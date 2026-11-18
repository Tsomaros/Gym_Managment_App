import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isIos } from './usePush';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

/** The Share icon of Safari: a square with an arrow. Decorative, the steps carry the meaning. */
function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-8 shrink-0 text-sky-600"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 15V3M8 7l4-4 4 4" />
      <path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" />
    </svg>
  );
}

/**
 * How to install the app, which on iPhone is the only way to get push notifications: the Safari
 * steps there, and on Android the browser's own install button when it offered one.
 */
export function InstallAppHint() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const capture = (e: Event) => {
      e.preventDefault(); // keep the browser's mini-bar away; we show our own button
      setPrompt(e as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', capture);
    return () => window.removeEventListener('beforeinstallprompt', capture);
  }, []);

  if (isIos()) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-3">
          <ShareIcon />
          <p className="font-semibold text-slate-900">{t('notifications.installTitle')}</p>
        </div>
        <p className="text-slate-800">{t('notifications.installIosIntro')}</p>
        <ol className="list-decimal space-y-1 ps-5 text-slate-800">
          <li>{t('notifications.installIosStep1')}</li>
          <li>{t('notifications.installIosStep2')}</li>
          <li>{t('notifications.installIosStep3')}</li>
        </ol>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="font-semibold text-slate-900">{t('notifications.installTitle')}</p>
      <p className="text-slate-800">{t('notifications.installAndroidIntro')}</p>
      {prompt ? (
        <button
          type="button"
          onClick={() => {
            void prompt.prompt();
            setPrompt(null);
          }}
          className="min-h-11 self-start rounded-md bg-slate-900 px-4 font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {t('notifications.installButton')}
        </button>
      ) : (
        <p className="text-slate-800">{t('notifications.installMenu')}</p>
      )}
    </div>
  );
}
