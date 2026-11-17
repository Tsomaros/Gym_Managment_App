import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  MemberDetail,
  MembersQuery,
  MemberSummary,
  Membership,
  MyMemberships,
} from '@gym/shared';
import { and, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { gymRoles, membershipFreezes, users } from '../db/schema';
import { withGym } from '../db/tenant';
import { toFreeze } from '../memberships/freezes.service';
import { gymToday, membershipsOf } from '../memberships/memberships.service';
import { PaymentsService } from '../memberships/payments.service';
import { memberStatus } from './member-status';

const MAX_RESULTS = 100;

/** Lower case, no accents, final sigma as σ: how names, emails and phones are compared. */
const normalised = (value: SQL) => sql`translate(unaccent(lower(${value})), 'ς', 'σ')`;
/** `%` and `_` typed by the user match themselves, not "anything". */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const memberColumns = {
  userId: users.id,
  firstName: users.firstName,
  lastName: users.lastName,
  email: users.email,
  emailVerifiedAt: users.emailVerifiedAt,
  phone: users.phone,
  dateOfBirth: users.dateOfBirth,
  emergencyContactName: users.emergencyContactName,
  emergencyContactPhone: users.emergencyContactPhone,
  joinedAt: gymRoles.createdAt,
};
interface MemberRow {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  emailVerifiedAt: Date | null;
  phone: string | null;
  dateOfBirth: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  joinedAt: Date;
}

@Injectable()
export class MembersService {
  constructor(
    private readonly clock: Clock,
    private readonly payments: PaymentsService,
  ) {}

  /** Members of the gym (not staff), newest sign-up first, at most 100. */
  async list(gymId: string, q: MembersQuery): Promise<MemberSummary[]> {
    return withGym(gymId, async (tx) => {
      const filters: SQL[] = [eq(gymRoles.role, 'member')];
      if (q.q) {
        const haystack = normalised(
          sql`${users.firstName} || ' ' || ${users.lastName} || ' ' || ${users.email} || ' ' || coalesce(${users.phone}, '')`,
        );
        const needle = normalised(sql`${`%${likeEscape(q.q)}%`}`);
        filters.push(sql`${haystack} like ${needle} escape '\\'`);
      }
      const query = tx
        .select(memberColumns)
        .from(gymRoles)
        .innerJoin(users, eq(users.id, gymRoles.userId))
        .where(and(...filters))
        .orderBy(desc(gymRoles.createdAt), asc(users.id));
      // Status depends on today's date, so it is computed here, not in SQL. Without a status filter
      // only the page is loaded; with one, every match is evaluated first (fine for a gym's size).
      const rows = q.status ? await query : await query.limit(MAX_RESULTS);

      const today = await gymToday(tx, gymId, this.clock.now());
      const byMember = await membershipsOf(
        tx,
        rows.map((r) => r.userId),
        today,
      );
      const summaries = rows.map((r) => this.summary(r, byMember.get(r.userId) ?? []));
      return summaries.filter((s) => !q.status || s.status === q.status).slice(0, MAX_RESULTS);
    });
  }

  /** One member with memberships and freezes; payments only when `withPayments` (owner). */
  async detail(gymId: string, memberId: string, withPayments: boolean): Promise<MemberDetail> {
    const detail = await withGym(gymId, async (tx) => {
      const [row] = await tx
        .select(memberColumns)
        .from(gymRoles)
        .innerJoin(users, eq(users.id, gymRoles.userId))
        .where(and(eq(gymRoles.userId, memberId), eq(gymRoles.role, 'member')));
      if (!row) throw new NotFoundException({ message: 'Not a member of this gym' });

      const today = await gymToday(tx, gymId, this.clock.now());
      const ms = (await membershipsOf(tx, [memberId], today)).get(memberId) ?? [];
      const freezes = ms.length
        ? await tx
            .select()
            .from(membershipFreezes)
            .where(
              inArray(
                membershipFreezes.membershipId,
                ms.map((m) => m.id),
              ),
            )
            .orderBy(desc(membershipFreezes.startsOn))
        : [];
      return {
        ...this.summary(row, ms),
        dateOfBirth: row.dateOfBirth,
        emergencyContactName: row.emergencyContactName,
        emergencyContactPhone: row.emergencyContactPhone,
        memberships: ms,
        freezes: freezes.map(toFreeze),
      };
    });
    const payments = withPayments ? await this.payments.listForMember(gymId, memberId) : [];
    return { ...detail, payments };
  }

  /** The caller's own non-voided memberships in this gym, newest first. */
  async mine(gymId: string, userId: string): Promise<MyMemberships> {
    return withGym(gymId, async (tx) => {
      const today = await gymToday(tx, gymId, this.clock.now());
      const ms = (await membershipsOf(tx, [userId], today)).get(userId) ?? [];
      return { memberships: ms.filter((m) => m.status !== 'voided') };
    });
  }

  private summary(r: MemberRow, ms: Membership[]): MemberSummary {
    return {
      userId: r.userId,
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      emailVerified: r.emailVerifiedAt !== null,
      phone: r.phone,
      joinedAt: r.joinedAt.toISOString(),
      ...memberStatus(ms),
    };
  }
}
