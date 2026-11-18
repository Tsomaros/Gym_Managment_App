import type { Plan, PlanSummary } from '@gym/shared';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/Field';
import { PdfPlanUpload } from './PdfPlanUpload';

const choice =
  'flex min-h-14 w-full flex-col items-start rounded-xl border border-slate-300 bg-white px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';
const back =
  'min-h-11 rounded-md border border-slate-300 px-4 font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

function FromTemplate({
  gymId,
  memberId,
  onCreated,
  onBack,
}: {
  gymId: string;
  memberId: string;
  onCreated: (plan: Plan) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<PlanSummary[] | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [activate, setActivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectId = useId();

  useEffect(() => {
    let current = true;
    apiFetch<PlanSummary[]>(`/gyms/${gymId}/plan-templates`)
      .then((list) => {
        if (!current) return;
        setTemplates(list);
        setTemplateId(list[0]?.id ?? '');
      })
      .catch(() => current && setError(t('common.genericError')));
    return () => {
      current = false;
    };
  }, [gymId, t]);

  async function create() {
    if (busy || !templateId) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await apiFetch<Plan>(`/gyms/${gymId}/members/${memberId}/plans/from-template`, {
          method: 'POST',
          body: JSON.stringify({ templateId, activate }),
        }),
      );
    } catch {
      setError(t('common.genericError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!templates && !error && <p role="status">{t('app.loading')}</p>}
      {templates && templates.length === 0 && (
        <p className="text-slate-700">{t('plans.newDialog.noTemplates')}</p>
      )}
      {templates && templates.length > 0 && (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={selectId} className="text-sm font-medium text-slate-700">
              {t('plans.newDialog.chooseTemplate')}
            </label>
            <select
              id={selectId}
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="min-h-11 rounded-md border border-slate-500 bg-white px-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.authorName ? `${tpl.title} — ${tpl.authorName}` : tpl.title}
                </option>
              ))}
            </select>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-base text-slate-900">
            <input
              type="checkbox"
              checked={activate}
              onChange={(e) => setActivate(e.target.checked)}
              className="size-6 accent-slate-900"
            />
            {t('plans.newDialog.activateNow')}
          </label>
        </>
      )}
      <FormError message={error} />
      <div className="flex justify-between gap-2">
        <button type="button" onClick={onBack} className={back}>
          {t('plans.newDialog.back')}
        </button>
        {templates && templates.length > 0 && (
          <button
            type="button"
            onClick={() => void create()}
            aria-disabled={busy || undefined}
            className="min-h-11 rounded-md bg-slate-900 px-4 font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-disabled:opacity-60"
          >
            {busy ? t('common.working') : t('plans.newDialog.create')}
          </button>
        )}
      </div>
    </div>
  );
}

/** How to start a client's new plan: from nothing, from a template, or from a PDF file. */
export function NewPlanDialog({
  gymId,
  memberId,
  onBlank,
  onCreated,
  onClose,
}: {
  gymId: string;
  memberId: string;
  onBlank: () => void;
  onCreated: (plan: Plan) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<'choose' | 'template' | 'pdf'>('choose');

  return (
    <Dialog title={t('plans.newDialog.title')} closeLabel={t('common.close')} onClose={onClose}>
      {step === 'choose' && (
        <div className="flex flex-col gap-3">
          <button type="button" className={choice} onClick={onBlank}>
            <span className="font-semibold text-slate-900">{t('plans.newDialog.blank')}</span>
            <span className="text-sm text-slate-600">{t('plans.newDialog.blankHint')}</span>
          </button>
          <button type="button" className={choice} onClick={() => setStep('template')}>
            <span className="font-semibold text-slate-900">
              {t('plans.newDialog.fromTemplate')}
            </span>
            <span className="text-sm text-slate-600">{t('plans.newDialog.fromTemplateHint')}</span>
          </button>
          <button type="button" className={choice} onClick={() => setStep('pdf')}>
            <span className="font-semibold text-slate-900">{t('plans.newDialog.pdf')}</span>
            <span className="text-sm text-slate-600">{t('plans.newDialog.pdfHint')}</span>
          </button>
        </div>
      )}
      {step === 'template' && (
        <FromTemplate
          gymId={gymId}
          memberId={memberId}
          onCreated={onCreated}
          onBack={() => setStep('choose')}
        />
      )}
      {step === 'pdf' && (
        <div className="flex flex-col gap-4">
          <PdfPlanUpload gymId={gymId} memberId={memberId} onCreated={onCreated} />
          <div>
            <button type="button" onClick={() => setStep('choose')} className={back}>
              {t('plans.newDialog.back')}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
