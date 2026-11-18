import { type Exercise, MUSCLE_GROUPS } from '@gym/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ExerciseForm } from './ExerciseForm';
import { exerciseName, viewerLanguage } from './exerciseName';
import { MAX_QUERY_LENGTH, useExercises } from './useExercises';

const rowButton =
  'min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

/** The gym's exercise library for trainers and the owner (spec §6.5). */
export function ExercisesPage() {
  const { t, i18n } = useTranslation();
  const lang = viewerLanguage(i18n.language);
  const { gymId = '' } = useParams();
  const { me } = useAuth();
  const isOwner = !!me?.gyms.find((g) => g.gymId === gymId)?.roles.includes('owner');
  const [q, setQ] = useState('');
  const { items, failed, reload } = useExercises(gymId, q);
  const [editing, setEditing] = useState<Exercise | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Exercise | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState('');
  const [refocus, setRefocus] = useState(0);
  // After the dialog has closed (and handed focus back to a row that is gone): continue at the search box.
  useEffect(() => {
    if (refocus) searchRef.current?.focus();
  }, [refocus]);

  const canArchive = (e: Exercise) => isOwner || e.createdBy === me?.id;

  async function archive() {
    if (!archiving) return;
    setBusy(true);
    setArchiveError(null);
    try {
      await apiFetch(`/gyms/${gymId}/exercises/${archiving.id}/archive`, { method: 'POST' });
      setNotice(t('exercises.archived', { name: exerciseName(archiving, lang) }));
      setArchiving(null);
      reload();
      setRefocus((n) => n + 1);
    } catch {
      setArchiveError(t('common.genericError'));
    } finally {
      setBusy(false);
    }
  }

  const byGroup = MUSCLE_GROUPS.map((g) => ({
    group: g,
    rows: (items ?? []).filter((e) => e.muscleGroup === g),
  })).filter((g) => g.rows.length > 0);

  return (
    <section aria-labelledby="exercises-title" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="exercises-title" className="mr-auto text-xl font-semibold text-slate-900">
          {t('exercises.title')}
        </h2>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="min-h-11 rounded-md bg-slate-900 px-4 font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {t('exercises.new')}
        </button>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={searchId} className="text-sm font-medium text-slate-700">
          {t('exercises.search')}
        </label>
        <input
          id={searchId}
          ref={searchRef}
          type="search"
          maxLength={MAX_QUERY_LENGTH}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          className="min-h-11 max-w-md rounded-md border border-slate-500 px-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        />
      </div>
      <p role="status" className="text-green-800 empty:hidden">
        {notice && `✓ ${notice}`}
      </p>
      {failed && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button type="button" onClick={reload} className="min-h-11 underline">
            {t('app.retry')}
          </button>
        </div>
      )}
      {!items && !failed && (
        <p role="status" className="text-slate-600">
          {t('app.loading')}
        </p>
      )}
      {items && byGroup.length === 0 && (
        <p className="text-slate-700">{q.trim() ? t('exercises.noMatch') : t('exercises.empty')}</p>
      )}
      {byGroup.map(({ group, rows }) => (
        <section key={group} aria-labelledby={`group-${group}`} className="flex flex-col gap-2">
          <h3 id={`group-${group}`} className="text-lg font-semibold text-slate-900">
            {t(`exercises.groups.${group}`)}
          </h3>
          <ul className="flex flex-col gap-2">
            {rows.map((e) => {
              const name = exerciseName(e, lang);
              return (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3"
                >
                  <span className="mr-auto min-w-0 font-medium break-words text-slate-900">
                    {name}
                  </span>
                  <span className="text-sm text-slate-600">
                    {t(`exercises.measures.${e.measure}`)}
                  </span>
                  <button
                    type="button"
                    className={rowButton}
                    aria-label={t('exercises.editNamed', { name })}
                    onClick={() => setEditing(e)}
                  >
                    {t('exercises.edit')}
                  </button>
                  {canArchive(e) && (
                    <button
                      type="button"
                      className={rowButton}
                      aria-label={t('exercises.archiveNamed', { name })}
                      onClick={() => {
                        setArchiveError(null);
                        setArchiving(e);
                      }}
                    >
                      {t('exercises.archive')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {editing && (
        <ExerciseForm
          gymId={gymId}
          exercise={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setNotice(t('exercises.saved', { name: exerciseName(saved, lang) }));
            setEditing(null);
            reload();
          }}
        />
      )}
      {archiving && (
        <ConfirmDialog
          title={t('exercises.archiveTitle')}
          message={t('exercises.archiveMessage', { name: exerciseName(archiving, lang) })}
          confirmLabel={t('exercises.archive')}
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
