import type { StaffRole } from '@gym/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';

/** Owner: takes one staff role away from a person, after a warning for trainers. */
export function RemoveRoleDialog({
  gymId,
  person,
  role,
  onRemoved,
  onCancel,
}: {
  gymId: string;
  person: { userId: string; name: string };
  role: StaffRole;
  onRemoved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/gyms/${gymId}/staff/${person.userId}/roles/${role}`, { method: 'DELETE' });
      onRemoved();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409 && role === 'owner'
          ? t('staff.lastOwner')
          : t('common.genericError'),
      );
    } finally {
      setBusy(false);
    }
  }

  const roleName = t(`roles.${role}`);
  const question = t('staff.removeConfirm', { role: roleName, name: person.name });
  return (
    <ConfirmDialog
      title={t('staff.removeTitle')}
      message={question}
      warning={role === 'trainer' ? t('staff.trainerWarning') : undefined}
      confirmLabel={t('staff.remove')}
      cancelLabel={t('common.cancel')}
      busy={busy}
      busyLabel={t('common.working')}
      error={error}
      onConfirm={() => void remove()}
      onCancel={onCancel}
    />
  );
}
