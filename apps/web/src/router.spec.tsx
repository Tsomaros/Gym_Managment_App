import type { MeResponse } from '@gym/shared';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthState } from './auth/AuthProvider';
import './i18n';
import { AppRoutes } from './router';

const GYM_A = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const GYM_B = '1c2d3e4f-5a6b-4c7d-9e8f-0a1b2c3d4e5f';

const meWith = (gyms: MeResponse['gyms'], isPlatformAdmin = false): MeResponse => ({
  id: '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d',
  email: 'giorgos@example.com',
  fullName: 'Γιώργος Παπαδόπουλος',
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
});
