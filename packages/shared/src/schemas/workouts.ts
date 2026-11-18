import { z } from 'zod';
import type { Measure } from './exercises.js';

const instant = z.iso.datetime({ offset: true });

export const SessionUpsertSchema = z
  .object({
    planId: z.uuid().nullish(),
    planDayId: z.uuid().nullish(),
    startedAt: instant,
    finishedAt: instant.nullish(),
    notes: z.string().trim().max(1000).nullish(),
  })
  .refine((v) => !v.finishedAt || Date.parse(v.finishedAt) >= Date.parse(v.startedAt), {
    path: ['finishedAt'],
    message: 'Finished before it started',
  });
export type SessionUpsert = z.infer<typeof SessionUpsertSchema>;

export const SetUpsertSchema = z.object({
  exerciseId: z.uuid(),
  planExerciseId: z.uuid().nullish(),
  setIndex: z.number().int().min(0).max(99),
  reps: z.number().int().min(0).max(100).nullish(),
  /** kg in steps of 0.25 (exact in binary, so the multiplication check is safe). */
  weightKg: z
    .number()
    .min(0)
    .max(999.75)
    .refine((v) => Number.isInteger(v * 4), 'Steps of 0.25 kg')
    .nullish(),
  durationSeconds: z.number().int().min(1).max(7200).nullish(),
  done: z.boolean(),
  loggedAt: instant,
});
export type SetUpsert = z.infer<typeof SetUpsertSchema>;

export const SessionListQuerySchema = z.object({
  before: instant.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SessionListQuery = z.infer<typeof SessionListQuerySchema>;

export const LastPerformanceQuerySchema = z.object({
  exerciseIds: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.uuid()).min(1).max(30)),
});
export type LastPerformanceQuery = z.infer<typeof LastPerformanceQuerySchema>;

export interface WorkoutSet {
  id: string;
  exerciseId: string;
  planExerciseId: string | null;
  measure: Measure;
  setIndex: number;
  reps: number | null;
  weightKg: number | null;
  durationSeconds: number | null;
  done: boolean;
  loggedAt: string;
}

export interface WorkoutSession {
  id: string;
  memberId: string;
  planId: string | null;
  planDayId: string | null;
  startedAt: string;
  /** Null while open. A session open for over 12 hours is shown finished at its last set. */
  finishedAt: string | null;
  notes: string | null;
  sets: WorkoutSet[];
}

export interface LastPerformance {
  exerciseId: string;
  sessionDate: string;
  sets: { reps: number | null; weightKg: number | null; durationSeconds: number | null }[];
}
