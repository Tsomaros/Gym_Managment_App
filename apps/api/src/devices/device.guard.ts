import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { hashToken } from '../auth/opaque-token';
import { systemDb } from '../db/client';
import { devices } from '../db/schema';

export interface CurrentDeviceInfo {
  id: string;
  gymId: string;
}

export type DeviceRequest = Request & { device?: CurrentDeviceInfo };

/**
 * Requires `Authorization: Device <token>` of a paired, non-revoked tablet and sets `req.device`.
 * Looked up through systemDb on every request, so a revoked tablet gets 401 on its next call.
 */
@Injectable()
export class DeviceGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<DeviceRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Device' || !token) throw new UnauthorizedException();

    const [device] = await systemDb
      .select({ id: devices.id, gymId: devices.gymId, revokedAt: devices.revokedAt })
      .from(devices)
      .where(eq(devices.tokenHash, hashToken(token)));
    if (!device || device.revokedAt) throw new UnauthorizedException();

    // At most one write a minute per tablet.
    await systemDb
      .update(devices)
      .set({ lastSeenAt: sql`now()` })
      .where(
        and(
          eq(devices.id, device.id),
          or(isNull(devices.lastSeenAt), lt(devices.lastSeenAt, sql`now() - interval '1 minute'`)),
        ),
      );

    req.device = { id: device.id, gymId: device.gymId };
    return true;
  }
}

export const CurrentDevice = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const device = ctx.switchToHttp().getRequest<DeviceRequest>().device;
  if (!device) throw new Error('@CurrentDevice() used on a route without DeviceGuard');
  return device;
});
