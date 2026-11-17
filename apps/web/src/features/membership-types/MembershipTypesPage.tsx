import type { MembershipType, MembershipTypeInput } from '@gym/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatMoney } from '../../lib/format';
import { MembershipTypeForm } from './MembershipTypeForm';

type Editing = { mode: 'new' } | { mode: 'edit'; type: MembershipType } | null;

/** Owner: the membership types the gym sells, with create, edit and archive. */
export function MembershipTypesPage() {
  const { t, i18n } = useTranslation();
  const { gymId } = useParams();
  const base = `/gyms/${gymId}/membership-types`;
  const [types, setTypes] = useState<MembershipType[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [archiving, setArchiving] = useState<MembershipType | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const formTitleRef = useRef<HTMLHeadingElement>(null);
  const wasEditing = useRef(false);

  // Focus follows the form: into it when it opens, back to the page title when it closes.
  useEffect(() => {
    if (editing) {
      formTitleRef.current?.focus();
      formTitleRef.current?.scrollIntoView?.({ block: 'start' });
    } else if (wasEditing.current) {
      titleRef.current?.focus();
    }
    wasEditing.current = !!editing;
  }, [editing]);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      setTypes(await apiFetch<MembershipType[]>(`${base}?includeArchived=${showArchived}`));
    } catch {
      setLoadError(true);
    }
  }, [base, showArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const displayName = (type: MembershipType) =>
    i18n.language === 'en' && type.nameEn ? type.nameEn : type.name;

  function summary(type: MembershipType): string {
    if (type.kind === 'time') return t('types.months', { count: type.durationMonths! });
    if (type.kind === 'day_pass') return t('types.kinds.day_pass');
    const visits = t('types.visits', { count: type.visitCount! });
    return type.validityDays
      ? `${visits} · ${t('types.validFor', { count: type.validityDays })}`
      : visits;
  }

  async function save(input: MembershipTypeInput) {
    const isNew = editing?.mode !== 'edit';
    const url = editing?.mode === 'edit' ? `${base}/${editing.type.id}` : base;
    await apiFetch<MembershipType>(url, {
      method: isNew ? 'POST' : 'PATCH',
      body: JSON.stringify(input),
    });
    setEditing(null);
    setNotice({
      kind: 'ok',
      text: t(isNew ? 'types.created' : 'types.saved', { name: input.name }),
    });
    await load();
  }

  async function confirmArchive() {
    if (!archiving) return;
    setArchiveBusy(true);
    try {
      await apiFetch<void>(`${base}/${archiving.id}/archive`, { method: 'POST' });
      setNotice({ kind: 'ok', text: t('types.archivedNotice', { name: displayName(archiving) }) });
      setArchiving(null);
      await load();
    } catch {
      setNotice({ kind: 'error', text: t('common.genericError') });
      setArchiving(null);
    } finally {
      setArchiveBusy(false);
    }
  }

  return (
    <section aria-labelledby="types-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2
          id="types-title"
          ref={titleRef}
          tabIndex={-1}
          className="mr-auto text-xl font-semibold text-slate-900 focus:outline-none"
        >
          {t('nav.membershipTypes')}
        </h2>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setEditing({ mode: 'new' });
            }}
            className="min-h-11 rounded-md bg-slate-900 px-4 font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {t('types.new')}
          </button>
        )}
      </div>

      <p role="status" className="min-h-5 text-sm text-green-800">
        {notice?.kind === 'ok' && `✓ ${notice.text}`}
      </p>
      {notice?.kind === 'error' && (
        <p role="alert" className="text-sm text-red-700">
          {notice.text}
        </p>
      )}

      {editing && (
        <div className="max-w-md scroll-mt-4 rounded-xl border border-slate-200 bg-white p-6">
          <h3
            ref={formTitleRef}
            tabIndex={-1}
            className="mb-4 text-lg font-semibold text-slate-900 focus:outline-none"
          >
            {editing.mode === 'new' ? t('types.new') : t('types.edit')}
          </h3>
          <MembershipTypeForm
            initial={editing.mode === 'edit' ? editing.type : undefined}
            onSubmit={save}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      <label className="flex min-h-11 w-fit items-center gap-3 text-sm text-slate-700">
        <input
          type="checkbox"
          className="size-5"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        {t('types.showArchived')}
      </label>

      {loadError && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('types.loadFailed')}
          <button type="button" onClick={() => void load()} className="min-h-11 underline">
            {t('app.retry')}
          </button>
        </div>
      )}
      {!types && !loadError && <p className="text-slate-600">{t('app.loading')}</p>}
      {types?.length === 0 && <p className="text-slate-600">{t('types.empty')}</p>}

      {types && types.length > 0 && (
        <ul className="flex flex-col gap-3">
          {types.map((type) => (
            <li
              key={type.id}
              className={`flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4 ${
                type.archived ? 'border-dashed border-slate-400' : 'border-slate-200'
              }`}
            >
              <div className="mr-auto min-w-0">
                <p className="font-semibold break-words text-slate-900">{displayName(type)}</p>
                <p className="text-sm text-slate-600">
                  <span>{t(`types.kinds.${type.kind}`)}</span>
                  {type.kind !== 'day_pass' && (
                    <>
                      {' '}
                      · <span>{summary(type)}</span>
                    </>
                  )}
                </p>
                <ul className="mt-1 flex flex-wrap gap-2" aria-label={t('types.includes')}>
                  {type.includesTrainer && <Badge>{t('types.withTrainer')}</Badge>}
                  {type.includesClasses && <Badge>{t('types.withClasses')}</Badge>}
                  {type.archived && <Badge>{t('types.archived')}</Badge>}
                </ul>
              </div>
              <p className="text-lg font-bold text-slate-900 tabular-nums">
                {formatMoney(type.priceCents, i18n.language)}
              </p>
              {!type.archived && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!!editing}
                    onClick={() => {
                      setNotice(null);
                      setEditing({ mode: 'edit', type });
                    }}
                    aria-label={t('types.editNamed', { name: displayName(type) })}
                    className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-slate-900 disabled:opacity-50"
                  >
                    {t('types.edit')}
                  </button>
                  <button
                    type="button"
                    disabled={!!editing}
                    onClick={() => setArchiving(type)}
                    aria-label={t('types.archiveNamed', { name: displayName(type) })}
                    className="min-h-11 rounded-md border border-red-300 px-3 text-sm font-medium text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-800 disabled:opacity-50"
                  >
                    {t('types.archive')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {archiving && (
        <ConfirmDialog
          title={t('types.archiveTitle')}
          message={t('types.archiveConfirm', { name: displayName(archiving) })}
          confirmLabel={t('types.archive')}
          cancelLabel={t('common.cancel')}
          busy={archiveBusy}
          busyLabel={t('common.working')}
          onConfirm={() => void confirmArchive()}
          onCancel={() => setArchiving(null)}
        />
      )}
    </section>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <li className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
      {children}
    </li>
  );
}
