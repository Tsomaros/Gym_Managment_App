import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import type { AppRequest } from './jwt.guard';

/**
 * 403 unless the caller is a platform admin. Re-reads the database rather than trusting the
 * token's claim, so revoking admin takes effect immediately, not when the token expires.
 * Use after JwtGuard: @UseGuards(JwtGuard, PlatformAdminGuard).
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException();

    const [row] = await db
      .select({ isPlatformAdmin: users.isPlatformAdmin })
      .from(users)
      .where(eq(users.id, userId));
    if (!row?.isPlatformAdmin) throw new ForbiddenException();

    req.user = { id: userId, isPlatformAdmin: true };
    return true;
  }
}
