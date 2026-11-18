import type { OnDutyPerson, StaffList, TrainerClient } from '@gym/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json, MEMBER } from '../../test/fixtures';
import { AssignTrainerDialog } from './AssignTrainerDialog';
import { CoverDialog } from './CoverDialog';
import { TrainerClientsPage } from './TrainerClientsPage';

const NIKOS = '2b2b2b2b-2222-4222-8222-222222222222';
const ELENI = '3c3c3c3c-3333-4333-8333-333333333333';
const staff: StaffList = {
  staff: [
    {
      userId: NIKOS,
      firstName: 'Νίκος',
      lastName: 'Γυμναστής',
      email: 'n@x.gr',
      phone: null,
      roles: ['trainer'],
      since: '2027-05-01T00:00:00.000Z',
    },
    {
      userId: ELENI,
      firstName: 'Ελένη',
      lastName: 'Προπονήτρια',
      email: 'e@x.gr',
      phone: null,
      roles: ['trainer', 'reception'],
      since: '2027-05-01T00:00:00.000Z',
    },
    {
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      firstName: 'Μαρία',
      lastName: 'Υποδοχή',
      email: 'm@x.gr',
      phone: null,
      roles: ['reception'],
      since: '2027-05-01T00:00:00.000Z',
    },
  ],
  pending: [],
};
const duty = (
  id: string,
  first: string,
  roles: OnDutyPerson['roles'] = ['trainer'],
): OnDutyPerson => ({
  userId: id,
  firstName: first,
  lastName: 'Τεστ',
  roles,
  until: '14:00',
});

afterEach(() => vi.unstubAllGlobals());

