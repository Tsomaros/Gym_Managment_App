import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import type { Device, KioskMe, PairDeviceResponse, PairingCodeResponse } from '@gym/shared';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { hashToken, randomToken } from '../auth/opaque-token';
import { Clock } from '../common/clock';
import { systemDb } from '../db/client';
import { devicePairingCodes, devices, gyms } from '../db/schema';
import { withGym } from '../db/tenant';
import { generateSignupCode, normaliseSignupCode } from '../signup/signup-code';

export const PAIRING_CODE_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class DevicesService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** Owner: a one-time code to type into a new tablet. Same alphabet and format as sign-up codes. */
  async createPairingCode(
    gymId: string,
    ownerId: string,
    name: string,
  ): Promise<PairingCodeResponse> {
    const { display, hash } = generateSignupCode();
    const expiresAt = new Date(this.clock.now().getTime() + PAIRING_CODE_TTL_MS);
    await withGym(gymId, (tx) =>
      tx.insert(devicePairingCodes).values({
        gymId,
        name,
        codeHash: hash,
        expiresAt,
        createdBy: ownerId,
      }),
    );
    return { code: display, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Public: trades a pairing code for a device token. No gym is known yet, so this runs through
   * systemDb. One statement claims the code; unknown, used, expired or malformed all give 410.
   */
  async pair(rawCode: string): Promise<PairDeviceResponse> {
    const code = normaliseSignupCode(rawCode);
    if (!code) throw new GoneException();

    const deviceToken = randomToken();
    return systemDb.transaction(async (tx) => {
      const [claimed] = await tx
        .update(devicePairingCodes)
        .set({ usedAt: sql`now()` })
        .where(
          and(
            eq(devicePairingCodes.codeHash, hashToken(code)),
            isNull(devicePairingCodes.usedAt),
            gt(devicePairingCodes.expiresAt, sql`now()`),
          ),
        )
        .returning({
          gymId: devicePairingCodes.gymId,
          name: devicePairingCodes.name,
          createdBy: devicePairingCodes.createdBy,
        });
      if (!claimed) throw new GoneException();

      const [device] = await tx
        .insert(devices)
        .values({
          gymId: claimed.gymId,
          name: claimed.name,
          tokenHash: hashToken(deviceToken),
          createdBy: claimed.createdBy,
        })
        .returning({ id: devices.id });
      const [gym] = await tx
        .select({ name: gyms.name })
        .from(gyms)
        .where(eq(gyms.id, claimed.gymId));
      await this.audit.record(tx, {
        gymId: claimed.gymId,
        actorId: claimed.createdBy,
        action: 'device.paired',
        entity: 'device',
        entityId: device!.id,
        data: { name: claimed.name },
      });
      return {
        deviceToken,
        gymId: claimed.gymId,
        gymName: gym!.name,
        deviceName: claimed.name,
      };
    });
  }

  async list(gymId: string): Promise<Device[]> {
    const rows = await withGym(gymId, (tx) =>
      tx
        .select({
          id: devices.id,
          name: devices.name,
          createdAt: devices.createdAt,
          lastSeenAt: devices.lastSeenAt,
          revokedAt: devices.revokedAt,
        })
        .from(devices)
        .orderBy(desc(devices.createdAt)),
    );
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.createdAt.toISOString(),
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      revoked: d.revokedAt !== null,
    }));
  }

  /** Owner. Takes effect on the tablet's next request (DeviceGuard reads the row every time). */
  async revoke(gymId: string, ownerId: string, deviceId: string): Promise<void> {
    await withGym(gymId, async (tx) => {
      const [device] = await tx
        .select({ id: devices.id, name: devices.name, revokedAt: devices.revokedAt })
        .from(devices)
        .where(eq(devices.id, deviceId))
        .for('update');
      if (!device) throw new NotFoundException();
      if (device.revokedAt) return;
      await tx.update(devices).set({ revokedAt: sql`now()` }).where(eq(devices.id, deviceId));
      await this.audit.record(tx, {
        gymId,
        actorId: ownerId,
        action: 'device.revoked',
        entity: 'device',
        entityId: deviceId,
        data: { name: device.name },
      });
    });
  }

  async me(deviceId: string): Promise<KioskMe> {
    const [row] = await systemDb
      .select({ gymId: devices.gymId, gymName: gyms.name, deviceName: devices.name })
      .from(devices)
      .innerJoin(gyms, eq(gyms.id, devices.gymId))
      .where(eq(devices.id, deviceId));
    if (!row) throw new NotFoundException();
    return row;
  }
}
