import { type ChangeEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Avatar } from './Avatar';
import { resizeImage } from './resizeImage';

const buttonLook =
  'inline-flex min-h-11 cursor-pointer items-center rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-slate-900';

/**
 * A member's photo with a way to take or choose a new one (the phone's selfie camera, or a file on
 * a computer) and to remove it. The picture is shrunk in the browser before it goes up.
 */
export function PhotoCapture({
  gymId,
  memberId,
  name,
  firstName = name.split(' ')[0] ?? '',
  lastName = name.split(' ').slice(1).join(' '),
  photoUrl,
  onChanged,
}: {
  gymId: string;
  memberId: string;
  name: string;
  firstName?: string;
  lastName?: string;
  photoUrl: string | null;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const path = `/gyms/${gymId}/members/${memberId}/photo`;

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // choosing the same file again must fire a change
    if (!file) return;
    setError(false);
    setBusy(true);
    const shown = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
    setPreview(shown);
    try {
      const resized = await resizeImage(file);
      const body = new FormData();
      body.set('photo', resized, 'photo.jpg');
      await apiFetch(path, { method: 'PUT', body });
      onChanged();
    } catch {
      setError(true);
    } finally {
      if (shown) URL.revokeObjectURL?.(shown);
      setPreview(null);
      setBusy(false);
    }
  }

  async function remove() {
    setError(false);
    setBusy(true);
    try {
      await apiFetch(path, { method: 'DELETE' });
      setConfirming(false);
      onChanged();
    } catch {
      setError(true);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <Avatar
        firstName={firstName}
        lastName={lastName}
        photoUrl={preview ?? photoUrl}
        size="large"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className={`${buttonLook} ${busy ? 'opacity-60' : ''}`}>
          {photoUrl ? t('photo.change') : t('photo.add')}
          <input
            type="file"
            accept="image/*"
            capture="user"
            disabled={busy}
            onChange={(e) => void upload(e)}
            className="sr-only"
          />
        </label>
        {photoUrl && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
            className={buttonLook}
          >
            {t('photo.remove')}
          </button>
        )}
      </div>
      {busy && preview && (
        <p role="status" className="text-sm text-slate-600">
          {t('photo.uploading')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {t('photo.error')}
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          title={t('photo.remove')}
          message={t('photo.removeMessage')}
          confirmLabel={t('photo.removeConfirm')}
          cancelLabel={t('common.cancel')}
          busy={busy}
          busyLabel={t('common.working')}
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
