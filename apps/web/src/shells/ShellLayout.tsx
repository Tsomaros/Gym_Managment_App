import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { LanguageSwitch } from '../components/LanguageSwitch';

export function SignOutButton() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => void logout().finally(() => navigate('/login', { replace: true }))}
      className="min-h-9 rounded-md px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-900"
    >
      {t('auth.signOut')}
    </button>
  );
}

function Placeholder({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <>
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 text-slate-600">{t('shell.comingSoon')}</p>
    </>
  );
}

/**
 * The frame of every area: header (area, gym, language, sign out) and a nav whose sections are
 * placeholders for now. `nav` holds i18n keys under `nav.*`; the first one is the area's home.
 */
export function ShellLayout({
  testId,
  title,
  gymName,
  nav,
  home,
  multipleGyms,
}: {
  testId: string;
  title: string;
  gymName?: string;
  nav: string[];
  /** Content of the area's home page; defaults to a placeholder. */
  home?: ReactNode;
  multipleGyms?: boolean;
}) {
  const { t } = useTranslation();
  const [first, ...rest] = nav;

  return (
    <div data-testid={testId} className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="mr-auto min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
            <p className="truncate text-lg font-bold text-slate-900">{gymName ?? t('app.name')}</p>
          </div>
          {multipleGyms && (
            <Link
              to="/gyms"
              className="min-h-9 content-center rounded-md px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-900"
            >
              {t('nav.switchGym')}
            </Link>
          )}
          <LanguageSwitch />
          <SignOutButton />
        </div>
        <nav aria-label={title} className="mx-auto max-w-5xl overflow-x-auto px-2">
          <ul className="flex gap-1">
            {nav.map((key, i) => (
              <li key={key}>
                <NavLink
                  to={i === 0 ? '.' : key}
                  end={i === 0}
                  className={({ isActive }) =>
                    `inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-slate-900 ${
                      isActive
                        ? 'border-slate-900 text-slate-900'
                        : 'border-transparent text-slate-600 hover:text-slate-900'
                    }`
                  }
                >
                  {t(`nav.${key}`)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Routes>
          <Route index element={home ?? <Placeholder title={t(`nav.${first}`)} />} />
          {rest.map((key) => (
            <Route key={key} path={key} element={<Placeholder title={t(`nav.${key}`)} />} />
          ))}
        </Routes>
      </main>
    </div>
  );
}
