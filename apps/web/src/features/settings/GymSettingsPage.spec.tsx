import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { GymSettingsPage } from './GymSettingsPage';

describe('GymSettingsPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let patchStatus: number;
  let settings: Record<string, unknown>;

  beforeEach(() => {
    patchStatus = 200;
    settings = {
      name: 'Gym',
      timezone: 'Europe/Athens',
      autoCheckoutMinutes: 120,
      receptionCanEditShifts: false,
    };
    fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === 'PATCH') {
        if (patchStatus !== 200) return json(patchStatus, {});
        settings = { ...settings, ...(JSON.parse(String(init.body)) as object) };
      }
      return json(200, settings);
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/settings`]}>
        <Routes>
          <Route path="/g/:gymId/settings" element={<GymSettingsPage />} />
        </Routes>
      </MemoryRouter>,
    );
  const patches = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'PATCH');
  const field = () => screen.findByLabelText(/Αυτόματη έξοδος μετά από/);
  const save = () => userEvent.click(screen.getByRole('button', { name: 'Αποθήκευση' }));

  it('shows the current auto check-out minutes with the allowed range', async () => {
    renderPage();
    const input = await field();
    expect(input).toHaveValue(120);
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('min', '30');
    expect(input).toHaveAttribute('max', '600');
    expect(screen.getByText(/30–600/)).toBeInTheDocument();
  });

  it('saves a new value and confirms it', async () => {
    renderPage();
    const input = await field();
    await userEvent.clear(input);
    await userEvent.type(input, '90');
    await save();
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(String(patches()[0]![0])).toBe(`/api/gyms/${GYM}/settings`);
    expect(JSON.parse(String(patches()[0]![1]?.body))).toEqual({ autoCheckoutMinutes: 90 });
    expect(await screen.findByRole('status')).toHaveTextContent('Αποθηκεύτηκε');
  });

  it.each(['20', '601', '45.5', '', '-5'])(
    'does not send %j and says what is allowed',
    async (typed) => {
      renderPage();
      const input = await field();
      await userEvent.clear(input);
      if (typed) await userEvent.type(input, typed);
      await save();
      expect(patches()).toHaveLength(0);
      expect(input).toHaveAccessibleDescription(/30–600/);
      expect(input).toBeInvalid();
    },
  );

  it.each([30, 600])('accepts the limit %i', async (minutes) => {
    renderPage();
    const input = await field();
    await userEvent.clear(input);
    await userEvent.type(input, String(minutes));
    await save();
    await waitFor(() => expect(patches()).toHaveLength(1));
  });

  it('shows an error when the server refuses, and no confirmation', async () => {
    patchStatus = 400;
    renderPage();
    const input = await field();
    await userEvent.clear(input);
    await userEvent.type(input, '90');
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    expect(screen.queryByText('Αποθηκεύτηκε')).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the settings cannot be loaded', async () => {
    fetchMock.mockImplementationOnce(async () => json(500, {}));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    await userEvent.click(screen.getByRole('button', { name: 'Δοκίμασε ξανά' }));
    expect(await field()).toHaveValue(120);
  });

  it('saves the reception shift switch at once, on its own', async () => {
    renderPage();
    const box = await screen.findByRole('checkbox', {
      name: 'Η ρεσεψιόν μπορεί να αλλάζει βάρδιες',
    });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(JSON.parse(String(patches()[0]![1]?.body))).toEqual({ receptionCanEditShifts: true });
    await waitFor(() => expect(box).toBeChecked());
    await userEvent.click(box);
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(JSON.parse(String(patches()[1]![1]?.body))).toEqual({ receptionCanEditShifts: false });
    await waitFor(() => expect(box).not.toBeChecked());
  });

  it('keeps the switch as it was and says so when saving it fails', async () => {
    renderPage();
    const box = await screen.findByRole('checkbox', {
      name: 'Η ρεσεψιόν μπορεί να αλλάζει βάρδιες',
    });
    patchStatus = 500;
    await userEvent.click(box);
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    expect(patches()).toHaveLength(1);
    expect(box).not.toBeChecked();
  });

  it('confirms the saved switch and blocks a second tap while the first is saving', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === 'PATCH') await gate;
      return original(input, init);
    });
    renderPage();
    const box = await screen.findByRole('checkbox', {
      name: 'Η ρεσεψιόν μπορεί να αλλάζει βάρδιες',
    });
    await userEvent.click(box);
    await waitFor(() => expect(box).toBeDisabled());
    release();
    await waitFor(() => expect(box).toBeEnabled());
    expect(patches()).toHaveLength(1);
    expect(await screen.findByRole('status')).toHaveTextContent('Αποθηκεύτηκε');
  });
});
