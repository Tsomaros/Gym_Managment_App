import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json, membership } from '../../test/fixtures';
import { FreezeDialog } from './FreezeDialog';

describe('FreezeDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const m = membership({ maxFreezeDays: 14 });
  const used = [
    {
      id: 'f1',
      membershipId: m.id,
      startsOn: '2027-05-10',
      endsOn: '2027-05-14',
      endedEarly: false,
      createdAt: '',
    },
  ];

  it('shows the freeze days left (max minus used)', () => {
    render(
      <FreezeDialog gymId={GYM} membership={m} freezes={used} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    expect(screen.getByText('Υπόλοιπο ημερών παγώματος: 9')).toBeInTheDocument();
  });

  it('sends the dates and reports the server limit message', async () => {
    fetchMock.mockResolvedValue(
      json(409, { message: 'Not enough freeze days left', remainingFreezeDays: 9 }),
    );
    render(
      <FreezeDialog gymId={GYM} membership={m} freezes={used} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    await userEvent.type(screen.getByLabelText('Από'), '2027-05-20');
    await userEvent.type(screen.getByLabelText('Έως'), '2027-05-31');
    await userEvent.click(screen.getByRole('button', { name: 'Πάγωμα' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`/api/gyms/${GYM}/memberships/${m.id}/freezes`);
    expect(JSON.parse(String(init!.body))).toEqual({
      startsOn: '2027-05-20',
      endsOn: '2027-05-31',
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Απομένουν μόνο 9 ημέρες παγώματος.',
    );
  });

  it('refuses an end before the start without calling the API', async () => {
    render(
      <FreezeDialog gymId={GYM} membership={m} freezes={[]} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    await userEvent.type(screen.getByLabelText('Από'), '2027-05-20');
    await userEvent.type(screen.getByLabelText('Έως'), '2027-05-19');
    await userEvent.click(screen.getByRole('button', { name: 'Πάγωμα' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Έως')).toHaveAttribute('aria-invalid', 'true');
  });
});
