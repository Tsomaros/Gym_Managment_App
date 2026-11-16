import { Injectable } from '@nestjs/common';
import type { AuditAction, AuditEntry, AuditPage, AuditQuery } from '@gym/shared';
import { and, desc, eq, inArray, lt, type SQL } from 'drizzle-orm';
import { systemDb } from '../db/client';
import { auditLog, users } from '../db/schema';
import { type Tx, withGym } from '../db/tenant';

export interface AuditEvent {
  gymId: string;
  actorId: string | null;
  action: AuditAction;
  entity: string;
  entityId?: string;
  /** Never passwords, hashes or codes: the history is shown to the owner as is. */
  data?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  /**
   * Appends one entry inside the caller's transaction (withGym, or systemDb on paths without a
   * gym context), so the entry exists exactly when the change it records commits.
   */
  async record(tx: Tx, e: AuditEvent): Promise<void> {
    await tx.insert(auditLog).values({
      gymId: e.gymId,
      actorId: e.actorId,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      data: e.data ?? {},
    });
  }

  /** Newest first; `before` is the id of the last entry of the previous page. */
  async list(gymId: string, q: AuditQuery): Promise<AuditPage> {
    const filters: SQL[] = [];
    if (q.before) filters.push(lt(auditLog.id, Number(q.before)));
    if (q.entity) filters.push(eq(auditLog.entity, q.entity));
    if (q.entityId) filters.push(eq(auditLog.entityId, q.entityId));

    const rows = await withGym(gymId, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(auditLog.id))
        // One extra row tells whether an older page exists.
        .limit(q.limit + 1),
    );

    // Actors may no longer hold a role in this gym (so gym_app can't see them under users RLS).
    // Their names are read through systemDb, only for ids that appear in this gym's history.
    const page = rows.slice(0, q.limit);
    const actorIds = [...new Set(page.map((r) => r.actorId).filter((id): id is string => !!id))];
    const names = new Map(
      actorIds.length
        ? (
            await systemDb
              .select({ id: users.id, fullName: users.fullName })
              .from(users)
              .where(inArray(users.id, actorIds))
          ).map((u) => [u.id, u.fullName])
        : [],
    );

    const entries: AuditEntry[] = page.map((r) => {
      const name = r.actorId ? names.get(r.actorId) : undefined;
      return {
        id: String(r.id),
        action: r.action as AuditAction,
        entity: r.entity,
        entityId: r.entityId,
        actor: r.actorId && name !== undefined ? { id: r.actorId, fullName: name } : null,
        data: r.data,
        at: r.at.toISOString(),
      };
    });
    return {
      entries,
      nextBefore: rows.length > q.limit ? String(page.at(-1)!.id) : null,
    };
  }
}
