import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AcceptInvite, GymRole, Invite, InvitePreview, Locale } from '@gym/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { GymContext } from '../access/gym-context';
import { AuditService } from '../audit/audit.service';
import { hashToken, randomToken } from '../auth/opaque-token';
import { hashPassword } from '../auth/password';
import { getEnv } from '../config/env';
import { systemDb } from '../db/client';
import { gymRoles, gyms, invitations, refreshTokens, users } from '../db/schema';
import { type Tx, withGym } from '../db/tenant';
import { MailService } from '../mail/mail.service';
import { inviteMail } from '../mail/templates/invite';

export const INVITE_TTL_MS = 72 * 3600 * 1000;

export interface NewInvitation {
  gymId: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: GymRole[];
  invitedBy: string;
}

export interface AcceptResult {
  userId: string;
  isPlatformAdmin: boolean;
  /** True when this acceptance created the account (and set its password). */
  created: boolean;
}

/** Roles reception may hand out; anything else needs the owner (spec §5). */
const RECEPTION_MAY_INVITE: readonly GymRole[] = ['member'];

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Stores an invitation inside `tx` (withGym, or systemDb when the gym is being created).
   * A pending invitation for the same gym and email is replaced, which invalidates its old link.
   * With `memberInvitesOnly`, only a pending member-only invitation may be replaced (409 otherwise),
   * so reception can't downgrade or cancel an owner's pending staff invitation.
   */
  async issue(
    tx: Tx,
    inv: NewInvitation,
    opts: { memberInvitesOnly?: boolean } = {},
  ): Promise<{ id: string; rawToken: string }> {
    const rawToken = randomToken();
    const fresh = {
      firstName: inv.firstName,
      lastName: inv.lastName,
      roles: inv.roles,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      invitedBy: inv.invitedBy,
    };
    const [row] = await tx
      .insert(invitations)
      .values({ gymId: inv.gymId, email: inv.email, ...fresh })
      .onConflictDoUpdate({
        target: [invitations.gymId, invitations.email],
        targetWhere: sql`${invitations.acceptedAt} is null`,
        set: { ...fresh, createdAt: sql`now()` },
        setWhere: opts.memberInvitesOnly
          ? sql`${invitations.roles} <@ array['member']::text[]`
          : undefined,
      })
      .returning({ id: invitations.id });
    if (!row) throw new ConflictException('A staff invitation for this email is pending');
    await this.audit.record(tx, {
      gymId: inv.gymId,
      actorId: inv.invitedBy,
      action: 'invitation.sent',
      entity: 'invitation',
      entityId: row.id,
      // No email: history can't be erased, and the invitation row (entityId) holds it.
      data: { roles: inv.roles },
    });
    return { id: row.id, rawToken };
  }

  /**
   * Emails the invite link in the invitee's language (their account's, else Greek).
   * Returns false instead of throwing when sending fails: the invitation is already stored and
   * can be sent again by re-inviting.
   */
  async sendInviteMail(inv: {
    email: string;
    firstName: string;
    gymName: string;
    rawToken: string;
  }): Promise<boolean> {
    try {
      const [existing] = await systemDb
        .select({ locale: users.locale })
        .from(users)
        .where(eq(users.email, inv.email));
      const locale = (existing?.locale ?? 'el') as Locale;
      await this.mail.send(
        inviteMail(locale, {
          to: inv.email,
          firstName: inv.firstName,
          gymName: inv.gymName,
          link: `${getEnv().WEB_ORIGIN}/invite/${inv.rawToken}`,
        }),
      );
      return true;
    } catch (err) {
      this.logger.error(`Invite email to ${inv.email} failed: ${(err as Error).message}`);
      return false;
    }
  }

  async invite(
    gym: GymContext,
    invitedBy: string,
    body: Invite,
  ): Promise<{ invitationId: string; mailSent: boolean }> {
    const isOwner = gym.roles.includes('owner');
    if (!isOwner && body.roles.some((r) => !RECEPTION_MAY_INVITE.includes(r))) {
      throw new ForbiddenException('Reception may only invite members');
    }

    const { id, rawToken, gymName } = await withGym(gym.id, async (tx) => {
      const [g] = await tx.select({ name: gyms.name }).from(gyms).where(eq(gyms.id, gym.id));
      const issued = await this.issue(
        tx,
        { gymId: gym.id, invitedBy, ...body },
        { memberInvitesOnly: !isOwner },
      );
      return { ...issued, gymName: g!.name };
    });
    const mailSent = await this.sendInviteMail({
      email: body.email,
      firstName: body.firstName,
      gymName,
      rawToken,
    });
    return { invitationId: id, mailSent };
  }

  /** Deletes a pending invitation of this gym (its token stops working); 404 if none. */
  async cancel(gymId: string, actorId: string, id: string): Promise<void> {
    await withGym(gymId, async (tx) => {
      const [row] = await tx
        .delete(invitations)
        .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt)))
        .returning({ id: invitations.id, roles: invitations.roles });
      if (!row) throw new NotFoundException();
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'invitation.cancelled',
        entity: 'invitation',
        entityId: id,
        data: { roles: row.roles },
      });
    });
  }

  /** A pending, unexpired invitation by its raw token; 410 otherwise. Token lookup → systemDb. */
  async preview(token: string): Promise<InvitePreview> {
    const [inv] = await systemDb
      .select({
        gymName: gyms.name,
        fullName: sql<string>`${invitations.firstName} || ' ' || ${invitations.lastName}`,
        email: invitations.email,
      })
      .from(invitations)
      .innerJoin(gyms, eq(gyms.id, invitations.gymId))
      .where(
        and(
          eq(invitations.tokenHash, hashToken(token)),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, sql`now()`),
        ),
      );
    if (!inv) throw new GoneException('Invitation is invalid or has expired');
    const [account] = await systemDb
      .select({ verifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.email, inv.email));
    // An unconfirmed account counts as new: accepting sets its password (see accept()).
    return { ...inv, accountExists: !!account?.verifiedAt };
  }

  /**
   * Redeems an invitation. A new email gets an account with this password. An existing account
   * only gains the roles; the password is ignored, and the caller must sign in normally (the link
   * alone never opens a session for an existing account). Single use; expired, used or unknown → 410.
   */
  async accept({ token, password }: AcceptInvite): Promise<AcceptResult> {
    const tokenHash = hashToken(token);
    // A token path: no gym is known until the token is read, and the account may already exist
    // in another gym (invisible to gym_app) or be created here (a users write). So the whole
    // acceptance runs in one systemDb transaction.
    const accepted = await systemDb.transaction(async (tx): Promise<AcceptResult | undefined> => {
      // Claiming and redeeming in one transaction: a double click can't accept twice.
      const [inv] = await tx
        .update(invitations)
        .set({ acceptedAt: sql`now()` })
        .where(
          and(
            eq(invitations.tokenHash, tokenHash),
            isNull(invitations.acceptedAt),
            gt(invitations.expiresAt, sql`now()`),
          ),
        )
        .returning({
          id: invitations.id,
          gymId: invitations.gymId,
          email: invitations.email,
          firstName: invitations.firstName,
          lastName: invitations.lastName,
          roles: invitations.roles,
        });
      if (!inv) return undefined;

      const userCols = {
        id: users.id,
        isPlatformAdmin: users.isPlatformAdmin,
        emailVerifiedAt: users.emailVerifiedAt,
      };
      let created = false;
      let [user] = await tx.select(userCols).from(users).where(eq(users.email, inv.email));
      if (!user) {
        [user] = await tx
          .insert(users)
          .values({
            email: inv.email,
            firstName: inv.firstName,
            lastName: inv.lastName,
            // The emailed link proves the address.
            emailVerifiedAt: sql`now()`,
            passwordHash: await hashPassword(password),
          })
          .onConflictDoNothing({ target: users.email })
          .returning(userCols);
        created = !!user;
        // Lost a race with another acceptance for the same email: use the account it created.
        user ??= (await tx.select(userCols).from(users).where(eq(users.email, inv.email)))[0];
      } else if (!user.emailVerifiedAt) {
        // Nobody ever proved this address, so whoever registered it may not own it. The emailed
        // link does prove it: its holder sets the password, every earlier session ends, and the
        // account is theirs.
        await tx
          .update(users)
          .set({ passwordHash: await hashPassword(password), emailVerifiedAt: sql`now()` })
          .where(eq(users.id, user.id));
        await tx
          .update(refreshTokens)
          .set({ revokedAt: sql`now()` })
          .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
        created = true;
      }

      await tx
        .insert(gymRoles)
        .values(inv.roles.map((role) => ({ gymId: inv.gymId, userId: user!.id, role })))
        .onConflictDoNothing();
      await this.audit.record(tx, {
        gymId: inv.gymId,
        actorId: user!.id,
        action: 'invitation.accepted',
        entity: 'invitation',
        entityId: inv.id,
        data: { roles: inv.roles, newAccount: created },
      });
      return { userId: user!.id, isPlatformAdmin: user!.isPlatformAdmin, created };
    });

    if (!accepted) throw new GoneException('Invitation is invalid or has expired');
    return accepted;
  }
}
