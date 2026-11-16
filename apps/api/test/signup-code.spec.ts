import { describe, expect, it } from 'vitest';
import { generateSignupCode, normaliseSignupCode } from '../src/signup/signup-code';
import { hashToken } from '../src/auth/opaque-token';

const DISPLAY = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

describe('generateSignupCode', () => {
  it('produces 1,000 codes that all use only the easy-to-read alphabet, shown as XXXX-XXXX', () => {
    const codes = Array.from({ length: 1000 }, () => generateSignupCode());
    for (const c of codes) expect(c.display).toMatch(DISPLAY);
    // Not a constant: a broken generator returning one code would pass the format check.
    expect(new Set(codes.map((c) => c.raw)).size).toBeGreaterThan(990);
  });

  it('returns the raw code without the dash, and stores only its sha256 hash', () => {
    const c = generateSignupCode();
    expect(c.raw).toBe(c.display.replace('-', ''));
    expect(c.hash).toBe(hashToken(c.raw));
    expect(c.hash).not.toContain(c.raw);
  });
});

describe('normaliseSignupCode', () => {
  it('accepts lower case, the dash and spaces around it', () => {
    expect(normaliseSignupCode(' k7p2-qm9x ')).toBe('K7P2QM9X');
    expect(normaliseSignupCode('k7p2 qm9x')).toBe('K7P2QM9X');
    expect(normaliseSignupCode('K7P2QM9X')).toBe('K7P2QM9X');
  });

  it('rejects characters outside the alphabet (0, O, 1, I, L) and the wrong length', () => {
    expect(normaliseSignupCode('K7P2QM90')).toBeNull();
    expect(normaliseSignupCode('K7P2QMOX')).toBeNull();
    expect(normaliseSignupCode('K7P2QM1X')).toBeNull();
    expect(normaliseSignupCode('K7P2QMIX')).toBeNull();
    expect(normaliseSignupCode('K7P2QMLX')).toBeNull();
    expect(normaliseSignupCode('K7P2QM9')).toBeNull();
    expect(normaliseSignupCode('K7P2QM9XX')).toBeNull();
    expect(normaliseSignupCode('')).toBeNull();
  });
});
