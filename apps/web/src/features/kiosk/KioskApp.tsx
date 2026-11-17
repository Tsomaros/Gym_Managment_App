import type { KioskCheckInResult, KioskMe } from '@gym/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, kioskFetch } from '../../api/client';
import { KioskPairing } from './KioskPairing';
import { KioskResult, type KioskOutcome } from './KioskResult';
import { KioskScanner } from './KioskScanner';
import { kioskStorage } from './kioskStorage';

/** How long a verdict stays on screen, and how long a repeated scan of one code is ignored. */
const RESULT_MS = 3000;

type Link = 'checking' | 'unreachable' | 'ready';

function outcomeOf(r: KioskCheckInResult): KioskOutcome {
  if (r.valid) return { kind: 'ok', firstName: r.firstName ?? null };
  if (r.reason === 'invalid_token') return { kind: 'codeExpired' };
  return { kind: 'reception' };
}

/**
 * /kiosk: the entrance tablet. It authenticates as a device (never as a user): no stored token →
 * pairing; a token the server no longer knows (revoked) → back to pairing; otherwise it scans
 * member QR codes and shows a 3-second verdict (spec §6.2).
 */
export function KioskApp() {
  const { t } = useTranslation();
  const [token, setToken] = useState<string | null>(() => kioskStorage.get());
  const [link, setLink] = useState<Link>('checking');
  const [me, setMe] = useState<KioskMe | null>(null);
  const [outcome, setOutcome] = useState<KioskOutcome | null>(null);
  const busy = useRef(false);
  // Bumped on un-pairing and unmount: an answer that arrives later must not show anything.
  const epoch = useRef(0);
  const last = useRef<{ token: string; at: number } | null>(null);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const unpair = useCallback(() => {
    kioskStorage.clear();
    setToken(null);
    setMe(null);
    setOutcome(null);
    busy.current = false;
    epoch.current++;
    clearTimeout(resultTimer.current);
  }, []);

  const connect = useCallback(() => {
    if (!token) return;
    setLink('checking');
    kioskFetch<KioskMe>('/kiosk/me', token)
      .then((m) => {
        setMe(m);
        setLink('ready');
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) unpair();
        else setLink('unreachable');
      });
  }, [token, unpair]);

  useEffect(connect, [connect]);
  useEffect(
    () => () => {
      epoch.current++;
      clearTimeout(resultTimer.current);
    },
    [],
  );

  const onToken = useCallback(
    (scanned: string) => {
      if (busy.current || !token) return;
      const now = Date.now();
      if (last.current?.token === scanned && now - last.current.at < RESULT_MS) return;
      last.current = { token: scanned, at: now };
      busy.current = true;
      const mine = epoch.current;

      const show = (o: KioskOutcome) => {
        if (mine !== epoch.current) return;
        setOutcome(o);
        resultTimer.current = setTimeout(() => {
          setOutcome(null);
          busy.current = false;
          // A code still held up gets another full window, so it is not scanned a second time.
          if (last.current) last.current.at = Date.now();
        }, RESULT_MS);
      };
      kioskFetch<KioskCheckInResult>('/kiosk/check-in', token, {
        method: 'POST',
        body: JSON.stringify({ token: scanned }),
      })
        .then((r) => show(outcomeOf(r)))
        .catch((err: unknown) => {
          if (mine !== epoch.current) return;
          if (err instanceof ApiError && err.status === 401) unpair();
          else show({ kind: 'connection' });
        });
    },
    [token, unpair],
  );

  if (!token) {
    return (
      <KioskPairing
        onPaired={(deviceToken) => {
          kioskStorage.set(deviceToken);
          setToken(deviceToken);
        }}
      />
    );
  }

  if (link !== 'ready') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 p-6 text-center">
        {link === 'checking' ? (
          <p role="status" className="text-2xl text-slate-700">
            {t('kiosk.connecting')}
          </p>
        ) : (
          <div role="alert" className="flex flex-col items-center gap-4">
            <p className="text-2xl text-red-700">{t('kiosk.offline')}</p>
            <button
              type="button"
              onClick={connect}
              className="min-h-14 rounded-lg bg-slate-900 px-6 text-xl font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              {t('app.retry')}
            </button>
          </div>
        )}
      </main>
    );
  }

  return (
    <>
      <KioskScanner
        onToken={onToken}
        paused={outcome !== null}
        caption={me ? `${me.gymName} · ${me.deviceName}` : undefined}
      />
      {outcome && <KioskResult outcome={outcome} />}
    </>
  );
}
