import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { refreshTokens } from '../db/schema';
import { hashToken, randomToken } from './opaque-token';

export const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;

/**
 * Opaque refresh tokens: 32 random bytes, stored as sha256, rotated on every use.
 * Presenting a token that was already rotated or revoked revokes its whole family.
 */
@Injectable()
export class RefreshStore {
  async issue(userId: string, familyId: string = randomUUID()): Promise<string> {
    const raw = randomToken();
    await db.insert(refreshTokens).values({
      userId,
      familyId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    });
    return raw;
  }

  async rotate(raw: string): Promise<{ userId: string; raw: string }> {
    const tokenHash = hashToken(raw);
    const rotated = await db.transaction(async (tx) => {
      // One statement claims the token, so two concurrent refreshes can't both succeed.
      const [used] = await tx
        .update(refreshTokens)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(refreshTokens.tokenHash, tokenHash),
            isNull(refreshTokens.revokedAt),
            gt(refreshTokens.expiresAt, sql`now()`),
          ),
        )
        .returning({
          id: refreshTokens.id,
          userId: refreshTokens.userId,
          familyId: refreshTokens.familyId,
        });
      if (!used) return undefined;

      const next = randomToken();
      const [created] = await tx
        .insert(refreshTokens)
        .values({
          userId: used.userId,
          familyId: used.familyId,
          tokenHash: hashToken(next),
          expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        })
        .returning({ id: refreshTokens.id });
      await tx
        .update(refreshTokens)
        .set({ replacedBy: created!.id })
        .where(eq(refreshTokens.id, used.id));
      return { userId: used.userId, raw: next };
    });
    if (rotated) return rotated;

    // Not claimable: unknown, expired, or already used. Reuse of a used token means it leaked.
    const [known] = await db
      .select({ familyId: refreshTokens.familyId, revokedAt: refreshTokens.revokedAt })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash));
    if (known?.revokedAt) await this.revokeFamily(known.familyId);
    throw new UnauthorizedException();
  }

  async revokeFamily(familyId: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  /** Revokes the family of `raw`, if it is a known token. Used by logout. */
  async revokeFamilyOf(raw: string): Promise<void> {
    const [known] = await db
      .select({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashToken(raw)));
    if (known) await this.revokeFamily(known.familyId);
  }
}
