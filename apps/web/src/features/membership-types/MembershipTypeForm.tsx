import {
  MEMBERSHIP_KINDS,
  type MembershipKind,
  type MembershipType,
  type MembershipTypeInput,
  MembershipTypeInputSchema,
} from '@gym/shared';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, FormError, SubmitButton } from '../../components/Field';
import { centsToInput, parseEuros } from '../../lib/format';

type Errors = Partial<
  Record<'name' | 'duration' | 'visits' | 'validity' | 'price' | 'freeze', string>
>;

const isPack = (k: MembershipKind) => k === 'visits' || k === 'classes';

/** Create or edit a membership type. Fields follow the kind; only time-based types can be frozen. */
export function MembershipTypeForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: MembershipType;
  onSubmit: (input: MembershipTypeInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const kindId = useId();
  const [kind, setKind] = useState<MembershipKind>(initial?.kind ?? 'time');
  const [name, setName] = useState(initial?.name ?? '');
  const [nameEn, setNameEn] = useState(initial?.nameEn ?? '');
  const [months, setMonths] = useState(initial?.durationMonths?.toString() ?? '');
  const [visits, setVisits] = useState(initial?.visitCount?.toString() ?? '');
  const [validity, setValidity] = useState(initial?.validityDays?.toString() ?? '');
  const [price, setPrice] = useState(
    initial ? centsToInput(initial.priceCents, i18n.language) : '',
  );
  const [freeze, setFreeze] = useState(initial?.maxFreezeDays.toString() ?? '0');
  const [trainer, setTrainer] = useState(initial?.includesTrainer ?? false);
  const [classes, setClasses] = useState(initial?.includesClasses ?? false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // After a failed submit, focus the first invalid field so phone users see what to fix.
  const refs = {
    name: useRef<HTMLInputElement>(null),
    duration: useRef<HTMLInputElement>(null),
    visits: useRef<HTMLInputElement>(null),
    validity: useRef<HTMLInputElement>(null),
    price: useRef<HTMLInputElement>(null),
    freeze: useRef<HTMLInputElement>(null),
  };
  const [focusFirstError, setFocusFirstError] = useState(false);
  useEffect(() => {
    if (!focusFirstError) return;
    setFocusFirstError(false);
    const order = ['name', 'duration', 'visits', 'validity', 'price', 'freeze'] as const;
    const first = order.find((k) => errors[k]);
    if (first) refs[first].current?.focus();
  }, [focusFirstError, errors]);

  const int = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);

  function validate(): MembershipTypeInput | null {
    const e: Errors = {};
    const priceCents = parseEuros(price);
    if (!name.trim()) e.name = t('common.required');
    if (priceCents === null) e.price = t('types.priceInvalid');
    const candidate = {
      kind,
      name,
      nameEn: nameEn.trim() ? nameEn : null,
      priceCents: priceCents ?? -1,
      includesTrainer: trainer,
      includesClasses: kind === 'classes' ? true : classes,
      ...(kind === 'time' && { durationMonths: int(months), maxFreezeDays: int(freeze) }),
      ...(isPack(kind) && {
        visitCount: int(visits),
        validityDays: validity.trim() ? int(validity) : null,
      }),
    };
    const parsed = MembershipTypeInputSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'durationMonths') e.duration = t('types.durationInvalid');
        if (field === 'visitCount') e.visits = t('types.visitsInvalid');
        if (field === 'validityDays') e.validity = t('types.validityInvalid');
        if (field === 'maxFreezeDays') e.freeze = t('types.freezeInvalid');
        if (field === 'name' && !e.name) e.name = t('common.required');
        if (field === 'priceCents' && !e.price) e.price = t('types.priceInvalid');
      }
    }
    setErrors(e);
    // A rule the form has no field message for must not fail silently.
    if (!parsed.success && Object.keys(e).length === 0) setFormError(t('common.checkFields'));
    setFocusFirstError(true);
    return Object.keys(e).length === 0 && parsed.success ? parsed.data : null;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const input = validate();
    if (!input) return;
    setBusy(true);
    try {
      await onSubmit(input);
    } catch {
      setFormError(t('common.genericError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field
        label={t('types.name')}
        ref={refs.name}
        required
        maxLength={80}
        value={name}
        error={errors.name}
        onChange={(e) => setName(e.target.value)}
      />
      <Field
        label={t('types.nameEn')}
        maxLength={80}
        value={nameEn}
        hint={t('types.nameEnHint')}
        onChange={(e) => setNameEn(e.target.value)}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={kindId} className="text-sm font-medium text-slate-700">
          {t('types.kind')}
        </label>
        <select
          id={kindId}
          value={kind}
          onChange={(e) => setKind(e.target.value as MembershipKind)}
          className="min-h-11 rounded-md border border-slate-500 bg-white px-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {MEMBERSHIP_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`types.kinds.${k}`)}
            </option>
          ))}
        </select>
      </div>
      {kind === 'time' && (
        <Field
          label={t('types.durationMonths')}
          ref={refs.duration}
          inputMode="numeric"
          required
          value={months}
          error={errors.duration}
          onChange={(e) => setMonths(e.target.value)}
        />
      )}
      {isPack(kind) && (
        <>
          <Field
            label={t('types.visitCount')}
            ref={refs.visits}
            inputMode="numeric"
            required
            value={visits}
            error={errors.visits}
            onChange={(e) => setVisits(e.target.value)}
          />
          <Field
            label={t('types.validityDays')}
            ref={refs.validity}
            inputMode="numeric"
            value={validity}
            hint={t('types.validityHint')}
            error={errors.validity}
            onChange={(e) => setValidity(e.target.value)}
          />
        </>
      )}
      <Field
        label={t('types.price')}
        ref={refs.price}
        inputMode="decimal"
        required
        value={price}
        error={errors.price}
        onChange={(e) => setPrice(e.target.value)}
      />
      {kind === 'time' && (
        <Field
          label={t('types.maxFreezeDays')}
          ref={refs.freeze}
          inputMode="numeric"
          value={freeze}
          error={errors.freeze}
          onChange={(e) => setFreeze(e.target.value)}
        />
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-slate-700">{t('types.includes')}</legend>
        <label className="flex min-h-11 items-center gap-3 text-slate-800">
          <input
            type="checkbox"
            className="size-5"
            checked={trainer}
            onChange={(e) => setTrainer(e.target.checked)}
          />
          {t('types.includesTrainer')}
        </label>
        <label className="flex min-h-11 items-center gap-3 text-slate-800">
          <input
            type="checkbox"
            className="size-5"
            checked={kind === 'classes' || classes}
            disabled={kind === 'classes'}
            onChange={(e) => setClasses(e.target.checked)}
          />
          {t('types.includesClasses')}
        </label>
      </fieldset>
      <FormError message={formError} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-md border border-slate-300 px-4 font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {t('common.cancel')}
        </button>
        <SubmitButton busy={busy}>{t('common.save')}</SubmitButton>
      </div>
    </form>
  );
}
