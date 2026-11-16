import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, systemDb } from '../../src/db/client';
import { users } from '../../src/db/schema';

describe('person details on users', () => {
  const run = randomUUID().slice(0, 8);

  afterAll(async () => {
    await systemDb.delete(users).where(eq(users.email, `person-${run}@example.com`));
    await closeDb();
  });

  it('derives full_name from first and last name, and stores the optional details', async () => {
    const [row] = await systemDb
      .insert(users)
      .values({
        email: `person-${run}@example.com`,
        firstName: 'Γιώργος',
        lastName: 'Παπαδόπουλος',
        phone: '+306912345678',
        dateOfBirth: '1990-05-17',
        emergencyContactName: 'Μαρία Παπαδοπούλου',
        emergencyContactPhone: '+306987654321',
      })
      .returning();
    expect(row).toMatchObject({
      fullName: 'Γιώργος Παπαδόπουλος',
      phone: '+306912345678',
      dateOfBirth: '1990-05-17',
      emergencyContactName: 'Μαρία Παπαδοπούλου',
      emergencyContactPhone: '+306987654321',
      emailVerifiedAt: null,
    });
  });

  it('keeps full_name in step when the name changes', async () => {
    const [row] = await systemDb
      .update(users)
      .set({ lastName: 'Νικολάου' })
      .where(eq(users.email, `person-${run}@example.com`))
      .returning({ fullName: users.fullName });
    expect(row?.fullName).toBe('Γιώργος Νικολάου');

    const [again] = await systemDb
      .update(users)
      .set({ firstName: 'Νίκος' })
      .where(eq(users.email, `person-${run}@example.com`))
      .returning({ fullName: users.fullName });
    expect(again?.fullName).toBe('Νίκος Νικολάου');
  });

  it('has no trailing space in full_name when the last name is empty (backfilled one-word names)', async () => {
    const [row] = await systemDb
      .update(users)
      .set({ firstName: 'Μαρία', lastName: '' })
      .where(eq(users.email, `person-${run}@example.com`))
      .returning({ fullName: users.fullName });
    expect(row?.fullName).toBe('Μαρία');
  });
});
