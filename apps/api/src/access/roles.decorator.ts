import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import type { GymRole } from '@gym/shared';
import { GYM_ROLES_KEY, GymRolesGuard } from './gym-roles.guard';
import { JwtGuard } from './jwt.guard';
import { PlatformAdminGuard } from './platform-admin.guard';

/**
 * For `/gyms/:gymId/...` routes: requires a signed-in caller holding at least one of `roles`
 * in that gym ('owner' also satisfies 'reception'). Applies JwtGuard and GymRolesGuard in order.
 */
export const GymRoles = (...roles: [GymRole, ...GymRole[]]) =>
  applyDecorators(SetMetadata(GYM_ROLES_KEY, roles), UseGuards(JwtGuard, GymRolesGuard));

/** For platform routes: a signed-in caller who is a platform admin (checked against the database). */
export const PlatformAdmin = () => UseGuards(JwtGuard, PlatformAdminGuard);
