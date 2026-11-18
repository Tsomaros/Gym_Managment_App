import { MAX_PDF_BYTES, type Plan } from '@gym/shared';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../../api/client';
import { Field, FormError, SubmitButton } from '../../components/Field';

/** A ready-made plan as a PDF file (10 MB at most), optionally active at once. */
export function PdfPlanUpload({
  gymId,
  memberId,
  onCreated,
}: {
  gymId: string;
  memberId: string;
  onCreated: (plan: Plan) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [activate, setActivate] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFormError(null);
    const cleanTitle = title.trim();
    setTitleError(cleanTitle ? null : t('plans.pdf.titleRequired'));
    const looksLikePdf = !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
    const problem =
      !file || !looksLikePdf
        ? t('plans.pdf.notPdf')
        : file.size > MAX_PDF_BYTES
          ? t('plans.pdf.tooLarge')
          : null;
    setFileError(problem);
    if (!cleanTitle) return titleRef.current?.focus();
    if (problem) return fileRef.current?.focus();

    setBusy(true);
    try {
      const body = new FormData();
      body.set('title', cleanTitle);
      body.set('activate', String(activate));
      body.set('file', file!);
      onCreated(
        await apiFetch<Plan>(`/gyms/${gymId}/members/${memberId}/plans/pdf`, {
          method: 'POST',
          body,
        }),
      );
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 415) setFileError(t('plans.pdf.serverNotPdf'));
      else if (status === 413) setFileError(t('plans.pdf.tooLarge'));
      else setFormError(t('plans.pdf.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
      <Field
        ref={titleRef}
        label={t('plans.pdf.title')}
        value={title}
        maxLength={80}
        required
        error={titleError}
        onChange={(e) => setTitle(e.target.value)}
      />
      <Field
        ref={fileRef}
        label={t('plans.pdf.file')}
        type="file"
        accept="application/pdf"
        error={fileError}
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setFileError(null);
        }}
      />
      <label className="flex min-h-11 items-center gap-3 text-base text-slate-900">
        <input
          type="checkbox"
          checked={activate}
          onChange={(e) => setActivate(e.target.checked)}
          className="size-6 accent-slate-900"
        />
        {t('plans.pdf.activateNow')}
      </label>
      <FormError message={formError} />
      <div className="flex justify-end">
        <SubmitButton busy={busy}>
          {busy ? t('common.working') : t('plans.pdf.upload')}
        </SubmitButton>
      </div>
    </form>
  );
}
