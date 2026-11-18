import type { Occupancy } from '@gym/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { OccupancyBadge } from './OccupancyBadge';

const show = async (body: Occupancy) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json(200, body)),
  );
  render(<OccupancyBadge gymId={GYM} />);
};

describe('OccupancyBadge', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['quiet', 'Ήσυχα'],
    ['moderate', 'Μέτρια'],
    ['busy', 'Πολύς κόσμος'],
  ] as const)('says %s in words', async (level, text) => {
    await show({ level });
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('shows only the level when the count is not given, with no digit on screen', async () => {
    await show({ level: 'moderate' });
    const badge = await screen.findByTestId('occupancy-badge');
    expect(badge).toHaveTextContent('Μέτρια');
    expect(badge.textContent).not.toMatch(/\d/);
  });

  it('adds the number of people when the API sends it, in the singular and the plural', async () => {
    await show({ level: 'busy', count: 23, capacity: 30 });
    expect(await screen.findByTestId('occupancy-badge')).toHaveTextContent(
      'Πολύς κόσμος, 23 άτομα',
    );
  });

  it('says "1 άτομο" for one person', async () => {
    await show({ level: 'quiet', count: 1, capacity: 30 });
    expect(await screen.findByTestId('occupancy-badge')).toHaveTextContent('Ήσυχα, 1 άτομο');
  });

  it('shows nothing at all when the gym has no capacity set', async () => {
    await show({ level: null });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetch).toHaveBeenCalledTimes(1); // the answer really arrived before we looked
    expect(screen.queryByTestId('occupancy-badge')).not.toBeInTheDocument();
    expect(document.body.textContent).toBe('');
  });

  it('shows nothing, not an error, when the first request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(500, {})),
    );
    render(<OccupancyBadge gymId={GYM} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('occupancy-badge')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('draws a different icon for each level, so the level is not told by colour alone', async () => {
    const paths: string[] = [];
    for (const level of ['quiet', 'moderate', 'busy'] as const) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => json(200, { level })),
      );
      const { container, unmount } = render(<OccupancyBadge gymId={GYM} />);
      await screen.findByTestId('occupancy-badge');
      const svg = container.querySelector('svg')!;
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      paths.push(svg.innerHTML);
      unmount();
    }
    expect(new Set(paths).size).toBe(3);
  });
});
