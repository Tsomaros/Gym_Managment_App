import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { GymRole } from '@gym/shared';
import type { AppRequest } from './jwt.guard';

/** The gym of a `/gyms/:gymId/...` request and the caller's roles there, set by GymRolesGuard. */
export interface GymContext {
  id: string;
  roles: GymRole[];
}

export const CurrentGym = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const gym = ctx.switchToHttp().getRequest<AppRequest>().gym;
  if (!gym) throw new Error('@CurrentGym() used on a route without @GymRoles()');
  return gym;
});
