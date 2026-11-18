import { describe, expect, it } from 'vitest';
import { transportOptions } from '../src/mail/mail.service';

describe('mail transport options', () => {
  it('gives up on a silent mail server within seconds, not the minutes of the library defaults', () => {
    const o = transportOptions('smtp://localhost:1025');
    for (const key of ['connectionTimeout', 'greetingTimeout', 'socketTimeout'] as const) {
      expect(o[key]).toBeGreaterThan(0);
      expect(o[key]).toBeLessThanOrEqual(15_000);
    }
  });

  it('keeps the connection url', () => {
    expect(transportOptions('smtp://user:pw@mail.example:587').url).toBe(
      'smtp://user:pw@mail.example:587',
    );
  });
});
