import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CONSENT_KINDS,
  CONSENT_TEXT_VERSION,
  type ConsentKind,
  type ConsentState,
  type GymRole,
} from '@gym/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { bodyMeasurements, healthConsents, progressPhotos } from '../db/schema';
import { type Tx, withGym } from '../db/tenant';
import { gymToday } from '../memberships/memberships.service';
import { StorageService } from '../storage/storage.service';
import { healthAccess } from '../workouts/health-access';

export interface Caller {
  userId: string;
  roles: GymRole[];
}

/**
 * Serialises consent changes and anything that checks or deletes consent-backed data for one
 * member until the transaction ends: a measurement recorded while the member withdraws is either
 * deleted with the rest or refused, never left behind.
 */
export async function lockConsent(tx: Tx, memberId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'consent:' + memberId}))`);
}

/** The member's active consent of `kind`, or undefined. */
export async function activeConsent(tx: Tx, memberId: string, kind: ConsentKind) {
  const [row] = await tx
    .select()
    .from(healthConsents)
    .where(
      and(
        eq(healthConsents.memberId, memberId),
        eq(healthConsents.kind, kind),
        isNull(healthConsents.withdrawnAt),
      ),
    );
  return row;
}

async function stateOf(tx: Tx, memberId: string): Promise<ConsentState> {
  const state = Object.fromEntries(
    CONSENT_KINDS.map((k) => [k, { granted: false, at: null }]),
  ) as ConsentState;
  const rows = await tx
    .select()
    .from(healthConsents)
    .where(and(eq(healthConsents.memberId, memberId), isNull(healthConsents.withdrawnAt)));
  for (const r of rows) {
    state[r.kind as ConsentKind] = { granted: true, at: r.grantedAt.toISOString() };
  }
  return state;
}

@Injectable()
export class ConsentsService {
  private readonly log = new Logger(ConsentsService.name);

  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly storage: StorageService,
  ) {}

  state(gymId: string, caller: Caller, memberId: string): Promise<ConsentState> {
    return withGym(gymId, async (tx) => {
      const today = await gymToday(tx, gymId, this.clock.now());
      const access = await healthAccess(tx, gymId, caller, memberId, today);
      if (!access.read) throw new NotFoundException();
      return stateOf(tx, memberId);
    });
  }

  /** The member grants `kind`. `created` is false when it was already granted. */
  grant(
    gymId: string,
    memberId: string,
    kind: ConsentKind,
  ): Promise<{ state: ConsentState; created: boolean }> {
    return withGym(gymId, async (tx) => {
      await lockConsent(tx, memberId);
      const existing = await activeConsent(tx, memberId, kind);
      if (existing) return { state: await stateOf(tx, memberId), created: false };
      const [row] = await tx
        .insert(healthConsents)
        .values({
          gymId,
          memberId,
          kind,
          textVersion: CONSENT_TEXT_VERSION,
          grantedAt: this.clock.now(),
        })
        .returning({ id: healthConsents.id });
      await this.audit.record(tx, {
        gymId,
        actorId: memberId,
        action: 'consent.granted',
        entity: 'health_consent',
        entityId: row!.id,
        data: { kind, textVersion: CONSENT_TEXT_VERSION },
      });
      return { state: await stateOf(tx, memberId), created: true };
    });
  }

  /**
   * The member withdraws `kind`: the consent row is kept (with `withdrawn_at`) as evidence and
   * all of the member's data of that kind in this gym is deleted in the same transaction.
   * Withdrawing what is not granted does nothing.
   */
  async withdraw(gymId: string, memberId: string, kind: ConsentKind): Promise<void> {
    // Storage objects go after the commit: the rows are the source of truth. A failed delete
    // is logged and retried by the next withdrawal (the sweep below covers the whole folder).
    await withGym(gymId, async (tx) => {
      await lockConsent(tx, memberId);
      const existing = await activeConsent(tx, memberId, kind);
      if (!existing) return;
      await tx
        .update(healthConsents)
        // greatest(): a clock that stepped back since the grant must not break the
        // withdrawn_at >= granted_at check — withdrawing is a right and cannot fail on skew.
        .set({
          withdrawnAt: sql`greatest(${this.clock.now().toISOString()}::timestamptz, ${healthConsents.grantedAt})`,
        })
        .where(eq(healthConsents.id, existing.id));
      const deleted = await this.deleteData(tx, memberId, kind);
      await this.audit.record(tx, {
        gymId,
        actorId: memberId,
        action: 'consent.withdrawn',
        entity: 'health_consent',
        entityId: existing.id,
        data: { kind, deleted },
      });
    });
    if (kind === 'photos') {
      // The whole folder, not just the keys of the deleted rows: an object left by an earlier
      // failed delete (or by an upload that raced a withdrawal) goes too, and a repeated
      // withdrawal retries it. Any key lives under this prefix.
      await this.storage
        .removePrefix(`gyms/${gymId}/progress/${memberId}/`)
        .catch((err: Error) => this.log.warn(`Could not sweep progress photos: ${err.message}`));
    }
  }

  /** Deletes the member's data of `kind` and returns how many items went. */
  private async deleteData(tx: Tx, memberId: string, kind: ConsentKind): Promise<number> {
    if (kind === 'measurements') {
      const rows = await tx
        .delete(bodyMeasurements)
        .where(eq(bodyMeasurements.memberId, memberId))
        .returning({ id: bodyMeasurements.id });
      return rows.length;
    }
    const rows = await tx
      .delete(progressPhotos)
      .where(eq(progressPhotos.memberId, memberId))
      .returning({ id: progressPhotos.id });
    return rows.length;
  }
}
