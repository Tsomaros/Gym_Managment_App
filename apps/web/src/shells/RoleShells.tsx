import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { EmailNotVerifiedBanner } from '../components/EmailNotVerifiedBanner';
import { HistoryPage } from '../features/audit/HistoryPage';
import { MemberCheckInPage } from '../features/checkin/MemberCheckInPage';
import { MembersSection } from '../features/members/MembersSection';
import { MyMembershipPage } from '../features/my-membership/MyMembershipPage';
import { PaymentsPage } from '../features/payments/PaymentsPage';
import { NewMemberCodeDialog } from '../features/signup/NewMemberCodeDialog';
import { MembershipTypesPage } from '../features/membership-types/MembershipTypesPage';
import { ShellLayout } from './ShellLayout';

export interface GymShellProps {
  gymName: string;
  multipleGyms: boolean;
}

/** Reception (and the owner) hand a one-time sign-up code to a new member at the desk. */
function NewMemberCodeButton() {
  const { t } = useTranslation();
  const { gymId = '' } = useParams();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        {t('codes.button')}
      </button>
      {open && <NewMemberCodeDialog gymId={gymId} onClose={() => setOpen(false)} />}
    </>
  );
}

export function OwnerShell(props: GymShellProps) {
  const { t } = useTranslation();
  return (
    <ShellLayout
      testId="shell-owner"
      title={t('shell.owner')}
      nav={['dashboard', 'members', 'membershipTypes', 'payments', 'history', 'staff', 'checkIn']}
      pages={{
        members: <MembersSection />,
        membershipTypes: <MembershipTypesPage />,
        payments: <PaymentsPage />,
        history: <HistoryPage />,
      }}
      actions={<NewMemberCodeButton />}
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
      pages={{ members: <MembersSection /> }}
      actions={<NewMemberCodeButton />}
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
  const { me } = useAuth();
  return (
    <ShellLayout
      testId="shell-member"
      title={t('shell.member')}
      nav={['memberCheckIn', 'myMembership', 'myWorkouts']}
      home={<MemberCheckInPage />}
      pages={{ myMembership: <MyMembershipPage /> }}
      banner={me && !me.emailVerified ? <EmailNotVerifiedBanner email={me.email} /> : undefined}
      {...props}
    />
  );
}
