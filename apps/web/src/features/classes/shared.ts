import type { ClassSessionView, ClassTypeView } from '@gym/shared';

export const inputClass =
  'min-h-11 rounded-md border border-slate-500 px-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';
export const primaryClass =
  'min-h-11 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-disabled:opacity-60';
export const plainClass =
  'min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';
export const dangerClass =
  'min-h-11 rounded-md border border-red-700 px-4 text-sm font-medium text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800 aria-disabled:opacity-60';

/** The class's name in the reader's language (the English one when it has one). */
export const typeName = (
  type: { name: string; nameEn: string | null },
  language: string,
): string => (language === 'en' && type.nameEn ? type.nameEn : type.name);

export const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** Length of a session in minutes, from its gym-local start and end. */
export const durationOf = (s: Pick<ClassSessionView, 'startsAt' | 'endsAt'>): number =>
  minutesOf(s.endsAt) - minutesOf(s.startsAt);

/** Whether `start` + `minutes` stays before midnight (the API refuses a class that doesn't). */
export const endsBeforeMidnight = (start: string, minutes: number): boolean =>
  minutesOf(start) + minutes < 24 * 60;

export const activeTypes = (types: readonly ClassTypeView[]): ClassTypeView[] =>
  types.filter((t) => !t.archived);

/** A trainer the timetable can name: the schedule's staff who hold the trainer role. */
export interface TrainerOption {
  userId: string;
  firstName: string;
  lastName: string;
}
