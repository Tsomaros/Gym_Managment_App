import type { Payment } from '@gym/shared';
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { ApiError, apiFetch } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { Field, FormError } from '../../components/Field';
import { formatMoney } from '../../lib/format';

/** Today on this device as YYYY-MM-DD (the owner's device is in the gym's time zone). */
const localToday = () => new Date().toLocaleDateString('en-CA');

/** Owner: payments for a date range (default today), totals per method, and voiding. */
export function PaymentsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { gymId } = useParams();
  const [from, setFrom] = useState(localToday);
  const [to, setTo] = useState(localToday);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const justVoided = useRef(false);

  const load = useCallback(async () => {
    if (!from || !to || to < from) {
      setPayments(null); // don't leave rows of another range under the error
      return;
    }
    setFailed(false);
    try {
      setPayments(await apiFetch<Payment[]>(`/gyms/${gymId}/payments?from=${from}&to=${to}`));
    } catch {
      setFailed(true);
    }
  }, [gymId, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const live = (payments ?? []).filter((p) => !p.voidedAt);
  const total = (method?: Payment['method']) =>
    live.filter((p) => !method || p.method === method).reduce((s, p) => s + p.amountCents, 0);
  const time = (iso: string) =>
    new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'el-GR', {
      dateStyle: from === to ? undefined : 'short',
      timeStyle: 'short',
    }).format(new Date(iso));

  return (
    <section aria-labelledby="payments-title" className="flex flex-col gap-4">
      <h2 id="payments-title" className="text-xl font-semibold text-slate-900">
        {t('nav.payments')}
      </h2>
      <div className="flex flex-wrap gap-3">
        <Field
          label={t('payments.from')}
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Field
          label={t('payments.to')}
          type="date"
          value={to}
          error={to && from && to < from ? t('freeze.endBeforeStart') : null}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      <p
        ref={noticeRef}
        role="status"
        tabIndex={-1}
        className="min-h-5 text-sm text-green-800 focus:outline-none"
      >
        {notice && `✓ ${notice}`}
      </p>
      {failed && (
        <p role="alert" className="text-red-700">
          {t('common.genericError')}
        </p>
      )}

      {payments && (
        <section
          aria-label={t('payments.totals')}
          className="grid grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-white p-4 text-center"
        >
          {[
            [t('sell.cash'), total('cash')],
            [t('sell.card'), total('card')],
            [t('payments.total'), total()],
          ].map(([label, cents]) => (
            <div key={label as string}>
              <p className="text-sm text-slate-600">{label}</p>
              <p className="text-lg font-bold text-slate-900 tabular-nums">
                {formatMoney(cents as number, lang)}
              </p>
            </div>
          ))}
        </section>
      )}

      {!payments && !failed && <p className="text-slate-600">{t('app.loading')}</p>}
      {payments?.length === 0 && <p className="text-slate-600">{t('payments.empty')}</p>}
      {payments && payments.length > 0 && (
        <ul className="flex flex-col gap-2">
          {payments.map((p) => (
            <li
              key={p.id}
              className={`flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4 ${
                p.voidedAt ? 'border-dashed border-slate-400' : 'border-slate-200'
              }`}
            >
              <div className="mr-auto min-w-0">
                <p className="font-semibold break-words text-slate-900">{p.memberName}</p>
                <p className="text-sm text-slate-600">
                  {p.membershipName} · {t(`sell.${p.method}`)} · {time(p.paidAt)}
                  {p.recordedBy && ` · ${p.recordedBy.fullName}`}
                </p>
                {p.voidedAt && (
                  <p className="mt-1 text-sm text-red-800">
                    {t('payments.voided', {
                      by: p.voidedBy?.fullName ?? '—',
                      reason: p.voidReason ?? '',
                    })}
                  </p>
                )}
              </div>
              <p
                className={`text-lg font-bold tabular-nums ${p.voidedAt ? 'text-slate-500 line-through' : 'text-slate-900'}`}
              >
                {formatMoney(p.amountCents, lang)}
              </p>
              {!p.voidedAt && (
                <button
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    justVoided.current = false;
                    setVoiding(p);
                  }}
                  aria-label={t('payments.voidNamed', {
                    member: p.memberName,
                    amount: formatMoney(p.amountCents, lang),
                  })}
                  className="min-h-11 rounded-md border border-red-300 px-3 text-sm font-medium text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-800"
                >
                  {t('payments.void')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {voiding && (
        <VoidDialog
          gymId={gymId!}
          payment={voiding}
          onClose={() => setVoiding(null)}
          // After a void its button disappears; focus the outcome (the notice) instead.
          returnFocusTo={() => (justVoided.current ? noticeRef.current : null)}
          onVoided={() => {
            justVoided.current = true;
            setNotice(t('payments.voidedNotice'));
            setVoiding(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

function VoidDialog({
  gymId,
  payment,
  onClose,
  onVoided,
  returnFocusTo,
}: {
  gymId: string;
  payment: Payment;
  onClose: () => void;
  onVoided: () => void;
  returnFocusTo: () => HTMLElement | null;
}) {
  const { t, i18n } = useTranslation();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = reason.trim().length >= 3 && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch<void>(`/gyms/${gymId}/payments/${payment.id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      onVoided();
    } catch (err) {
      setError(
        t(
          err instanceof ApiError && err.status === 409
            ? 'payments.alreadyVoided'
            : 'common.genericError',
        ),
      );
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('payments.voidTitle')}
      closeLabel={t('common.close')}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-slate-700">
          {t('payments.voidExplain', {
            member: payment.memberName,
            amount: formatMoney(payment.amountCents, i18n.language),
            name: payment.membershipName,
          })}
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor={reasonId} className="text-sm font-medium text-slate-700">
            {t('payments.reason')}
          </label>
          <textarea
            id={reasonId}
            rows={3}
            maxLength={200}
            value={reason}
            aria-describedby={`${reasonId}-hint`}
            onChange={(e) => setReason(e.target.value)}
            className="rounded-md border border-slate-500 px-3 py-2 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          />
          <p id={`${reasonId}-hint`} className="text-sm text-slate-600">
            {t('payments.reasonHint')}
          </p>
        </div>
        <FormError message={error} />
        <button
          type="submit"
          disabled={!ready}
          className="min-h-11 rounded-md bg-red-700 px-4 font-semibold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800 disabled:opacity-50"
        >
          {busy ? t('common.working') : t('payments.void')}
        </button>
      </form>
    </Dialog>
  );
}
