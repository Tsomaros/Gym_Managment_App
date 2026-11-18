import { z } from 'zod';

/** How many weeks back a chart looks: 3 / 6 / 12 months are 13 / 26 / 52. */
export const ProgressQuerySchema = z.object({
  weeks: z.coerce.number().int().min(4).max(104).default(26),
});
export type ProgressQuery = z.infer<typeof ProgressQuerySchema>;

export interface ProgressExerciseOption {
  exerciseId: string;
  nameEl: string;
  nameEn: string | null;
  /** Sessions with at least one done weight and reps set. */
  sessions: number;
}

export interface ExerciseProgressPoint {
  /** The gym-local day of the session. */
  date: string;
  topSetKg: number;
  topSetReps: number;
  /** Null when no set of the session has 1–12 reps. */
  e1rmKg: number | null;
}

export interface ExerciseProgress {
  exerciseId: string;
  points: ExerciseProgressPoint[];
}

export interface VolumePoint {
  /** Monday of the week. */
  weekStart: string;
  volumeKg: number;
}

export interface AttendancePoint {
  weekStart: string;
  days: number;
}
