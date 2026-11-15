import type { GymRole, MeResponse } from '@gym/shared';

/** Highest role first: the shell shown for a gym is the one for the caller's highest role there. */
export const ROLE_RANK: readonly GymRole[] = ['owner', 'reception', 'trainer', 'member'];

export function highestRole(roles: readonly GymRole[]): GymRole | undefined {
  return ROLE_RANK.find((r) => roles.includes(r));
}

/** Where "/" leads: the only gym, the picker for several, the platform area for an admin with none. */
export function homePath(me: MeResponse): string {
  if (me.gyms.length === 1) return `/g/${me.gyms[0]!.gymId}`;
  if (me.gyms.length === 0 && me.isPlatformAdmin) return '/platform';
  return '/gyms';
}
