import type { CheckInResult, GymSettings, LiveEvent, PresentMember, VisitorRow } from '@gym/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { CoverDialog } from '../trainers/CoverDialog';
import { OnDutyPanel } from '../schedule/OnDutyPanel';
import { SellMembershipDialog } from '../members/SellMembershipDialog';
import { LiveFeed } from './LiveFeed';
import { ManualCheckIn } from './ManualCheckIn';
import { PresentList } from './PresentList';
import { useLiveEvents } from './useLiveEvents';
import { VisitorsList } from './VisitorsList';

const FEED_SIZE = 11; // the latest as a big card, ten before it
const DEFAULT_TIME_ZONE = 'Europe/Athens';

/** The status badge of someone inside: a valid check-in means an active membership. */
const presentStatus = (r: CheckInResult): PresentMember['membershipStatus'] => {
  const s = r.membership?.status;
  return s === 'frozen' || s === 'expired' ? s : 'active';
};

const presentFrom = (r: CheckInResult): PresentMember => ({
  checkInId: r.checkInId!,
  memberId: r.member.id,
  firstName: r.member.firstName,
  lastName: r.member.lastName,
  photoUrl: r.member.photoUrl,
  at: r.at,
  membershipStatus: presentStatus(r),
});

const visitorFrom = (r: CheckInResult): VisitorRow => ({
  checkInId: r.checkInId!,
  memberId: r.member.id,
  firstName: r.member.firstName,
  lastName: r.member.lastName,
  at: r.at,
  method: r.method,
  valid: r.valid,
  reason: r.reason,
  checkedOutAt: null,
});

/**
 * The reception desk (spec §6.2): every check-in as it happens with the member's photo and a
 * clear red warning when it is not valid, who is inside, today's visitors, and a box to check
 * someone in by name. The lists are loaded once; after that the live stream updates them.
 */
/** The lists are asked for again this often: who is inside also changes with the clock. */
const RELOAD_MS = 60_000;

