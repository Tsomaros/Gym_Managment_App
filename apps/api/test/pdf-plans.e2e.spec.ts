import { randomUUID } from 'node:crypto';
import net from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuditPage, MembershipType, Plan, PlanSummary } from '@gym/shared';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/auth/tokens';
import { Clock } from '../src/common/clock';
import { systemDb } from '../src/db/client';
import {
  auditLog,
  gymRoles,
  gyms,
  memberships,
  membershipTypes,
  memberTrainers,
  payments,
  plans,
  trainerCovers,
  users,
} from '../src/db/schema';
import { configureApp } from '../src/main';
import { StorageService } from '../src/storage/storage.service';
import { useTestDatabase } from './test-env';

useTestDatabase(); // loads .env so S3_ENDPOINT is known before the reachability check

/** True when something listens on the S3 endpoint (MinIO from docker compose). */
async function s3Reachable(): Promise<boolean> {
  const url = new URL(process.env.S3_ENDPOINT ?? 'http://localhost:9000');
  return new Promise((resolve) => {
    const socket = net.connect({ host: url.hostname, port: Number(url.port) || 80 });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** Not a real PDF: the server checks the first bytes, not that the file renders. */
const pdf = (size = 200, fill = 7): Buffer => {
  const b = Buffer.alloc(size, fill);
  Buffer.from('%PDF-1.7\n').copy(b);
  return b;
};
const png = (): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 2),
  ]);
const MB = 1024 * 1024;
const DAY = '2027-05-12';

