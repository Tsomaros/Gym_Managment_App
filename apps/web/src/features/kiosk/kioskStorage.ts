const KEY = 'gym.kiosk.device';

/**
 * The tablet's device token. It lives in localStorage so a reload or a restart keeps the tablet
 * paired; every access is guarded because private windows and blocked storage throw.
 */
export const kioskStorage = {
  get(): string | null {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      localStorage.setItem(KEY, token);
    } catch {
      // not stored: the tablet will have to be paired again after a reload
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // nothing to clear
    }
  },
};
