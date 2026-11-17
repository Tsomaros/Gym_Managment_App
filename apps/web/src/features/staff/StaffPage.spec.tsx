import type { StaffList } from '@gym/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { StaffPage } from './StaffPage';

const OWNER = '1a1a1a1a-1111-4111-8111-111111111111';
const TRAINER = '2b2b2b2b-2222-4222-8222-222222222222';
const INVITE = '3c3c3c3c-3333-4333-8333-333333333333';

const list: StaffList = {
  staff: [
    {
      userId: OWNER,
      firstName: 'Μαρία',
      lastName: 'Ιδιοκτήτρια',
      email: 'maria@x.gr',
      phone: '+306912345678',
      roles: ['owner', 'trainer'],
      since: '2027-05-01T09:00:00.000Z',
    },
    {
      userId: TRAINER,
      firstName: 'Νίκος',
      lastName: 'Γυμναστής',
      email: 'nikos@x.gr',
      phone: null,
      roles: ['trainer'],
      since: '2027-05-02T09:00:00.000Z',
    },
  ],
  pending: [
    {
      id: INVITE,
      email: 'new@x.gr',
      firstName: 'Ελένη',
      lastName: 'Νέα',
      roles: ['reception'],
      expiresAt: '2027-05-05T09:00:00.000Z',
    },
  ],
};

