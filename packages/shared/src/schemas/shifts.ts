import { z } from 'zod';
import { isoDateSchema } from './common.js';

/** HH:MM, 00:00–23:59, minutes in steps of 5. */
export const shiftTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5][05]$/, 'HH:MM, minutes in steps of 5');

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** A weekly pattern: ISO weekday (1 = Monday … 7 = Sunday), valid from/until (inclusive) gym dates. */
export interface ShiftSeries {
  id: string;
  staffId: string;
  weekday: Weekday;
  startsAt: string;
  endsAt: string;
  validFrom: string;
  validUntil: string | null;
}

/** A dated shift: a one-off (seriesId null) or an override of one occurrence of a series. */
export interface ShiftRow {
  id: string;
  staffId: string;
  date: string;
  startsAt: string;
  endsAt: string;
  seriesId: string | null;
  cancelled: boolean;
  note: string | null;
}

export interface ExpandedShift {
  staffId: string;
  date: string;
  startsAt: string;
  endsAt: string;
  seriesId: string | null;
  /** The override or one-off row behind this shift; null for a plain series occurrence. */
  shiftId: string | null;
  note: string | null;
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const noteSchema = z.string().trim().max(200).nullable().optional();

/** The longest span a schedule query may cover, in days (both ends included). */
export const MAX_SCHEDULE_DAYS = 62;

const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

export const ScheduleQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((q) => q.to >= q.from, { message: 'to is before from', path: ['to'] })
  .refine((q) => dayNumber(q.to) - dayNumber(q.from) + 1 <= MAX_SCHEDULE_DAYS, {
    message: `At most ${MAX_SCHEDULE_DAYS} days`,
    path: ['to'],
  });
export type ScheduleQuery = z.infer<typeof ScheduleQuerySchema>;

export const CreateShiftSeriesSchema = z
  .object({
    staffId: z.uuid(),
    weekday: z
      .number()
      .int()
      .refine((n): n is Weekday => (WEEKDAYS as readonly number[]).includes(n)),
    startsAt: shiftTimeSchema,
    endsAt: shiftTimeSchema,
    validFrom: isoDateSchema,
    validUntil: isoDateSchema.nullable().optional(),
  })
  .refine((s) => s.endsAt > s.startsAt, { message: 'Must end after it starts', path: ['endsAt'] })
  .refine((s) => !s.validUntil || s.validUntil >= s.validFrom, {
    message: 'validUntil is before validFrom',
    path: ['validUntil'],
  });
export type CreateShiftSeries = z.infer<typeof CreateShiftSeriesSchema>;

export const EndShiftSeriesSchema = z.object({ lastDate: isoDateSchema });
export type EndShiftSeries = z.infer<typeof EndShiftSeriesSchema>;

export const CreateShiftSchema = z
  .object({
    staffId: z.uuid(),
    date: isoDateSchema,
    startsAt: shiftTimeSchema,
    endsAt: shiftTimeSchema,
    note: noteSchema,
  })
  .refine((s) => s.endsAt > s.startsAt, { message: 'Must end after it starts', path: ['endsAt'] });
export type CreateShift = z.infer<typeof CreateShiftSchema>;

export const UpdateShiftSchema = z
  .object({
    startsAt: shiftTimeSchema.optional(),
    endsAt: shiftTimeSchema.optional(),
    note: noteSchema,
  })
  .refine((s) => !s.startsAt || !s.endsAt || s.endsAt > s.startsAt, {
    message: 'Must end after it starts',
    path: ['endsAt'],
  });
export type UpdateShift = z.infer<typeof UpdateShiftSchema>;

/** One occurrence of a series on one date: other times, or cancelled. */
export const OccurrenceSchema = z.union([
  z.object({ cancelled: z.literal(true) }).strict(),
  z
    .object({ startsAt: shiftTimeSchema, endsAt: shiftTimeSchema, note: noteSchema })
    .strict()
    .refine((s) => s.endsAt > s.startsAt, {
      message: 'Must end after it starts',
      path: ['endsAt'],
    }),
]);
export type Occurrence = z.infer<typeof OccurrenceSchema>;

export interface ScheduleStaff {
  userId: string;
  firstName: string;
  lastName: string;
  roles: ('owner' | 'reception' | 'trainer')[];
}

export interface ScheduleResponse {
  shifts: ExpandedShift[];
  staff: ScheduleStaff[];
}

export interface OnDutyPerson extends ScheduleStaff {
  /** When the current shift ends, HH:MM gym time. */
  until: string;
}
