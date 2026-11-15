export const GYM_ROLES = ['owner', 'reception', 'trainer', 'member'] as const;
export type GymRole = (typeof GYM_ROLES)[number];
