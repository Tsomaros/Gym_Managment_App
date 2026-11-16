import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthState } from '../../auth/AuthProvider';
import '../../i18n';
import { EmailNotVerifiedBanner } from '../../components/EmailNotVerifiedBanner';
import { JoinPage } from '../../pages/JoinPage';
import { VerifyEmailPage } from '../../pages/VerifyEmailPage';
import { NewMemberCodeDialog } from './NewMemberCodeDialog';

const GYM = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const calls = (path: string) => fetchMock.mock.calls.filter(([url]) => String(url) === path);

function authValue(overrides: Partial<AuthState> = {}): AuthState {
  return {
    me: null,
    status: 'ready',
    login: vi.fn(),
    logout: vi.fn(),
    startSession: vi.fn(),
    refreshMe: vi.fn(),
    ...overrides,
  };
}

function renderAt(path: string, auth: AuthState = authValue()) {
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/join" element={<JoinPage />} />
          <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
          <Route path="/login" element={<p>login page</p>} />
          <Route path="/" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return auth;
}

describe('NewMemberCodeDialog', () => {
  it('shows the code from the API in large type, with a copy and a new-code button', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(201, { code: 'K7P2-QM9X', expiresAt: '2027-05-02T09:00:00.000Z' }),
      )
      .mockResolvedValueOnce(
        json(201, { code: 'ABCD-EFGH', expiresAt: '2027-05-02T09:05:00.000Z' }),
      );
    render(<NewMemberCodeDialog gymId={GYM} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Νέος κωδικός μέλους' });
    const code = await within(dialog).findByText('K7P2-QM9X');
    // Read out letter by letter, not as one word.
    expect(code).toHaveAttribute('aria-label', 'K 7 P 2 - Q M 9 X');
    expect(calls(`/api/gyms/${GYM}/signup-codes`)).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: 'Αντιγραφή' })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Νέος κωδικός' }));
    expect(await within(dialog).findByText('ABCD-EFGH')).toBeInTheDocument();
    expect(calls(`/api/gyms/${GYM}/signup-codes`)).toHaveLength(2);
  });
});

describe('JoinPage', () => {
  async function fillValid(overrides: Partial<Record<string, string>> = {}) {
    const values = {
      'Κωδικός εγγραφής': 'k7p2-qm9x',
      Όνομα: 'Γιώργος',
      Επώνυμο: 'Παπαδόπουλος',
      Email: 'giorgos@example.com',
      Κινητό: '69 1234 5678',
      'Ημερομηνία γέννησης': '1990-05-17',
      'Διάλεξε κωδικό': 'a long password',
      ...overrides,
    };
    for (const [label, value] of Object.entries(values)) {
      if (value) await userEvent.type(screen.getByLabelText(label), value);
    }
    await userEvent.click(screen.getByRole('checkbox', { name: /ενημέρωση απορρήτου/ }));
  }

  it('asks for the fields in the order reception expects, emergency contact hidden at first', () => {
    renderAt('/join');
    const labels = screen
      .getAllByRole('textbox')
      .map(
        (el) =>
          el.getAttribute('aria-label') ??
          document.querySelector(`label[for="${el.id}"]`)?.textContent,
      );
    expect(labels.slice(0, 5)).toEqual(['Κωδικός εγγραφής', 'Όνομα', 'Επώνυμο', 'Email', 'Κινητό']);
    expect(screen.getByLabelText('Όνομα επαφής')).not.toBeVisible();
  });

  it('shows Greek errors for a 7-character password and an empty phone, and sends nothing', async () => {
    renderAt('/join');
    await fillValid({ Κινητό: '', 'Διάλεξε κωδικό': 'seven77' });
    await userEvent.click(screen.getByRole('button', { name: 'Εγγραφή' }));

    expect(screen.getByLabelText('Διάλεξε κωδικό')).toHaveAccessibleDescription(
      'Ο κωδικός θέλει τουλάχιστον 8 χαρακτήρες.',
    );
    expect(screen.getByLabelText('Κινητό')).toHaveAccessibleDescription(
      'Συμπλήρωσε αυτό το πεδίο.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to sign up without the privacy consent, and sends nothing', async () => {
    renderAt('/join');
    await fillValid();
    await userEvent.click(screen.getByRole('checkbox', { name: /ενημέρωση απορρήτου/ })); // untick
    await userEvent.click(screen.getByRole('button', { name: 'Εγγραφή' }));

    expect(screen.getByRole('checkbox', { name: /ενημέρωση απορρήτου/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says the person is already a member on 409', async () => {
    fetchMock.mockResolvedValue(json(409, { message: 'already a member' }));
    renderAt('/join');
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'Εγγραφή' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent(/Ζήτα νέο κωδικό/);
    expect(screen.queryByText('home')).not.toBeInTheDocument();
  });

  it('signs a new member in and goes home', async () => {
    fetchMock.mockResolvedValue(json(201, { accessToken: 'tok' }));
    const auth = renderAt('/join');
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'Εγγραφή' }));

    await waitFor(() => expect(auth.startSession).toHaveBeenCalledWith('tok'));
    const body = JSON.parse(String(calls('/api/auth/signup')[0]![1]!.body));
    expect(body).toMatchObject({
      code: 'k7p2-qm9x',
      phone: '+306912345678',
      dateOfBirth: '1990-05-17',
      acceptPrivacy: true,
    });
    expect(await screen.findByText('home')).toBeInTheDocument();
  });

  it('asks for a new code from reception when the code is used or expired (410)', async () => {
    fetchMock.mockResolvedValue(json(410, { message: 'Code invalid or expired' }));
    renderAt('/join');
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'Εγγραφή' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Ζήτα νέο κωδικό από την υποδοχή/);
  });

  it('sends an existing account to sign in', async () => {
    fetchMock.mockResolvedValue(json(201, { signInRequired: true }));
    renderAt('/join');
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'Εγγραφή' }));
    const link = await screen.findByRole('link', { name: /συνδέσου/ });
    expect(link).toHaveAttribute('href', '/login');
  });
});

