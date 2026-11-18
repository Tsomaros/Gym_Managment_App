import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { InstallAppHint } from './InstallAppHint';
import { usePush } from './usePush';

export const PUSH_CARD_KEY = 'gym.pushCardDismissed';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(PUSH_CARD_KEY) === '1';
  } catch {
    return false; // storage blocked (private window): show the card, dismiss in memory only
  }
}

/**
 * A dismissible offer on the member's home: reminders before the membership ends. After the tap
 * the card stays long enough to say what happened (turned on, or blocked and where to change it).
 */
export function EnablePushCard() {
  const { t } = useTranslation();
  const { gymId } = useParams();
  const { state, enable } = usePush();
  const [dismissed, setDismissed] = useState(wasDismissed);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tapped, setTapped] = useState(false);

  const offer = state === 'default' || state === 'needs-install';
  if (dismissed || (!offer && !tapped)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(PUSH_CARD_KEY, '1');
    } catch {
      // not remembered across visits, which is fine
    }
  };

  async function turnOn() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await enable();
      setTapped(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  // The outcome is announced from a region that stays mounted from the first render.
  const outcome = tapped
    ? state === 'subscribed'
      ? t('notifications.pushOn')
      : state === 'denied'
        ? t('notifications.pushDenied')
        : ''
    : '';

  return (
    <section
      aria-labelledby="push-card-title"
      className="mt-6 flex flex-col gap-3 rounded-2xl border border-sky-300 bg-sky-50 p-4"
    >
      <h2 id="push-card-title" className="font-semibold text-slate-900">
        {t('notifications.cardQuestion')}
      </h2>
      <p role="status" className="text-slate-800">
        {outcome}
      </p>
      {state === 'needs-install' && <InstallAppHint />}
      {state === 'default' && (
        <button
          type="button"
          aria-disabled={busy || undefined}
          onClick={() => void turnOn()}
          className="min-h-11 self-start rounded-md bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {busy ? t('notifications.pushWorking') : t('notifications.cardEnable')}
        </button>
      )}
      {failed && (
        <p role="alert" className="text-red-700">
          {t('notifications.pushFailed')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {tapped && gymId && (
          <Link
            to={`/g/${gymId}/notifications`}
            className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-slate-900 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {t('nav.notifications')}
          </Link>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="min-h-11 rounded-md px-3 text-sm font-medium text-slate-700 underline hover:bg-sky-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {tapped ? t('notifications.cardClose') : t('notifications.cardLater')}
        </button>
      </div>
    </section>
  );
}