describe('AssignTrainerDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let putStatus: number;
  const onDone = vi.fn<() => void>();
  const onSell = vi.fn<() => void>();
  const onClose = vi.fn<() => void>();

  beforeEach(() => {
    putStatus = 200;
    onDone.mockClear();
    onSell.mockClear();
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/staff')) return json(200, staff);
      if (url.endsWith('/on-duty')) return json(200, [duty(ELENI, 'Ελένη', ['trainer'])]);
      if (url.endsWith('/trainer') && init?.method === 'PUT')
        return putStatus === 200 ? json(200, {}) : json(putStatus, {});
      if (url.endsWith('/trainer') && init?.method === 'DELETE')
        return new Response(null, { status: 204 });
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  const renderDialog = (current: Parameters<typeof AssignTrainerDialog>[0]['current'] = null) =>
    render(
      <AssignTrainerDialog
        gymId={GYM}
        memberId={MEMBER}
        memberName="Γιώργος Παπαδόπουλος"
        current={current}
        onClose={onClose}
        onDone={onDone}
        onSell={onSell}
      />,
    );

  it('lists only the trainers and marks who is on a shift now', async () => {
    renderDialog();
    const nikos = await screen.findByRole('radio', { name: /Νίκος Γυμναστής/ });
    expect(nikos.closest('label')).toHaveTextContent('Εκτός βάρδιας');
    expect(
      screen.getByRole('radio', { name: /Ελένη Προπονήτρια/ }).closest('label'),
    ).toHaveTextContent('Σε βάρδια');
    expect(screen.queryByRole('radio', { name: /Μαρία Υποδοχή/ })).not.toBeInTheDocument();
  });

  it('assigns the chosen trainer', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('radio', { name: /Νίκος Γυμναστής/ }));
    await user.click(screen.getByRole('button', { name: 'Ανάθεση' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const put = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')!;
    expect(String(put[0])).toBe(`/api/gyms/${GYM}/members/${MEMBER}/trainer`);
    expect(JSON.parse(String(put[1]?.body))).toEqual({ trainerId: NIKOS });
  });

  it('sends nothing until a trainer is chosen', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('radio', { name: /Νίκος Γυμναστής/ });
    await user.click(screen.getByRole('button', { name: 'Ανάθεση' }));
    // Let any (wrongly) started request reach fetch before checking that none did.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('explains that a personal-training membership is needed and offers to sell one', async () => {
    putStatus = 409;
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('radio', { name: /Νίκος Γυμναστής/ }));
    await user.click(screen.getByRole('button', { name: 'Ανάθεση' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Χρειάζεται συνδρομή με personal trainer');
    await user.click(within(alert).getByRole('button', { name: 'Πώληση συνδρομής' }));
    expect(onSell).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows a generic error for another failure, not the sell offer', async () => {
    putStatus = 500;
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('radio', { name: /Νίκος Γυμναστής/ }));
    await user.click(screen.getByRole('button', { name: 'Ανάθεση' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    expect(screen.queryByRole('button', { name: 'Πώληση συνδρομής' })).not.toBeInTheDocument();
  });

  it('shows the current trainer chosen and removes them on request', async () => {
    const user = userEvent.setup();
    renderDialog({ userId: NIKOS, firstName: 'Νίκος', lastName: 'Γυμναστής', paused: false });
    expect(await screen.findByRole('radio', { name: /Νίκος Γυμναστής/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Αφαίρεση γυμναστή' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const del = fetchMock.mock.calls.find(([, i]) => i?.method === 'DELETE')!;
    expect(String(del[0])).toBe(`/api/gyms/${GYM}/members/${MEMBER}/trainer`);
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(false);
  });

  it('does not claim anyone is off shift when the on-duty lookup fails', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/staff')) return json(200, staff);
      return json(500, {});
    });
    renderDialog();
    expect(await screen.findByRole('radio', { name: /Νίκος Γυμναστής/ })).toBeInTheDocument();
    expect(screen.queryByText('Εκτός βάρδιας')).not.toBeInTheDocument();
    expect(screen.queryByText('Σε βάρδια')).not.toBeInTheDocument();
  });
});

describe('CoverDialog', () => {
  const onDone = vi.fn<(c: { trainerId: string; firstName: string }) => void>();
  let putStatus: number;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    putStatus = 200;
    onDone.mockClear();
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/on-duty'))
        return json(200, [
          duty(NIKOS, 'Νίκος'),
          duty(ELENI, 'Ελένη'),
          duty('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Μαρία', ['reception']),
        ]);
      if (url.endsWith('/cover') && init?.method === 'PUT')
        return putStatus === 200 ? json(200, {}) : json(putStatus, {});
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  const renderDialog = (primary: string | null = null) =>
    render(
      <CoverDialog
        gymId={GYM}
        memberId={MEMBER}
        memberName="Γιώργος Παπαδόπουλος"
        primaryTrainerId={primary}
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );

  it('offers only trainers who are on duty now, never reception staff or the primary trainer', async () => {
    renderDialog(NIKOS);
    expect(await screen.findByRole('button', { name: /Ελένη Τεστ/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Νίκος/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Μαρία/ })).not.toBeInTheDocument();
  });

  it('assigns the picked trainer and reports their first name', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('button', { name: /Ελένη Τεστ/ }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({ trainerId: ELENI, firstName: 'Ελένη' }),
    );
    const put = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')!;
    expect(String(put[0])).toBe(`/api/gyms/${GYM}/members/${MEMBER}/cover`);
    expect(JSON.parse(String(put[1]?.body))).toEqual({ trainerId: ELENI });
  });

  it('says so when the trainer went off duty in the meantime', async () => {
    putStatus = 409;
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('button', { name: /Ελένη Τεστ/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('δεν είναι πια σε βάρδια');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('says so when nobody else is on duty', async () => {
    fetchMock.mockImplementation(async () => json(200, [duty(NIKOS, 'Νίκος')]));
    renderDialog(NIKOS);
    expect(
      await screen.findByText('Κανένας άλλος γυμναστής δεν είναι σε βάρδια αυτή τη στιγμή.'),
    ).toBeInTheDocument();
  });

  it('loads the on-duty list again after a 409 and offers a retry when the list cannot be loaded', async () => {
    putStatus = 409;
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('button', { name: /Ελένη Τεστ/ }));
    await screen.findByText(/δεν είναι πια σε βάρδια/);
    const loads = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/on-duty'));
    expect(loads).toHaveLength(2);
  });

  it('can retry when the on-duty list fails to load', async () => {
    let first = true;
    fetchMock.mockImplementation(async () => {
      if (first) {
        first = false;
        return json(500, {});
      }
      return json(200, [duty(ELENI, 'Ελένη')]);
    });
    const user = userEvent.setup();
    renderDialog();
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    await user.click(screen.getByRole('button', { name: 'Δοκίμασε ξανά' }));
    expect(await screen.findByRole('button', { name: /Ελένη Τεστ/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('TrainerClientsPage', () => {
  const client = (over: Partial<TrainerClient>): TrainerClient => ({
    memberId: 'm1',
    firstName: 'Γιώργος',
    lastName: 'Α',
    photoUrl: null,
    paused: false,
    membershipStatus: 'active',
    assignedAt: '2027-05-01T09:00:00.000Z',
    ...over,
  });
  const renderPage = (clients: TrainerClient[]) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => json(200, clients)),
    );
    return render(
      <MemoryRouter initialEntries={[`/g/${GYM}/members`]}>
        <Routes>
          <Route path="/g/:gymId/members" element={<TrainerClientsPage />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it('lists clients with their status, a paused badge in words, and covers under their own heading', async () => {
    renderPage([
      client({ memberId: 'm1', firstName: 'Γιώργος' }),
      client({ memberId: 'm2', firstName: 'Άννα', paused: true, membershipStatus: 'expired' }),
      client({ memberId: 'm3', firstName: 'Κώστας', cover: true }),
    ]);
    const clients = await screen.findByRole('list', { name: 'Οι πελάτες μου' });
    const rows = within(clients).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Γιώργος Α')).toBeInTheDocument();
    expect(within(rows[0]!).queryByText('Σε παύση')).not.toBeInTheDocument();
    expect(within(rows[1]!).getByText('Σε παύση')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Έληξε')).toBeInTheDocument();

    const covers = screen.getByRole('region', { name: 'Αντικατάσταση σήμερα' });
    expect(within(covers).getByText('Κώστας Α')).toBeInTheDocument();
    expect(within(clients).queryByText('Κώστας Α')).not.toBeInTheDocument();
  });

  it('links every client, own or covered, to their plans', async () => {
    renderPage([
      client({ memberId: 'm1', firstName: 'Γιώργος' }),
      client({ memberId: 'm3', firstName: 'Κώστας', cover: true }),
    ]);
    const own = await screen.findByRole('link', { name: 'Προγράμματα του Γιώργος Α' });
    expect(own).toHaveAttribute('href', `/g/${GYM}/members/m1/plans`);
    expect(screen.getByRole('link', { name: 'Προγράμματα του Κώστας Α' })).toHaveAttribute(
      'href',
      `/g/${GYM}/members/m3/plans`,
    );
  });

  it('says so when there are no clients, and shows no covers heading', async () => {
    renderPage([]);
    expect(await screen.findByText('Δεν έχεις πελάτες ακόμα.')).toBeInTheDocument();
    expect(screen.queryByText('Αντικατάσταση σήμερα')).not.toBeInTheDocument();
  });
});
