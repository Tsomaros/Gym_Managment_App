import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { AppRequest } from '../access/jwt.guard';
import { gyms } from '../db/schema';
import { withGym } from '../db/tenant';

/**
 * Runs after @GymRoles('reception'): the owner always passes, reception only while the owner has
 * switched on `reception_can_edit_shifts` (spec §6.3).
 */
@Injectable()
export class CanEditShiftsGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gym = context.switchToHttp().getRequest<AppRequest>().gym;
    if (!gym) throw new Error('CanEditShiftsGuard needs @GymRoles(...) before it');
    if (gym.roles.includes('owner')) return true;
    const [row] = await withGym(gym.id, (tx) =>
      tx.select({ allowed: gyms.receptionCanEditShifts }).from(gyms).where(eq(gyms.id, gym.id)),
    );
    if (!row?.allowed) throw new ForbiddenException();
    return true;
  }
}
