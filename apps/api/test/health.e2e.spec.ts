import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/main';

describe('GET /health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('responds 200 with { status: "ok" }', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('does not answer on other paths (the route is exactly /health)', async () => {
    expect((await request(app.getHttpServer()).get('/healthz')).status).toBe(404);
    expect((await request(app.getHttpServer()).get('/')).status).toBe(404);
  });
});
