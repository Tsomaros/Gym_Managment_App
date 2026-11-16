import type { SignupCodeResponse } from '@gym/shared';
import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../api/client';
import { Modal } from '../../components/modal';

/**
 * Reception: a fresh one-time sign-up code, big enough to read out or show across the desk.
 * Opening the dialog creates a code; "new code" creates another (the previous one stays valid
 * until used or expired).
 */
export function NewMemberCodeDialog({ gymId, onClose }: { gymId: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const [code, setCode] = useState<SignupCodeResponse | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const started = useRef(false);

  const generate = useCallback(async () => {
    setError(false);
    setCopied(false);
    try {
      setCode(
        await apiFetch<SignupCodeResponse>(`/gyms/${gymId}/signup-codes`, { method: 'POST' }),
      );
    } catch {
      setError(true);
    }
  }, [gymId]);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice; create one code per opening
    started.current = true;
    void generate();
  }, [generate]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, []);

  function trapTab(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const buttons = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button') ?? [])];
    const first = buttons[0];
    const last = buttons.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const expires =
    code &&
    new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'el-GR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(code.expiresAt));

  const button =
    'min-h-11 rounded-md border border-slate-300 px-4 font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

  return (
    <Modal>
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onKeyDown={trapTab}
          className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
        >
          <div className="flex items-start gap-3">
            <h2 id={titleId} className="mr-auto text-lg font-semibold text-slate-900">
              {t('codes.title')}
            </h2>
            <button type="button" onClick={onClose} className={button}>
              {t('common.close')}
            </button>
          </div>
          <p className="mt-2 text-slate-700">{t('codes.instructions')}</p>

          <div className="my-6 text-center" aria-live="polite">
            {code && (
              <>
                <p
                  aria-label={code.code.split('').join(' ')}
                  className="font-mono text-[3rem] font-bold tracking-widest text-slate-900 sm:text-6xl"
                >
                  {code.code}
                </p>
                <p className="mt-3 text-sm text-slate-600">
                  {t('codes.expires', { time: expires })}
                </p>
              </>
            )}
            {!code && !error && <p className="text-slate-600">{t('app.loading')}</p>}
            {error && (
              <p role="alert" className="text-red-700">
                {t('common.genericError')}
              </p>
            )}
          </div>

          <p role="status" className="min-h-5 text-center text-sm text-green-800">
            {copied ? `✓ ${t('codes.copied')}` : ''}
          </p>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => void generate()} className={button}>
              {t('codes.another')}
            </button>
            <button
              type="button"
              onClick={() => void copy()}
              disabled={!code}
              className="min-h-11 rounded-md bg-slate-900 px-4 font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-50"
            >
              {t('codes.copy')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