describe('StaffPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let data: StaffList;

  beforeEach(() => {
    data = structuredClone(list);
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === `/api/gyms/${GYM}/staff` && method === 'GET') return json(200, data);
      if (url === `/api/gyms/${GYM}/invitations/${INVITE}/cancel` && method === 'POST') {
        data = { ...data, pending: [] };
        return new Response(null, { status: 204 });
      }
      if (url === `/api/gyms/${GYM}/invitations` && method === 'POST')
        return json(201, { invitationId: 'x', mailSent: true });
      if (url === `/api/gyms/${GYM}/staff/${TRAINER}/roles/trainer` && method === 'DELETE') {
        data = { ...data, staff: data.staff.filter((s) => s.userId !== TRAINER) };
        return new Response(null, { status: 204 });
      }
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = (canManage: boolean) =>
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/staff`]}>
        <Routes>
          <Route path="/g/:gymId/staff" element={<StaffPage canManage={canManage} />} />
        </Routes>
      </MemoryRouter>,
    );
  const calls = (method: string, suffix: string) =>
    fetchMock.mock.calls.filter(
      ([u, i]) => String(u).endsWith(suffix) && (i?.method ?? 'GET') === method,
    );

  it('lists staff with role chips in Greek, a tel: link for the phone and the email', async () => {
    renderPage(true);
    const row = (await screen.findByText('Μαρία Ιδιοκτήτρια')).closest('li')!;
    expect(within(row).getByText('Ιδιοκτήτης')).toBeInTheDocument();
    expect(within(row).getByText('Γυμναστής')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /\+306912345678/ })).toHaveAttribute(
      'href',
      'tel:+306912345678',
    );
    expect(within(row).getByText('maria@x.gr')).toBeInTheDocument();
    const second = screen.getByText('Νίκος Γυμναστής').closest('li')!;
    expect(within(second).queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows pending invitations to the owner and cancels one', async () => {
    const user = userEvent.setup();
    renderPage(true);
    const item = (await screen.findByText('Ελένη Νέα')).closest('li')!;
    expect(within(item).getByText('new@x.gr')).toBeInTheDocument();
    await user.click(within(item).getByRole('button', { name: 'Ακύρωση πρόσκλησης: Ελένη Νέα' }));
    await waitFor(() => expect(calls('POST', `/invitations/${INVITE}/cancel`)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('Ελένη Νέα')).not.toBeInTheDocument());
  });

  it('gives reception the list only: no invite, remove or pending controls', async () => {
    // The data still holds a pending invitation: reception must not see it (the owner does).
    renderPage(false);
    await screen.findByText('Μαρία Ιδιοκτήτρια');
    expect(screen.queryByRole('button', { name: /Πρόσκληση/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Αφαίρεση/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ακύρωση/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Εκκρεμείς προσκλήσεις/)).not.toBeInTheDocument();
    expect(screen.queryByText('Ελένη Νέα')).not.toBeInTheDocument();
    expect(screen.queryByText('new@x.gr')).not.toBeInTheDocument();
  });

  it('removes a trainer role only after the warning is confirmed', async () => {
    const user = userEvent.setup();
    renderPage(true);
    const row = (await screen.findByText('Νίκος Γυμναστής')).closest('li')!;
    await user.click(
      within(row).getByRole('button', { name: 'Αφαίρεση ρόλου Γυμναστής: Νίκος Γυμναστής' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/οι μελλοντικές βάρδιες θα διαγραφούν/)).toBeInTheDocument();
    expect(calls('DELETE', '/roles/trainer')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Αφαίρεση' }));
    await waitFor(() => expect(calls('DELETE', `/staff/${TRAINER}/roles/trainer`)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('Νίκος Γυμναστής')).not.toBeInTheDocument());
    // Only that person was affected; the other staff member is still listed.
    expect(screen.getByText('Μαρία Ιδιοκτήτρια')).toBeInTheDocument();
  });

  it('does not remove anything when the warning is cancelled', async () => {
    const user = userEvent.setup();
    renderPage(true);
    const row = (await screen.findByText('Νίκος Γυμναστής')).closest('li')!;
    await user.click(
      within(row).getByRole('button', { name: 'Αφαίρεση ρόλου Γυμναστής: Νίκος Γυμναστής' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Άκυρο' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(calls('DELETE', '/roles/trainer')).toHaveLength(0);
    expect(screen.getByText('Νίκος Γυμναστής')).toBeInTheDocument();
  });

  it('confirms a sent invitation and reloads the list', async () => {
    const user = userEvent.setup();
    renderPage(true);
    await screen.findByText('Μαρία Ιδιοκτήτρια');
    await user.click(screen.getByRole('button', { name: 'Πρόσκληση προσωπικού' }));
    const dialog = await screen.findByRole('dialog', { name: 'Πρόσκληση προσωπικού' });
    await user.type(within(dialog).getByLabelText('Όνομα'), 'Άννα');
    await user.type(within(dialog).getByLabelText('Επώνυμο'), 'Τεστ');
    await user.type(within(dialog).getByLabelText('Email'), 'anna@x.gr');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Υποδοχή' }));
    await user.click(within(dialog).getByRole('button', { name: 'Αποστολή πρόσκλησης' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Η πρόσκληση στάλθηκε.');
    expect(calls('POST', '/invitations')).toHaveLength(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // initial load + reload after the invitation
    expect(calls('GET', '/staff')).toHaveLength(2);
  });

  it('opens the invite dialog from the button', async () => {
    const user = userEvent.setup();
    renderPage(true);
    await screen.findByText('Μαρία Ιδιοκτήτρια');
    await user.click(screen.getByRole('button', { name: 'Πρόσκληση προσωπικού' }));
    expect(await screen.findByRole('dialog', { name: 'Πρόσκληση προσωπικού' })).toBeInTheDocument();
  });

  it('says so when the list fails to load, with a retry', async () => {
    fetchMock.mockImplementationOnce(async () => json(500, {}));
    renderPage(true);
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Δοκίμασε ξανά' }));
    expect(await screen.findByText('Μαρία Ιδιοκτήτρια')).toBeInTheDocument();
  });

  it('announces a removal and puts focus back on the page heading, not on a vanished button', async () => {
    const user = userEvent.setup();
    renderPage(true);
    const row = (await screen.findByText('Νίκος Γυμναστής')).closest('li')!;
    await user.click(
      within(row).getByRole('button', { name: 'Αφαίρεση ρόλου Γυμναστής: Νίκος Γυμναστής' }),
    );
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Αφαίρεση' }),
    );
    await waitFor(() => expect(screen.queryByText('Νίκος Γυμναστής')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Ο ρόλος αφαιρέθηκε.');
    expect(screen.getByRole('heading', { name: 'Προσωπικό', level: 2 })).toHaveFocus();
  });

  it('shows an error, not the retry-the-list button, when cancelling an invitation fails', async () => {
    const user = userEvent.setup();
    renderPage(true);
    const item = (await screen.findByText('Ελένη Νέα')).closest('li')!;
    fetchMock.mockImplementationOnce(async () => json(500, {}));
    await user.click(within(item).getByRole('button', { name: 'Ακύρωση πρόσκλησης: Ελένη Νέα' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    expect(screen.queryByRole('button', { name: 'Δοκίμασε ξανά' })).not.toBeInTheDocument();
    expect(screen.getByText('Ελένη Νέα')).toBeInTheDocument();
  });
});
