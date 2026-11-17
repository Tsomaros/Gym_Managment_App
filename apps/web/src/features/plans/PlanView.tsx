import type { Plan, PlanDay } from '@gym/shared';
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { exerciseName, viewerLanguage } from '../exercises/exerciseName';
import { formatTarget } from './planFormat';

function DayExercises({ day }: { day: PlanDay }) {
  const { t, i18n } = useTranslation();
  const lang = viewerLanguage(i18n.language);
  if (!day.exercises.length) return <p className="text-slate-700">{t('plans.view.noExercises')}</p>;
  return (
    <ol className="flex flex-col gap-2">
      {day.exercises.map((e) => (
        <li key={e.id} className="rounded-xl border border-slate-300 bg-white p-3">
          <p className="text-lg font-semibold break-words text-slate-900">
            {exerciseName(e.exercise, lang)}
            {e.exercise.archived && (
              <span className="ml-2 text-sm font-normal text-slate-600">
                {t('plans.view.archivedExercise')}
              </span>
            )}
          </p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-4 text-xl font-semibold text-slate-900">
            <span className="whitespace-nowrap tabular-nums">{formatTarget(e, lang)}</span>
            {e.restSeconds != null && (
              <span className="text-slate-700">
                {t('plans.view.rest', { seconds: e.restSeconds })}
              </span>
            )}
          </p>
          {e.notes && <p className="mt-1 break-words text-slate-700">{e.notes}</p>}
        </li>
      ))}
    </ol>
  );
}

/** The days as tabs, one panel at a time: the member's layout on a phone. */
function DayTabs({ days }: { days: PlanDay[] }) {
  const { t } = useTranslation();
  const base = useId();
  const [selected, setSelected] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.min(selected, days.length - 1);

  function select(i: number) {
    setSelected(i);
    // A tab half out of view on a narrow screen slides fully in.
    tabRefs.current[i]?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }

  function onKeyDown(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (current + step + days.length) % days.length;
    select(next);
    tabRefs.current[next]?.focus();
  }

  if (!days.length) return null;
  // One day needs no choosing.
  if (days.length === 1) return <DayExercises day={days[0]!} />;
  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label={t('plans.view.days')}
        className="-mx-1 flex gap-2 overflow-x-auto p-1"
        onKeyDown={onKeyDown}
      >
        {days.map((d, i) => (
          <button
            key={d.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            id={`${base}-tab-${i}`}
            type="button"
            role="tab"
            aria-selected={i === current}
            aria-controls={`${base}-panel`}
            tabIndex={i === current ? 0 : -1}
            title={d.title}
            onClick={() => select(i)}
            className={`min-h-11 max-w-[75vw] shrink-0 truncate rounded-full border px-4 text-base font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
              i === current
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-500 bg-white text-slate-800 hover:bg-slate-50'
            }`}
          >
            {d.title}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-tab-${current}`}
        tabIndex={0}
        className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        <DayExercises day={days[current]!} />
      </div>
    </div>
  );
}

/**
 * A plan to read (trainer, and the member on their phone): an interactive plan day by day, as
 * sections for staff or as tabs for the member, or a PDF plan with its signed link (5 minutes).
 */
export function PlanView({
  plan,
  layout = 'sections',
}: {
  plan: Plan;
  layout?: 'sections' | 'tabs';
}) {
  const { t } = useTranslation();
  return (
    <article className="flex flex-col gap-4">
      <header>
        <h3 className="text-xl font-semibold break-words text-slate-900">{plan.title}</h3>
        {plan.notes && <p className="mt-1 break-words text-slate-700">{plan.notes}</p>}
      </header>
      {plan.kind === 'pdf' ? (
        <div className="flex flex-col gap-3">
          <p className="text-slate-700">{t('plans.view.pdfPlan')}</p>
          {plan.pdfUrl && (
            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                href={plan.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-14 flex-1 items-center justify-center rounded-md bg-slate-900 px-6 text-lg font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                {t('plans.view.openPdf')}
              </a>
              <a
                href={plan.pdfUrl}
                download
                className="inline-flex min-h-14 items-center justify-center rounded-md border border-slate-400 px-6 text-lg font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                {t('plans.view.downloadPdf')}
              </a>
            </div>
          )}
        </div>
      ) : layout === 'tabs' ? (
        <DayTabs days={plan.days} />
      ) : (
        plan.days.map((d) => (
          <section key={d.id} aria-labelledby={`day-${d.id}`} className="flex flex-col gap-2">
            <h4 id={`day-${d.id}`} className="text-lg font-semibold text-slate-900">
              {d.title}
            </h4>
            <DayExercises day={d} />
          </section>
        ))
      )}
    </article>
  );
}
