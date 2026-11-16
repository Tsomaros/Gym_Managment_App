import { describe, expect, it } from 'vitest';
import {
  CreateGymSchema,
  InviteSchema,
  makeDateOfBirthSchema,
  personNameSchema,
  phoneSchema,
} from '../src/index.js';

describe('phoneSchema', () => {
  it.each([
    ['69 1234 5678', '+306912345678'], // Greek mobile without country code
    ['2634012345', '+302634012345'], // Greek landline without country code
    ['0044 7700 900123', '+447700900123'], // 00 international prefix
    ['+30 691-234-5678', '+306912345678'], // dashes and spaces
    ['(+30) 6912345678', '+306912345678'], // brackets
    ['0030 691 234 5678', '+306912345678'], // 00 prefix with Greek country code: no double +30
    ['+12345678', '+12345678'], // 8 digits: shortest valid
    ['+123456789012345', '+123456789012345'], // 15 digits: longest valid
  ])('normalises %j to %j', (input, expected) => {
    expect(phoneSchema.parse(input)).toBe(expected);
  });

  it.each([
    '12345', // too short, no country code
    '6912345678 ext 2', // letters
    '+0123456789', // country code cannot start with 0
    '691234567', // 9 digits starting with 69: not a Greek number and no country code
    '69123456789', // 11 digits starting with 69: only 10-digit numbers get +30
    '3012345678', // 10 digits not starting with 69 or 2: no +30, no country code
    '+1234567', // 7 digits after +: one short of the E.164 minimum of 8
    '+1234567890123456', // 16 digits: one over the maximum of 15
    '',
  ])('rejects %j', (input) => {
    expect(phoneSchema.safeParse(input).success).toBe(false);
  });
});

describe('makeDateOfBirthSchema (today 2026-11-16)', () => {
  const dob = makeDateOfBirthSchema('2026-11-16');

  it('rejects a date in the future', () => {
    expect(dob.safeParse('2026-11-17').success).toBe(false);
  });

  it('accepts today and exactly 110 years ago, rejects the day before that', () => {
    expect(dob.safeParse('2026-11-16').success).toBe(true);
    expect(dob.safeParse('1916-11-16').success).toBe(true);
    expect(dob.safeParse('1916-11-15').success).toBe(false);
  });

  it('rejects a calendar date that does not exist, and other formats', () => {
    expect(dob.safeParse('1990-02-30').success).toBe(false);
    expect(dob.safeParse('1990-2-3').success).toBe(false);
    expect(dob.safeParse('03/02/1990').success).toBe(false);
  });

  it('accepts 29 February in a leap year only', () => {
    expect(dob.safeParse('1992-02-29').success).toBe(true);
    expect(dob.safeParse('1991-02-29').success).toBe(false);
  });
});

describe('personNameSchema', () => {
  it('trims a Greek name', () => {
    expect(personNameSchema.parse('  Γιώργος ')).toBe('Γιώργος');
  });

  it('rejects an empty or blank name and one over 60 characters', () => {
    expect(personNameSchema.safeParse('').success).toBe(false);
    expect(personNameSchema.safeParse('   ').success).toBe(false);
    expect(personNameSchema.safeParse('α'.repeat(60)).success).toBe(true);
    expect(personNameSchema.safeParse('α'.repeat(61)).success).toBe(false);
  });
});

describe('invitation and gym creation take first and last name', () => {
  it('InviteSchema requires firstName and lastName', () => {
    const ok = InviteSchema.parse({
      email: 'a@x.gr',
      firstName: ' Μαρία ',
      lastName: 'Νικολάου',
      roles: ['member'],
    });
    expect(ok).toMatchObject({ firstName: 'Μαρία', lastName: 'Νικολάου' });
    const base = { email: 'a@x.gr', roles: ['member'] };
    expect(InviteSchema.safeParse({ ...base, firstName: 'Μαρία' }).success).toBe(false);
    expect(InviteSchema.safeParse({ ...base, lastName: 'Νικολάου' }).success).toBe(false);
    expect(
      InviteSchema.safeParse({ email: 'a@x.gr', fullName: 'Μαρία Νικολάου', roles: ['member'] })
        .success,
    ).toBe(false);
  });

  it('CreateGymSchema requires ownerFirstName and ownerLastName', () => {
    const ok = CreateGymSchema.parse({
      name: 'Gym',
      ownerEmail: 'o@x.gr',
      ownerFirstName: 'Νίκος',
      ownerLastName: 'Αλεξίου',
    });
    expect(ok).toMatchObject({ ownerFirstName: 'Νίκος', ownerLastName: 'Αλεξίου' });
    expect(
      CreateGymSchema.safeParse({ name: 'Gym', ownerEmail: 'o@x.gr', ownerFullName: 'Νίκος' })
        .success,
    ).toBe(false);
    // Each name is required on its own.
    const base = { name: 'Gym', ownerEmail: 'o@x.gr' };
    expect(CreateGymSchema.safeParse({ ...base, ownerFirstName: 'Νίκος' }).success).toBe(false);
    expect(CreateGymSchema.safeParse({ ...base, ownerLastName: 'Αλεξίου' }).success).toBe(false);
  });
});
