import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import '../../i18n';
import { GYM } from '../../test/fixtures';
import { TodayTiles } from './TodayTiles';

const renderTiles = (today = { visitors: 14, present: 5, expiringSoon: 9 }) =>
  render(
    <MemoryRouter>
      <TodayTiles gymId={GYM} today={today} />
    </MemoryRouter>,
  );

describe('TodayTiles', () => {
  it('shows the three numbers with their labels', () => {
    renderTiles();
    expect(screen.getByRole('link', { name: /Επισκέπτες σήμερα/ })).toHaveTextContent('14');
    expect(screen.getByRole('link', { name: /Μέσα τώρα/ })).toHaveTextContent('5');
    expect(screen.getByRole('link', { name: /Λήγουν σε 7 ημέρες/ })).toHaveTextContent('9');
  });

  it('links visitors and who is inside to the desk, and the ending memberships to renewals', () => {
    renderTiles();
    expect(screen.getByRole('link', { name: /Επισκέπτες σήμερα/ })).toHaveAttribute(
      'href',
      `/g/${GYM}/checkIn`,
    );
    expect(screen.getByRole('link', { name: /Μέσα τώρα/ })).toHaveAttribute(
      'href',
      `/g/${GYM}/checkIn`,
    );
    expect(screen.getByRole('link', { name: /Λήγουν σε 7 ημέρες/ })).toHaveAttribute(
      'href',
      `/g/${GYM}/renewals`,
    );
  });

  it('shows zeros as zeros, not as missing numbers', () => {
    renderTiles({ visitors: 0, present: 0, expiringSoon: 0 });
    for (const name of [/Επισκέπτες σήμερα/, /Μέσα τώρα/, /Λήγουν σε 7 ημέρες/]) {
      expect(screen.getByRole('link', { name })).toHaveTextContent('0');
    }
  });
});
