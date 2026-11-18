import { MAX_PROGRESS_PHOTOS, type ProgressPhoto } from '@gym/shared';
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Dialog } from '../../components/Dialog';
import { viewerLanguage } from '../exercises/exerciseName';
import { resizeImage } from '../members/resizeImage';
import { shortDate } from '../progress/chartTheme';

/** Progress photos are shrunk to this longest side in the browser before they go up. */
export const PROGRESS_PHOTO_MAX_SIDE = 1200;
/** Signed links last 5 minutes; the list is fetched again a little before that. */
const REFRESH_MS = 4 * 60_000;
/** A broken image may mean an expired link, but never worth more than one reload a minute. */
const ERROR_RELOAD_MS = 60_000;

const button =
  'inline-flex min-h-11 cursor-pointer items-center rounded-md border border-slate-500 bg-white px-4 font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

/**
 * Progress photos of a member: a grid of thumbnails with the day, tap for full size, add (a
 * phone's camera or a file), delete after asking. Only the member and their primary trainer add
 * and delete (`canWrite`); a cover trainer only looks. Links are signed and short-lived, so the
 * list is refreshed while the page stays open. The day of a new photo is the gym's today: the
 * server fills it in, so a phone with another clock or zone cannot date it wrongly.
 */
export function ProgressPhotos({
  gymId,
  memberId,
  canWrite,
  consentGranted,
  onChanged,
}: {
  gymId: string;
  /** Omitted for the member's own photos (the /me routes). */
  memberId?: string;
  canWrite: boolean;
  consentGranted: boolean;
  /** Something changed that the parent shows too (a photo added or deleted, consent found withdrawn). */
  onChanged?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = viewerLanguage(i18n.language);
  const base = `/gyms/${gymId}/${memberId ? `members/${memberId}` : 'me'}/progress-photos`;
  const [photos, setPhotos] = useState<ProgressPhoto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [viewing, setViewing] = useState<ProgressPhoto | null>(null);
  const [deleting, setDeleting] = useState<ProgressPhoto | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Only the newest answer counts: a slow older one must not bring back a deleted photo.
  const latest = useRef(0);
  const lastErrorReload = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const list = await apiFetch<ProgressPhoto[]>(base);
      if (mine !== latest.current) return;
      setPhotos(list);
      setFailed(false);
    } catch {
      if (mine === latest.current) setFailed(true);
    }
  }, [base]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const reloadOnBrokenImage = () => {
    if (Date.now() - lastErrorReload.current < ERROR_RELOAD_MS) return;
    lastErrorReload.current = Date.now();
    void load();
  };

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // choosing the same file again must fire a change
    if (!file || uploading) return;
    setError(null);
    setNotice('');
    setUploading(true);
    try {
      const resized = await resizeImage(file, PROGRESS_PHOTO_MAX_SIDE);
      const body = new FormData();
      body.set('photo', resized, 'photo.jpg');
      await apiFetch(base, { method: 'POST', body });
      await load();
      setNotice(t('health.photos.added'));
      onChanged?.();
    } catch (err) {
      const message = err instanceof ApiError ? (err.body as { message?: string })?.message : '';
      if (err instanceof ApiError && err.status === 409) {
        setError(
          t(message === 'Too many photos' ? 'health.photos.tooMany' : 'health.photos.noConsent', {
            max: MAX_PROGRESS_PHOTOS,
          }),
        );
        // the consent may have been withdrawn elsewhere: let the page find out
        if (message !== 'Too many photos') onChanged?.();
      } else {
        setError(t('health.photos.uploadFailed'));
      }
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await apiFetch(`${base}/${deleting.id}`, { method: 'DELETE' });
      setDeleting(null);
      await load();
      setNotice(t('health.photos.deleted'));
      // the delete button that opened the dialog is gone: keep focus on the section
      requestAnimationFrame(() => titleRef.current?.focus());
      onChanged?.();
    } catch {
      setError(t('common.genericError'));
    } finally {
      setDeleteBusy(false);
    }
  }

  const canAdd = consentGranted && !uploading;
  return (
    <section
      aria-labelledby="photos-title"
      className="flex flex-col gap-3 rounded-2xl border border-slate-300 bg-white p-4"
    >
      <h3
        id="photos-title"
        ref={titleRef}
        tabIndex={-1}
        className="text-lg font-semibold text-slate-900 focus:outline-none"
      >
        {t('health.photos.title')}
      </h3>
      {failed && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button type="button" onClick={() => void load()} className="min-h-11 underline">
            {t('app.retry')}
          </button>
        </div>
      )}
      {photos === null && !failed && (
        <p role="status" className="text-slate-700">
          {t('app.loading')}
        </p>
      )}
      {!consentGranted && (
        <p className="rounded-md border border-amber-700 bg-amber-50 p-3 font-medium text-amber-950">
          {canWrite ? t('health.photos.noConsent') : t('health.photos.noConsentView')}
        </p>
      )}
      {photos?.length === 0 && consentGranted && (
        <p className="text-slate-700">{t('health.photos.none')}</p>
      )}
      {photos && photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p) => (
            <li key={p.id} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setViewing(p)}
                aria-label={t('health.photos.open', { date: shortDate(p.takenOn, lang) })}
                className="overflow-hidden rounded-lg border border-slate-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                <img
                  src={p.url}
                  alt=""
                  loading="lazy"
                  className="aspect-[3/4] w-full object-cover"
                  onError={reloadOnBrokenImage}
                />
              </button>
              <div className="flex items-center gap-1">
                <span className="mr-auto text-sm font-medium text-slate-800">
                  {shortDate(p.takenOn, lang)}
                </span>
                {canWrite && (
                  <button
                    type="button"
                    aria-label={t('health.photos.deleteNamed', {
                      date: shortDate(p.takenOn, lang),
                    })}
                    aria-disabled={uploading || undefined}
                    onClick={() => {
                      if (uploading) return;
                      setError(null);
                      setDeleting(p);
                    }}
                    className="min-h-11 rounded-md px-2 text-sm font-medium text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-slate-900"
                  >
                    {t('health.photos.delete')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <div className="flex flex-col gap-2">
          <button
            ref={addRef}
            type="button"
            aria-disabled={!canAdd || undefined}
            onClick={() => canAdd && fileRef.current?.click()}
            className={`${button} self-start`}
          >
            {uploading ? t('common.working') : t('health.photos.add')}
          </button>
          {/* no `capture`: phones then offer both the camera and the library */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            aria-label={t('health.photos.add')}
            disabled={!consentGranted}
            tabIndex={-1}
            onChange={(e) => void upload(e)}
            className="sr-only"
          />
        </div>
      )}
      <p role="status" className="sr-only">
        {notice}
      </p>
      {error && !deleting && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {viewing && (
        <Dialog
          title={t('health.photos.viewTitle', { date: shortDate(viewing.takenOn, lang) })}
          closeLabel={t('common.close')}
          onClose={() => setViewing(null)}
        >
          <img src={viewing.url} alt="" className="max-h-[70vh] w-full rounded-md object-contain" />
        </Dialog>
      )}
      {deleting && (
        <ConfirmDialog
          title={t('health.photos.deleteTitle')}
          message={t('health.photos.deleteMessage', { date: shortDate(deleting.takenOn, lang) })}
          confirmLabel={t('health.photos.delete')}
          cancelLabel={t('common.cancel')}
          busy={deleteBusy}
          busyLabel={t('common.working')}
          error={error}
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
