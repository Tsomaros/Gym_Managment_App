import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { CenteredCard } from '../components/CenteredCard';
import { SignOutButton } from '../shells/ShellLayout';

export function GymPickerPage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  if (!me) return null;

  return (
    <CenteredCard title={t('gyms.pick')} testId="gym-picker" actions={<SignOutButton />}>
      {me.gyms.length === 0 && !me.isPlatformAdmin && (
        <p className="text-slate-600">{t('gyms.none')}</p>
      )}
      <ul className="flex flex-col gap-2">
        {me.gyms.map((gym) => (
          <li key={gym.gymId}>
            <Link
              to={`/g/${gym.gymId}`}
              className="flex min-h-14 flex-col justify-center rounded-lg border border-slate-200 px-4 py-2 hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-slate-900"
            >
              <span className="font-semibold text-slate-900">{gym.gymName}</span>
              <span className="text-sm text-slate-600">
                {gym.roles.map((r) => t(`roles.${r}`)).join(' · ')}
              </span>
            </Link>
          </li>
        ))}
        {me.isPlatformAdmin && (
          <li>
            <Link
              to="/platform"
              className="flex min-h-14 items-center rounded-lg border border-dashed border-slate-300 px-4 font-semibold text-slate-900 hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-slate-900"
            >
              {t('gyms.platform')}
            </Link>
          </li>
        )}
      </ul>
    </CenteredCard>
  );
}
