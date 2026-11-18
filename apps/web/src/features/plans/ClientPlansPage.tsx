import type { Plan, PlanSummary, TrainerClient } from '@gym/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { ApiError, apiFetch } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { NewPlanDialog } from './NewPlanDialog';
import { PlanEditor } from './PlanEditor';
import { PlanView } from './PlanView';

const action =
  'min-h-11 rounded-md border border-slate-400 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

/**
 * One client's plans, for their trainer: the active plan to read (and change, for the primary
 * trainer), the other plans as a history, and a way to start a new one. A trainer who only covers
 * the client today reads, and nothing more.
 */
export function ClientPlansPage() {
  const { t } = useTranslation();
  const { gymId = '', memberId = '' } = useParams();
  const [client, setClient] = useState<TrainerClient | null>(null);
  const [list, setList] = useState<PlanSummary[] | null>(null);
  const [viewing, setViewing] = useState<Plan | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<'view' | 'edit' | 'new'>('view');
  const [choosing, setChoosing] = useState(false);
  const [archiving, setArchiving] = useState<Plan | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Which request is the newest: an older answer arriving late is dropped.
  const latest = useRef(0);
  const shownHeading = useRef<HTMLHeadingElement>(null);
  // The id on screen, so a reload keeps showing the same plan.
  const shownId = useRef<string | undefined>(undefined);
  useEffect(() => {
    shownId.current = viewing?.id;
  }, [viewing]);

  /** Loads the list, and the plan to show: `showId`, else the one on screen, else the active one. */
  const load = useCallback(
    async (showId?: string) => {
      const mine = ++latest.current;
      setFailed(false);
      try {
        // A failed client list or plan is a failure to show, never a silent "read-only" or "no plan".
        const [clients, summaries] = await Promise.all([
          apiFetch<TrainerClient[]>(`/gyms/${gymId}/trainer/clients`),
          apiFetch<PlanSummary[]>(`/gyms/${gymId}/members/${memberId}/plans`),
        ]);
        if (mine !== latest.current) return; // something newer was asked for meanwhile
        setClient(clients.find((c) => c.memberId === memberId) ?? null);
        setList(summaries);
        setNoAccess(false);
        const wanted =
          summaries.find((x) => x.id === (showId ?? shownId.current)) ??
          summaries.find((x) => x.status === 'active');
        const plan = wanted ? await apiFetch<Plan>(`/gyms/${gymId}/plans/${wanted.id}`) : null;
        if (mine !== latest.current) return;
        setViewing(plan);
      } catch (err) {
        if (mine !== latest.current) return;
        if (err instanceof ApiError && err.status === 404) setNoAccess(true);
        else setFailed(true);
      }
    },
    [gymId, memberId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  // Reading only: the trainer covers this client today, or is not known to be the primary one.
  const canWrite = !!client && !client.cover;

  async function open(id: string) {
    const mine = ++latest.current; // an older, slower load must not replace this
    setNotice('');
    setActionError(null);
    try {
      const plan = await apiFetch<Plan>(`/gyms/${gymId}/plans/${id}`);
      if (mine !== latest.current) return;
      setViewing(plan);
      // The plan opens at the top of the page: bring the reader there.
      requestAnimationFrame(() => {
        shownHeading.current?.scrollIntoView?.({ block: 'start' });
        shownHeading.current?.focus();
      });
    } catch {
      if (mine === latest.current) setActionError(t('plans.loadFailed'));
    }
  }

  async function activate(plan: { id: string }) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiFetch<Plan>(`/gyms/${gymId}/plans/${plan.id}/activate`, { method: 'POST' });
      setNotice(t('plans.done.activated'));
      await load(plan.id);
    } catch {
      setActionError(t('common.genericError'));
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!archiving) return;
    setBusy(true);
    setArchiveError(null);
    try {
      await apiFetch(`/gyms/${gymId}/plans/${archiving.id}/archive`, { method: 'POST' });
      setNotice(t('plans.done.archived'));
      setArchiving(null);
      setViewing(null);
      shownId.current = undefined; // show the active plan again, if there still is one
      await load();
    } catch {
      setArchiveError(t('common.genericError'));
    } finally {
      setBusy(false);
    }
  }

  if (mode !== 'view') {
    return (
      <PlanEditor
        key={mode === 'edit' ? viewing?.id : 'new'}
        gymId={gymId}
        memberId={memberId}
        plan={mode === 'edit' ? viewing : null}
        mode="plan"
        onClose={() => setMode('view')}
        onSaved={(saved) => {
          setMode('view');
          setNotice('');
          void load(saved.id);
        }}
      />
    );
  }

  const name = client ? `${client.firstName} ${client.lastName}` : '';
  const others = (list ?? []).filter((p) => p.id !== viewing?.id);

  return (
    <section aria-labelledby="client-plans-title" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/g/${gymId}/members`}
          className="min-h-11 content-center rounded-md px-3 text-sm font-medium text-slate-700 underline hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-900"
        >
          {t('plans.back')}
        </Link>
        <h2 id="client-plans-title" className="mr-auto text-xl font-semibold text-slate-900">
          {name ? t('plans.clientTitle', { name }) : t('plans.link')}
        </h2>
        {canWrite && !noAccess && (
          <button
            type="button"
            onClick={() => setChoosing(true)}
            className="min-h-11 rounded-md bg-slate-900 px-4 font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {t('plans.newPlan')}
          </button>
        )}
      </div>

      {client?.cover && (
        <p className="rounded-md border border-amber-700 bg-amber-50 p-3 font-medium text-amber-950">
          {t('plans.coverBanner')}
        </p>
      )}
      {noAccess && <p className="text-slate-800">{t('plans.noAccess')}</p>}
      {failed && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('plans.loadFailed')}
          <button type="button" onClick={() => void load()} className="min-h-11 underline">
            {t('app.retry')}
          </button>
        </div>
      )}
      {actionError && (
        <p role="alert" className="text-red-700">
          {actionError}
        </p>
      )}
      {!list && !noAccess && !failed && (
        <p role="status" className="text-slate-600">
          {t('app.loading')}
        </p>
      )}
      <p role="status" className="text-green-800 empty:hidden">
        {notice && `✓ ${notice}`}
      </p>

      {list && (
        <section aria-labelledby="shown-plan-title" className="flex flex-col gap-3">
          <h3
            id="shown-plan-title"
            ref={shownHeading}
            tabIndex={-1}
            className="text-sm font-semibold tracking-wide text-slate-600 uppercase focus:outline-none"
          >
            {viewing ? t(`plans.status.${viewing.status}`) : t('plans.active')}
            {viewing?.author && (
              <span className="font-normal normal-case">
                {' · '}
                {t('plans.by', { name: `${viewing.author.firstName} ${viewing.author.lastName}` })}
              </span>
            )}
          </h3>
          {viewing ? (
            <>
              <PlanView plan={viewing} />
              {canWrite && viewing.status !== 'archived' && (
                <div className="flex flex-wrap gap-2">
                  {viewing.kind === 'interactive' && (
                    <button type="button" className={action} onClick={() => setMode('edit')}>
                      {t('plans.edit')}
                    </button>
                  )}
                  {viewing.status === 'draft' && (
                    <button
                      type="button"
                      className={action}
                      onClick={() => void activate(viewing)}
                      aria-label={t('plans.activate') + ' «' + viewing.title + '»'}
                    >
                      {t('plans.activate')}
                    </button>
                  )}
                  <button
                    type="button"
                    className={action}
                    aria-label={`${t('plans.archive')} «${viewing.title}»`}
                    onClick={() => {
                      setArchiveError(null);
                      setArchiving(viewing);
                    }}
                  >
                    {t('plans.archive')}
                  </button>
                </div>
              )}
            </>
          ) : (
            !failed && <p className="text-slate-700">{t('plans.noActive')}</p>
          )}
        </section>
      )}

      {list && (
        <section aria-label={t('plans.history')} className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold text-slate-900">{t('plans.history')}</h3>
          {others.length === 0 ? (
            <p className="text-slate-700">{t('plans.noHistory')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {others.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3"
                >
                  <span className="mr-auto min-w-0 font-medium break-words text-slate-900">
                    {p.title}
                    <span className="ml-2 text-sm font-normal text-slate-600">
                      {t(`plans.status.${p.status}`)}
                      {p.kind === 'pdf' && ` · ${t('plans.kind.pdf')}`}
                      {p.authorName && ` · ${t('plans.by', { name: p.authorName })}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={action}
                    aria-label={t('plans.openNamed', { title: p.title })}
                    onClick={() => void open(p.id)}
                  >
                    {t('plans.open')}
                  </button>
                  {canWrite && p.status === 'draft' && (
                    <button
                      type="button"
                      className={action}
                      aria-label={`${t('plans.activate')} «${p.title}»`}
                      onClick={() => void activate(p)}
                    >
                      {t('plans.activate')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {choosing && (
        <NewPlanDialog
          gymId={gymId}
          memberId={memberId}
          onBlank={() => {
            setChoosing(false);
            setMode('new');
          }}
          onCreated={(created) => {
            setChoosing(false);
            setNotice('');
            void load(created.id);
          }}
          onClose={() => setChoosing(false)}
        />
      )}
      {archiving && (
        <ConfirmDialog
          title={t('plans.archiveTitle')}
          message={t('plans.archiveMessage', { title: archiving.title })}
          confirmLabel={t('plans.archive')}
          cancelLabel={t('common.cancel')}
          busy={busy}
          busyLabel={t('common.working')}
          error={archiveError}
          onConfirm={() => void archive()}
          onCancel={() => setArchiving(null)}
        />
      )}
    </section>
  );
}
