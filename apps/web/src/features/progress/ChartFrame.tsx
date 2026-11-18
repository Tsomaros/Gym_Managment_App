import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The frame every progress chart shares: a title, a one-line summary in words (what a screen
 * reader gets instead of the picture), the chart itself, an empty state, and the same numbers
 * as a table for anyone who cannot read a line.
 */
export function ChartFrame({
  title,
  summary,
  empty,
  loading,
  emptyText,
  legend,
  table,
  children,
}: {
  title: string;
  /** The chart in a sentence; null when there is no data. */
  summary: string | null;
  empty: boolean;
  /** An answer for what is on screen is still on its way: show a placeholder, not "nothing". */
  loading?: boolean;
  /** What to say when there is nothing to draw; defaults to the progress screens' wording. */
  emptyText?: string;
  legend?: ReactNode;
  table: { head: string[]; rows: string[][] };
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-2 rounded-2xl border border-slate-300 bg-white p-3"
    >
      <h3 id={`${id}-title`} className="text-lg font-semibold text-slate-900">
        {title}
      </h3>
      {loading ? (
        <div
          role="status"
          className="flex h-56 items-center justify-center rounded-lg bg-slate-100 text-slate-700"
        >
          {t('app.loading')}
        </div>
      ) : empty ? (
        <p className="py-6 text-center text-slate-700">{emptyText ?? t('progress.empty')}</p>
      ) : (
        <>
          {summary && <p className="text-slate-800">{summary}</p>}
          {legend}
          <div role="img" aria-label={title} className="h-56 w-full">
            {children}
          </div>
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-slate-800 underline">
              {t('progress.showTable')}
              <span className="sr-only"> – {title}</span>
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{title}</caption>
                <thead>
                  <tr>
                    {table.head.map((h) => (
                      <th key={h} scope="col" className="py-1 pr-3 font-semibold text-slate-900">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, i) => (
                    <tr key={i} className="border-t border-slate-200">
                      {row.map((cell, j) =>
                        j === 0 ? (
                          <th key={j} scope="row" className="py-1 pr-3 font-medium text-slate-900">
                            {cell}
                          </th>
                        ) : (
                          <td key={j} className="py-1 pr-3 tabular-nums text-slate-800">
                            {cell}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

/** A coloured mark beside a text label: identity never rests on colour alone, text stays ink. */
export function LegendItem({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-800">
      <svg width="24" height="8" aria-hidden className="shrink-0">
        <line
          x1="0"
          y1="4"
          x2="24"
          y2="4"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={dashed ? '5 4' : undefined}
        />
      </svg>
      {label}
    </span>
  );
}
