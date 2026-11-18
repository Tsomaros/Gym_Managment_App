import { z } from 'zod';
import { isoDateSchema } from './common.js';
import { shiftTimeSchema, type Weekday } from './shifts.js';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const weekdaySchema = z
  .number()
  .int()
  .refine((n): n is Weekday => (WEEKDAYS as readonly number[]).includes(n));

/** The longest range a class-session query may cover, in days (both ends included). */
export const MAX_CLASS_QUERY_DAYS = 31;
/** Sessions are materialised for today … today + 27. */
export const CLASS_HORIZON_DAYS = 28;
export const CLASS_CANCEL_CUTOFF_MIN = 0;
export const CLASS_CANCEL_CUTOFF_MAX = 1440;

const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** End time of a class that starts at `startsAt` (HH:MM) and lasts `minutes`; null if it crosses midnight. */
export function classEndTime(startsAt: string, minutes: number): string | null {
  const [h, m] = startsAt.split(':').map(Number) as [number, number];
  const total = h * 60 + m + minutes;
  if (total >= 24 * 60) return null;
  const hh = Math.floor(total / 60) % 24;
  return `${String(hh).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const durationSchema = z.number().int().min(15).max(240);
const capacitySchema = z.number().int().min(1).max(200);
const roomSchema = z.string().trim().min(1).max(40).nullable().optional();

export const CreateClassTypeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  nameEn: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  defaultCapacity: capacitySchema,
  defaultDurationMinutes: durationSchema,
});
export type CreateClassType = z.infer<typeof CreateClassTypeSchema>;

export const UpdateClassTypeSchema = CreateClassTypeSchema.partial().refine(
  (b) => Object.keys(b).length > 0,
  { message: 'Nothing to change' },
);
export type UpdateClassType = z.infer<typeof UpdateClassTypeSchema>;

export interface ClassTypeView {
  id: string;
  name: string;
  nameEn: string | null;
  description: string | null;
  defaultCapacity: number;
  defaultDurationMinutes: number;
  archived: boolean;
}

const endsWithinDay = (s: { startsAt: string; durationMinutes: number }) =>
  classEndTime(s.startsAt, s.durationMinutes) !== null;

export const CreateClassSeriesSchema = z
  .object({
    classTypeId: z.uuid(),
    weekday: weekdaySchema,
    startsAt: shiftTimeSchema,
    durationMinutes: durationSchema,
    capacity: capacitySchema,
    trainerId: z.uuid().nullable().optional(),
    room: roomSchema,
    validFrom: isoDateSchema,
    validUntil: isoDateSchema.nullable().optional(),
  })
  .refine(endsWithinDay, { message: 'A class must end before midnight', path: ['durationMinutes'] })
  .refine((s) => !s.validUntil || s.validUntil >= s.validFrom, {
    message: 'validUntil is before validFrom',
    path: ['validUntil'],
  });
export type CreateClassSeries = z.infer<typeof CreateClassSeriesSchema>;

export const EndClassSeriesSchema = z.object({ lastDate: isoDateSchema });
export type EndClassSeries = z.infer<typeof EndClassSeriesSchema>;

export const CreateClassSessionSchema = z
  .object({
    classTypeId: z.uuid(),
    date: isoDateSchema,
    startsAt: shiftTimeSchema,
    durationMinutes: durationSchema,
    capacity: capacitySchema,
    trainerId: z.uuid().nullable().optional(),
    room: roomSchema,
  })
  .refine(endsWithinDay, { message: 'A class must end before midnight', path: ['durationMinutes'] });
export type CreateClassSession = z.infer<typeof CreateClassSessionSchema>;

export const CancelClassSessionSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});
export type CancelClassSession = z.infer<typeof CancelClassSessionSchema>;

export const ClassSessionQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((q) => q.to >= q.from, { message: 'to is before from', path: ['to'] })
  .refine((q) => dayNumber(q.to) - dayNumber(q.from) + 1 <= MAX_CLASS_QUERY_DAYS, {
    message: `At most ${MAX_CLASS_QUERY_DAYS} days`,
    path: ['to'],
  });
export type ClassSessionQuery = z.infer<typeof ClassSessionQuerySchema>;

/** A weekly class pattern (the inputs of materialisation). */
export interface ClassSeries {
  id: string;
  classTypeId: string;
  weekday: Weekday;
  startsAt: string;
  durationMinutes: number;
  capacity: number;
  trainerId: string | null;
  room: string | null;
  validFrom: string;
  validUntil: string | null;
}

export interface ClassSessionView {
  id: string;
  date: string;
  startsAt: string;
  endsAt: string;
  type: { id: string; name: string; nameEn: string | null };
  trainer: { id: string; firstName: string } | null;
  room: string | null;
  capacity: number;
  booked: number;
  cancelled: boolean;
  seriesId: string | null;
  myBooking?: { id: string; status: string };
}
