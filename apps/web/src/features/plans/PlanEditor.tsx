import { type Exercise, type Plan, PlanInputSchema } from '@gym/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ExercisePicker } from '../exercises/ExercisePicker';
import { PlanDayEditor } from './PlanDayEditor';
import {
  blankDay,
  blankDraft,
  type Draft,
  draftFromPlan,
  isDirty,
  keepKeys,
  moveItem,
  newDraftExercise,
  toPlanInput,
} from './planState';

const button =
  'min-h-11 rounded-md px-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-disabled:opacity-60';

/** The plan was saved, but the step after it (activating) did not go through. */
class SavedButNotActivated extends Error {}

/**
 * Builds or edits a plan (or a template): days and exercises from the gym's library, saved as one
 * document with the ids of what was already stored, so history and logs stay linked. The browser
 * is warned about unsaved changes, and closing asks first when there are some.
 */
export function PlanEditor({
  gymId,
  memberId,
  plan,
  mode,
  onClose,
  onSaved,
}: {
  gymId: string;
  /** The client the plan is for; not used for templates. */
  memberId?: string;
  /** The stored plan or template; null for a new one. */
  plan: Plan | null;
  mode: 'plan' | 'template';
  onClose: () => void;
  onSaved: (saved: Plan) => void;
}) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<Plan | null>(plan);
  const [draft, setDraft] = useState<Draft>(() =>
    plan ? draftFromPlan(plan) : blankDraft(t('plans.editor.defaultDay')),
  );
  // What was last saved (or loaded), to tell whether the draft has changed since.
  const [savedInput, setSavedInput] = useState(() => toPlanInput(draft));
  const [pickerDay, setPickerDay] = useState<string | null>(null);
  const [removingDay, setRemovingDay] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [badDay, setBadDay] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);

  const dirty = isDirty(draft, savedInput);

  // The browser's own "leave this page?" while there is something to lose.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const patchDraft = useCallback((patch: Partial<Draft>) => {
    setNotice('');
    setDraft((d) => ({ ...d, ...patch }));
  }, []);

  /** Shows a problem and moves focus to it, so it is read out and in view whatever the screen size. */
  function problem(message: string) {
    setError(message);
    requestAnimationFrame(() => alertRef.current?.focus());
  }

  function validate(): boolean {
    setError(null);
    setTitleError(null);
    setBadDay(null);
    if (!draft.title.trim()) {
      setTitleError(t('plans.editor.titleRequired'));
      titleRef.current?.focus();
      return false;
    }
    const unnamed = draft.days.find((d) => !d.title.trim());
    if (unnamed) {
      setBadDay(unnamed.key);
      setError(t('plans.editor.dayTitleRequired'));
      document.getElementById(`day-title-${unnamed.key}`)?.focus();
      return false;
    }
    if (!PlanInputSchema.safeParse(toPlanInput(draft)).success) {
      problem(t('plans.editor.checkRows'));
      return false;
    }
    return true;
  }

  /** Shows what the API stored: its ids for new items, with the editor's own keys kept. */
  function showSaved(saved: Plan, from: Draft) {
    const reloaded = keepKeys(from, draftFromPlan(saved));
    setCurrent(saved);
    setDraft(reloaded);
    setSavedInput(toPlanInput(reloaded));
  }

  /** Saves the draft (and activates it when asked). Throws SavedButNotActivated after a partial success. */
  async function persist(activate: boolean): Promise<Plan> {
    const input = toPlanInput(draft);
    let saved: Plan;
    if (mode === 'template') {
      saved = current
        ? await apiFetch<Plan>(`/gyms/${gymId}/plan-templates/${current.id}`, {
            method: 'PUT',
            body: JSON.stringify(input),
          })
        : await apiFetch<Plan>(`/gyms/${gymId}/plan-templates`, {
            method: 'POST',
            body: JSON.stringify(input),
          });
    } else if (!current) {
      saved = await apiFetch<Plan>(`/gyms/${gymId}/members/${memberId}/plans`, {
        method: 'POST',
        body: JSON.stringify(activate ? { ...input, activate: true } : input),
      });
    } else {
      saved = await apiFetch<Plan>(`/gyms/${gymId}/plans/${current.id}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
      showSaved(saved, draft); // saved for good, whatever happens next
      if (activate && saved.status !== 'active') {
        try {
          saved = await apiFetch<Plan>(`/gyms/${gymId}/plans/${saved.id}/activate`, {
            method: 'POST',
          });
        } catch {
          throw new SavedButNotActivated();
        }
      }
    }
    showSaved(saved, draft);
    return saved;
  }

  async function save(options: { activate?: boolean; asTemplate?: boolean } = {}) {
    if (busy || !validate()) return;
    setBusy(true);
    setNotice('');
    let saved: Plan;
    try {
      saved = await persist(!!options.activate);
    } catch (err) {
      problem(
        err instanceof SavedButNotActivated
          ? t('plans.editor.savedNotActivated')
          : t('plans.editor.saveFailed'),
      );
      setBusy(false);
      return;
    }
    try {
      if (options.asTemplate) {
        const title = toPlanInput(draft).title;
        await apiFetch<Plan>(`/gyms/${gymId}/plans/${saved.id}/save-as-template`, {
          method: 'POST',
          body: JSON.stringify({ title }),
        });
        setNotice(t('plans.editor.templateSaved', { title }));
      } else {
        onSaved(saved);
      }
    } catch {
      problem(t('plans.editor.savedNoTemplate'));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (dirty) setConfirmClose(true);
    else onClose();
  }

  function addExercise(e: Exercise) {
    if (!pickerDay) return;
    setDraft((d) => ({
      ...d,
      days: d.days.map((day) =>
        day.key === pickerDay
          ? { ...day, exercises: [...day.exercises, newDraftExercise(e)] }
          : day,
      ),
    }));
    setPickerDay(null);
  }

  const dayToRemove = draft.days.find((d) => d.key === removingDay);
  const heading =
    mode === 'template'
      ? t('plans.editor.templateTitle')
      : current
        ? t('plans.editor.editTitle')
        : t('plans.editor.newTitle');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-xl font-semibold text-slate-900">{heading}</h2>
        <button
          type="button"
          onClick={close}
          className={`${button} border border-slate-400 bg-white text-slate-900 hover:bg-slate-50`}
        >
          {t('plans.editor.close')}
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="plan-title" className="text-sm font-medium text-slate-700">
          {t('plans.editor.planTitle')}
        </label>
        <input
          id="plan-title"
          ref={titleRef}
          type="text"
          maxLength={80}
          value={draft.title}
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? 'plan-title-error' : undefined}
          onChange={(e) => {
            setTitleError(null);
            patchDraft({ title: e.target.value });
          }}
          className={`min-h-11 rounded-md border px-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
            titleError ? 'border-red-700' : 'border-slate-500'
          }`}
        />
        {titleError && (
          <p id="plan-title-error" className="text-sm text-red-700">
            {titleError}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="plan-notes" className="text-sm font-medium text-slate-700">
          {t('plans.editor.notes')}
        </label>
        <textarea
          id="plan-notes"
          rows={2}
          maxLength={1000}
          value={draft.notes}
          onChange={(e) => patchDraft({ notes: e.target.value })}
          className="rounded-md border border-slate-500 px-3 py-2 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        />
      </div>

      <div className="flex flex-col gap-4">
        {draft.days.map((day, i) => (
          <PlanDayEditor
            key={day.key}
            day={day}
            first={i === 0}
            last={i === draft.days.length - 1}
            titleInvalid={badDay === day.key}
            onChange={(next) => {
              if (badDay === day.key && next.title.trim()) setBadDay(null);
              patchDraft({ days: draft.days.map((d) => (d.key === day.key ? next : d)) });
            }}
            onMove={(delta) => patchDraft({ days: moveItem(draft.days, i, delta) })}
            onRemove={() => setRemovingDay(day.key)}
            onAddExercise={() => setPickerDay(day.key)}
          />
        ))}
        {draft.days.length < 14 && (
          <button
            type="button"
            onClick={() => patchDraft({ days: [...draft.days, blankDay('')] })}
            className="min-h-11 self-start rounded-md border border-slate-400 bg-white px-4 font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            <span aria-hidden="true">+ </span>
            {t('plans.editor.addDay')}
          </button>
        )}
      </div>

      <p
        ref={alertRef}
        role="alert"
        tabIndex={-1}
        className="min-h-5 text-red-700 empty:hidden focus:outline-none"
      >
        {error}
      </p>
      <p role="status" className="text-green-800 empty:hidden">
        {notice && `✓ ${notice}`}
      </p>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <button
          type="button"
          aria-disabled={busy || undefined}
          onClick={() => void save()}
          className={`${button} bg-slate-900 text-white hover:bg-slate-800`}
        >
          {t('plans.editor.save')}
        </button>
        {mode === 'plan' && (
          <>
            {current?.status !== 'active' && (
              <button
                type="button"
                aria-disabled={busy || undefined}
                onClick={() => void save({ activate: true })}
                className={`${button} border border-slate-900 bg-white text-slate-900 hover:bg-slate-50`}
              >
                {t('plans.editor.saveActivate')}
              </button>
            )}
            <button
              type="button"
              aria-disabled={busy || undefined}
              onClick={() => void save({ asTemplate: true })}
              className={`${button} border border-slate-400 bg-white text-slate-900 hover:bg-slate-50`}
            >
              {t('plans.editor.saveTemplate')}
            </button>
          </>
        )}
      </div>

      {pickerDay && (
        <ExercisePicker gymId={gymId} onPick={addExercise} onClose={() => setPickerDay(null)} />
      )}
      {dayToRemove && (
        <ConfirmDialog
          title={t('plans.editor.removeDayTitle')}
          message={t('plans.editor.removeDayMessage', {
            name: dayToRemove.title.trim() || t('plans.editor.day'),
          })}
          confirmLabel={t('plans.editor.removeDay')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => {
            patchDraft({ days: draft.days.filter((d) => d.key !== dayToRemove.key) });
            setRemovingDay(null);
          }}
          onCancel={() => setRemovingDay(null)}
        />
      )}
      {confirmClose && (
        <ConfirmDialog
          title={t('plans.editor.discardTitle')}
          message={t('plans.editor.discardMessage')}
          confirmLabel={t('plans.editor.discard')}
          cancelLabel={t('plans.editor.keepEditing')}
          onConfirm={() => {
            setConfirmClose(false);
            onClose();
          }}
          onCancel={() => setConfirmClose(false)}
        />
      )}
    </div>
  );
}
