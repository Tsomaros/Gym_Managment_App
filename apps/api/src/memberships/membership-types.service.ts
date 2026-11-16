import { Injectable, NotFoundException } from '@nestjs/common';
import type { MembershipType, MembershipTypeInput } from '@gym/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { membershipTypes } from '../db/schema';
import { withGym } from '../db/tenant';

type Row = typeof membershipTypes.$inferSelect;

export function toMembershipType(r: Row): MembershipType {
  return {
    id: r.id,
    name: r.name,
    nameEn: r.nameEn,
    kind: r.kind,
    durationMonths: r.durationMonths,
    visitCount: r.visitCount,
    validityDays: r.validityDays,
    priceCents: r.priceCents,
    maxFreezeDays: r.maxFreezeDays,
    includesTrainer: r.includesTrainer,
    includesClasses: r.includesClasses,
    archived: r.archivedAt !== null,
  };
}

/** Every column the input decides; rules that don't apply to the kind are stored as null. */
function columns(input: MembershipTypeInput) {
  return {
    name: input.name,
    nameEn: input.nameEn,
    kind: input.kind,
    durationMonths: input.kind === 'time' ? input.durationMonths : null,
    visitCount: input.kind === 'visits' || input.kind === 'classes' ? input.visitCount : null,
    validityDays: input.kind === 'visits' || input.kind === 'classes' ? input.validityDays : null,
    priceCents: input.priceCents,
    maxFreezeDays: input.maxFreezeDays,
    includesTrainer: input.includesTrainer,
    includesClasses: input.includesClasses,
  };
}

/** What the history keeps of a type: enough to read later without the row. */
const snapshot = (r: Row) => ({
  name: r.name,
  kind: r.kind,
  priceCents: r.priceCents,
  durationMonths: r.durationMonths,
  visitCount: r.visitCount,
});

@Injectable()
export class MembershipTypesService {
  constructor(private readonly audit: AuditService) {}

  list(gymId: string, includeArchived: boolean): Promise<MembershipType[]> {
    return withGym(gymId, async (tx) => {
      const rows = await tx
        .select()
        .from(membershipTypes)
        .where(includeArchived ? undefined : isNull(membershipTypes.archivedAt))
        .orderBy(asc(membershipTypes.archivedAt), asc(membershipTypes.name));
      return rows.map(toMembershipType);
    });
  }

  create(gymId: string, actorId: string, input: MembershipTypeInput): Promise<MembershipType> {
    return withGym(gymId, async (tx) => {
      const [row] = await tx
        .insert(membershipTypes)
        .values({ gymId, ...columns(input) })
        .returning();
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'membership_type.created',
        entity: 'membership_type',
        entityId: row!.id,
        data: snapshot(row!),
      });
      return toMembershipType(row!);
    });
  }

  /** Replaces the type's rules. Memberships already sold keep their own snapshot. */
  update(
    gymId: string,
    actorId: string,
    id: string,
    input: MembershipTypeInput,
  ): Promise<MembershipType> {
    return withGym(gymId, async (tx) => {
      const [row] = await tx
        .update(membershipTypes)
        .set(columns(input))
        // Archived types are frozen: their rules are part of the record.
        .where(and(eq(membershipTypes.id, id), isNull(membershipTypes.archivedAt)))
        .returning();
      if (!row) throw new NotFoundException();
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'membership_type.updated',
        entity: 'membership_type',
        entityId: id,
        data: snapshot(row),
      });
      return toMembershipType(row);
    });
  }

  /** Archived types can't be sold and are hidden from lists by default. Archiving twice is a no-op. */
  archive(gymId: string, actorId: string, id: string): Promise<void> {
    return withGym(gymId, async (tx) => {
      const [row] = await tx
        .update(membershipTypes)
        .set({ archivedAt: sql`now()` })
        .where(and(eq(membershipTypes.id, id), isNull(membershipTypes.archivedAt)))
        .returning();
      if (!row) {
        // Already archived: nothing to do or record. Unknown (or another gym's): 404.
        const [exists] = await tx
          .select({ id: membershipTypes.id })
          .from(membershipTypes)
          .where(eq(membershipTypes.id, id));
        if (!exists) throw new NotFoundException();
        return;
      }
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'membership_type.archived',
        entity: 'membership_type',
        entityId: id,
        data: { name: row.name },
      });
    });
  }

  /** An unarchived type of this gym, or undefined. Used when selling. */
  async findSellable(gymId: string, id: string): Promise<Row | undefined> {
    const [row] = await withGym(gymId, (tx) =>
      tx
        .select()
        .from(membershipTypes)
        .where(and(eq(membershipTypes.id, id), isNull(membershipTypes.archivedAt))),
    );
    return row;
  }
}
