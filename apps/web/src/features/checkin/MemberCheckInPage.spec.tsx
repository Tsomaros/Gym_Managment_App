import type { MeResponse } from '@gym/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import QRCode from 'qrcode';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthState } from '../../auth/AuthProvider';
import '../../i18n';
import { GYM, json, MEMBER, membership } from '../../test/fixtures';
import { MemberCheckInPage } from './MemberCheckInPage';

const me: MeResponse = {
  id: MEMBER,
  email: 'g@x.gr',
  fullName: 'Μαρία Παπαδοπούλου',
  firstName: 'Μαρία',
  lastName: 'Παπαδοπούλου',
  emailVerified: true,
  locale: 'el',
  isPlatformAdmin: false,
  gyms: [{ gymId: GYM, gymName: 'Gym', roles: ['member'] }],
};

describe('MemberCheckInPage', () => {
  let issued: number;
  let failing: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    issued = 0;
    failing = false;
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (failing) throw new TypeError('offline');
        if (url.endsWith('/me/check-in-token')) {
          issued += 1;
          return json(200, {
            token: `GYM1.payload${issued}.signature${issued}`,
            expiresAt: new Date(Date.now() + 45_000).toISOString(),
          });
        }
        if (url.endsWith('/me/memberships')) return json(200, { memberships: [membership()] });
        return json(404, {});
      }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'wakeLock');
  });

  const renderPage = () => {
    const auth: AuthState = {
      me,
      status: 'ready',
      login: vi.fn(),
      logout: vi.fn(),
      startSession: vi.fn(),
      refreshMe: vi.fn(),
    };
    return render(
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[`/g/${GYM}`]}>
          <Routes>
            <Route path="/g/:gymId" element={<MemberCheckInPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
  };
  const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
  const qr = () => screen.queryByRole('img', { name: /Κωδικός εισόδου/ });
  const pathOf = (el: HTMLElement) => el.querySelector('path')!.getAttribute('d')!;

  it('shows a QR code for the token the API returned, with the member name', async () => {
    renderPage();
    await settle();
    const code = qr()!;
    expect(code).toBeInTheDocument();
    expect(code).toHaveAccessibleName('Κωδικός εισόδου για Μαρία Παπαδοπούλου');
    expect(pathOf(code as unknown as HTMLElement).length).toBeGreaterThan(200);
    expect(screen.getByText('Μαρία Παπαδοπούλου')).toBeInTheDocument();
  });

  it('draws a different code after the 30 s refresh (it encodes the new token)', async () => {
    renderPage();
    await settle();
    const first = pathOf(qr() as unknown as HTMLElement);
    await settle(30_000);
    const second = pathOf(qr() as unknown as HTMLElement);
    expect(second).not.toBe(first);
  });

  it('encodes exactly the token the API issued, before and after a refresh', async () => {
    // expected modules come from the qrcode library for the known token strings (4-module quiet zone)
    const expected = (value: string) => {
      const q = QRCode.create(value, { errorCorrectionLevel: 'M' });
      let d = '';
      for (let y = 0; y < q.modules.size; y++)
        for (let x = 0; x < q.modules.size; x++)
          if (q.modules.get(x, y)) d += `M${x + 4} ${y + 4}h1v1h-1z`;
      return d;
    };
    renderPage();
    await settle();
    expect(pathOf(qr() as unknown as HTMLElement)).toBe(expected('GYM1.payload1.signature1'));
    await settle(30_000);
    expect(pathOf(qr() as unknown as HTMLElement)).toBe(expected('GYM1.payload2.signature2'));
  });

  it('retries at once when the member presses the retry button', async () => {
    failing = true;
    renderPage();
    await settle();
    expect(qr()).not.toBeInTheDocument();
    failing = false;
    fireEvent.click(screen.getByRole('button'));
    await settle();
    expect(qr()).toBeInTheDocument();
  });

  it('is black on white with a quiet zone, whatever the colour scheme', async () => {
    renderPage();
    await settle();
    const svg = qr()!;
    expect(svg.querySelector('rect')).toHaveAttribute('fill', '#ffffff');
    expect(svg.querySelector('path')).toHaveAttribute('fill', '#000000');
    const [, , w] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const modules = Number(svg.getAttribute('data-modules'));
    expect(w).toBe(modules + 8); // 4 modules of white on every side
  });

  it('shows the connection message and no QR when the API cannot be reached', async () => {
    failing = true;
    renderPage();
    await settle();
    expect(qr()).not.toBeInTheDocument();
    expect(
      screen.getByText(/Δεν υπάρχει σύνδεση — η ρεσεψιόν μπορεί να σε περάσει με το όνομά σου/),
    ).toBeInTheDocument();
  });

  it('removes the QR once an unrefreshed code expires, and brings it back when the connection returns', async () => {
    renderPage();
    await settle();
    expect(qr()).toBeInTheDocument();
    failing = true;
    await settle(30_000); // refresh fails; the first code still has 15 s
    expect(qr()).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await settle(14_000);
    expect(qr()).toBeInTheDocument();
    await settle(1_000); // 45 s: the code has expired
    expect(qr()).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    failing = false;
    await settle(15_000); // next scheduled refresh at 60 s
    expect(qr()).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the membership summary under the code', async () => {
    renderPage();
    await settle();
    expect(screen.getByText('Μηνιαία')).toBeInTheDocument();
    expect(screen.getByText('Ενεργή')).toBeInTheDocument();
  });

  it('asks the browser to keep the screen on, and lets go when the page closes', async () => {
    const release = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ release, addEventListener: vi.fn() }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    const { unmount } = renderPage();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('screen');
    expect(release).not.toHaveBeenCalled();
    unmount();
    await settle();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does not ask for a second lock while the first request is still pending', async () => {
    let grant!: (s: unknown) => void;
    const request = vi.fn(() => new Promise((res) => (grant = res)));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    renderPage();
    await settle();
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    grant({ release: vi.fn(async () => undefined), addEventListener: vi.fn() });
    await settle();
  });

  it('asks for the screen lock again when the tab returns after the browser dropped it', async () => {
    const releaseHandlers: Array<() => void> = [];
    const request = vi.fn(async () => ({
      release: vi.fn(async () => undefined),
      addEventListener: (_: string, fn: () => void) => releaseHandlers.push(fn),
    }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    renderPage();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    const visibility = vi.spyOn(document, 'visibilityState', 'get');

    // lock still held: coming back to the tab must not ask a second time
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(request).toHaveBeenCalledTimes(1);

    // the browser drops the lock when the tab is hidden; nothing is requested while hidden
    releaseHandlers.forEach((fn) => fn());
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(request).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
  });

  it('works without the Wake Lock API', async () => {
    renderPage();
    await settle();
    expect(qr()).toBeInTheDocument();
  });
});
