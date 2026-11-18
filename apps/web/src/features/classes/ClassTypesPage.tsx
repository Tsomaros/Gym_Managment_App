import type { ClassTypeView } from '@gym/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Field } from '../../components/Field';
import { dangerClass, plainClass, primaryClass, typeName } from './shared';

interface Draft {
  name: string;
  nameEn: string;
  description: string;
  capacity: string;
  duration: string;
}
const EMPTY: Draft = { name: '', nameEn: '', description: '', capacity: '12', duration: '45' };

/** Owner: the kinds of class the gym runs (spinning, pilates…); archived, never deleted. */
export function ClassTypesPage() {
  const { t, i18n } = useTranslation();
  const { gymId = '' } = useParams();
  const base = `/gyms/${gymId}/class-types`;
  const [types, setTypes] = useState<ClassTypeView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [saveFailed, setSaveFailed] = useState(false);
  const [archiving, setArchiving] = useState<ClassTypeView | null>(null);
  const [archiveError, setArchiveError] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    apiFetch<ClassTypeView[]>(base)
      .then(setTypes)
      .catch(() => setFailed(true));
  }, [base]);
  useEffect(load, [load]);

  function edit(type?: ClassTypeView) {
    setErrors({});
    setSaveFailed(false);
    setEditing({
      id: type?.id ?? null,
      draft: type
        ? {
            name: type.name,
            nameEn: type.nameEn ?? '',
            description: type.description ?? '',
            capacity: String(type.defaultCapacity),
            duration: String(type.defaultDurationMinutes),
          }
        : EMPTY,
    });
  }
  const set = (patch: Partial<Draft>) =>
    setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const d = editing.draft;
    const capacity = Number(d.capacity);
    const duration = Number(d.duration);
    const found: Partial<Record<keyof Draft, string>> = {};
    if (!d.name.trim()) found.name = t('common.required');
    if (d.description.length > 500) found.description = t('classes.types.descriptionError');
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) {
      found.capacity = t('classes.form.capacityError');
    }
    if (!Number.isInteger(duration) || duration < 15 || duration > 240) {
      found.duration = t('classes.form.durationError');
    }
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaveFailed(false);
    try {
      await apiFetch(editing.id ? `${base}/${editing.id}` : base, {
        method: editing.id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: d.name.trim(),
          nameEn: d.nameEn.trim() || null,
          description: d.description.trim() || null,
          defaultCapacity: capacity,
          defaultDurationMinutes: duration,
        }),
      });
      setEditing(null);
      load();
    } catch {
      setSaveFailed(true);
    }
  }

  async function archive() {
    if (!archiving) return;
    setArchiveError(false);
    try {
      await apiFetch(`${base}/${archiving.id}/archive`, { method: 'POST' });
      setArchiving(null);
      load();
    } catch {
      setArchiveError(true);
    }
  }

  return (
    <section aria-labelledby="class-types-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="class-types-title" className="mr-auto text-xl font-semibold text-slate-900">
          {t('classes.types.title')}
        </h2>
        {!editing && (
          <button type="button" onClick={() => edit()} className={primaryClass}>
            {t('classes.types.new')}
          </button>
        )}
      </div>

      {editing && (
        <form
          onSubmit={save}
          noValidate
          aria-label={editing.id ? t('classes.types.edit') : t('classes.types.new')}
          className="flex max-w-md flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5"
        >
          <Field
            label={t('classes.types.name')}
            value={editing.draft.name}
            maxLength={80}
            error={errors.name}
            onChange={(e) => set({ name: e.target.value })}
          />
          <Field
            label={t('classes.types.nameEn')}
            value={editing.draft.nameEn}
            maxLength={80}
            onChange={(e) => set({ nameEn: e.target.value })}
          />
          <Field
            label={t('classes.types.description')}
            value={editing.draft.description}
            error={errors.description}
            onChange={(e) => set({ description: e.target.value })}
          />
          <div className="flex gap-3">
            <div className="flex-1">
              <Field
                label={t('classes.types.defaultCapacity')}
                type="number"
                inputMode="numeric"
                value={editing.draft.capacity}
                error={errors.capacity}
                onChange={(e) => set({ capacity: e.target.value })}
              />
            </div>
            <div className="flex-1">
              <Field
                label={t('classes.types.defaultDuration')}
                type="number"
                inputMode="numeric"
                value={editing.draft.duration}
                error={errors.duration}
                onChange={(e) => set({ duration: e.target.value })}
              />
            </div>
          </div>
          <p role="alert" className="min-h-5 text-sm text-red-700">
            {saveFailed && t('common.genericError')}
          </p>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setEditing(null)} className={plainClass}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={primaryClass}>
              {t('common.save')}
            </button>
          </div>
        </form>
      )}

      {failed && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button type="button" onClick={load} className="min-h-11 underline">
            {t('app.retry')}
          </button>
        </div>
      )}
      {!types && !failed && (
        <p role="status" className="text-slate-600">
          {t('app.loading')}
        </p>
      )}
      {types && types.length === 0 && <p className="text-slate-700">{t('classes.types.empty')}</p>}
      {types && types.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {types.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="mr-auto min-w-0">
                <p className={`font-semibold ${x.archived ? 'text-slate-500' : 'text-slate-900'}`}>
                  {typeName(x, i18n.language)}
                  {x.archived && (
                    <span className="ml-2 text-sm font-normal">({t('classes.types.archived')})</span>
                  )}
                </p>
                <p className="text-sm text-slate-700">
                  {t('classes.types.summary', {
                    capacity: x.defaultCapacity,
                    minutes: x.defaultDurationMinutes,
                  })}
                </p>
                {x.description && <p className="text-sm text-slate-600">{x.description}</p>}
              </div>
              {!x.archived && (
                <>
                  <button
                    type="button"
                    onClick={() => edit(x)}
                    aria-label={`${t('classes.types.edit')}: ${typeName(x, i18n.language)}`}
                    className={plainClass}
                  >
                    {t('classes.types.edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setArchiving(x)}
                    aria-label={`${t('classes.types.archive')}: ${typeName(x, i18n.language)}`}
                    className={dangerClass}
                  >
                    {t('classes.types.archive')}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {archiving && (
        <ConfirmDialog
          title={t('classes.types.archiveTitle')}
          message={t('classes.types.archiveMessage', { name: typeName(archiving, i18n.language) })}
          confirmLabel={t('classes.types.archive')}
          cancelLabel={t('common.cancel')}
          error={archiveError ? t('common.genericError') : undefined}
          onConfirm={() => void archive()}
          onCancel={() => setArchiving(null)}
        />
      )}
    </section>
  );
}
