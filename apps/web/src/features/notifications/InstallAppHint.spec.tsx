import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { InstallAppHint } from './InstallAppHint';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

describe('InstallAppHint', () => {
  afterEach(() => vi.restoreAllMocks());

  it('on an iPhone it lists the Safari steps, ending with "Add to Home Screen"', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    render(<InstallAppHint />);
    const steps = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatch(/Safari/);
    expect(steps[1]).toMatch(/Κοινοποίηση/);
    expect(steps[2]).toContain('Προσθήκη στην οθόνη Αφετηρίας');
    // The illustration is decorative: the steps carry the meaning.
    expect(document.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('on Android with an install prompt available it offers an install button that triggers it', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ANDROID);
    render(<InstallAppHint />);
    expect(screen.queryByRole('button', { name: 'Εγκατάσταση εφαρμογής' })).not.toBeInTheDocument();
    const prompt = vi.fn(async () => undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    await userEvent.click(await screen.findByRole('button', { name: 'Εγκατάσταση εφαρμογής' }));
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('on Android without an install prompt it explains the browser menu instead', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ANDROID);
    render(<InstallAppHint />);
    expect(screen.getByText(/μενού του προγράμματος περιήγησης/)).toBeInTheDocument();
  });
});
