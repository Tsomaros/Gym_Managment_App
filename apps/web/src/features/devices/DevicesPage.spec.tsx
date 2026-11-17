import type { Device } from '@gym/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { DevicesPage } from './DevicesPage';

const door: Device = {
  id: '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  name: 'Είσοδος',
  createdAt: '2027-05-01T09:00:00.000Z',
  lastSeenAt: '2027-05-02T07:30:00.000Z',
  revoked: false,
};
const old: Device = {
  id: '8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e',
  name: 'Παλιό tablet',
  createdAt: '2027-04-01T09:00:00.000Z',
  lastSeenAt: null,
  revoked: true,
};

describe('DevicesPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let devices: Device[];

  beforeEach(() => {
    devices = [door, old];
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === `/api/gyms/${GYM}/devices` && method === 'GET') return json(200, devices);
      if (url === `/api/gyms/${GYM}/devices/pairing-codes` && method === 'POST')
        return json(201, { code: 'ABCD-EFGH', expiresAt: '2027-05-02T09:15:00.000Z' });
      if (url.endsWith('/revoke') && method === 'POST') {
        devices = devices.map((d) => (url.includes(d.id) ? { ...d, revoked: true } : d));
        return new Response(null, { status: 204 });
      }
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/devices`]}>
        <Routes>
          <Route path="/g/:gymId/devices" element={<DevicesPage />} />
        </Routes>
      </MemoryRouter>,
    );
  const posts = (suffix: string) =>
    fetchMock.mock.calls.filter(
      ([u, i]) => String(u).endsWith(suffix) && (i?.method ?? 'GET') === 'POST',
    );

  it('lists the tablets with last use, and marks a revoked one in words', async () => {
    renderPage();
    const doorItem = (await screen.findByText('Είσοδος')).closest('li')!;
    expect(within(doorItem).getByText(/Τελευταία χρήση/)).toBeInTheDocument();
    expect(within(doorItem).queryByText('Ανακλήθηκε')).not.toBeInTheDocument();
    expect(within(doorItem).getByRole('button', { name: 'Ανάκληση: Είσοδος' })).toBeInTheDocument();

    const oldItem = screen.getByText('Παλιό tablet').closest('li')!;
    expect(within(oldItem).getByText('Ανακλήθηκε')).toBeInTheDocument();
    expect(within(oldItem).getByText('Δεν έχει χρησιμοποιηθεί ακόμα')).toBeInTheDocument();
    expect(within(oldItem).queryByRole('button', { name: /Ανάκληση/ })).not.toBeInTheDocument();
  });

  it('says so when there is no tablet yet', async () => {
    devices = [];
    renderPage();
    expect(await screen.findByText('Δεν υπάρχει συνδεδεμένο tablet.')).toBeInTheDocument();
  });

  it('creates a pairing code for a named tablet and shows it large, with the time it stops working', async () => {
    renderPage();
    await screen.findByText('Είσοδος');
    await userEvent.click(screen.getByRole('button', { name: 'Σύνδεση νέου tablet' }));
    const dialog = await screen.findByRole('dialog');

    await userEvent.type(within(dialog).getByLabelText('Όνομα tablet'), 'Πόρτα 2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Δημιουργία κωδικού' }));

    const code = await within(dialog).findByText('ABCD-EFGH');
    expect(code.closest('p')!.className).toMatch(/text-(5xl|6xl|\[3rem\]|4xl)/);
    expect(code.closest('p')).toHaveFocus(); // the form button that had focus is gone
    expect(within(dialog).getByText('A B C D - E F G H')).toBeInTheDocument(); // read out letter by letter
    expect(dialog).toHaveTextContent(/έως τις/);
    const [, init] = posts('/devices/pairing-codes')[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'Πόρτα 2' });
  });

  it('does not create a code without a name', async () => {
    renderPage();
    await screen.findByText('Είσοδος');
    await userEvent.click(screen.getByRole('button', { name: 'Σύνδεση νέου tablet' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Δημιουργία κωδικού' }));
    expect(posts('/pairing-codes')).toHaveLength(0);
    expect(within(dialog).getByText('Συμπλήρωσε αυτό το πεδίο.')).toBeInTheDocument();
  });

  it('asks before revoking, and does nothing when cancelled', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Ανάκληση: Είσοδος' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Είσοδος');
    expect(posts('/revoke')).toHaveLength(0);
    await userEvent.click(within(confirm).getByRole('button', { name: 'Άκυρο' }));
    expect(posts('/revoke')).toHaveLength(0);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('revokes after confirmation and shows the tablet as revoked', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Ανάκληση: Είσοδος' }));
    const confirm = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Ανάκληση' }));
    await waitFor(() => expect(posts(`/devices/${door.id}/revoke`)).toHaveLength(1));
    await waitFor(() => {
      const item = screen.getByText('Είσοδος').closest('li')!;
      expect(within(item).getByText('Ανακλήθηκε')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('revokes the tablet that was chosen, not another active one', async () => {
    const back: Device = {
      ...door,
      id: '9c3d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f',
      name: 'Πίσω πόρτα',
    };
    devices = [door, back];
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Ανάκληση: Πίσω πόρτα' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Πίσω πόρτα');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Ανάκληση' }));
    await waitFor(() => expect(posts('/revoke')).toHaveLength(1));
    expect(posts(`/devices/${back.id}/revoke`)).toHaveLength(1);
    expect(posts(`/devices/${door.id}/revoke`)).toHaveLength(0);
  });

  it('shows an error and closes the confirmation when the revoke fails', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/revoke')) return json(500, {});
      if (url === `/api/gyms/${GYM}/devices` && (init?.method ?? 'GET') === 'GET')
        return json(200, devices);
      return json(404, {});
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Ανάκληση: Είσοδος' }));
    const confirm = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Ανάκληση' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    const item = screen.getByText('Είσοδος').closest('li')!;
    expect(within(item).queryByText('Ανακλήθηκε')).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the list cannot be loaded', async () => {
    fetchMock.mockImplementationOnce(async () => json(500, {}));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    await userEvent.click(screen.getByRole('button', { name: 'Δοκίμασε ξανά' }));
    expect(await screen.findByText('Είσοδος')).toBeInTheDocument();
  });
});
