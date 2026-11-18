import { z } from 'zod';

export const MUSCLE_GROUPS = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'legs',
  'glutes',
  'core',
  'cardio',
  'full_body',
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

/** How an exercise is logged: weight and reps, reps only, or a duration (phase 4b). */
export const MEASURES = ['weight_reps', 'reps', 'duration'] as const;
export type Measure = (typeof MEASURES)[number];

const nameEn = z
  .string()
  .trim()
  .max(80)
  .nullish()
  .transform((v) => (v ? v : null));

export const ExerciseInputSchema = z.object({
  nameEl: z.string().trim().min(1).max(80),
  nameEn: nameEn.optional(),
  muscleGroup: z.enum(MUSCLE_GROUPS),
  measure: z.enum(MEASURES),
});
export type ExerciseInput = z.infer<typeof ExerciseInputSchema>;

export const ExercisePatchSchema = z
  .object({
    nameEl: z.string().trim().min(1).max(80),
    nameEn,
    muscleGroup: z.enum(MUSCLE_GROUPS),
    measure: z.enum(MEASURES),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export type ExercisePatch = z.infer<typeof ExercisePatchSchema>;

export const ExerciseQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  muscleGroup: z.enum(MUSCLE_GROUPS).optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ExerciseQuery = z.infer<typeof ExerciseQuerySchema>;

export interface Exercise {
  id: string;
  nameEl: string;
  nameEn: string | null;
  muscleGroup: MuscleGroup;
  measure: Measure;
  archived: boolean;
  createdBy: string | null;
}
