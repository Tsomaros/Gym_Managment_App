import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { GymRole } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { gymRoles } from '../db/schema';
import { withGym } from '../db/tenant';
import type { AppRequest } from './jwt.guard';

export const GYM_ROLES_KEY = 'gymRoles';

// Guards run before pipes, so :gymId is checked here; handlers still use ParseUUIDPipe.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The owner may do everything reception may (spec §5). */
function satisfies(held: GymRole[], required: GymRole[]): boolean {
  return required.some(
    (role) => held.includes(role) || (role === 'reception' && held.includes('owner')),
  );
}

/**
 * Loads the caller's roles in `:gymId` (through row-level security) and requires one of the
 * roles given to @GymRoles(). Sets `req.gym`. The platform admin gets no implicit access.
 */
@Injectable()
export class GymRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<GymRole[] | undefined>(GYM_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) throw new Error('GymRolesGuard needs @GymRoles(...) with roles');

    const req = context.switchToHttp().getRequest<AppRequest>();
    const rawGymId = req.params.gymId;
    if (typeof rawGymId !== 'string' || !UUID.test(rawGymId)) {
      throw new BadRequestException('gymId must be a uuid');
    }
    const gymId = rawGymId.toLowerCase(); // stored form, so later string comparisons match
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException(); // JwtGuard must run first

    const rows = await withGym(gymId, (tx) =>
      tx.select({ role: gymRoles.role }).from(gymRoles).where(eq(gymRoles.userId, userId)),
    );
    const held = rows.map((r) => r.role);
    if (!satisfies(held, required)) throw new ForbiddenException();

    req.gym = { id: gymId, roles: held };
    return true;
  }
}
