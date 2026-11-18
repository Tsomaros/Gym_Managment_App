import type { NotificationGroup, NotificationPrefs } from '@gym/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { InstallAppHint } from './InstallAppHint';
import { usePush } from './usePush';

type Channel = 'email' | 'push';

/**
 * A switch. While a save is running it is aria-disabled, not disabled: a disabled button drops
 * keyboard focus, and the next switch would need a Tab from the top of the page. The off state has
 * a 3:1 border and an empty knob, the on state a filled track and a check mark, so the state is
 * never shown by colour alone.
 */
function Switch({
  label,
  checked,
  busy,
  onChange,
}: {
  label: string;
  checked: boolean;
  busy: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) onChange();
      }}
      className="flex min-h-11 min-w-14 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
    >
      <span
        aria-hidden="true"
        className={`relative h-7 w-12 rounded-full border-2 transition-colors motion-reduce:transition-none ${
          checked ? 'border-slate-900 bg-slate-900' : 'border-slate-500 bg-white'
        }`}
      >
        <span
          className={`absolute top-0.5 flex size-5 items-center justify-center rounded-full transition-all motion-reduce:transition-none ${
            checked ? 'start-5 bg-white text-slate-900' : 'start-0.5 bg-slate-500'
          }`}
        >
          {checked && (
            <svg
              viewBox="0 0 12 12"
              className="size-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M2.5 6.5l2.5 2.5 4.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </span>
    </button>
  );
}

const card = 'flex flex-col gap-3 rounded-2xl border border-slate-300 bg-white p-4';
const buttonBase =
  'min-h-11 self-start rounded-md px-4 py-2 text-start font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

/** /g/:gymId/notifications — push on this device, and email/push per kind of message for this gym. */
export function NotificationSettingsPage() {
  const { t } = useTranslation();
  const { gymId = '' } = useParams();
  const push = usePush();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [pushFailed, setPushFailed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const url = `/gyms/${gymId}/me/notification-prefs`;

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      setPrefs(await apiFetch<NotificationPrefs>(url));
    } catch {
      setLoadFailed(true);
    }
  }, [url]);
  useEffect(() => {
    void load();
  }, [load]);

  async function flip(group: NotificationGroup, channel: Channel) {
    if (!prefs || saving) return;
    const next: NotificationPrefs = {
      ...prefs,
      [group]: { ...prefs[group], [channel]: !prefs[group][channel] },
    };
    setPrefs(next); // shown at once; put back below if the server says no
    setSaving(true);
    setSaveFailed(false);
    try {
      setPrefs(
        await apiFetch<NotificationPrefs>(url, { method: 'PUT', body: JSON.stringify(next) }),
      );
    } catch {
      setPrefs(prefs);
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  async function togglePush() {
    if (pushBusy) return;
    setPushBusy(true);
    setPushFailed(false);
    try {
      await (push.state === 'subscribed' ? push.disable() : push.enable());
    } catch {
      setPushFailed(true);
    } finally {
      setPushBusy(false);
    }
  }

  const groups: { key: NotificationGroup; name: string; help: string }[] = [
    {
      key: 'membership',
      name: t('notifications.groupMembership'),
      help: t('notifications.groupMembershipHelp'),
    },
    { key: 'plans', name: t('notifications.groupPlans'), help: t('notifications.groupPlansHelp') },
    {
      key: 'classes',
      name: t('notifications.groupClasses'),
      help: t('notifications.groupClassesHelp'),
    },
  ];

  return (
    <section aria-labelledby="notif-title" className="mx-auto flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 id="notif-title" className="text-xl font-semibold text-slate-900">
          {t('notifications.title')}
        </h2>
        <p className="text-slate-800">{t('notifications.intro')}</p>
      </div>

      <div className={card}>
        <h3 className="text-lg font-semibold text-slate-900">{t('notifications.pushTitle')}</h3>
        {push.state === 'needs-install' && <InstallAppHint />}
        {/* One live region, always mounted: the outcome of the button is read out. */}
        <div aria-live="polite" className="flex flex-col gap-3">
          {push.state === 'unsupported' && (
            <p className="text-slate-800">{t('notifications.pushUnsupported')}</p>
          )}
          {push.state === 'denied' && (
            <p className="text-slate-800">{t('notifications.pushDenied')}</p>
          )}
          {(push.state === 'default' || push.state === 'subscribed') && (
            <>
              <p className="text-slate-800">
                {pushBusy
                  ? t('notifications.pushWorking')
                  : push.state === 'subscribed'
                    ? t('notifications.pushOn')
                    : t('notifications.pushOff')}
              </p>
              {/* The same button either way, so keyboard focus stays where it was. */}
              <button
                type="button"
                aria-disabled={pushBusy || undefined}
                onClick={() => void togglePush()}
                className={`${buttonBase} ${
                  push.state === 'subscribed'
                    ? 'border border-slate-400 text-slate-900 hover:bg-slate-100'
                    : 'bg-slate-900 text-white hover:bg-slate-800'
                }`}
              >
                {push.state === 'subscribed'
                  ? t('notifications.pushDisable')
                  : t('notifications.pushEnable')}
              </button>
            </>
          )}
        </div>
        {pushFailed && (
          <p role="alert" className="text-red-700">
            {t('notifications.pushFailed')}
          </p>
        )}
      </div>

      <div className={card}>
        <h3 className="text-lg font-semibold text-slate-900">{t('notifications.whatTitle')}</h3>
        <p className="text-sm text-slate-700">{t('notifications.pushAllDevices')}</p>
        {loadFailed && (
          <div role="alert" className="flex items-center gap-3 text-red-700">
            {t('common.genericError')}
            <button type="button" onClick={() => void load()} className="min-h-11 underline">
              {t('app.retry')}
            </button>
          </div>
        )}
        {!prefs && !loadFailed && (
          <p role="status" className="text-slate-700">
            {t('app.loading')}
          </p>
        )}
        {prefs && (
          <ul className="divide-y divide-slate-200">
            {groups.map(({ key, name, help }) => (
              <li key={key} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                <div className="min-w-0 basis-full sm:me-auto sm:basis-auto">
                  <p className="font-medium text-slate-900">{name}</p>
                  <p className="text-sm text-slate-700">{help}</p>
                </div>
                {(['email', 'push'] as const).map((channel) => {
                  const channelName = t(
                    channel === 'email'
                      ? 'notifications.channelEmail'
                      : 'notifications.channelPush',
                  );
                  return (
                    <div key={channel} className="flex items-center gap-1">
                      <span aria-hidden="true" className="text-sm text-slate-800">
                        {channelName}
                      </span>
                      <Switch
                        label={t('notifications.switchLabel', {
                          group: name,
                          channel: channelName,
                        })}
                        checked={prefs[key][channel]}
                        busy={saving}
                        onChange={() => void flip(key, channel)}
                      />
                    </div>
                  );
                })}
              </li>
            ))}
          </ul>
        )}
        {saveFailed && (
          <p role="alert" className="text-red-700">
            {t('common.genericError')}
          </p>
        )}
      </div>
    </section>
  );
}
