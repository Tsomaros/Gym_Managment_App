import type { Plan, PlanSummary } from '@gym/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PlanEditor } from './PlanEditor';
import { PlanView } from './PlanView';

const action =
  'min-h-11 rounded-md border border-slate-400 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

/** The gym's plan templates: every trainer reads them, only the author changes or deletes one. */
export function TemplatesPage() {
  const { t } = useTranslation();
  const { gymId = '' } = useParams();
  const { me } = useAuth();
  const [list, setList] = useState<PlanSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState<Plan | null>(null);
  const [editing, setEditing] = useState<{ plan: Plan | null } | null>(null);
  const [deleting, setDeleting] = useState<PlanSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setList(await apiFetch<PlanSummary[]>(`/gyms/${gymId}/plan-templates`));
    } catch {
      setFailed(true);
    }
  }, [gymId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function fetchTemplate(id: string): Promise<Plan | null> {
    try {
      return await apiFetch<Plan>(`/gyms/${gymId}/plan-templates/${id}`);
    } catch {
      setFailed(true);
      return null;
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await apiFetch(`/gyms/${gymId}/plan-templates/${deleting.id}`, { method: 'DELETE' });
      if (shown?.id === deleting.id) setShown(null);
      setDeleting(null);
      setNotice(t('plans.templates.deleted'));
      await load();
    } catch {
      setDeleteError(t('common.genericError'));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <PlanEditor
        key={editing.plan?.id ?? 'new'}
        gymId={gymId}
        plan={editing.plan}
        mode="template"
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          setShown(null);
          setNotice(t('plans.templates.saved'));
          void load();
        }}
      />
    );
  }

  return (
    <section aria-labelledby="templates-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="templates-title" className="mr-auto text-xl font-semibold text-slate-900">
          {t('plans.templates.title')}
        </h2>
        <button
          type="button"
          onClick={() => setEditing({ plan: null })}
          className="min-h-11 rounded-md bg-slate-900 px-4 font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {t('plans.templates.new')}
        </button>
      </div>
      <p className="text-slate-700">{t('plans.templates.intro')}</p>
      <p role="status" className="text-green-800 empty:hidden">
        {notice && `✓ ${notice}`}
      </p>
      {failed && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('plans.templates.loadFailed')}
          <button type="button" onClick={() => void load()} className="min-h-11 underline">
            {t('app.retry')}
          </button>
        </div>
      )}
      {!list && !failed && (
        <p role="status" className="text-slate-600">
          {t('app.loading')}
        </p>
      )}
      {list && list.length === 0 && <p className="text-slate-700">{t('plans.templates.empty')}</p>}
      {list && list.length > 0 && (
        <ul className="flex flex-col gap-2">
          {list.map((p) => {
            const mine = p.authorId === me?.id;
            return (
              <li
                key={p.id}
                aria-label={p.title}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3"
              >
                <span className="mr-auto min-w-0 font-medium break-words text-slate-900">
                  {p.title}
                  <span className="ml-2 text-sm font-normal text-slate-600">
                    {mine ? (
                      <span className="rounded-full bg-slate-900 px-2 py-0.5 text-white">
                        {t('plans.templates.mine')}
                      </span>
                    ) : (
                      p.authorName && t('plans.by', { name: p.authorName })
                    )}
                  </span>
                </span>
                <button
                  type="button"
                  className={action}
                  aria-label={t('plans.openNamed', { title: p.title })}
                  onClick={() => void fetchTemplate(p.id).then((plan) => plan && setShown(plan))}
                >
                  {t('plans.open')}
                </button>
                {mine && (
                  <>
                    <button
                      type="button"
                      className={action}
                      aria-label={`${t('plans.edit')} «${p.title}»`}
                      onClick={() =>
                        void fetchTemplate(p.id).then((plan) => plan && setEditing({ plan }))
                      }
                    >
                      {t('plans.edit')}
                    </button>
                    <button
                      type="button"
                      className={`${action} text-red-800`}
                      aria-label={t('plans.templates.deleteNamed', { title: p.title })}
                      onClick={() => {
                        setDeleteError(null);
                        setDeleting(p);
                      }}
                    >
                      {t('plans.templates.delete')}
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {shown && <PlanView plan={shown} />}
      {deleting && (
        <ConfirmDialog
          title={t('plans.templates.deleteTitle')}
          message={t('plans.templates.deleteMessage', { title: deleting.title })}
          confirmLabel={t('plans.templates.delete')}
          cancelLabel={t('common.cancel')}
          busy={busy}
          busyLabel={t('common.working')}
          error={deleteError}
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
