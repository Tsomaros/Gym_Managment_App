import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/main';

describe('login throttling', () => {
  const run = randomUUID().slice(0, 8);
  let app: INestApplication;

  const login = (email: string) =>
    request(app.getHttpServer()).post('/auth/login').send({ email, password: 'wrong password' });

  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers the 6th wrong login for one email within 60 s with 429; another email still gets 401', async () => {
    const email = `target-${run}@x.gr`;
    for (let i = 0; i < 5; i++) expect((await login(email)).status).toBe(401);
    expect((await login(email)).status).toBe(429);
    expect((await login(`other-${run}@x.gr`)).status).toBe(401);
  });

  it('counts different spellings of one email together', async () => {
    const email = `spelled-${run}@x.gr`;
    for (let i = 0; i < 5; i++) expect((await login(email)).status).toBe(401);
    expect((await login(`  ${email.toUpperCase()} `)).status).toBe(429);
  });
});
