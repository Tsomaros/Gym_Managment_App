import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Payment, PaymentsQuery } from '@gym/shared';
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { namesOf, person } from '../common/names';
import { gyms, memberships, payments } from '../db/schema';
import { withGym } from '../db/tenant';
import { lockMember } from './memberships.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** Payments whose time falls on the days `from`..`to` (both included) in the gym's time zone. */
  async list(gymId: string, q: PaymentsQuery): Promise<Payment[]> {
    const rows = await withGym(gymId, async (tx) => {
      const [gym] = await tx
        .select({ timezone: gyms.timezone })
        .from(gyms)
        .where(eq(gyms.id, gymId));
      // Local midnights of `from` and of the day after `to`, as instants.
      const start = sql`(${q.from}::date)::timestamp at time zone ${gym!.timezone}`;
      const end = sql`(${q.to}::date + 1)::timestamp at time zone ${gym!.timezone}`;
      return tx
        .select({ p: payments, membershipName: memberships.name })
        .from(payments)
        .innerJoin(memberships, eq(memberships.id, payments.membershipId))
        .where(and(gte(payments.paidAt, start), lt(payments.paidAt, end)))
        .orderBy(desc(payments.paidAt));
    });
    return this.toPayments(rows);
  }

  /** Payments of one member, newest first (member detail, owner only). */
  async listForMember(gymId: string, memberId: string): Promise<Payment[]> {
    const rows = await withGym(gymId, (tx) =>
      tx
        .select({ p: payments, membershipName: memberships.name })
        .from(payments)
        .innerJoin(memberships, eq(memberships.id, payments.membershipId))
        .where(eq(payments.memberId, memberId))
        .orderBy(desc(payments.paidAt)),
    );
    return this.toPayments(rows);
  }

  /** Voids a payment and the membership it paid for. Owner only. Twice → 409. */
  async void(gymId: string, actorId: string, paymentId: string, reason: string): Promise<void> {
    await withGym(gymId, async (tx) => {
      const [target] = await tx
        .select({ memberId: payments.memberId })
        .from(payments)
        .where(eq(payments.id, paymentId));
      if (!target) throw new NotFoundException();
      await lockMember(tx, gymId, target.memberId);

      const now = this.clock.now();
      const [voided] = await tx
        .update(payments)
        .set({ voidedAt: now, voidedBy: actorId, voidReason: reason })
        .where(and(eq(payments.id, paymentId), isNull(payments.voidedAt)))
        .returning({ membershipId: payments.membershipId, amountCents: payments.amountCents });
      if (!voided) throw new ConflictException({ message: 'Payment already voided' });
      await tx
        .update(memberships)
        .set({ voidedAt: now })
        .where(and(eq(memberships.id, voided.membershipId), isNull(memberships.voidedAt)));
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'payment.voided',
        entity: 'payment',
        entityId: paymentId,
        data: { membershipId: voided.membershipId, amountCents: voided.amountCents, reason },
      });
    });
  }

  private async toPayments(
    rows: { p: typeof payments.$inferSelect; membershipName: string }[],
  ): Promise<Payment[]> {
    const names = await namesOf(rows.flatMap(({ p }) => [p.memberId, p.recordedBy, p.voidedBy]));
    return rows.map(({ p, membershipName }) => ({
      id: p.id,
      membershipId: p.membershipId,
      membershipName,
      memberId: p.memberId,
      memberName: names.get(p.memberId) ?? '',
      amountCents: p.amountCents,
      method: p.method,
      paidAt: p.paidAt.toISOString(),
      recordedBy: person(p.recordedBy, names),
      voidedAt: p.voidedAt?.toISOString() ?? null,
      voidedBy: person(p.voidedBy, names),
      voidReason: p.voidReason,
    }));
  }
}
