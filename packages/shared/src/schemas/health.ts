import { z } from 'zod';

/** Health data a member can consent to (spec §8). Each kind is consented to and withdrawn alone. */
export const CONSENT_KINDS = ['measurements', 'photos'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/** Stored with every grant: which wording the member agreed to. */
export const CONSENT_TEXT_VERSION = 'v1';

export const ConsentKindSchema = z.enum(CONSENT_KINDS);

export interface ConsentKindState {
  granted: boolean;
  /** When the current consent was given; null while not granted. */
  at: string | null;
}
export type ConsentState = Record<ConsentKind, ConsentKindState>;

/** Exact in decimal: `v` has at most `places` decimals. */
const decimals = (places: number) => (v: number) => {
  const f = 10 ** places;
  return Math.abs(v * f - Math.round(v * f)) < 1e-6;
};

const cm = z.number().min(10).max(300).refine(decimals(1), 'One decimal').nullish();

const MEASURED_VALUES = [
  'weightKg',
  'bodyFatPct',
  'waistCm',
  'hipsCm',
  'chestCm',
  'armCm',
  'thighCm',
] as const;

export const MeasurementInputSchema = z
  .object({
    /** A gym-local day, not in the future (checked by the API against the gym's clock). */
    measuredOn: z.iso.date().refine((d) => d >= '1900-01-01', 'Too long ago'),
    weightKg: z.number().min(20).max(400).refine(decimals(2), 'Two decimals').nullish(),
    bodyFatPct: z.number().min(2).max(70).refine(decimals(1), 'One decimal').nullish(),
    waistCm: cm,
    hipsCm: cm,
    chestCm: cm,
    armCm: cm,
    thighCm: cm,
    notes: z
      .string()
      .trim()
      .max(300)
      .refine((s) => !s.includes('\u0000'), 'No NUL characters')
      .nullish(),
  })
  .refine((v) => MEASURED_VALUES.some((k) => v[k] != null), {
    path: ['weightKg'],
    message: 'Give at least one value',
  });
export type MeasurementInput = z.infer<typeof MeasurementInputSchema>;

export interface Measurement {
  id: string;
  measuredOn: string;
  weightKg: number | null;
  bodyFatPct: number | null;
  waistCm: number | null;
  hipsCm: number | null;
  chestCm: number | null;
  armCm: number | null;
  thighCm: number | null;
  notes: string | null;
  recordedBy: string | null;
}

export const MAX_PROGRESS_PHOTO_BYTES = 3 * 1024 * 1024;

/** The text fields sent next to the photo (multipart). */
export const ProgressPhotoFieldsSchema = z.object({ takenOn: z.iso.date() });
export type ProgressPhotoFields = z.infer<typeof ProgressPhotoFieldsSchema>;

export interface ProgressPhoto {
  id: string;
  takenOn: string;
  /** A signed link valid for 5 minutes; fetch the list again for a fresh one. */
  url: string;
  uploadedBy: string | null;
}
