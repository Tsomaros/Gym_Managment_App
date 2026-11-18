import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { EnablePushCard, PUSH_CARD_KEY } from './EnablePushCard';
import type { PushState } from './usePush';

const push = { state: 'default' as PushState, enable: vi.fn(async () => {}), disable: vi.fn() };
vi.mock('./usePush', () => ({ usePush: () => push }));
vi.mock('./InstallAppHint', () => ({ InstallAppHint: () => <p>install-hint</p> }));

describe('EnablePushCard', () => {
  beforeEach(() => {
    localStorage.clear();
    push.state = 'default';
    push.enable.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('offers the reminder and enables push from the button', async () => {
    render(<EnablePushCard />, { wrapper: MemoryRouter });
    expect(screen.getByText('Θέλεις υπενθύμιση πριν λήξει η συνδρομή σου;')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ενεργοποίηση' }));
    expect(push.enable).toHaveBeenCalledTimes(1);
  });

  it('says so when enabling fails, and keeps the offer', async () => {
    push.enable.mockRejectedValueOnce(new Error('boom'));
    render(<EnablePushCard />, { wrapper: MemoryRouter });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ενεργοποίηση' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ενεργοποίηση' })).toBeInTheDocument();
  });

  it('hides after "Not now" and stays hidden on the next visit', async () => {
    const first = render(<EnablePushCard />, { wrapper: MemoryRouter });
    await userEvent.click(screen.getByRole('button', { name: 'Όχι τώρα' }));
    expect(screen.queryByText(/Θέλεις υπενθύμιση/)).not.toBeInTheDocument();
    expect(localStorage.getItem(PUSH_CARD_KEY)).toBe('1');
    first.unmount();
    render(<EnablePushCard />, { wrapper: MemoryRouter });
    expect(screen.queryByText(/Θέλεις υπενθύμιση/)).not.toBeInTheDocument();
  });

  it.each(['subscribed', 'denied', 'unsupported'] as const)(
    'is not shown when push is %s',
    (state) => {
      push.state = state;
      render(<EnablePushCard />, { wrapper: MemoryRouter });
      expect(screen.queryByText(/Θέλεις υπενθύμιση/)).not.toBeInTheDocument();
    },
  );

  it('on an iPhone outside the installed app it shows the install steps instead of the button', () => {
    push.state = 'needs-install';
    render(<EnablePushCard />, { wrapper: MemoryRouter });
    expect(screen.getByText('install-hint')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ενεργοποίηση' })).not.toBeInTheDocument();
  });

  it('still shows (and dismisses in memory) when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<EnablePushCard />, { wrapper: MemoryRouter });
    expect(screen.getByText(/Θέλεις υπενθύμιση/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Όχι τώρα' }));
    expect(screen.queryByText(/Θέλεις υπενθύμιση/)).not.toBeInTheDocument();
  });

  it('after a successful tap it says push is on and offers the settings, instead of just vanishing', async () => {
    push.enable.mockImplementationOnce(async () => {
      push.state = 'subscribed';
    });
    render(<EnablePushCard />, { wrapper: MemoryRouter });
    await userEvent.click(screen.getByRole('button', { name: 'Ενεργοποίηση' }));
    expect(await screen.findByText(/ενεργές σε αυτή τη συσκευή/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ενεργοποίηση' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Κλείσιμο' })).toBeInTheDocument();
  });

  it('after the browser blocks the permission it explains where to change it', async () => {
    push.enable.mockImplementationOnce(async () => {
      push.state = 'denied';
    });
    render(<EnablePushCard />, { wrapper: MemoryRouter });
    await userEvent.click(screen.getByRole('button', { name: 'Ενεργοποίηση' }));
    expect(await screen.findByText(/έχουν αποκλειστεί/)).toBeInTheDocument();
  });

  it('ignores a second tap while the first is still working', async () => {
    let finish!: () => void;
    push.enable.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
    render(<EnablePushCard />, { wrapper: MemoryRouter });
    const button = screen.getByRole('button', { name: 'Ενεργοποίηση' });
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('button', { name: 'Μια στιγμή…' }));
    expect(push.enable).toHaveBeenCalledTimes(1);
    finish();
  });
});
