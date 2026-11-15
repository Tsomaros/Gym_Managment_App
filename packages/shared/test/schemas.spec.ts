import { describe, expect, it } from 'vitest';
import {
  AcceptInviteSchema,
  CreateGymSchema,
  emailSchema,
  InviteSchema,
  LoginSchema,
  MeResponseSchema,
} from '../src/index.js';

const greekName = 'Γιώργος Παπαδόπουλος';

describe('emailSchema', () => {
  it('trims and lowercases, so " Maria@Example.com " is maria@example.com', () => {
    expect(emailSchema.parse(' Maria@Example.com ')).toBe('maria@example.com');
  });

  it('rejects a string that is not an email after trimming', () => {
    expect(emailSchema.safeParse('  maria  ').success).toBe(false);
    expect(emailSchema.safeParse('   ').success).toBe(false);
  });
});

describe('emailSchema (hard cases)', () => {
  it('lowercases an all-caps address and strips tabs/newlines around it', () => {
    expect(emailSchema.parse('\t MARIA@EXAMPLE.COM \n')).toBe('maria@example.com');
  });

  it('rejects an address with a space inside, even though the ends are trimmed', () => {
    expect(emailSchema.safeParse(' ma ria@example.com ').success).toBe(false);
  });

  it('rejects an address longer than 254 characters and accepts a 247-character one', () => {
    const label = 'b'.repeat(60);
    const long = `${'a'.repeat(60)}@${label}.${label}.${label}.${label}.com`; // 60+1+4*61+3 = 308
    const ok = `${'a'.repeat(60)}@${label}.${label}.${label}.com`; // 60+1+3*61+3 = 247
    expect(emailSchema.safeParse(long).success).toBe(false);
    expect(emailSchema.safeParse(ok).success).toBe(true);
  });
});

describe('LoginSchema', () => {
  it('normalises the email and keeps the password exactly as typed', () => {
    expect(LoginSchema.parse({ email: ' Maria@Example.com', password: ' pw ' })).toEqual({
      email: 'maria@example.com',
      password: ' pw ',
    });
  });

  it('rejects an empty password', () => {
    expect(LoginSchema.safeParse({ email: 'a@b.gr', password: '' }).success).toBe(false);
  });

  it('caps the password at 256 characters, so login cannot be used to burn argon2 CPU', () => {
    expect(LoginSchema.safeParse({ email: 'a@b.gr', password: 'p'.repeat(256) }).success).toBe(
      true,
    );
    expect(LoginSchema.safeParse({ email: 'a@b.gr', password: 'p'.repeat(257) }).success).toBe(
      false,
    );
  });
});

describe('AcceptInviteSchema', () => {
  it('rejects a 7-character password and accepts an 8-character one', () => {
    expect(AcceptInviteSchema.safeParse({ token: 't', password: '1234567' }).success).toBe(false);
    expect(AcceptInviteSchema.safeParse({ token: 't', password: '12345678' }).success).toBe(true);
  });

  it('rejects an empty token', () => {
    expect(AcceptInviteSchema.safeParse({ token: '', password: '12345678' }).success).toBe(false);
  });

  it('rejects a password longer than 256 characters', () => {
    expect(AcceptInviteSchema.safeParse({ token: 't', password: 'p'.repeat(256) }).success).toBe(
      true,
    );
    expect(AcceptInviteSchema.safeParse({ token: 't', password: 'p'.repeat(257) }).success).toBe(
      false,
    );
  });
});