export function DeskPage({ reloadMs = RELOAD_MS }: { reloadMs?: number } = {}) {
  const { t } = useTranslation();
  const { gymId = '' } = useParams();
  const [feed, setFeed] = useState<CheckInResult[]>([]);
  const [present, setPresent] = useState<PresentMember[] | null>(null);
  const [visitors, setVisitors] = useState<VisitorRow[] | null>(null);
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<'present' | 'today'>('present');
  const [selling, setSelling] = useState<CheckInResult | null>(null);
  const [covering, setCovering] = useState<CheckInResult | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    apiFetch<GymSettings>(`/gyms/${gymId}/settings`)
      .then((s) => setTimeZone(s.timezone))
      .catch(() => undefined); // the lists still work in the default zone
    Promise.all([
      apiFetch<PresentMember[]>(`/gyms/${gymId}/check-ins/present`),
      apiFetch<VisitorRow[]>(`/gyms/${gymId}/check-ins`),
    ])
      .then(([p, v]) => {
        setPresent(p);
        setVisitors(v);
      })
      .catch(() => setFailed(true));
  }, [gymId]);
  useEffect(load, [load]);
  // Auto check-out and the gym's midnight move people out of "inside now" without any event.
  useEffect(() => {
    const timer = setInterval(load, reloadMs);
    return () => clearInterval(timer);
  }, [load, reloadMs]);

  /**
   * One check-in, from the stream or from the box. The stream and the box can both deliver the
   * same one, so a known id is not added twice; `promote` (the receptionist just did it) moves a
   * repeat to the top so its "not recorded again" note is seen.
   */
  const addResult = useCallback((result: CheckInResult, promote: boolean) => {
    setFeed((prev) => {
      const known = prev.some((r) => r.checkInId === result.checkInId);
      if (known && !promote) return prev;
      return [result, ...prev.filter((r) => r.checkInId !== result.checkInId)].slice(0, FEED_SIZE);
    });
    if (!result.checkInId || result.duplicate) return;
    if (result.valid) {
      setPresent(
        (prev) =>
          prev && [presentFrom(result), ...prev.filter((p) => p.memberId !== result.member.id)],
      );
    }
    setVisitors(
      (prev) =>
        prev &&
        (prev.some((v) => v.checkInId === result.checkInId)
          ? prev
          : [visitorFrom(result), ...prev]),
    );
  }, []);

  const onEvent = useCallback(
    (e: LiveEvent) => {
      if (e.type === 'check_in') {
        addResult(e.result, false);
      } else {
        setPresent((prev) => prev && prev.filter((p) => p.checkInId !== e.checkInId));
        const left = new Date().toISOString();
        setVisitors(
          (prev) =>
            prev &&
            prev.map((v) => (v.checkInId === e.checkInId ? { ...v, checkedOutAt: left } : v)),
        );
      }
    },
    [addResult],
  );
  const { connected } = useLiveEvents(gymId, onEvent);
  // Events missed while the link was down are gone: after a reconnect, load the lists again.
  const wasConnected = useRef(false);
  useEffect(() => {
    if (!connected) return;
    if (wasConnected.current) load();
    wasConnected.current = true;
  }, [connected, load]);

  async function checkOut(checkInId: string) {
    try {
      await apiFetch(`/gyms/${gymId}/check-ins/${checkInId}/check-out`, { method: 'POST' });
      onEvent({ type: 'check_out', checkInId });
    } catch {
      setFailed(true);
    }
  }

  /** After a sale at the desk the same person is checked in again, now with a valid membership. */
  async function sold(memberId: string) {
    try {
      addResult(
        await apiFetch<CheckInResult>(`/gyms/${gymId}/members/${memberId}/check-ins`, {
          method: 'POST',
        }),
        true,
      );
    } catch {
      setFailed(true);
    }
  }

  const tabClass = (active: boolean) =>
    `min-h-11 rounded-md px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
      active
        ? 'bg-slate-900 text-white'
        : 'border border-slate-300 text-slate-800 hover:bg-slate-50'
    }`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <h2 className="mr-auto text-xl font-semibold text-slate-900">{t('desk.title')}</h2>
        <div className="w-full max-w-md">
          <ManualCheckIn gymId={gymId} onResult={(r) => addResult(r, true)} />
        </div>
      </div>

      {failed && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button type="button" onClick={load} className="min-h-11 underline">
            {t('app.retry')}
          </button>
        </div>
      )}

      <OnDutyPanel />

      <div className="grid gap-6 xl:grid-cols-2">
        <LiveFeed results={feed} connected={connected} onSell={setSelling} onCover={setCovering} />
        <div className="flex flex-col gap-4">
          <div role="group" aria-label={t('desk.views')} className="flex gap-2">
            <button
              type="button"
              aria-pressed={tab === 'present'}
              onClick={() => setTab('present')}
              className={tabClass(tab === 'present')}
            >
              {t('desk.present')}
            </button>
            <button
              type="button"
              aria-pressed={tab === 'today'}
              onClick={() => setTab('today')}
              className={tabClass(tab === 'today')}
            >
              {t('desk.today')}
            </button>
          </div>
          {!present || !visitors ? (
            !failed && <p className="text-slate-600">{t('app.loading')}</p>
          ) : tab === 'present' ? (
            <PresentList
              members={present}
              onCheckOut={(id) => void checkOut(id)}
              timeZone={timeZone}
            />
          ) : (
            <VisitorsList rows={visitors} timeZone={timeZone} />
          )}
        </div>
      </div>

      {covering && (
        <CoverDialog
          gymId={gymId}
          memberId={covering.member.id}
          memberName={`${covering.member.firstName} ${covering.member.lastName}`}
          primaryTrainerId={covering.trainer?.userId ?? null}
          onClose={() => setCovering(null)}
          onDone={(cover) => {
            const id = covering.checkInId;
            setFeed((prev) => prev.map((r) => (r.checkInId === id ? { ...r, cover } : r)));
            setCovering(null);
          }}
        />
      )}
      {selling && (
        <SellMembershipDialog
          gymId={gymId}
          memberId={selling.member.id}
          memberName={`${selling.member.firstName} ${selling.member.lastName}`}
          onClose={() => setSelling(null)}
          onSold={() => void sold(selling.member.id)}
        />
      )}
    </div>
  );
}
