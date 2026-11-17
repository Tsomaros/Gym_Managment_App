import type { ExpandedShift, ScheduleStaff } from '@gym/shared';
import { useTranslation } from 'react-i18next';

const cellButton =
  'inline-flex min-h-11 w-full items-center justify-center rounded-md bg-slate-900 px-2 text-sm font-semibold whitespace-nowrap text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';
const addButton =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-dashed border-slate-400 text-lg font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

const time = (s: ExpandedShift) => `${s.startsAt}–${s.endsAt}`;
const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

export interface WeekGridProps {
  /** The seven dates of the week, Monday first. */
  days: string[];
  staff: ScheduleStaff[];
  shifts: ExpandedShift[];
  /** The gym's current date: earlier days are read-only. */
  today: string;
  editable: boolean;
  /** Phone width: a list of days instead of a table. */
  narrow: boolean;
  /** `staffId` is null on the day list, where the dialog asks who. */
  onAdd: (staffId: string | null, date: string) => void;
  onOpen: (shift: ExpandedShift, person: ScheduleStaff) => void;
}

function useDayLabel() {
  const { i18n } = useTranslation();
  const tag = i18n.language === 'en' ? 'en-GB' : 'el-GR';
  return (date: string, style: 'long' | 'short') => {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    return new Intl.DateTimeFormat(
      tag,
      style === 'long'
        ? { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }
        : { weekday: 'short', day: 'numeric', timeZone: 'UTC' },
    ).format(new Date(Date.UTC(y, m - 1, d)));
  };
}

/**
 * One week of shifts: a table (people × days) on a desktop, a list of days on a phone. Editors
 * (`editable`) open a block to change it and press "+" in an empty future cell to add one; days
 * before `today` are greyed and have no actions.
 */
export function WeekGrid({
  days,
  staff,
  shifts,
  today,
  editable,
  narrow,
  onAdd,
  onOpen,
}: WeekGridProps) {
  const { t } = useTranslation();
  const label = useDayLabel();
  const byId = new Map(staff.map((s) => [s.userId, s]));
  const shiftsOn = (staffId: string, date: string) =>
    shifts.filter((s) => s.staffId === staffId && s.date === date);

  function block(s: ExpandedShift) {
    const person = byId.get(s.staffId);
    if (!editable || s.date < today || !person) {
      return (
        <span key={`${s.seriesId}${s.shiftId}${s.startsAt}`} className="block text-sm font-medium">
          {time(s)}
        </span>
      );
    }
    return (
      <button
        key={`${s.seriesId}${s.shiftId}${s.startsAt}`}
        type="button"
        onClick={() => onOpen(s, person)}
        aria-label={t('schedule.openShift', {
          name: fullName(person),
          day: label(s.date, 'long'),
          time: time(s),
        })}
        className={cellButton}
      >
        {time(s)}
      </button>
    );
  }

  if (narrow) {
    return (
      <div className="flex flex-col gap-3">
        {days.map((date) => {
          const list = shifts.filter((s) => s.date === date);
          const past = date < today;
          return (
            <section
              key={date}
              aria-labelledby={`day-${date}`}
              aria-current={date === today ? 'date' : undefined}
              className={`rounded-xl border p-3 ${
                past ? 'border-slate-200 bg-slate-100 text-slate-700' : 'border-slate-200 bg-white'
              } ${date === today ? 'ring-2 ring-slate-900' : ''}`}
            >
              <h3 id={`day-${date}`} className="mb-2 font-semibold">
                {label(date, 'long')}
                {date === today && (
                  <span className="ml-2 rounded bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
                    {t('schedule.today')}
                  </span>
                )}
                {past && <span className="sr-only"> ({t('schedule.past')})</span>}
              </h3>
              {list.length === 0 && <p className="text-sm">{t('schedule.noShifts')}</p>}
              <ul className="flex flex-col gap-2">
                {list.map((s) => {
                  const person = byId.get(s.staffId);
                  return (
                    <li key={`${s.seriesId}${s.shiftId}${s.startsAt}${s.staffId}`}>
                      {person && editable && !past ? (
                        <button
                          type="button"
                          onClick={() => onOpen(s, person)}
                          aria-label={t('schedule.openShift', {
                            name: fullName(person),
                            day: label(date, 'long'),
                            time: time(s),
                          })}
                          className="min-h-11 w-full rounded-md bg-slate-900 px-3 text-left text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                        >
                          {person ? fullName(person) : ''} · {time(s)}
                        </button>
                      ) : (
                        <span className="text-sm font-medium">
                          {person ? fullName(person) : ''} · {time(s)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {editable && !past && (
                <button
                  type="button"
                  onClick={() => onAdd(null, date)}
                  aria-label={t('schedule.addOnDay', { day: label(date, 'long') })}
                  className={`${addButton} mt-2 w-full text-sm`}
                >
                  {t('schedule.add')}
                </button>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[44rem] border-collapse text-left">
        <caption className="sr-only">{t('schedule.gridCaption')}</caption>
        <thead>
          <tr>
            <th scope="col" className="p-2 text-sm font-semibold text-slate-700">
              {t('schedule.person')}
            </th>
            {days.map((date) => (
              <th
                key={date}
                scope="col"
                aria-current={date === today ? 'date' : undefined}
                className={`p-2 text-sm font-semibold ${
                  date === today ? 'bg-slate-900 text-white' : 'text-slate-700'
                }`}
              >
                {label(date, 'short')}
                <span className="sr-only"> ({label(date, 'long')})</span>
                {date === today && (
                  <span className="block text-xs font-medium">{t('schedule.today')}</span>
                )}
                {date < today && <span className="sr-only"> ({t('schedule.past')})</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {staff.map((person) => (
            <tr key={person.userId} className="border-t border-slate-200">
              <th scope="row" className="p-2 text-sm font-semibold text-slate-900">
                {fullName(person)}
                <span className="block text-xs font-normal text-slate-600">
                  {person.roles.map((r) => t(`roles.${r}`)).join(', ')}
                </span>
              </th>
              {days.map((date) => {
                const past = date < today;
                return (
                  <td
                    key={date}
                    className={`p-1 align-top ${past ? 'bg-slate-100 text-slate-700' : ''}`}
                  >
                    <div className="flex flex-col gap-1">
                      {shiftsOn(person.userId, date).map(block)}
                      {editable && !past && (
                        <button
                          type="button"
                          onClick={() => onAdd(person.userId, date)}
                          aria-label={t('schedule.addNamed', {
                            name: fullName(person),
                            day: label(date, 'long'),
                          })}
                          className={addButton}
                        >
                          <span aria-hidden="true">+</span>
                        </button>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
