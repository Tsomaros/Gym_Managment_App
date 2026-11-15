import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthState } from '../auth/AuthProvider';
import '../i18n';
import { AcceptInvitePage } from './AcceptInvitePage';
import { LoginPage } from './LoginPage';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderPage(path: string, auth: Partial<AuthState>) {
  const value: AuthState = {
    me: null,
    status: 'ready',
    login: vi.fn(),
    logout: vi.fn(),
    startSession: vi.fn(),
    refreshMe: vi.fn(),
    ...auth,
  };
  render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/invite/:token" element={<AcceptInvitePage />} />
          <Route path="/" element={<p data-testid="home">home</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return value;
}

describe('LoginPage', () => {
  it('flags empty fields itself instead of reporting wrong credentials', async () => {
    const auth = renderPage('/login', {});
    await userEvent.click(screen.getByRole('button', { name: 'Σύνδεση' }));

    expect(auth.login).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Κωδικός')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Λάθος email ή κωδικός.')).not.toBeInTheDocument();
  });

  it('flags only the empty field, and a whitespace-only email counts as empty', async () => {
    const auth = renderPage('/login', {});
    await userEvent.type(screen.getByLabelText('Email'), '   ');
    await userEvent.type(screen.getByLabelText('Κωδικός'), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: 'Σύνδεση' }));

    expect(auth.login).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Κωδικός')).not.toHaveAttribute('aria-invalid');
  });

  it('shows a loading state, not the form, while the stored session is being restored', () => {
    renderPage('/login', { status: 'loading' });
    expect(screen.queryByRole('button', { name: 'Σύνδεση' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('AcceptInvitePage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  const acceptCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url) === '/api/auth/accept-invite');

  it('for an existing account, checks the password before using up the invitation', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/auth/invitations/')) {
        return json(200, {
          gymName: 'Gym B',
          fullName: 'Μαρία',
          email: 'maria@x.gr',
          accountExists: true,
        });
      }
      if (url === '/api/auth/accept-invite') return json(200, { signInRequired: true });
      return json(404, {});
    });
    const login = vi
      .fn<AuthState['login']>()
      .mockRejectedValueOnce(Object.assign(new Error('401'), { status: 401 }))
      .mockResolvedValueOnce(undefined);
    const auth = renderPage('/invite/tok123', { login });

    const password = await screen.findByLabelText('Κωδικός');
    await userEvent.type(password, 'wrong pass');
    await userEvent.click(screen.getByRole('button', { name: 'Σύνδεση και είσοδος' }));

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(acceptCalls()).toHaveLength(0); // invitation still unused after a typo
    expect(await screen.findByText('Λάθος email ή κωδικός.')).toBeInTheDocument();

    await userEvent.clear(password);
    await userEvent.type(password, 'right pass');
    await userEvent.click(screen.getByRole('button', { name: 'Σύνδεση και είσοδος' }));

    expect(await screen.findByTestId('home')).toBeInTheDocument();
    expect(login).toHaveBeenLastCalledWith('maria@x.gr', 'right pass');
    expect(acceptCalls()).toHaveLength(1);
    expect(JSON.parse(String(acceptCalls()[0]?.[1]?.body))).toEqual({
      token: 'tok123',
      password: 'right pass',
    });
    expect(auth.refreshMe).toHaveBeenCalled(); // new gym role visible without a reload
  });

  it('says an expired invitation is no longer valid and offers sign-in', async () => {
    fetchMock.mockResolvedValue(json(410, { message: 'gone' }));
    renderPage('/invite/old', {});

    expect(
      await screen.findByRole('heading', { name: 'Η πρόσκληση δεν ισχύει' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Πήγαινε στη σύνδεση' })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('treats a network failure as retryable, not as an expired invitation', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchMock.mockResolvedValueOnce(
      json(200, { gymName: 'Gym', fullName: 'Νίκος', email: 'n@x.gr', accountExists: false }),
    );
    renderPage('/invite/tok', {});

    await userEvent.click(await screen.findByRole('button', { name: 'Δοκίμασε ξανά' }));
    expect(await screen.findByRole('heading', { name: 'Πρόσκληση στο Gym' })).toBeInTheDocument();
    expect(screen.queryByText(/δεν ισχύει/)).not.toBeInTheDocument();
  });
});
