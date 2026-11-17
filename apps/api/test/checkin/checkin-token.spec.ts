import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signCheckInToken, verifyCheckInToken } from '../../src/checkin/checkin-token';

const SECRET = 'a'.repeat(32);
const ids = {
  memberId: '11111111-1111-4111-8111-111111111111',
  gymId: '22222222-2222-4222-8222-222222222222',
};
const t0 = new Date('2027-05-01T09:00:00Z');
const plus = (s: number) => new Date(t0.getTime() + s * 1000);

/** Replaces the character at `i` with a different valid base64url character. */
function flip(token: string, i: number): string {
  const c = token[i] === 'A' ? 'B' : 'A';
  return token.slice(0, i) + c + token.slice(i + 1);
}

describe('check-in token', () => {
  it('verifies 44 s after signing and is rejected at 46 s', () => {
    const { token } = signCheckInToken(ids, t0, SECRET);
    expect(verifyCheckInToken(token, plus(44), SECRET)).toEqual(ids);
    expect(verifyCheckInToken(token, plus(46), SECRET)).toBeNull();
  });

  it('reports an expiry 45 s after signing', () => {
    expect(signCheckInToken(ids, t0, SECRET).expiresAt).toEqual(plus(45));
  });

  it('is GYM1.<payload>.<sig>', () => {
    const { token } = signCheckInToken(ids, t0, SECRET);
    expect(token).toMatch(/^GYM1\.[\w-]+\.[\w-]+$/);
  });

  it('rejects a token whose payload or signature has one character changed', () => {
    const { token } = signCheckInToken(ids, t0, SECRET);
    const [prefix, payload, sig] = token.split('.') as [string, string, string];
    expect(verifyCheckInToken(`${prefix}.${flip(payload, 5)}.${sig}`, t0, SECRET)).toBeNull();
    expect(verifyCheckInToken(`${prefix}.${payload}.${flip(sig, 5)}`, t0, SECRET)).toBeNull();
  });

  it('rejects the wrong prefix, and garbage without throwing', () => {
    const { token } = signCheckInToken(ids, t0, SECRET);
    expect(verifyCheckInToken(token.replace('GYM1.', 'GYM2.'), t0, SECRET)).toBeNull();
    for (const bad of ['garbage', '', 'GYM1.', 'GYM1..', 'GYM1.%%%.%%%', 'GYM1.e30.AAAA']) {
      expect(verifyCheckInToken(bad, t0, SECRET)).toBeNull();
    }
  });

  it('rejects a token signed with a different secret', () => {
    const { token } = signCheckInToken(ids, t0, 'b'.repeat(32));
    expect(verifyCheckInToken(token, t0, SECRET)).toBeNull();
  });

  it('rejects a correctly signed payload that is not a member/gym/expiry triple', () => {
    const { token } = signCheckInToken(
      { memberId: 5 as unknown as string, gymId: 'x' },
      t0,
      SECRET,
    );
    expect(verifyCheckInToken(token, t0, SECRET)).toBeNull();
  });

  it('is rejected at exactly 45 s (the expiry instant is already too late)', () => {
    const { token } = signCheckInToken(ids, t0, SECRET);
    expect(verifyCheckInToken(token, plus(45), SECRET)).toBeNull();
  });

  // Correctly signed payloads (so only the shape check can reject them).
  const x = Math.floor(plus(45).getTime() / 1000);
  it.each([
    ['gym id is a number', { m: ids.memberId, g: 7, x }],
    ['expiry is a string', { m: ids.memberId, g: ids.gymId, x: String(x) }],
    ['expiry is missing', { m: ids.memberId, g: ids.gymId }],
    ['member id is missing', { g: ids.gymId, x }],
    ['member id is not a UUID', { m: 'not-a-uuid', g: ids.gymId, x }],
    ['gym id is not a UUID', { m: ids.memberId, g: 'x', x }],
    ['payload is null', null],
    ['payload is an array', [ids.memberId, ids.gymId, x]],
  ])('rejects a signed payload where %s', (_name, body) => {
    const head = `GYM1.${Buffer.from(JSON.stringify(body)).toString('base64url')}`;
    const sig = createHmac('sha256', SECRET).update(head).digest('base64url');
    expect(verifyCheckInToken(`${head}.${sig}`, t0, SECRET)).toBeNull();
    // Control: the same construction with a valid body is accepted.
    const ok = `GYM1.${Buffer.from(JSON.stringify({ m: ids.memberId, g: ids.gymId, x })).toString('base64url')}`;
    const okSig = createHmac('sha256', SECRET).update(ok).digest('base64url');
    expect(verifyCheckInToken(`${ok}.${okSig}`, t0, SECRET)).toEqual(ids);
  });
});