describe('VerifyEmailPage', () => {
  it('confirms the email from the link and refreshes the profile', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const auth = renderAt(
      '/verify-email/abc123',
      authValue({ me: { emailVerified: false } as never }),
    );
    expect(await screen.findByText('Το email σου επιβεβαιώθηκε.')).toBeInTheDocument();
    expect(calls('/api/auth/verify-email')).toHaveLength(1);
    expect(JSON.parse(String(calls('/api/auth/verify-email')[0]![1]!.body))).toEqual({
      token: 'abc123',
    });
    expect(auth.refreshMe).toHaveBeenCalled();
  });

  it('confirms the email for someone who is not signed in, without refreshing a profile', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const auth = renderAt('/verify-email/abc123');
    expect(await screen.findByText('Το email σου επιβεβαιώθηκε.')).toBeInTheDocument();
    expect(auth.refreshMe).not.toHaveBeenCalled();
  });

  it('explains an old or used link', async () => {
    fetchMock.mockResolvedValue(json(410, {}));
    renderAt('/verify-email/old');
    expect(await screen.findByText(/δεν ισχύει πια/)).toBeInTheDocument();
  });
});

describe('VerifyEmailPage while the session is still loading', () => {
  it('refreshes the profile once the signed-in member has loaded, so the banner goes away', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const refreshMe = vi.fn().mockResolvedValue(undefined);
    const loading = authValue({ status: 'loading', me: null, refreshMe });
    const { rerender } = render(
      <AuthContext.Provider value={loading}>
        <MemoryRouter initialEntries={['/verify-email/t1']}>
          <Routes>
            <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(await screen.findByText('Το email σου επιβεβαιώθηκε.')).toBeInTheDocument();
    expect(refreshMe).not.toHaveBeenCalled();

    const ready = authValue({
      status: 'ready',
      me: { emailVerified: false } as never,
      refreshMe,
    });
    rerender(
      <AuthContext.Provider value={ready}>
        <MemoryRouter initialEntries={['/verify-email/t1']}>
          <Routes>
            <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    await waitFor(() => expect(refreshMe).toHaveBeenCalledTimes(1));
    expect(calls('/api/auth/verify-email')).toHaveLength(1);
  });
});

describe('EmailNotVerifiedBanner', () => {
  it('sends one email for a double tap', async () => {
    let finish: (r: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((r) => (finish = r)));
    render(<EmailNotVerifiedBanner email="giorgos@example.com" />);
    const button = screen.getByRole('button', { name: 'Στείλε ξανά' });
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('button', { name: /Στέλνεται|Στείλε ξανά/ }));
    finish(new Response(null, { status: 204 }));
    expect(await screen.findByRole('status')).toHaveTextContent('Στάλθηκε νέο email.');
    expect(calls('/api/auth/resend-verification')).toHaveLength(1);
  });

  it('resends the confirmation email and says so', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    render(<EmailNotVerifiedBanner email="giorgos@example.com" />);
    expect(screen.getByText(/giorgos@example.com/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Στείλε ξανά' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Στάλθηκε νέο email.');
    expect(calls('/api/auth/resend-verification')).toHaveLength(1);
  });
});
