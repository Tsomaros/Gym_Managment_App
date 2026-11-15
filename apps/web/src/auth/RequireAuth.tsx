import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthProvider';

/** Renders child routes for a signed-in user; otherwise sends them to /login and back afterwards. */
export function RequireAuth() {
  const { me, status } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();

  if (status === 'loading') {
    return (
      <p role="status" className="p-8 text-center text-slate-500">
        {t('app.loading')}
      </p>
    );
  }
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
