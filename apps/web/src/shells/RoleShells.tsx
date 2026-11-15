import { useTranslation } from 'react-i18next';
import { ShellLayout } from './ShellLayout';

export interface GymShellProps {
  gymName: string;
  multipleGyms: boolean;
}

export function OwnerShell(props: GymShellProps) {
  const { t } = useTranslation();
  return (
    <ShellLayout
      testId="shell-owner"
      title={t('shell.owner')}
      nav={['dashboard', 'members', 'staff', 'checkIn']}
      {...props}
    />
  );
}

export function ReceptionShell(props: GymShellProps) {
  const { t } = useTranslation();
  return (
    <ShellLayout
      testId="shell-reception"
      title={t('shell.reception')}
      nav={['checkIn', 'members', 'schedule']}
      {...props}
    />
  );
}

export function TrainerShell(props: GymShellProps) {
  const { t } = useTranslation();
  return (
    <ShellLayout
      testId="shell-trainer"
      title={t('shell.trainer')}
      nav={['schedule', 'members', 'plans']}
      {...props}
    />
  );
}

export function MemberShell(props: GymShellProps) {
  const { t } = useTranslation();
  return (
    <ShellLayout
      testId="shell-member"
      title={t('shell.member')}
      nav={['myWorkouts', 'myMembership']}
      {...props}
    />
  );
}
