import type { CheckInResult, LiveEvent } from '@gym/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { FakeEventSource } from '../../test/fakeEventSource';
import {
  checkInResult,
  GYM,
  json,
  MEMBER,
  membership,
  monthlyType,
  presentMember,
  visitorRow,
} from '../../test/fixtures';
import { DeskPage } from './DeskPage';

const SETTINGS = { name: 'Gym', timezone: 'Europe/Athens', autoCheckoutMinutes: 120 };
const NIKOS = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

describe('DeskPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let present: ReturnType<typeof presentMember>[];
  let visitors: ReturnType<typeof visitorRow>[];

  beforeEach(() => {
    FakeEventSource.reset();
    present = [
      presentMember({
        checkInId: 'in-1',
        firstName: 'Νίκος',
        lastName: 'Αλεξίου',
        memberId: NIKOS,
      }),
    ];
    visitors = [
      visitorRow({ checkInId: 'in-1', firstName: 'Νίκος', lastName: 'Αλεξίου', memberId: NIKOS }),
    ];
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === `/api/gyms/${GYM}/settings`) return json(200, SETTINGS);
      if (url === `/api/gyms/${GYM}/check-ins/present`) return json(200, present);
      if (url === `/api/gyms/${GYM}/check-ins`) return json(200, visitors);
      if (url === `/api/gyms/${GYM}/live/tickets`) return json(201, { ticket: 'T1' });
      if (url.endsWith('/check-out') && method === 'POST')
        return new Response(null, { status: 204 });
      if (url.includes('/membership-types')) return json(200, [monthlyType]);
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderDesk = async () => {
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}`]}>
        <Routes>
          <Route path="/g/:gymId" element={<DeskPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Νίκος Αλεξίου', { selector: 'li *' });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  };
  const live = (event: LiveEvent) => act(() => FakeEventSource.last.emit(event.type, event));
  const calls = (suffix: string) =>
    fetchMock.mock.calls.filter(([u]) => String(u).endsWith(suffix));
  const insideList = () => screen.getByRole('region', { name: /Μέσα τώρα/ });

  it("loads who is inside and the day's visitors from the API once, then follows live events without asking again", async () => {
    await renderDesk();
    expect(calls('/check-ins/present')).toHaveLength(1);
    expect(calls(`/gyms/${GYM}/check-ins`)).toHaveLength(1);

    act(() => FakeEventSource.last.emit('open'));
    const result = checkInResult({
      checkInId: 'in-2',
      member: {
        id: MEMBER,
        firstName: 'Μαρία',
        lastName: 'Νικολάου',
        photoUrl: 'https://f.test/m.jpg',
      },
    });
    live({ type: 'check_in', result });

    // the big card
    const card = await screen.findByTestId('check-in-card');
    expect(within(card).getByText('Μαρία Νικολάου')).toBeInTheDocument();
    expect(card).toHaveAttribute('data-verdict', 'valid');
    // inside now (newest first) and today's list
    const items = within(insideList()).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Μαρία Νικολάου');
    expect(items[1]).toHaveTextContent('Νίκος Αλεξίου');
    expect(calls('/check-ins/present')).toHaveLength(1); // no refetch
    expect(calls(`/gyms/${GYM}/check-ins`)).toHaveLength(1);
  });

  it('shows a refusal from the stream as a red card with the reason in words and the sell button, and keeps the member out of "inside"', async () => {
    await renderDesk();
    live({
      type: 'check_in',
      result: checkInResult({
        checkInId: 'in-3',
        valid: false,
        reason: 'frozen',
        membership: membership({ status: 'frozen', effectiveEndsOn: '2027-06-07' }),
      }),
    });
    const card = await screen.findByTestId('check-in-card');
    expect(card).toHaveAttribute('data-verdict', 'refused');
    expect(within(card).getByText('Η συνδρομή είναι σε πάγωμα')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Πώληση συνδρομής' })).toBeInTheDocument();
    expect(within(insideList()).getAllByRole('listitem')).toHaveLength(1);
  });

  it('keeps the previous check-ins under the big card, the latest first, ten at most', async () => {
    await renderDesk();
    for (let i = 1; i <= 13; i++) {
      live({
        type: 'check_in',
        result: checkInResult({
          checkInId: `c-${i}`,
          member: { id: `m-${i}`, firstName: `Μέλος${i}`, lastName: 'Τεστ', photoUrl: null },
        }),
      });
    }
    const feed = screen.getByRole('region', { name: 'Τελευταίες είσοδοι' });
    expect(within(feed).getByTestId('check-in-card')).toHaveTextContent('Μέλος13 Τεστ');
    const previous = within(feed).getAllByTestId('previous-check-in');
    expect(previous).toHaveLength(10);
    expect(previous[0]).toHaveTextContent('Μέλος12 Τεστ');
    expect(previous[9]).toHaveTextContent('Μέλος3 Τεστ');
  });

  it('removes a member from "inside" on a check_out event, and marks them checked out in the day list', async () => {
    await renderDesk();
    live({ type: 'check_out', checkInId: 'in-1' });
    await waitFor(() =>
      expect(within(insideList()).getByText('Δεν υπάρχει κανείς μέσα.')).toBeInTheDocument(),
    );
    // the day list shows the departure (time is "now", so only its shape is fixed)
    await userEvent.click(screen.getByRole('button', { name: 'Σήμερα' }));
    const row = within(screen.getByRole('region', { name: 'Σήμερα' })).getAllByRole('listitem');
    expect(row).toHaveLength(1);
    expect(row[0]).toHaveTextContent(/έξοδος \d{2}:\d{2}/);
  });

  it('checks out from the button, and a second event for the same check-out changes nothing', async () => {
    await renderDesk();
    await userEvent.click(screen.getByRole('button', { name: 'Έξοδος: Νίκος Αλεξίου' }));
    await waitFor(() => expect(calls('/check-ins/in-1/check-out')).toHaveLength(1));
    expect(calls('/check-ins/in-1/check-out')[0]![1]?.method).toBe('POST');
    await waitFor(() =>
      expect(within(insideList()).getByText('Δεν υπάρχει κανείς μέσα.')).toBeInTheDocument(),
    );
    live({ type: 'check_out', checkInId: 'in-1' });
    expect(within(insideList()).getByText('Δεν υπάρχει κανείς μέσα.')).toBeInTheDocument();
  });

  it('adds the same check-in once even when it arrives from the stream and from the manual box', async () => {
    await renderDesk();
    const result = checkInResult({ checkInId: 'same' });
    live({ type: 'check_in', result });
    live({ type: 'check_in', result });
    expect(within(insideList()).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryAllByTestId('previous-check-in')).toHaveLength(0);
    // the day list has it once too (Νίκος from the load + the new one)
    await userEvent.click(screen.getByRole('button', { name: 'Σήμερα' }));
    expect(
      within(screen.getByRole('region', { name: 'Σήμερα' })).getAllByRole('listitem'),
    ).toHaveLength(2);
  });

  it('puts a repeat of someone already inside at the top once, not twice', async () => {
    await renderDesk();
    live({
      type: 'check_in',
      result: checkInResult({
        checkInId: 'in-9',
        member: { id: NIKOS, firstName: 'Νίκος', lastName: 'Αλεξίου', photoUrl: null },
      }),
    });
    const names = within(insideList())
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(names).toHaveLength(1);
    expect(names[0]).toContain('Νίκος Αλεξίου');
    // the one row is the newer check-in (in-9), so its button checks out in-9, not in-1
    await userEvent.click(screen.getByRole('button', { name: 'Έξοδος: Νίκος Αλεξίου' }));
    await waitFor(() => expect(calls('/check-ins/in-9/check-out')).toHaveLength(1));
    expect(calls('/check-ins/in-1/check-out')).toHaveLength(0);
  });

  it('shows whether the live link is up: reconnecting until the stream opens', async () => {
    await renderDesk();
    expect(screen.getByRole('status', { name: /σύνδεση/i })).toHaveTextContent('Επανασύνδεση…');
    act(() => FakeEventSource.last.emit('open'));
    expect(screen.getByRole('status', { name: /σύνδεση/i })).toHaveTextContent('Ζωντανά');
    act(() => FakeEventSource.last.emit('error'));
    expect(screen.getByRole('status', { name: /σύνδεση/i })).toHaveTextContent('Επανασύνδεση…');
  });

  it('opens the sell dialog from a refusal, and after the sale checks the member in again', async () => {
    const refused: CheckInResult = checkInResult({
      checkInId: 'in-4',
      valid: false,
      reason: 'expired',
      membership: membership({ status: 'expired', effectiveEndsOn: '2027-02-28' }),
    });
    let sold = false;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === `/api/gyms/${GYM}/settings`) return json(200, SETTINGS);
      if (url === `/api/gyms/${GYM}/check-ins/present`) return json(200, []);
      if (url === `/api/gyms/${GYM}/check-ins`) return json(200, []);
      if (url === `/api/gyms/${GYM}/live/tickets`) return json(201, { ticket: 'T1' });
      if (url.includes('/membership-types')) return json(200, [monthlyType]);
      if (url.endsWith(`/members/${MEMBER}/memberships`) && method === 'POST') {
        sold = true;
        return json(201, membership());
      }
      if (url.endsWith(`/members/${MEMBER}/check-ins`) && method === 'POST') {
        return json(201, checkInResult({ checkInId: 'in-5' }));
      }
      return json(404, {});
    });
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}`]}>
        <Routes>
          <Route path="/g/:gymId" element={<DeskPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    live({ type: 'check_in', result: refused });
    await userEvent.click(await screen.findByRole('button', { name: 'Πώληση συνδρομής' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Μηνιαία/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Πώληση' }));
    await screen.findByText('Η πώληση έγινε');
    await userEvent.click(screen.getByRole('button', { name: 'Κλείσιμο' }));

    expect(sold).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId('check-in-card')).toHaveAttribute('data-verdict', 'valid'),
    );
  });

  it('loads the lists again after the live link comes back, since events during the gap are lost', async () => {
    await renderDesk();
    act(() => FakeEventSource.last.emit('open'));
    expect(calls('/check-ins/present')).toHaveLength(1); // the first connect needs no reload

    act(() => FakeEventSource.last.emit('error'));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2), { timeout: 3000 });
    expect(calls('/check-ins/present')).toHaveLength(1); // still down: nothing new yet
    present = [
      presentMember({ checkInId: 'in-7', firstName: 'Άννα', lastName: 'Νέα', memberId: 'm-7' }),
    ];
    act(() => FakeEventSource.last.emit('open'));

    await waitFor(() => expect(calls('/check-ins/present')).toHaveLength(2));
    await within(insideList()).findByText('Άννα Νέα');
    expect(within(insideList()).queryByText('Νίκος Αλεξίου')).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the lists cannot be loaded', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith('/settings') ? json(200, SETTINGS) : json(500, {}),
    );
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}`]}>
        <Routes>
          <Route path="/g/:gymId" element={<DeskPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    expect(screen.getByRole('button', { name: 'Δοκίμασε ξανά' })).toBeInTheDocument();
  });

  it('says so when nothing has happened yet today', async () => {
    present = [];
    visitors = [];
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}`]}>
        <Routes>
          <Route path="/g/:gymId" element={<DeskPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByText('Οι είσοδοι εμφανίζονται εδώ μόλις γίνουν.'),
    ).toBeInTheDocument();
  });
});