describe('PDF workout plans (MinIO)', () => {
  let reachable = false;
  /** Skips with a reason when nothing listens on S3_ENDPOINT (CI has no MinIO). */
  const s3it = (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx) => {
      if (!reachable) ctx.skip('nothing listens on S3_ENDPOINT: run `docker compose up -d`');
      await fn();
    });
  const run = randomUUID().slice(0, 8);
  const clock = {
    current: new Date(`${DAY}T09:00:00Z`),
    now() {
      return this.current;
    },
  };
  let app: INestApplication;
  let storage: StorageService;
  let gymId: string;
  let withTrainer: MembershipType;
  const tok: Record<string, string> = {};
  const id: Record<string, string> = {};
  const server = () => app.getHttpServer();
  const req = (method: 'get' | 'post' | 'put', path: string, who: string) =>
    request(server())[method](`/gyms/${gymId}${path}`).auth(tok[who]!, { type: 'bearer' });

  async function person(key: string, roles: string[]): Promise<void> {
    const [u] = await systemDb
      .insert(users)
      .values({ email: `${key.toLowerCase()}-${run}@x.gr`, firstName: key, lastName: 'Test' })
      .returning({ id: users.id });
    id[key] = u!.id;
    tok[key] = signAccessToken({ sub: u!.id, adm: false });
    await systemDb
      .insert(gymRoles)
      .values(roles.map((role) => ({ gymId, userId: u!.id, role }) as never));
  }
  const upload = (
    who: string,
    member: string,
    file: Buffer,
    fields: Record<string, string> = {},
    filename = 'plan.pdf',
  ) => {
    const r = request(server())
      .post(`/gyms/${gymId}/members/${id[member]}/plans/pdf`)
      .auth(tok[who]!, { type: 'bearer' })
      .field('title', fields.title ?? 'Πρόγραμμα PDF');
    if (fields.activate) r.field('activate', fields.activate);
    return r.attach('file', file, { filename, contentType: 'application/pdf' });
  };
  const replace = (who: string, planId: string, file: Buffer, filename = 'new.pdf') =>
    request(server())
      .put(`/gyms/${gymId}/plans/${planId}/pdf`)
      .auth(tok[who]!, { type: 'bearer' })
      .attach('file', file, { filename, contentType: 'application/pdf' });
  const download = async (url: string) => {
    const res = await fetch(url);
    return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
  };
  const keyOf = async (planId: string) =>
    (await systemDb.select().from(plans).where(eq(plans.id, planId)))[0]!.pdfObjectKey;

  beforeAll(async () => {
    reachable = await s3Reachable();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: ['error', 'warn'] }));
    await app.init();
    storage = app.get(StorageService);
    const [g] = await systemDb
      .insert(gyms)
      .values({ name: `Pdf plans ${run}`, timezone: 'Europe/Athens' })
      .returning({ id: gyms.id });
    gymId = g!.id;
    await person('owner', ['owner']);
    await person('rec', ['reception']);
    await person('t', ['trainer']);
    await person('u', ['trainer']);
    await person('m', ['member']);
    await person('n', ['member']);
    withTrainer = (
      await req('post', '/membership-types', 'owner')
        .send({
          name: 'Με γυμναστή',
          kind: 'time',
          durationMonths: 1,
          priceCents: 4000,
          maxFreezeDays: 0,
          includesTrainer: true,
        })
        .expect(201)
    ).body as MembershipType;
    for (const m of ['m', 'n']) {
      await req('post', `/members/${id[m]}/memberships`, 'rec')
        .send({ typeId: withTrainer.id, amountCents: 4000, method: 'cash' })
        .expect(201);
      await req('put', `/members/${id[m]}/trainer`, 'rec').send({ trainerId: id.t }).expect(200);
    }
  });

  beforeEach(() => {
    clock.current = new Date(`${DAY}T09:00:00Z`);
  });

  afterAll(async () => {
    if (gymId) {
      const rows = await systemDb.select().from(plans).where(eq(plans.gymId, gymId));
      for (const r of rows)
        if (r.pdfObjectKey) await storage.remove(r.pdfObjectKey).catch(() => undefined);
      await systemDb.delete(plans).where(eq(plans.gymId, gymId));
      await systemDb.delete(auditLog).where(eq(auditLog.gymId, gymId));
      await systemDb.delete(trainerCovers).where(eq(trainerCovers.gymId, gymId));
      await systemDb.delete(memberTrainers).where(eq(memberTrainers.gymId, gymId));
      await systemDb.delete(payments).where(eq(payments.gymId, gymId));
      await systemDb.delete(memberships).where(eq(memberships.gymId, gymId));
      await systemDb.delete(membershipTypes).where(eq(membershipTypes.gymId, gymId));
      await systemDb.delete(gymRoles).where(eq(gymRoles.gymId, gymId));
      await systemDb.delete(gyms).where(eq(gyms.id, gymId));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  s3it(
    'uploads a PDF and activates it: the member gets a signed link that returns the same bytes',
    async () => {
      const file = pdf(1500, 9);
      const res = await upload('t', 'm', file, {
        title: 'Πρόγραμμα Νοεμβρίου',
        activate: 'true',
      }).expect(201);
      const plan = res.body as Plan;
      expect(plan).toMatchObject({
        kind: 'pdf',
        status: 'active',
        title: 'Πρόγραμμα Νοεμβρίου',
        memberId: id.m,
        authorId: id.t,
        isTemplate: false,
        days: [],
      });
      expect(plan.pdfUrl).toMatch(/^https?:\/\//);
      const key = (await keyOf(plan.id))!;
      expect(key).toMatch(new RegExp(`^gyms/${gymId}/plans/${plan.id}/[0-9a-f-]{36}\\.pdf$`));

      const mine = (await req('get', '/me/plans/active', 'm').expect(200)).body as Plan;
      expect(mine.id).toBe(plan.id);
      const got = await download(mine.pdfUrl!);
      expect(got.status).toBe(200);
      expect(got.bytes.equals(file)).toBe(true);
      // Every read hands out a signed link that expires after 5 minutes.
      const again = (await req('get', `/plans/${plan.id}`, 't').expect(200)).body as Plan;
      for (const url of [mine.pdfUrl!, again.pdfUrl!]) {
        expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('300');
      }
      // The summary list never carries a link.
      const list = (await req('get', `/members/${id.m}/plans`, 't').expect(200))
        .body as PlanSummary[];
      expect(JSON.stringify(list)).not.toContain('X-Amz');
    },
  );

  s3it('without activate the PDF plan is a draft the member cannot see', async () => {
    const plan = (await upload('t', 'n', pdf()).expect(201)).body as Plan;
    expect(plan.status).toBe('draft');
    await req('get', `/plans/${plan.id}`, 'n').expect(404);
    await req('post', `/plans/${plan.id}/activate`, 't').expect(200);
    const seen = (await req('get', '/me/plans/active', 'n').expect(200)).body as Plan;
    expect(seen.pdfUrl).not.toBeNull();
  });

  s3it(
    'rejects what is not a PDF (415) and anything over 10 MB (413), and accepts exactly 10 MB',
    async () => {
      const before = await systemDb.select().from(plans).where(eq(plans.memberId, id.m!));
      await upload('t', 'm', png(), {}, 'plan.pdf').expect(415); // a PNG renamed .pdf
      await upload('t', 'm', Buffer.from('hello'), {}, 'plan.pdf').expect(415);
      await upload('t', 'm', pdf(10 * MB + 100_000)).expect(413);
      await upload('t', 'm', pdf(10 * MB + 1)).expect(413);
      await request(server())
        .post(`/gyms/${gymId}/members/${id.m}/plans/pdf`)
        .auth(tok.t!, { type: 'bearer' })
        .field('title', 'Χωρίς αρχείο')
        .expect(415);
      await request(server())
        .post(`/gyms/${gymId}/members/${id.m}/plans/pdf`)
        .auth(tok.t!, { type: 'bearer' })
        .attach('file', pdf(), { filename: 'a.pdf', contentType: 'application/pdf' })
        .expect(400); // no title
      const after = await systemDb.select().from(plans).where(eq(plans.memberId, id.m!));
      expect(after).toHaveLength(before.length); // nothing was created
      const exact = (await upload('t', 'm', pdf(10 * MB), { title: 'Ακριβώς 10 MB' }).expect(201))
        .body as Plan;
      expect((await download(exact.pdfUrl!)).bytes.length).toBe(10 * MB);
    },
  );

  s3it('replacing the PDF deletes the old object after the change is saved', async () => {
    const first = pdf(500, 3);
    const plan = (await upload('t', 'n', first, { title: 'Αντικατάσταση' }).expect(201))
      .body as Plan;
    const oldKey = (await keyOf(plan.id))!;
    const oldUrl = await storage.signedGetUrl(oldKey);
    expect((await download(oldUrl)).status).toBe(200);

    const second = pdf(700, 4);
    const res = await replace('t', plan.id, second).expect(200);
    const updated = res.body as Plan;
    const newKey = (await keyOf(plan.id))!;
    expect(newKey).not.toBe(oldKey);
    expect(newKey).toMatch(new RegExp(`^gyms/${gymId}/plans/${plan.id}/`));
    expect((await download(updated.pdfUrl!)).bytes.equals(second)).toBe(true);
    expect((await download(oldUrl)).status).toBe(404);

    // A rejected replacement changes nothing.
    await replace('t', plan.id, png()).expect(415);
    expect(await keyOf(plan.id)).toBe(newKey);
    const page = (
      await req('get', `/audit?entity=plan&entityId=${plan.id}&limit=50`, 'owner').expect(200)
    ).body as AuditPage;
    expect(page.entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['plan.created', 'plan.updated']),
    );
    expect(JSON.stringify(page.entries.map((e) => e.data))).not.toContain(newKey);
  });

  s3it('a cover trainer can open the PDF but cannot upload or replace one', async () => {
    const plan = (await upload('t', 'm', pdf(300, 5), { title: 'Για κάλυψη' }).expect(201))
      .body as Plan;
    await systemDb
      .insert(trainerCovers)
      .values({ gymId, memberId: id.m!, trainerId: id.u!, date: DAY });
    try {
      const seen = (await req('get', `/plans/${plan.id}`, 'u').expect(200)).body as Plan;
      expect(seen.pdfUrl).not.toBeNull();
      expect((await download(seen.pdfUrl!)).status).toBe(200);
      await upload('u', 'm', pdf()).expect(403);
      await replace('u', plan.id, pdf()).expect(403);
    } finally {
      await systemDb.delete(trainerCovers).where(eq(trainerCovers.gymId, gymId));
    }
    // Once the cover is gone there is no access, and nothing leaks about the plan.
    await upload('u', 'm', pdf()).expect(404);
    await replace('u', plan.id, pdf()).expect(404);
    await req('get', `/plans/${plan.id}`, 'u').expect(404);
  });

  s3it(
    'only the trainer with write access uploads; the member, reception and the owner cannot',
    async () => {
      await upload('m', 'm', pdf()).expect(403);
      await upload('rec', 'm', pdf()).expect(403);
      await upload('owner', 'm', pdf()).expect(403);
      const plan = (await upload('t', 'm', pdf(), { title: 'Δικό μου' }).expect(201)).body as Plan;
      await replace('m', plan.id, pdf()).expect(403);
      await replace('rec', plan.id, pdf()).expect(403);
      // A user without a member role in this gym is not a member to upload for.
      await upload('t', 't', pdf()).expect(404);
    },
  );

  s3it(
    'replace needs a PDF plan that is not archived; an interactive plan cannot be replaced or edited as a PDF',
    async () => {
      const plan = (await upload('t', 'm', pdf(), { title: 'Αρχειοθετείται' }).expect(201))
        .body as Plan;
      await req('post', `/plans/${plan.id}/archive`, 't').expect(204);
      await replace('t', plan.id, pdf()).expect(409);
      const interactive = (
        await req('post', `/members/${id.m}/plans`, 't')
          .send({ title: 'Διαδραστικό', days: [{ title: 'Α', exercises: [] }] })
          .expect(201)
      ).body as Plan;
      await replace('t', interactive.id, pdf()).expect(409);
      // And a PDF plan is not editable as an interactive one.
      const pdfPlan = (await upload('t', 'm', pdf(), { title: 'PDF' }).expect(201)).body as Plan;
      await req('put', `/plans/${pdfPlan.id}`, 't')
        .send({ title: 'Χ', days: [{ title: 'Α', exercises: [] }] })
        .expect(409);
    },
  );
});
