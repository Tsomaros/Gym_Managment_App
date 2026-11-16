import type { Membership, MembershipType, PaymentMethod } from '@gym/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { Field, FormError, SubmitButton } from '../../components/Field';
import { centsToInput, formatDate, formatMoney, parseEuros } from '../../lib/format';

/**
 * Reception sells or renews a membership: pick the type, take the money (the price, or less for
 * a discount), cash or card, optional later start. The API decides the start and end and the
 * dialog shows them.
 */
export function SellMembershipDialog({
  gymId,
  memberId,
  memberName,
  onClose,
  onSold,
}: {
  gymId: string;
  memberId: string;
  memberName: string;
  onClose: () => void;
  onSold: (m: Membership) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [types, setTypes] = useState<MembershipType[] | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [startsOn, setStartsOn] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sold, setSold] = useState<Membership | null>(null);

  useEffect(() => {
    apiFetch<MembershipType[]>(`/gyms/${gymId}/membership-types`)
      .then(setTypes)
      .catch(() => setError(t('common.genericError')));
  }, [gymId, t]);

  const name = (type: MembershipType) => (lang === 'en' && type.nameEn ? type.nameEn : type.name);

  function choose(type: MembershipType) {
    setTypeId(type.id);
    setAmount(centsToInput(type.priceCents, lang));
    setAmountError(null);
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const type = types?.find((x) => x.id === typeId);
    if (!type) {
      setError(t('sell.chooseType'));
      return;
    }
    const amountCents = parseEuros(amount);
    if (amountCents === null) {
      setAmountError(t('types.priceInvalid'));
      return;
    }
    if (amountCents > type.priceCents) {
      setAmountError(t('sell.aboveprice'));
      return;
    }
    setAmountError(null);
    setBusy(true);
    try {
      const m = await apiFetch<Membership>(`/gyms/${gymId}/members/${memberId}/memberships`, {
        method: 'POST',
        body: JSON.stringify({
          typeId: type.id,
          amountCents,
          method,
          ...(startsOn && { startsOn }),
        }),
      });
      setSold(m);
      onSold(m);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(
        t(
          status === 409
            ? 'sell.archived'
            : status === 400
              ? 'sell.badRequest'
              : 'common.genericError',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  if (sold) {
    return (
      <Dialog title={t('sell.doneTitle')} closeLabel={t('common.close')} onClose={onClose}>
        <p role="status" className="text-slate-800">
          <span aria-hidden="true">✓ </span>
          {t('sell.done', { name: sold.name, member: memberName })}
        </p>
        <p className="mt-2 text-lg font-semibold text-slate-900">
          {sold.endsOn
            ? t('sell.period', {
                from: formatDate(sold.startsOn, lang),
                to: formatDate(sold.endsOn, lang),
              })
            : t('sell.from', { from: formatDate(sold.startsOn, lang) })}
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={t('sell.title', { member: memberName })}
      closeLabel={t('common.close')}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-slate-700">{t('sell.type')}</legend>
          {!types && !error && <p className="text-slate-600">{t('app.loading')}</p>}
          {types?.length === 0 && <p className="text-slate-600">{t('sell.noTypes')}</p>}
          {types?.map((type) => (
            <label
              key={type.id}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md border p-3 ${
                typeId === type.id ? 'border-slate-900 bg-slate-50' : 'border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="type"
                className="size-5"
                checked={typeId === type.id}
                onChange={() => choose(type)}
              />
              <span className="mr-auto font-medium text-slate-900">{name(type)}</span>
              <span className="tabular-nums text-slate-700">
                {formatMoney(type.priceCents, lang)}
              </span>
            </label>
          ))}
        </fieldset>
        <Field
          label={t('sell.amount')}
          inputMode="decimal"
          value={amount}
          error={amountError}
          hint={t('sell.amountHint')}
          onChange={(e) => setAmount(e.target.value)}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-slate-700">{t('sell.method')}</legend>
          <div className="flex gap-3">
            {(['cash', 'card'] as const).map((m) => (
              <label
                key={m}
                className="flex min-h-11 flex-1 cursor-pointer items-center gap-3 rounded-md border border-slate-300 p-3"
              >
                <input
                  type="radio"
                  name="method"
                  className="size-5"
                  checked={method === m}
                  onChange={() => setMethod(m)}
                />
                {t(`sell.${m}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <Field
          label={t('sell.startsOn')}
          type="date"
          value={startsOn}
          hint={t('sell.startsOnHint')}
          onChange={(e) => setStartsOn(e.target.value)}
        />
        <FormError message={error} />
        <SubmitButton busy={busy}>{t('sell.submit')}</SubmitButton>
      </form>
    </Dialog>
  );
}
