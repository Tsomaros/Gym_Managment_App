import { z } from 'zod';
import type { Measure, MuscleGroup } from './exercises.js';

export const PLAN_KINDS = ['interactive', 'pdf'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const PLAN_STATUSES = ['draft', 'active', 'archived'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const MAX_PLAN_DAYS = 14;
export const MAX_DAY_EXERCISES = 30;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

const title = z.string().trim().min(1).max(80);
const reps = z.number().int().min(1).max(100).nullish();

export const PlanExerciseInputSchema = z
  .object({
    id: z.uuid().optional(),
    exerciseId: z.uuid(),
    sets: z.number().int().min(1).max(20),
    repsMin: reps,
    repsMax: reps,
    toFailure: z.boolean().default(false),
    /** kg in steps of 0.25 (kept exact in binary, so the multiplication check is safe). */
    weightKg: z
      .number()
      .min(0)
      .max(999.75)
      .refine((v) => Number.isInteger(v * 4), 'Steps of 0.25 kg')
      .nullish(),
    restSeconds: z.number().int().min(0).max(900).nullish(),
    durationSeconds: z.number().int().min(1).max(7200).nullish(),
    notes: z.string().trim().max(300).nullish(),
  })
  .superRefine((v, ctx) => {
    const hasMin = v.repsMin != null;
    const hasMax = v.repsMax != null;
    if (v.toFailure && (hasMin || hasMax)) {
      ctx.addIssue({ code: 'custom', path: ['toFailure'], message: 'No reps when to failure' });
    } else if (hasMin !== hasMax) {
      ctx.addIssue({ code: 'custom', path: ['repsMax'], message: 'Give both reps bounds or none' });
    } else if (hasMin && hasMax && v.repsMin! > v.repsMax!) {
      ctx.addIssue({ code: 'custom', path: ['repsMin'], message: 'Minimum above maximum' });
    }
  });
export type PlanExerciseInput = z.infer<typeof PlanExerciseInputSchema>;

export const PlanDayInputSchema = z.object({
  id: z.uuid().optional(),
  title,
  exercises: z.array(PlanExerciseInputSchema).max(MAX_DAY_EXERCISES),
});
export type PlanDayInput = z.infer<typeof PlanDayInputSchema>;

const planFields = {
  title,
  notes: z.string().trim().max(1000).nullish(),
  days: z.array(PlanDayInputSchema).min(1).max(MAX_PLAN_DAYS),
};

/** An id may appear once in a save, whether it names a day or an exercise. */
function uniqueIds(v: { days: PlanDayInput[] }, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const d of v.days) {
    for (const id of [d.id, ...d.exercises.map((e) => e.id)]) {
      if (!id) continue;
      if (seen.has(id)) ctx.addIssue({ code: 'custom', path: ['days'], message: 'Duplicate id' });
      seen.add(id);
    }
  }
}

export const PlanInputSchema = z.object(planFields).superRefine(uniqueIds);
export type PlanInput = z.infer<typeof PlanInputSchema>;

/** A new plan: the same body, optionally activated straight away. */
export const CreatePlanSchema = z
  .object({ ...planFields, activate: z.boolean().optional() })
  .superRefine(uniqueIds);
export type CreatePlan = z.infer<typeof CreatePlanSchema>;

export interface PlanExercise {
  id: string;
  exerciseId: string;
  exercise: {
    nameEl: string;
    nameEn: string | null;
    muscleGroup: MuscleGroup;
    measure: Measure;
    archived: boolean;
  };
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
  toFailure: boolean;
  weightKg: number | null;
  restSeconds: number | null;
  durationSeconds: number | null;
  notes: string | null;
}

export interface PlanDay {
  id: string;
  title: string;
  exercises: PlanExercise[];
}

export interface Plan {
  id: string;
  memberId: string | null;
  authorId: string | null;
  author: { firstName: string; lastName: string } | null;
  isTemplate: boolean;
  kind: PlanKind;
  title: string;
  notes: string | null;
  status: PlanStatus;
  /** A signed link that works for 5 minutes; only for PDF plans. */
  pdfUrl: string | null;
  activatedAt: string | null;
  days: PlanDay[];
}

export interface PlanSummary {
  id: string;
  title: string;
  kind: PlanKind;
  status: PlanStatus;
  activatedAt: string | null;
  archivedAt: string | null;
  authorName: string | null;
}

export const SaveAsTemplateSchema = z.object({ title });
export type SaveAsTemplate = z.infer<typeof SaveAsTemplateSchema>;

export const FromTemplateSchema = z.object({
  templateId: z.uuid(),
  activate: z.boolean().optional(),
});
export type FromTemplate = z.infer<typeof FromTemplateSchema>;

/** The text fields sent next to the PDF file (multipart, so every value is a string). */
export const PdfPlanFieldsSchema = z.object({
  title,
  activate: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type PdfPlanFields = z.infer<typeof PdfPlanFieldsSchema>;
