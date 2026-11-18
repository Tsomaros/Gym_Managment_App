import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { dropPushSubscription } from '../features/notifications/usePush';
import { json } from '../test/fixtures';
import { AuthProvider, useAuth } from './AuthProvider';

vi.mock('../features/notifications/usePush', () => ({ dropPushSubscription: vi.fn() }));

function LogoutButton() {
  const { logout, status } = useAuth();
  return (
    <button type="button" disabled={status !== 'ready'} onClick={() => void logout()}>
      out
    </button>
  );
}

describe('signing out and push notifications', () => {
  let order: string[];

  beforeEach(() => {
    order = [];
    vi.mocked(dropPushSubscription).mockReset();
    vi.mocked(dropPushSubscription).mockImplementation(async () => {
      order.push('drop push');
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/auth/logout')) order.push('logout');
        if (url.endsWith('/auth/refresh')) return json(401, {});
        return new Response(null, { status: 204 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderIt = () =>
    render(
      <MemoryRouter>
        <AuthProvider>
          <LogoutButton />
        </AuthProvider>
      </MemoryRouter>,
    );

  it('removes this browser’s push subscription first, so the next person on it gets none of this account’s reminders', async () => {
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'out' }));
    await waitFor(() => expect(order).toEqual(['drop push', 'logout']));
  });

  it('still signs out when removing the subscription fails', async () => {
    vi.mocked(dropPushSubscription).mockRejectedValue(new Error('offline'));
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'out' }));
    await waitFor(() => expect(order).toEqual(['logout']));
  });
});
