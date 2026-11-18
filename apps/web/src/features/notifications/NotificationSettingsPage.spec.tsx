import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { NotificationSettingsPage } from './NotificationSettingsPage';
import type { PushState } from './usePush';

const push = {
  state: 'default' as PushState,
  enable: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
};
vi.mock('./usePush', () => ({ usePush: () => push }));
vi.mock('./InstallAppHint', () => ({ InstallAppHint: () => <p>install-hint</p> }));

const ON = { email: true, push: true };

describe('NotificationSettingsPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let prefs: Record<string, { email: boolean; push: boolean }>;
  let putStatus: number;

  beforeEach(() => {
    prefs = { membership: { ...ON }, plans: { ...ON } };
    putStatus = 200;
    push.state = 'default';
    push.enable.mockClear();
    push.disable.mockClear();
    fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === 'PUT') {
        if (putStatus !== 200) return json(putStatus, {});
        prefs = JSON.parse(String(init.body)) as typeof prefs;
      }
      return json(200, prefs);
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/notifications`]}>
        <Routes>
          <Route path="/g/:gymId/notifications" element={<NotificationSettingsPage />} />
        </Routes>
      </MemoryRouter>,
    );
  const puts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'PUT');
  const toggle = (name: string) => screen.findByRole('switch', { name });

  it('shows the four switches from the saved preferences', async () => {
    prefs = { membership: { email: false, push: true }, plans: { email: true, push: false } };
    renderPage();
    expect(await toggle('Συνδρομή: Email')).not.toBeChecked();
    expect(await toggle('Συνδρομή: Ειδοποίηση')).toBeChecked();
    expect(await toggle('Προγράμματα: Email')).toBeChecked();
    expect(await toggle('Προγράμματα: Ειδοποίηση')).not.toBeChecked();
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/api/gyms/${GYM}/me/notification-prefs`);
  });

  it('flipping one switch sends the whole preferences with just that change', async () => {
    renderPage();
    await userEvent.click(await toggle('Συνδρομή: Email'));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(JSON.parse(String(puts()[0]![1]!.body))).toEqual({
      membership: { email: false, push: true },
      plans: { email: true, push: true },
    });
    await waitFor(async () => expect(await toggle('Συνδρομή: Email')).not.toBeChecked());
    await userEvent.click(await toggle('Προγράμματα: Ειδοποίηση'));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(JSON.parse(String(puts()[1]![1]!.body))).toEqual({
      membership: { email: false, push: true },
      plans: { email: true, push: false },
    });
  });

  it('puts the switch back and says so when saving fails', async () => {
    renderPage();
    const sw = await toggle('Συνδρομή: Email');
    putStatus = 500;
    await userEvent.click(sw);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await toggle('Συνδρομή: Email')).toBeChecked();
  });

  it('offers to enable push on this device and calls enable', async () => {
    renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Ενεργοποίηση ειδοποιήσεων σε αυτή τη συσκευή' }),
    );
    expect(push.enable).toHaveBeenCalledTimes(1);
  });

  it('when subscribed it says so and offers to turn push off', async () => {
    push.state = 'subscribed';
    renderPage();
    expect(await screen.findByText(/ενεργές σε αυτή τη συσκευή/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Απενεργοποίηση ειδοποιήσεων σε αυτή τη συσκευή' }),
    );
    expect(push.disable).toHaveBeenCalledTimes(1);
  });

  it('says so when turning push on fails, and not before', async () => {
    push.enable.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    await toggle('Συνδρομή: Email');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Ενεργοποίηση ειδοποιήσεων σε αυτή τη συσκευή' }),
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('when the browser blocked notifications it explains how to allow them', async () => {
    push.state = 'denied';
    renderPage();
    expect(await screen.findByText(/έχουν αποκλειστεί/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Ενεργοποίηση ειδοποιήσεων/ }),
    ).not.toBeInTheDocument();
  });

  it('on an iPhone outside the installed app it shows the install steps', async () => {
    push.state = 'needs-install';
    renderPage();
    expect(await screen.findByText('install-hint')).toBeInTheDocument();
  });

  it('shows an error with a retry when the preferences cannot be read', async () => {
    fetchMock.mockImplementationOnce(async () => json(500, {}));
    renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Δοκίμασε ξανά' }));
    expect(await toggle('Συνδρομή: Email')).toBeChecked();
  });

  it('keeps keyboard focus on the switch after it is flipped, so the next one is one Tab away', async () => {
    renderPage();
    const sw = await toggle('Συνδρομή: Email');
    sw.focus();
    await userEvent.keyboard(' ');
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(sw).toHaveFocus();
  });

  it('ignores a flip while the previous one is still saving', async () => {
    let release!: () => void;
    fetchMock.mockImplementation(async (_input, init) => {
      if (init?.method === 'PUT') await new Promise<void>((r) => (release = r));
      return json(200, prefs);
    });
    renderPage();
    await userEvent.click(await toggle('Συνδρομή: Email'));
    await userEvent.click(await toggle('Προγράμματα: Email'));
    expect(puts()).toHaveLength(1);
    release();
  });
});
