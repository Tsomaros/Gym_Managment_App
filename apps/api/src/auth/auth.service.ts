import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { GymRole, Login, MeResponse } from '@gym/shared';
import { asc, eq } from 'drizzle-orm';
import { db, systemDb } from '../db/client';
import { gymRoles, gyms, users } from '../db/schema';
import { hashPassword, verifyPassword } from './password';
import { RefreshStore } from './refresh-store';
import { signAccessToken } from './tokens';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  /** Verified against when the email is unknown, so both failures take about as long. */
  private dummyHash?: Promise<string>;

  constructor(private readonly refreshStore: RefreshStore) {}

  async login({ email, password }: Login): Promise<IssuedTokens> {
    const [user] = await db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        isPlatformAdmin: users.isPlatformAdmin,
      })
      .from(users)
      .where(eq(users.email, email));

    this.dummyHash ??= hashPassword('dummy password for timing');
    const ok = await verifyPassword(user?.passwordHash ?? (await this.dummyHash), password);
    if (!user?.passwordHash || !ok) {
      throw new UnauthorizedException({ message: 'Invalid credentials' });
    }

    return {
      accessToken: signAccessToken({ sub: user.id, adm: user.isPlatformAdmin }),
      refreshToken: await this.refreshStore.issue(user.id),
    };
  }

  async refresh(raw: string | undefined): Promise<IssuedTokens> {
    if (!raw) throw new UnauthorizedException();
    const { userId, raw: refreshToken } = await this.refreshStore.rotate(raw);
    const [user] = await db
      .select({ isPlatformAdmin: users.isPlatformAdmin })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) throw new UnauthorizedException();
    return {
      accessToken: signAccessToken({ sub: userId, adm: user.isPlatformAdmin }),
      refreshToken,
    };
  }

  async logout(raw: string | undefined): Promise<void> {
    if (raw) await this.refreshStore.revokeFamilyOf(raw);
  }

  async me(userId: string): Promise<MeResponse> {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        locale: users.locale,
        isPlatformAdmin: users.isPlatformAdmin,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) throw new UnauthorizedException();

    // No gym is chosen yet, so memberships across gyms are read with systemDb, scoped to this user.
    const rows = await systemDb
      .select({ gymId: gyms.id, gymName: gyms.name, role: gymRoles.role })
      .from(gymRoles)
      .innerJoin(gyms, eq(gyms.id, gymRoles.gymId))
      .where(eq(gymRoles.userId, userId))
      .orderBy(asc(gyms.name), asc(gymRoles.role));

    const byGym = new Map<string, { gymId: string; gymName: string; roles: GymRole[] }>();
    for (const { gymId, gymName, role } of rows) {
      const gym = byGym.get(gymId) ?? { gymId, gymName, roles: [] };
      gym.roles.push(role);
      byGym.set(gymId, gym);
    }

    return { ...user, locale: user.locale as MeResponse['locale'], gyms: [...byGym.values()] };
  }
}
