import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { viewerLanguage } from '../exercises/exerciseName';
import { CHART } from '../progress/chartTheme';
import { endHourLabel, hourLabel, weekdayName } from './dashboardFormat';

const DAYS = [0, 1, 2, 3, 4, 5, 6];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const SLOTS_IN_SUMMARY = 3;

/** Blue at 25 % to 100 % by how busy the slot is, next to the busiest one. Empty slots stay plain. */
const shade = (level: number): string =>
  level === 0 ? 'transparent' : `rgb(42 120 214 / ${(0.25 + 0.75 * level).toFixed(2)})`;

/**
 * Check-ins of the last 8 weeks by weekday (rows, Monday first) and hour (columns): one hue,
 * light to dark. Each cell says its count to a screen reader, and the busiest slots are named in
 * a sentence above, so the picture is never the only way to read it.
 */
export function BusyHoursHeatmap({ grid }: { grid: number[][] }) {
  const { t, i18n } = useTranslation();
  const lang = viewerLanguage(i18n.language);
  const id = useId();
  const max = Math.max(0, ...grid.flat());
  const busiest = DAYS.flatMap((d) => HOURS.map((h) => ({ d, h, n: grid[d]?.[h] ?? 0 })))
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n || a.d - b.d || a.h - b.h)
    .slice(0, SLOTS_IN_SUMMARY);

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-2 rounded-2xl border border-slate-300 bg-white p-3"
    >
      <h3 id={`${id}-title`} className="text-lg font-semibold text-slate-900">
        {t('dashboard.busyTitle')}
      </h3>
      <p className="text-sm text-slate-700">{t('dashboard.busyHint')}</p>
      {max === 0 ? (
        <p className="py-6 text-center text-slate-700">{t('dashboard.busyNone')}</p>
      ) : (
        <>
          <p className="text-slate-800">
            {t('dashboard.busySummary', {
              slots: busiest
                .map((c) =>
                  t('dashboard.busySlot', {
                    day: weekdayName(c.d, lang, 'long'),
                    from: hourLabel(c.h),
                    to: endHourLabel(c.h),
                    count: c.n,
                  }),
                )
                .join(', '),
            })}
          </p>
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label={t('dashboard.busyTitle')}
          >
            <table className="w-full min-w-[34rem] table-fixed border-separate border-spacing-0.5 text-xs">
              <caption className="sr-only">{t('dashboard.busyTitle')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-10">
                    <span className="sr-only">{t('dashboard.day')}</span>
                  </th>
                  {HOURS.map((h) => (
                    <th key={h} scope="col" className="font-normal text-slate-700">
                      <span aria-hidden="true">{h % 3 === 0 ? h : ''}</span>
                      <span className="sr-only">{hourLabel(h)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.map((d) => (
                  <tr key={d}>
                    <th
                      scope="row"
                      className="sticky left-0 bg-white pr-1 text-left font-medium text-slate-800"
                    >
                      {weekdayName(d, lang, 'short')}
                    </th>
                    {HOURS.map((h) => {
                      const n = grid[d]?.[h] ?? 0;
                      const level = max === 0 ? 0 : n / max;
                      const label = t('dashboard.busyCell', {
                        day: weekdayName(d, lang, 'long'),
                        from: hourLabel(h),
                        to: endHourLabel(h),
                        count: n,
                      });
                      return (
                        <td
                          key={h}
                          title={label}
                          data-level={level.toFixed(2)}
                          className="h-7 rounded-sm border border-slate-300 text-center text-[10px] tabular-nums text-slate-900"
                          style={{ backgroundColor: shade(level) }}
                        >
                          {n > 0 && <span aria-hidden="true">{n}</span>}
                          <span className="sr-only">{label}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div aria-hidden="true" className="flex items-center gap-2 text-xs text-slate-700">
            {t('dashboard.less')}
            <span
              className="h-3 w-24 rounded-sm border border-slate-200"
              style={{
                background: `linear-gradient(to right, ${shade(0.01)}, ${shade(1)})`,
                borderColor: CHART.grid,
              }}
            />
            {t('dashboard.more')}
          </div>
        </>
      )}
    </section>
  );
}
