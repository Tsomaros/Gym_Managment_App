import type { Device, PairingCodeResponse } from '@gym/shared';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Dialog } from '../../components/Dialog';
import { Field } from '../../components/Field';

const button =
  'min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';
const primary =
  'min-h-11 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-disabled:opacity-60';

function useDateTime() {
  const { i18n } = useTranslation();
  const tag = i18n.language === 'en' ? 'en-GB' : 'el-GR';
  return (iso: string, style: 'short' | 'time' = 'short') =>
    new Intl.DateTimeFormat(
      tag,
      style === 'time' ? { timeStyle: 'short' } : { dateStyle: 'short', timeStyle: 'short' },
    ).format(new Date(iso));
}

/** Owner: pairs entrance tablets with a one-time code and revokes lost or retired ones. */
function PairDialog({ gymId, onClose }: { gymId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const format = useDateTime();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [code, setCode] = useState<PairingCodeResponse | null>(null);
  const codeRef = useRef<HTMLParagraphElement>(null);
  // The form (and the focused button) disappears when the code shows: move focus to the code.
  useEffect(() => {
    if (code) codeRef.current?.focus();
  }, [code]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t('common.required'));
      return;
    }
    setNameError(null);
    setBusy(true);
    setFailed(false);
    try {
      setCode(
        await apiFetch<PairingCodeResponse>(`/gyms/${gymId}/devices/pairing-codes`, {
          method: 'POST',
          body: JSON.stringify({ name: trimmed }),
        }),
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={t('devices.codeTitle')} closeLabel={t('common.close')} onClose={onClose}>
      {code ? (
        <div className="text-center">
          <p
            ref={codeRef}
            tabIndex={-1}
            className="font-mono text-5xl font-bold tracking-widest text-slate-900 focus:outline-none sm:text-6xl"
          >
            <span aria-hidden="true">{code.code}</span>
            <span className="sr-only">{code.code.split('').join(' ')}</span>
          </p>
          <p className="mt-3 text-sm text-slate-700">
            {t('devices.codeHint', { time: format(code.expiresAt, 'time') })}
          </p>
          <div className="mt-6 flex justify-end">
            <button type="button" onClick={onClose} className={primary}>
              {t('devices.done')}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
          <Field
            label={t('devices.nameLabel')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder={t('devices.namePlaceholder')}
            error={nameError}
            autoComplete="off"
          />
          {failed && (
            <p role="alert" className="text-red-700">
              {t('common.genericError')}
            </p>
          )}
          <div className="flex justify-end">
            <button type="submit" aria-disabled={busy || undefined} className={primary}>
              {busy ? t('common.working') : t('devices.create')}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function DevicesPage() {
  const { t } = useTranslation();
  const format = useDateTime();
  const { gymId = '' } = useParams();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [revoking, setRevoking] = useState<Device | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    apiFetch<Device[]>(`/gyms/${gymId}/devices`)
      .then(setDevices)
      .catch(() => setFailed(true));
  }, [gymId]);
  useEffect(load, [load]);

  async function revoke(device: Device) {
    setBusy(true);
    try {
      await apiFetch(`/gyms/${gymId}/devices/${device.id}/revoke`, { method: 'POST' });
      setRevoking(null);
      load();
    } catch {
      setFailed(true);
      setRevoking(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="devices-title">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 id="devices-title" className="mr-auto text-xl font-semibold text-slate-900">
          {t('devices.title')}
        </h2>
        <button type="button" onClick={() => setPairing(true)} className={primary}>
          {t('devices.connect')}
        </button>
      </div>

      {failed && (
        <div role="alert" className="mb-4 flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button type="button" onClick={load} className="min-h-11 underline">
            {t('app.retry')}
          </button>
        </div>
      )}
      {!devices && !failed && <p className="text-slate-600">{t('app.loading')}</p>}
      {devices && devices.length === 0 && <p className="text-slate-700">{t('devices.empty')}</p>}
      {devices && devices.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="mr-auto min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold break-words text-slate-900">
                  {d.name}
                  {d.revoked && (
                    <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-sm font-semibold text-red-900 ring-1 ring-red-700">
                      <span aria-hidden="true">✕ </span>
                      {t('devices.revoked')}
                    </span>
                  )}
                </p>
                <p className="text-sm text-slate-600">
                  {d.lastSeenAt
                    ? t('devices.lastSeen', { when: format(d.lastSeenAt) })
                    : t('devices.neverSeen')}
                </p>
              </div>
              {!d.revoked && (
                <button
                  type="button"
                  onClick={() => setRevoking(d)}
                  aria-label={t('devices.revokeNamed', { name: d.name })}
                  className={button}
                >
                  {t('devices.revoke')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {pairing && (
        <PairDialog
          gymId={gymId}
          onClose={() => {
            setPairing(false);
            load();
          }}
        />
      )}
      {revoking && (
        <ConfirmDialog
          title={t('devices.revokeTitle')}
          message={t('devices.revokeMessage', { name: revoking.name })}
          confirmLabel={t('devices.revoke')}
          cancelLabel={t('common.cancel')}
          busy={busy}
          busyLabel={t('common.working')}
          onConfirm={() => void revoke(revoking)}
          onCancel={() => setRevoking(null)}
        />
      )}
    </section>
  );
}
