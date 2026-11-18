import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { RestTimer } from './RestTimer';

describe('RestTimer', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await i18n.changeLanguage('el');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('counts down from the target seconds and buzzes once at zero', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    render(<RestTimer seconds={90} startedAt={1} onSkip={() => undefined} />);
    expect(screen.getByRole('timer')).toHaveTextContent('1:30');
    act(() => void vi.advanceTimersByTime(30_000));
    expect(screen.getByRole('timer')).toHaveTextContent('1:00');
    expect(vibrate).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(60_500));
    expect(screen.getByRole('timer')).toHaveTextContent('0:00');
    expect(vibrate).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('Τέλος ξεκούρασης').length).toBeGreaterThan(0);
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  it('starts over when a new set restarts it, and works where vibration does not exist', () => {
    const { rerender } = render(<RestTimer seconds={60} startedAt={1} onSkip={() => undefined} />);
    act(() => void vi.advanceTimersByTime(45_000));
    expect(screen.getByRole('timer')).toHaveTextContent('0:15');
    rerender(<RestTimer seconds={60} startedAt={2} onSkip={() => undefined} />);
    expect(screen.getByRole('timer')).toHaveTextContent('1:00');
    act(() => void vi.advanceTimersByTime(61_000));
    expect(screen.getByRole('timer')).toHaveTextContent('0:00'); // no vibrate API: no crash
  });

  it('can be skipped', async () => {
    vi.useRealTimers();
    const onSkip = vi.fn();
    render(<RestTimer seconds={30} startedAt={1} onSkip={onSkip} />);
    await userEvent.click(screen.getByRole('button', { name: 'Παράλειψη' }));
    expect(onSkip).toHaveBeenCalled();
  });
});
