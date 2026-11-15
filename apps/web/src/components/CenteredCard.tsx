import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from './LanguageSwitch';

/** Full-page layout for sign-in, invitations and the gym picker. */
export function CenteredCard({
  title,
  testId,
  children,
  actions,
}: {
  title: string;
  testId: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    document.title = `${title} · ${t('app.name')}`;
  }, [title, t]);
  return (
    <div data-testid={testId} className="min-h-dvh bg-slate-50 px-4 py-6">
      <header className="mx-auto flex max-w-md items-center justify-end gap-3">
        {actions}
        <LanguageSwitch />
      </header>
      <main className="mx-auto mt-10 max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-6 text-2xl font-bold text-slate-900">{title}</h1>
        {children}
      </main>
    </div>
  );
}
