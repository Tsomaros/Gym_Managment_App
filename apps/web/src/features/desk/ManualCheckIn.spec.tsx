import type { CheckInResult, MemberSummary } from '@gym/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { checkInResult, GYM, json, MEMBER } from '../../test/fixtures';
import { ManualCheckIn } from './ManualCheckIn';

const summary = (over: Partial<MemberSummary>): MemberSummary => ({
  userId: MEMBER,
  photoUrl: null,
  firstName: 'Γιώργος',
  lastName: 'Παπαδόπουλος',
  email: 'g@x.gr',
  emailVerified: true,
  phone: '+306912345678',
  joinedAt: '2027-05-01T09:00:00Z',
  status: 'active',
  currentEndsOn: null,
  visitsLeft: null,
  ...over,
});
const giorgos = summary({});
const giota = summary({
  userId: 'm-2',
  firstName: 'Γιώτα',
  lastName: 'Δημητρίου',
  email: 'gi@x.gr',
});

describe('ManualCheckIn', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let onResult: ReturnType<typeof vi.fn<(result: CheckInResult) => void>>;

  beforeEach(() => {
    onResult = vi.fn<(result: CheckInResult) => void>();
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('/members?')) return json(200, [giorgos, giota]);
      if (url.endsWith('/check-ins') && init?.method === 'POST') {
        return json(201, checkInResult());
      }
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const calls = (suffix: string, method = 'GET') =>
    fetchMock.mock.calls.filter(
      ([u, i]) => String(u).includes(suffix) && (i?.method ?? 'GET') === method,
    );
  const type = (text: string) =>
    fireEvent.change(screen.getByRole('combobox', { name: 'Είσοδος με όνομα' }), {
      target: { value: text },
    });

  it('waits 250 ms after typing before searching, with one request for what was typed', async () => {
    vi.useFakeTimers();
    try {
      render(<ManualCheckIn gymId={GYM} onResult={onResult} />);
      type('γ');
      await vi.advanceTimersByTimeAsync(200);
      type('γιωρ');
      await vi.advanceTimersByTimeAsync(249);
      expect(calls('/members?')).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls('/members?')).toHaveLength(1);
      expect(String(calls('/members?')[0]![0])).toContain(`q=${encodeURIComponent('γιωρ')}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists "Γιώργος" for "γιωρ" and checks in the highlighted member once with Enter', async () => {
    render(<ManualCheckIn gymId={GYM} onResult={onResult} />);
    const box = screen.getByRole('combobox', { name: 'Είσοδος με όνομα' });
    await userEvent.type(box, 'γιωρ');
    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveTextContent('Γιώργος Παπαδόπουλος');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(calls('/check-ins', 'POST')).toHaveLength(1));
    expect(String(calls('/check-ins', 'POST')[0]![0])).toBe(
      `/api/gyms/${GYM}/members/${MEMBER}/check-ins`,
    );
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(checkInResult()));
    expect(box).toHaveValue('');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('moves the highlight with the arrow keys and checks in that member', async () => {
    render(<ManualCheckIn gymId={GYM} onResult={onResult} />);
    const box = screen.getByRole('combobox', { name: 'Είσοδος με όνομα' });
    await userEvent.type(box, 'γι');
    await screen.findAllByRole('option');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    expect(box).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1]!.id);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(calls('/check-ins', 'POST')).toHaveLength(1));
    expect(String(calls('/check-ins', 'POST')[0]![0])).toContain('/members/m-2/');

    await userEvent.type(box, 'γι');
    await screen.findAllByRole('option');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}'); // stays on the first
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('checks in a member who is clicked', async () => {
    render(<ManualCheckIn gymId={GYM} onResult={onResult} />);
    await userEvent.type(screen.getByRole('combobox'), 'γι');
    await userEvent.click(await screen.findByRole('option', { name: /Γιώτα Δημητρίου/ }));
    await waitFor(() => expect(calls('/check-ins', 'POST')).toHaveLength(1));
    expect(String(calls('/check-ins', 'POST')[0]![0])).toContain('/members/m-2/');
  });

  it('does nothing on Enter when nothing is listed, and says so when no member matches', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).includes('/members?') ? json(200, []) : json(404, {}),
    );
    render(<ManualCheckIn gymId={GYM} onResult={onResult} />);
    await userEvent.type(screen.getByRole('combobox'), 'ζζζ{Enter}');
    expect(await screen.findByText('Κανένα μέλος.')).toBeInTheDocument();
    expect(calls('/check-ins', 'POST')).toHaveLength(0);
  });

  it('closes the list on Escape and searches nothing for a blank box', async () => {
    render(<ManualCheckIn gymId={GYM} onResult={onResult} />);
    const box = screen.getByRole('combobox');
    await userEvent.type(box, '   ');
    await new Promise((r) => setTimeout(r, 300));
    expect(calls('/members?')).toHaveLength(0);

    await userEvent.type(box, 'γι');
    await screen.findAllByRole('option');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('ignores Enter while the results of an older query are still on screen', async () => {
    render(<ManualCheckIn gymId={GYM} onResult={onResult} />);
    const box = screen.getByRole('combobox');
    await userEvent.type(box, 'γι');
    await screen.findAllByRole('option');
    // another letter and Enter at once: the list still shows the answer to "γι"
    await userEvent.type(box, 'ω{Enter}');
    expect(calls('/check-ins', 'POST')).toHaveLength(0);
    // once the new answer is in, Enter works again
    await screen.findAllByRole('option');
    await waitFor(() => expect(calls('/members?').length).toBeGreaterThan(1));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(calls('/check-ins', 'POST')).toHaveLength(1));
  });

  it('closes the list when the box loses focus, and tells screen readers it is closed', async () => {
    render(<ManualCheckIn gymId={GYM} onResult={onResult} />);
    const box = screen.getByRole('combobox');
    await userEvent.type(box, 'γι');
    await screen.findAllByRole('option');
    expect(box).toHaveAttribute('aria-expanded', 'true');
    await userEvent.tab();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(box).toHaveAttribute('aria-expanded', 'false');
  });

  it('announces when no member matches', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).includes('/members?') ? json(200, []) : json(404, {}),
    );
    render(<ManualCheckIn gymId={GYM} onResult={onResult} />);
    await userEvent.type(screen.getByRole('combobox'), 'ζζζ');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Κανένα μέλος.'));
  });

  it('shows an error and keeps what was typed when the check-in fails', async () => {
    fetchMock.mockImplementation(async (input, init) =>
      String(input).includes('/members?')
        ? json(200, [giorgos])
        : init?.method === 'POST'
          ? json(500, {})
          : json(404, {}),
    );
    render(<ManualCheckIn gymId={GYM} onResult={onResult} />);
    const box = screen.getByRole('combobox');
    await userEvent.type(box, 'γιωρ');
    await screen.findByRole('option');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    expect(onResult).not.toHaveBeenCalled();
    expect(box).toHaveValue('γιωρ');
  });
});
