import type { GymRole } from '@gym/shared';
import type { ComponentType } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router';
import { useAuth } from './auth/AuthProvider';
import { highestRole, homePath } from './auth/home';
import { RequireAuth } from './auth/RequireAuth';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { GymPickerPage } from './pages/GymPickerPage';
import { JoinPage } from './pages/JoinPage';
import { LoginPage } from './pages/LoginPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { PlatformShell } from './shells/PlatformShell';
import {
  type GymShellProps,
  MemberShell,
  OwnerShell,
  ReceptionShell,
  TrainerShell,
} from './shells/RoleShells';

const SHELLS: Record<GymRole, ComponentType<GymShellProps>> = {
  owner: OwnerShell,
  reception: ReceptionShell,
  trainer: TrainerShell,
  member: MemberShell,
};

function HomeRedirect() {
  const { me } = useAuth();
  return <Navigate to={homePath(me!)} replace />;
}

/** /g/:gymId/* — the shell for the caller's highest role in that gym. */
function GymArea() {
  const { me } = useAuth();
  const { gymId } = useParams();
  const gym = me!.gyms.find((g) => g.gymId === gymId);
  const role = gym && highestRole(gym.roles);
  if (!gym || !role) return <Navigate to={homePath(me!)} replace />;
  const Shell = SHELLS[role];
  return <Shell gymName={gym.gymName} multipleGyms={me!.gyms.length > 1} />;
}

function PlatformArea() {
  const { me } = useAuth();
  if (!me!.isPlatformAdmin) return <Navigate to={homePath(me!)} replace />;
  return <PlatformShell />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/invite/:token" element={<AcceptInvitePage />} />
      <Route path="/join" element={<JoinPage />} />
      <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
      <Route element={<RequireAuth />}>
        <Route index element={<HomeRedirect />} />
        <Route path="gyms" element={<GymPickerPage />} />
        <Route path="g/:gymId/*" element={<GymArea />} />
        <Route path="platform/*" element={<PlatformArea />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
