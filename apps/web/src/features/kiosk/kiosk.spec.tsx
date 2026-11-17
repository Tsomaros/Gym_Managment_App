import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { KioskApp } from './KioskApp';
import { kioskStorage } from './kioskStorage';

// jsdom has no camera: the scanner is replaced by a stub that exposes what KioskApp gives it.
// The scanner itself is tested in KioskScanner.spec.tsx.
let scannerProps: { onToken: (token: string) => void; paused: boolean } | null = null;
vi.mock('./KioskScanner', () => ({
  KioskScanner: (props: { onToken: (token: string) => void; paused: boolean }) => {
    scannerProps = props;
    return <div data-testid="scanner" data-paused={String(props.paused)} />;
  },
}));

const DEVICE_KEY = 'gym.kiosk.device';
const ME = { gymId: GYM, gymName: 'Γυμναστήριο Δοκιμή', deviceName: 'Είσοδος' };

describe('KioskApp', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let checkInAnswer: () => Response | Promise<Response>;
  let meAnswer: () => Response | Promise<Response>;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    scannerProps = null;
    meAnswer = () => json(200, ME);
    checkInAnswer = () => json(200, { valid: true, firstName: 'Μαρία', reason: null });
    fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === '/api/kiosk/me') return meAnswer();
      if (url === '/api/kiosk/check-in') return checkInAnswer();
      if (url === '/api/kiosk/pair')
        return json(201, { deviceToken: 'dev-token', gymId: GYM, gymName: 'G', deviceName: 'E' });
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
  const scan = (token: string) => act(async () => scannerProps!.onToken(token));
  const checkInCalls = () =>
    fetchMock.mock.calls.filter(([u]) => String(u) === '/api/kiosk/check-in');
  const pair = async (code: string) => {
    fireEvent.change(screen.getByLabelText('Κωδικός σύνδεσης'), { target: { value: code } });
    fireEvent.click(screen.getByRole('button', { name: 'Σύνδεση' }));
    await settle();
  };
  const startPaired = async () => {
    localStorage.setItem(DEVICE_KEY, 'dev-token');
    render(<KioskApp />);
    await settle();
  };

  describe('pairing', () => {
    it('shows the pairing screen without a stored token', async () => {
      render(<KioskApp />);
      await settle();
      expect(screen.getByLabelText('Κωδικός σύνδεσης')).toBeInTheDocument();
      expect(screen.queryByTestId('scanner')).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('pairs with the typed code, stores the device token and shows the scanner', async () => {
      render(<KioskApp />);
      await pair('abcd-efgh');
      const [, init] = fetchMock.mock.calls.find(([u]) => String(u) === '/api/kiosk/pair')!;
      expect(JSON.parse(String(init?.body))).toEqual({ code: 'ABCD-EFGH' }); // shown in capitals as typed;
      expect(localStorage.getItem(DEVICE_KEY)).toBe('dev-token');
      expect(screen.getByTestId('scanner')).toBeInTheDocument();
    });

    it('says the code is not valid on 410 and stays on the pairing screen with nothing stored', async () => {
      fetchMock.mockImplementation(async () => json(410, {}));
      render(<KioskApp />);
      await pair('ZZZZ-ZZZZ');
      expect(screen.getByRole('alert')).toHaveTextContent('Ο κωδικός δεν ισχύει ή έληξε');
      expect(localStorage.getItem(DEVICE_KEY)).toBeNull();
      expect(screen.queryByTestId('scanner')).not.toBeInTheDocument();
    });

    it('says to wait on 429, and shows a generic message when the server cannot be reached', async () => {
      fetchMock.mockImplementationOnce(async () => json(429, {}));
      render(<KioskApp />);
      await pair('ABCD-EFGH');
      expect(screen.getByRole('alert')).toHaveTextContent('Πολλές προσπάθειες');

      fetchMock.mockImplementationOnce(async () => {
        throw new TypeError('offline');
      });
      await pair('ABCD-EFGH');
      expect(screen.getByRole('alert')).toHaveTextContent('Δεν ήταν δυνατή η σύνδεση');
    });

    it('does not send an empty code', async () => {
      render(<KioskApp />);
      await settle();
      fireEvent.click(screen.getByRole('button', { name: 'Σύνδεση' }));
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('start-up with a stored token', () => {
    it('asks /kiosk/me with the device token and then scans', async () => {
      await startPaired();
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('/api/kiosk/me');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Device dev-token');
      expect(screen.getByTestId('scanner')).toBeInTheDocument();
    });

    it('clears the token and returns to pairing when /kiosk/me answers 401 (revoked)', async () => {
      meAnswer = () => json(401, {});
      await startPaired();
      expect(localStorage.getItem(DEVICE_KEY)).toBeNull();
      expect(screen.getByLabelText('Κωδικός σύνδεσης')).toBeInTheDocument();
      expect(screen.queryByTestId('scanner')).not.toBeInTheDocument();
    });

    it('keeps the token and offers a retry when the server cannot be reached', async () => {
      meAnswer = () => {
        throw new TypeError('offline');
      };
      await startPaired();
      expect(localStorage.getItem(DEVICE_KEY)).toBe('dev-token');
      expect(screen.getByRole('alert')).toHaveTextContent('Δεν υπάρχει σύνδεση με τον διακομιστή');

      meAnswer = () => json(200, ME);
      fireEvent.click(screen.getByRole('button', { name: 'Δοκίμασε ξανά' }));
      await settle();
      expect(screen.getByTestId('scanner')).toBeInTheDocument();
    });
  });

  describe('scanning', () => {
    it('sends the scanned token with the device token and greets the member by first name only', async () => {
      await startPaired();
      await scan('GYM1.aaa.bbb');
      const [, init] = checkInCalls()[0]!;
      expect(JSON.parse(String(init?.body))).toEqual({ token: 'GYM1.aaa.bbb' });
      expect(new Headers(init?.headers).get('authorization')).toBe('Device dev-token');
      expect(screen.getByText('Καλώς ήρθες, Μαρία!')).toBeInTheDocument();
    });

    it('pauses the scanner while the result shows and resumes after 3 s', async () => {
      await startPaired();
      expect(screen.getByTestId('scanner')).toHaveAttribute('data-paused', 'false');
      await scan('GYM1.aaa.bbb');
      expect(screen.getByTestId('scanner')).toHaveAttribute('data-paused', 'true');

      await settle(2_999);
      expect(screen.getByText('Καλώς ήρθες, Μαρία!')).toBeInTheDocument();
      await settle(1);
      expect(screen.queryByText('Καλώς ήρθες, Μαρία!')).not.toBeInTheDocument();
      expect(screen.getByTestId('scanner')).toHaveAttribute('data-paused', 'false');
    });

    it('tells the member to go to reception for any refusal, without saying why', async () => {
      checkInAnswer = () => json(200, { valid: false, firstName: 'Μαρία', reason: 'expired' });
      await startPaired();
      await scan('GYM1.aaa.bbb');
      expect(screen.getByText('Πέρασε από τη ρεσεψιόν')).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/expired|έληξε συνδρομή|Μαρία/i);
    });

    it.each(['frozen', 'used_up', 'no_membership', 'upcoming_only', 'classes_only', 'not_member'])(
      'shows the same reception message for %s',
      async (reason) => {
        // the server sends a name too: a refusal must not show it (the tablet faces the queue)
        checkInAnswer = () => json(200, { valid: false, firstName: 'Μαρία', reason });
        await startPaired();
        await scan('GYM1.aaa.bbb');
        expect(screen.getByText('Πέρασε από τη ρεσεψιόν')).toBeInTheDocument();
        expect(document.body.textContent!.toLowerCase()).not.toContain(reason.toLowerCase());
        expect(document.body.textContent).not.toContain('Μαρία');
        expect(document.body.textContent).not.toMatch(/Καλώς ήρθες|✓/);
      },
    );

    it('asks to open the app again when the code has expired, in a different (grey) state', async () => {
      checkInAnswer = () => json(200, { valid: false, firstName: null, reason: 'invalid_token' });
      await startPaired();
      await scan('GYM1.aaa.bbb');
      expect(screen.getByText('Ο κωδικός έληξε — άνοιξε ξανά την εφαρμογή')).toBeInTheDocument();
      expect(screen.queryByText('Πέρασε από τη ρεσεψιόν')).not.toBeInTheDocument();
    });

    it('does not tell results apart by colour alone: every state has words and a symbol', async () => {
      await startPaired();
      await scan('GYM1.aaa.bbb');
      expect(screen.getByRole('status')).toHaveTextContent(/✓.*Καλώς ήρθες, Μαρία!/);
      await settle(3_000);

      checkInAnswer = () => json(200, { valid: false, firstName: null, reason: 'frozen' });
      await scan('GYM1.ccc.ddd');
      expect(screen.getByRole('status')).toHaveTextContent(/!.*Πέρασε από τη ρεσεψιόν/);
    });

    it('makes one API call when the same token is decoded twice within 3 s', async () => {
      await startPaired();
      await scan('GYM1.aaa.bbb');
      await settle(1_000);
      await scan('GYM1.aaa.bbb');
      await settle(1_000);
      await scan('GYM1.aaa.bbb');
      expect(checkInCalls()).toHaveLength(1);
    });

    it('ignores a different token while a result is showing, and accepts the same one again after 3 s', async () => {
      await startPaired();
      await scan('GYM1.aaa.bbb');
      await scan('GYM1.zzz.yyy'); // another member's code during the result
      expect(checkInCalls()).toHaveLength(1);

      // The result is gone, but the code may still be held up: it gets a full 3 s more.
      await settle(3_000);
      await scan('GYM1.aaa.bbb');
      expect(checkInCalls()).toHaveLength(1);
      await settle(2_999);
      await scan('GYM1.aaa.bbb');
      expect(checkInCalls()).toHaveLength(1);
      await settle(1);
      await scan('GYM1.aaa.bbb');
      expect(checkInCalls()).toHaveLength(2);
    });

    it('stops a hung request after 5 s with the connection message, and scans again afterwards', async () => {
      checkInAnswer = () => new Promise<Response>(() => undefined);
      await startPaired();
      await scan('GYM1.aaa.bbb');
      await settle(4_999);
      expect(
        screen.queryByText('Πρόβλημα σύνδεσης — πέρασε από τη ρεσεψιόν'),
      ).not.toBeInTheDocument();
      await settle(1);
      expect(screen.getByText('Πρόβλημα σύνδεσης — πέρασε από τη ρεσεψιόν')).toBeInTheDocument();
      await settle(3_000);
      checkInAnswer = () => json(200, { valid: true, firstName: 'Μαρία', reason: null });
      await settle(3_000);
      await scan('GYM1.new.token');
      expect(screen.getByText('Καλώς ήρθες, Μαρία!')).toBeInTheDocument();
    });

    it('greets without a name when the API sends none', async () => {
      checkInAnswer = () => json(200, { valid: true, firstName: null, reason: null });
      await startPaired();
      await scan('GYM1.aaa.bbb');
      expect(screen.getByText('Καλώς ήρθες!')).toBeInTheDocument();
    });

    it('ignores scans until the 3 s are over (2 999 ms: still ignored), then accepts a different token', async () => {
      await startPaired();
      await scan('GYM1.aaa.bbb');
      await settle(2_999);
      await scan('GYM1.aaa.bbb');
      await scan('GYM1.zzz.yyy');
      expect(checkInCalls()).toHaveLength(1);

      await settle(1);
      await scan('GYM1.zzz.yyy');
      expect(checkInCalls()).toHaveLength(2);
      expect(JSON.parse(String(checkInCalls()[1]![1]?.body))).toEqual({ token: 'GYM1.zzz.yyy' });
    });

    it('keeps the device paired when the check-in fails with a server error (only 401 means revoked)', async () => {
      checkInAnswer = () => json(500, {});
      await startPaired();
      await scan('GYM1.aaa.bbb');
      expect(localStorage.getItem(DEVICE_KEY)).toBe('dev-token');
      expect(screen.getByText('Πρόβλημα σύνδεσης — πέρασε από τη ρεσεψιόν')).toBeInTheDocument();
      expect(screen.queryByLabelText('Κωδικός σύνδεσης')).not.toBeInTheDocument();
    });

    it('does not start a second request while one is in flight', async () => {
      let release!: () => void;
      checkInAnswer = () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json(200, { valid: true, firstName: 'Μαρία', reason: null }));
        });
      await startPaired();
      await scan('GYM1.aaa.bbb');
      await scan('GYM1.other.token');
      expect(checkInCalls()).toHaveLength(1);
      await act(async () => release());
      expect(screen.getByText('Καλώς ήρθες, Μαρία!')).toBeInTheDocument();
    });

    it('goes back to pairing at once when the check-in answers 401 (the tablet was revoked)', async () => {
      checkInAnswer = () => json(401, {});
      await startPaired();
      await scan('GYM1.aaa.bbb');
      expect(localStorage.getItem(DEVICE_KEY)).toBeNull();
      expect(screen.getByLabelText('Κωδικός σύνδεσης')).toBeInTheDocument();
    });

    it('sends the member to reception when the server cannot be reached, then scans again', async () => {
      checkInAnswer = () => {
        throw new TypeError('offline');
      };
      await startPaired();
      await scan('GYM1.aaa.bbb');
      expect(screen.getByText('Πρόβλημα σύνδεσης — πέρασε από τη ρεσεψιόν')).toBeInTheDocument();
      await settle(3_000);
      expect(screen.getByTestId('scanner')).toHaveAttribute('data-paused', 'false');
      expect(localStorage.getItem(DEVICE_KEY)).toBe('dev-token');
    });

    it('never sends the user access token', async () => {
      await startPaired();
      await scan('GYM1.aaa.bbb');
      for (const [, init] of fetchMock.mock.calls) {
        expect(new Headers(init?.headers).get('authorization')).not.toMatch(/^Bearer/);
        expect(init?.credentials).toBe('omit');
      }
    });
  });

  describe('kioskStorage', () => {
    it('stores, reads and clears the token', () => {
      expect(kioskStorage.get()).toBeNull();
      kioskStorage.set('abc');
      expect(kioskStorage.get()).toBe('abc');
      expect(localStorage.getItem(DEVICE_KEY)).toBe('abc');
      kioskStorage.clear();
      expect(kioskStorage.get()).toBeNull();
    });

    it('does not throw when storage is unavailable', () => {
      const broken = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      expect(kioskStorage.get()).toBeNull();
      expect(() => kioskStorage.set('x')).not.toThrow();
      expect(() => kioskStorage.clear()).not.toThrow();
      broken.mockRestore();
      set.mockRestore();
    });
  });
});
