import type { AuditEntry, AuditPage } from '@gym/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { formatDate, formatMoney } from '../../lib/format';

/** Owner: the gym's change history, newest first, as plain sentences. */
export function HistoryPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { gymId } = useParams();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(
    async (before?: string) => {
      setState('loading');
      try {
        const page = await apiFetch<AuditPage>(
          `/gyms/${gymId}/audit?limit=50${before ? `&before=${before}` : ''}`,
        );
        setEntries((prev) => (before ? [...prev, ...page.entries] : page.entries));
        setNextBefore(page.nextBefore);
        setState('ready');
      } catch {
        setState('error');
      }
    },
    [gymId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  function sentence(e: AuditEntry): string {
    const d = e.data as Record<string, string | number | undefined>;
    const money = (v: unknown) => (typeof v === 'number' ? formatMoney(v, lang) : '');
    const date = (v: unknown) => (typeof v === 'string' ? formatDate(v, lang) : '');
    const vars = {
      actor: e.actor?.fullName ?? t('history.someone'),
      name: d.typeName ?? d.name ?? '',
      amount: money(d.amountCents),
      method: d.method ? t(`history.methods.${d.method}`) : '',
      reason: d.reason ?? '',
      from: date(d.startsOn),
      to: date(d.endsOn),
    };
    return t(`history.actions.${e.action}`, vars);
  }

  const when = (iso: string) =>
    new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'el-GR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));

  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-4">
      <h2 id="history-title" className="text-xl font-semibold text-slate-900">
        {t('nav.history')}
      </h2>
      {state === 'ready' && entries.length === 0 && (
        <p className="text-slate-600">{t('history.empty')}</p>
      )}
      {entries.length > 0 && (
        <ol className="flex flex-col divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {entries.map((e) => (
            <li key={e.id} className="p-4">
              <p className="break-words text-slate-900">{sentence(e)}</p>
              <p className="mt-1 text-sm text-slate-600">
                <time dateTime={e.at}>{when(e.at)}</time>
              </p>
            </li>
          ))}
        </ol>
      )}
      {state === 'loading' && <p className="text-slate-600">{t('app.loading')}</p>}
      {state === 'error' && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button
            type="button"
            onClick={() => void load(nextBefore ?? undefined)}
            className="min-h-11 underline"
          >
            {t('app.retry')}
          </button>
        </div>
      )}
      {state === 'ready' && nextBefore && (
        <button
          type="button"
          onClick={() => void load(nextBefore)}
          className="min-h-11 self-start rounded-md border border-slate-300 px-4 font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-slate-900"
        >
          {t('history.more')}
        </button>
      )}
    </section>
  );
}
