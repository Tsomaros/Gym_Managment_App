import { z } from 'zod';
import type { MemberStatus } from './members.js';

export const SetTrainerSchema = z.object({ trainerId: z.uuid() });
export type SetTrainer = z.infer<typeof SetTrainerSchema>;

/** A member's primary trainer. `paused` while the member has no current membership with a trainer. */
export interface MemberTrainer {
  userId: string;
  firstName: string;
  lastName: string;
  paused: boolean;
}

/** One row of a trainer's client list. */
export interface TrainerClient {
  memberId: string;
  firstName: string;
  lastName: string;
  /** A signed link that works for 5 minutes; null when the member has no photo. */
  photoUrl: string | null;
  paused: boolean;
  membershipStatus: MemberStatus;
  assignedAt: string;
  /** True for a member the trainer covers for today only (not a primary client). */
  cover?: boolean;
}

/** A trainer covering a member for one gym date. */
export interface TrainerCover {
  memberId: string;
  trainerId: string;
  date: string;
}
