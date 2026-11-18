import type { MeResponse } from '@gym/shared';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthState } from './auth/AuthProvider';
import './i18n';
import { dashboard } from './features/dashboard/fixtures';
import { AppRoutes } from './router';

const GYM_A = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const GYM_B = '1c2d3e4f-5a6b-4c7d-9e8f-0a1b2c3d4e5f';

const meWith = (gyms: MeResponse['gyms'], isPlatformAdmin = false): MeResponse => ({
  id: '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d',
  email: 'giorgos@example.com',
  fullName: 'Γιώργος Παπαδόπουλος',
  firstName: 'Γιώργος',
  lastName: 'Παπαδόπουλος',
  emailVerified: true,
  locale: 'el',
  isPlatformAdmin,
  gyms,
});

function renderAt(path: string, me: MeResponse | null) {
  const auth: AuthState = {
    me,
    status: 'ready',
    login: vi.fn(),
    logout: vi.fn(),
    startSession: vi.fn(),
    refreshMe: vi.fn(),
  };
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('routing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps section links absolute when already inside a section', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]', { status: 200 })),
    );
    renderAt(
      `/g/${GYM_A}/membershipTypes`,
      meWith([{ gymId: GYM_A, gymName: 'Gym A', roles: ['owner'] }]),
    );
    const nav = await screen.findByRole('navigation');
    expect(within(nav).getByRole('link', { name: 'Πληρωμές' })).toHaveAttribute(
      'href',
      `/g/${GYM_A}/payments`,
    );
    expect(within(nav).getByRole('link', { name: 'Επισκόπηση' })).toHaveAttribute(
      'href',
      `/g/${GYM_A}`,
    );
  });

  it('sends a trainer who is also a member in one gym to the trainer area', async () => {
    renderAt('/', meWith([{ gymId: GYM_A, gymName: 'Gym A', roles: ['trainer', 'member'] }]));
    expect(await screen.findByTestId('shell-trainer')).toBeInTheDocument();
  });

  it('opens the owner area for an owner, whatever other roles they hold', async () => {
    renderAt(
      `/g/${GYM_A}`,
      meWith([{ gymId: GYM_A, gymName: 'Gym A', roles: ['member', 'owner', 'trainer'] }]),
    );
    expect(await screen.findByTestId('shell-owner')).toBeInTheDocument();
  });

  it('shows the gym picker for someone in two gyms', async () => {
    renderAt(
      '/',
      meWith([
        { gymId: GYM_A, gymName: 'Gym A', roles: ['member'] },
        { gymId: GYM_B, gymName: 'Gym B', roles: ['reception'] },
      ]),
    );
    expect(await screen.findByTestId('gym-picker')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Gym A/ })).toHaveAttribute('href', `/g/${GYM_A}`);
    expect(screen.getByRole('link', { name: /Gym B/ })).toHaveAttribute('href', `/g/${GYM_B}`);
  });

  it('sends a signed-out visitor to the sign-in page', async () => {
    renderAt('/', null);
    expect(await screen.findByTestId('login-page')).toBeInTheDocument();
  });

  it('gives reception the reception area even when they also train', async () => {
    renderAt(
      `/g/${GYM_A}`,
      meWith([{ gymId: GYM_A, gymName: 'Gym A', roles: ['trainer', 'reception'] }]),
    );
    expect(await screen.findByTestId('shell-reception')).toBeInTheDocument();
    expect(screen.queryByTestId('shell-trainer')).not.toBeInTheDocument();
  });

  it('picks the shell per gym: owner in one gym, member in another', async () => {
    const gyms = [
      { gymId: GYM_A, gymName: 'Gym A', roles: ['member' as const] },
      { gymId: GYM_B, gymName: 'Gym B', roles: ['owner' as const] },
    ];
    renderAt(`/g/${GYM_A}`, meWith(gyms));
    expect(await screen.findByTestId('shell-member')).toBeInTheDocument();
  });

  it('sends a signed-out visitor opening a gym link to sign-in, not the gym', async () => {
    renderAt(`/g/${GYM_A}`, null);
    expect(await screen.findByTestId('login-page')).toBeInTheDocument();
    expect(screen.queryByTestId('shell-owner')).not.toBeInTheDocument();
  });

  it('sends a platform admin with no gyms to the platform area', async () => {
    renderAt('/', meWith([], true));
    expect(await screen.findByTestId('shell-platform')).toBeInTheDocument();
  });

  it('keeps a non-admin out of the platform area', async () => {
    renderAt('/platform', meWith([{ gymId: GYM_A, gymName: 'Gym A', roles: ['owner'] }]));
    expect(await screen.findByTestId('shell-owner')).toBeInTheDocument();
    expect(screen.queryByTestId('shell-platform')).not.toBeInTheDocument();
  });

  it('sends someone to their gyms when they open a gym they do not belong to', async () => {
    renderAt(`/g/${GYM_B}`, meWith([{ gymId: GYM_A, gymName: 'Gym A', roles: ['member'] }]));
    expect(await screen.findByTestId('shell-member')).toBeInTheDocument();
  });

  describe('/settings/notifications (the link in reminder emails)', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) =>
          // The owner's home is the dashboard; everyone else here only reads notification settings.
          String(input).endsWith('/dashboard')
            ? new Response(JSON.stringify(dashboard()), { status: 200 })
            : new Response(
                '{"membership":{"email":true,"push":true},"plans":{"email":true,"push":true},"classes":{"email":true,"push":true}}',
                { status: 200 },
              ),
        ),
      );
    });

    it('opens the notification settings of the one gym a member belongs to', async () => {
      renderAt(
        '/settings/notifications',
        meWith([{ gymId: GYM_A, gymName: 'Gym A', roles: ['member'] }]),
      );
      expect(
        await screen.findByRole('heading', { name: 'Ειδοποιήσεις', level: 2 }),
      ).toBeInTheDocument();
      expect(screen.getByTestId('shell-member')).toBeInTheDocument();
    });

    it('asks for the gym first when the person is a member of several', async () => {
      renderAt(
        '/settings/notifications',
        meWith([
          { gymId: GYM_A, gymName: 'Gym A', roles: ['member'] },
          { gymId: GYM_B, gymName: 'Gym B', roles: ['member'] },
        ]),
      );
      expect(await screen.findByTestId('gym-picker')).toBeInTheDocument();
    });

    it('picks the one gym where they are a member, not the gym where they hold another role', async () => {
      renderAt(
        '/settings/notifications',
        meWith([
          { gymId: GYM_B, gymName: 'Gym B', roles: ['owner'] },
          { gymId: GYM_A, gymName: 'Gym A', roles: ['member'] },
        ]),
      );
      expect(
        await screen.findByRole('heading', { name: 'Ειδοποιήσεις', level: 2 }),
      ).toBeInTheDocument();
      const urls = vi.mocked(fetch).mock.calls.map(([u]) => String(u));
      expect(urls).toContain(`/api/gyms/${GYM_A}/me/notification-prefs`);
      expect(urls.join()).not.toContain(GYM_B);
    });

    it('does not open the settings for someone who is no member anywhere (owner only)', async () => {
      renderAt(
        '/settings/notifications',
        meWith([{ gymId: GYM_A, gymName: 'Gym A', roles: ['owner'] }]),
      );
      expect(await screen.findByTestId('shell-owner')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Ειδοποιήσεις', level: 2 })).toBeNull();
    });

    it('does not send an owner who is also a member into a staff area without that page', async () => {
      renderAt(
        '/settings/notifications',
        meWith([{ gymId: GYM_A, gymName: 'Gym A', roles: ['owner', 'member'] }]),
      );
      // The owner area has no notification page: they must not be sent to a section it lacks.
      expect(await screen.findByTestId('shell-owner')).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Ειδοποιήσεις', level: 2 }),
      ).not.toBeInTheDocument();
      // They land on the area's home instead.
      expect(screen.getByRole('link', { name: 'Επισκόπηση' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    it('goes to sign-in first when signed out', async () => {
      renderAt('/settings/notifications', null);
      expect(await screen.findByTestId('login-page')).toBeInTheDocument();
    });
  });
});