describe('InviteSchema', () => {
  const valid = { email: 'Giorgos@Example.com ', fullName: greekName, roles: ['member'] };

  it('keeps a Greek full name unchanged and normalises the email', () => {
    const parsed = InviteSchema.parse(valid);
    expect(parsed.fullName).toBe(greekName);
    expect(parsed.email).toBe('giorgos@example.com');
  });

  it('trims the full name and rejects a whitespace-only one', () => {
    expect(InviteSchema.parse({ ...valid, fullName: ` ${greekName}\n` }).fullName).toBe(greekName);
    expect(InviteSchema.safeParse({ ...valid, fullName: '   ' }).success).toBe(false);
  });

  it('rejects an empty role list', () => {
    expect(InviteSchema.safeParse({ ...valid, roles: [] }).success).toBe(false);
  });

  it('rejects a role that is not a gym role', () => {
    expect(InviteSchema.safeParse({ ...valid, roles: ['admin'] }).success).toBe(false);
  });

  it('removes duplicate roles', () => {
    expect(InviteSchema.parse({ ...valid, roles: ['trainer', 'member', 'trainer'] }).roles).toEqual(
      ['trainer', 'member'],
    );
  });

  it('rejects an empty or 121-character full name and accepts 120 characters', () => {
    expect(InviteSchema.safeParse({ ...valid, fullName: '' }).success).toBe(false);
    expect(InviteSchema.safeParse({ ...valid, fullName: 'α'.repeat(121) }).success).toBe(false);
    expect(InviteSchema.safeParse({ ...valid, fullName: 'α'.repeat(120) }).success).toBe(true);
  });
});

describe('CreateGymSchema', () => {
  const valid = {
    name: 'Γυμναστήριο Αθηνών',
    ownerEmail: 'Owner@Example.com',
    ownerFullName: greekName,
  };

  it("defaults the timezone to 'Europe/Athens'", () => {
    expect(CreateGymSchema.parse(valid)).toEqual({
      name: 'Γυμναστήριο Αθηνών',
      timezone: 'Europe/Athens',
      ownerEmail: 'owner@example.com',
      ownerFullName: greekName,
    });
  });

  it('accepts another IANA timezone and rejects a made-up one', () => {
    expect(CreateGymSchema.parse({ ...valid, timezone: 'Europe/Berlin' }).timezone).toBe(
      'Europe/Berlin',
    );
    expect(CreateGymSchema.safeParse({ ...valid, timezone: 'Mars/Olympus' }).success).toBe(false);
  });

  it('accepts UTC but rejects fixed offsets and non-canonical casing', () => {
    expect(CreateGymSchema.parse({ ...valid, timezone: 'UTC' }).timezone).toBe('UTC');
    expect(CreateGymSchema.parse({ ...valid, timezone: 'Asia/Kolkata' }).timezone).toBe(
      'Asia/Kolkata',
    );
    for (const timezone of ['+02:00', '-0500', 'europe/athens', 'EUROPE/ATHENS']) {
      expect(CreateGymSchema.safeParse({ ...valid, timezone }).success, timezone).toBe(false);
    }
  });

  it('trims the gym name and the owner name, and rejects whitespace-only names', () => {
    const parsed = CreateGymSchema.parse({
      ...valid,
      name: '  Γυμναστήριο Αθηνών ',
      ownerFullName: ` ${greekName} `,
    });
    expect(parsed.name).toBe('Γυμναστήριο Αθηνών');
    expect(parsed.ownerFullName).toBe(greekName);
    expect(CreateGymSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
    expect(CreateGymSchema.safeParse({ ...valid, ownerFullName: '   ' }).success).toBe(false);
  });

  it('rejects an empty or 121-character gym name', () => {
    expect(CreateGymSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
    expect(CreateGymSchema.safeParse({ ...valid, name: 'x'.repeat(121) }).success).toBe(false);
  });
});

describe('MeResponseSchema', () => {
  const me = {
    id: '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d',
    email: 'maria@example.com',
    fullName: greekName,
    locale: 'el',
    isPlatformAdmin: false,
    gyms: [
      {
        gymId: '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e',
        gymName: 'Gym',
        roles: ['owner', 'trainer'],
      },
    ],
  };

  it('accepts a user with roles in a gym', () => {
    expect(MeResponseSchema.parse(me)).toEqual(me);
  });

  it('rejects a malformed gym id, a malformed user id and an unknown role', () => {
    expect(MeResponseSchema.safeParse({ ...me, id: 'not-a-uuid' }).success).toBe(false);
    expect(
      MeResponseSchema.safeParse({ ...me, gyms: [{ ...me.gyms[0], gymId: '123' }] }).success,
    ).toBe(false);
    expect(
      MeResponseSchema.safeParse({ ...me, gyms: [{ ...me.gyms[0], roles: ['superuser'] }] })
        .success,
    ).toBe(false);
  });

  it("rejects a locale other than 'el' or 'en'", () => {
    expect(MeResponseSchema.safeParse({ ...me, locale: 'de' }).success).toBe(false);
  });
});
