import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { DashboardPage } from './DashboardPage';
import { dashboard, income } from './fixtures';

vi.mock('recharts', async () => (await import('./charts.mock')).rechartsMock());

describe('DashboardPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>(async () =>
      json(
        200,
        dashboard({
          today: { visitors: 14, present: 5, expiringSoon: 9 },
          income: income({
            '2027-05': {
              totalCents: 4000,
              byMethod: { cash: 4000, card: 0 },
              byType: [{ name: 'Μηνιαία', cents: 4000 }],
            },
          }),
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}`]}>
        <Routes>
          <Route path="/g/:gymId" element={<DashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it('loads the dashboard of the gym in the URL and shows every section', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Σήμερα' })).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/api/gyms/${GYM}/dashboard`);
    expect(screen.getByRole('link', { name: /Επισκέπτες σήμερα/ })).toHaveTextContent('14');
    expect(screen.getByRole('heading', { name: 'Έσοδα ανά μήνα' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Μέλη' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Πιο πολυσύχναστες ώρες' })).toBeInTheDocument();
  });

  it('shows a loading message first', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Φόρτωση επισκόπησης…');
  });

  it('shows an error with a retry, and the retry loads the page', async () => {
    fetchMock.mockImplementationOnce(async () => json(500, {}));
    renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Δοκίμασε ξανά' }));
    expect(await screen.findByRole('heading', { name: 'Σήμερα' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('after a switch to another gym it shows that gym, even when the first answer arrives last', async () => {
    const OTHER = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';
    const pending = new Map<string, (r: Response) => void>();
    fetchMock.mockImplementation(
      (input) => new Promise<Response>((resolve) => pending.set(String(input), resolve)),
    );
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}`]}>
        <Link to={`/g/${OTHER}`}>switch</Link>
        <Routes>
          <Route path="/g/:gymId" element={<DashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('link', { name: 'switch' }));
    // The other gym answers first, the first gym's slower answer arrives afterwards.
    pending.get(`/api/gyms/${OTHER}/dashboard`)!(
      json(200, dashboard({ today: { visitors: 7, present: 0, expiringSoon: 0 } })),
    );
    expect(await screen.findByRole('link', { name: /Επισκέπτες σήμερα/ })).toHaveTextContent('7');
    pending.get(`/api/gyms/${GYM}/dashboard`)!(
      json(200, dashboard({ today: { visitors: 99, present: 0, expiringSoon: 0 } })),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole('link', { name: /Επισκέπτες σήμερα/ })).toHaveTextContent('7');
  });

  it('clears the old gym while the new one loads', async () => {
    const OTHER = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}`]}>
        <Link to={`/g/${OTHER}`}>switch</Link>
        <Routes>
          <Route path="/g/:gymId" element={<DashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Σήμερα' });
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await userEvent.click(screen.getByRole('link', { name: 'switch' }));
    expect(screen.queryByRole('heading', { name: 'Σήμερα' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
