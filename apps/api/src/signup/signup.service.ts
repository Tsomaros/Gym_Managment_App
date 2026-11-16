import { ConflictException, GoneException, Injectable, Logger } from '@nestjs/common';
import type { Locale, Signup, SignupCodeResponse } from '@gym/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { hashToken, randomToken } from '../auth/opaque-token';
import { hashPassword } from '../auth/password';
import { getEnv } from '../config/env';
import { systemDb } from '../db/client';
import { emailVerifications, gymRoles, signupCodes, users } from '../db/schema';
import { type Tx, withGym } from '../db/tenant';
import { MailService } from '../mail/mail.service';
import { verifyEmailMail } from '../mail/templates/verify-email';
import { generateSignupCode, normaliseSignupCode, SIGNUP_CODE_TTL_MS } from './signup-code';

export const EMAIL_VERIFICATION_TTL_MS = 72 * 3600 * 1000;

const codeGone = () => new GoneException({ message: 'Code invalid or expired' });
const linkGone = () => new GoneException({ message: 'Link invalid or expired' });

export interface SignupResult {
  userId: string;
  isPlatformAdmin: boolean;
  /** True when this sign-up created the account (and set its password). */
  created: boolean;
}

@Injectable()
export class SignupService {
  private readonly logger = new Logger(SignupService.name);

  constructor(
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  /** Reception issues a one-time code for its gym (24 hours, single use, stored hashed). */
  async issueCode(gymId: string, createdBy: string): Promise<SignupCodeResponse> {
    const expiresAt = new Date(Date.now() + SIGNUP_CODE_TTL_MS);
    // 31^8 codes: a clash with a stored hash is very unlikely, but retry rather than fail.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { display, hash } = generateSignupCode();
      const row = await withGym(gymId, async (tx) => {
        const [inserted] = await tx
          .insert(signupCodes)
          .values({ gymId, codeHash: hash, expiresAt, createdBy })
          .onConflictDoNothing({ target: signupCodes.codeHash })
          .returning({ id: signupCodes.id });
        if (inserted) {
          // The code itself is a credential while unused, so it is not in the history.
          await this.audit.record(tx, {
            gymId,
            actorId: createdBy,
            action: 'signup_code.issued',
            entity: 'signup_code',
            entityId: inserted.id,
            data: { expiresAt: expiresAt.toISOString() },
          });
        }
        return inserted;
      });
      if (row) return { code: display, expiresAt: expiresAt.toISOString() };
    }
    throw new Error('Could not generate a unique sign-up code');
  }

  /**
   * Redeems a code. A new email gets an account and the member role, and is sent a confirmation
   * link. An existing account only gains the member role; its password and details are kept, and
   * the caller signs in normally. Unknown, used and expired codes → 410 (one body for all).
   * Already a member of that gym → 409, and the code stays unused.
   */
  async signup(body: Signup): Promise<SignupResult> {
    const code = normaliseSignupCode(body.code);
    if (!code) throw codeGone();
    // Hashed before the transaction so the code's row lock isn't held during argon2.
    const passwordHash = await hashPassword(body.password);

    // No gym is known until the code is read, and users is written: one systemDb transaction.
    const result = await systemDb.transaction(async (tx) => {
      // One statement claims the code: of two simultaneous sign-ups, the second waits for the
      // first to commit, then finds used_at set and gets zero rows.
      const [claimed] = await tx
        .update(signupCodes)
        .set({ usedAt: sql`now()` })
        .where(
          and(
            eq(signupCodes.codeHash, hashToken(code)),
            isNull(signupCodes.usedAt),
            gt(signupCodes.expiresAt, sql`now()`),
          ),
        )
        .returning({ id: signupCodes.id, gymId: signupCodes.gymId });
      if (!claimed) throw codeGone();

      const cols = { id: users.id, isPlatformAdmin: users.isPlatformAdmin, locale: users.locale };
      let created = false;
      let [user] = await tx.select(cols).from(users).where(eq(users.email, body.email));
      if (!user) {
        [user] = await tx
          .insert(users)
          .values({
            email: body.email,
            firstName: body.firstName,
            lastName: body.lastName,
            phone: body.phone,
            dateOfBirth: body.dateOfBirth,
            emergencyContactName: body.emergencyContactName ?? null,
            emergencyContactPhone: body.emergencyContactPhone ?? null,
            passwordHash,
          })
          .onConflictDoNothing({ target: users.email })
          .returning(cols);
        created = !!user;
        // Lost a race with a sign-up for the same email: link to the account it created.
        user ??= (await tx.select(cols).from(users).where(eq(users.email, body.email)))[0];
      }

      const [role] = await tx
        .insert(gymRoles)
        .values({ gymId: claimed.gymId, userId: user!.id, role: 'member' })
        .onConflictDoNothing()
        .returning({ userId: gymRoles.userId });
      // Throwing rolls the whole transaction back, so the code stays unused.
      if (!role) throw new ConflictException({ message: 'Already a member of this gym' });

      await tx.update(signupCodes).set({ usedBy: user!.id }).where(eq(signupCodes.id, claimed.id));
      await this.audit.record(tx, {
        gymId: claimed.gymId,
        actorId: user!.id,
        action: 'member.signed_up',
        entity: 'member',
        entityId: user!.id,
        data: { signupCodeId: claimed.id, existingAccount: !created },
      });

      const verifyToken = created ? await this.storeVerification(tx, user!.id) : undefined;
      return { user: user!, created, verifyToken };
    });

    if (result.verifyToken) {
      await this.sendVerification(
        {
          userId: result.user.id,
          email: body.email,
          firstName: body.firstName,
          locale: result.user.locale as Locale,
        },
        result.verifyToken,
      );
    }
    return {
      userId: result.user.id,
      isPlatformAdmin: result.user.isPlatformAdmin,
      created: result.created,
    };
  }

  /** Confirms the email of the link's account. Single use; used, expired or unknown → 410. */
  async verifyEmail(token: string): Promise<void> {
    await systemDb.transaction(async (tx) => {
      const [v] = await tx
        .update(emailVerifications)
        .set({ usedAt: sql`now()` })
        .where(
          and(
            eq(emailVerifications.tokenHash, hashToken(token)),
            isNull(emailVerifications.usedAt),
            gt(emailVerifications.expiresAt, sql`now()`),
          ),
        )
        .returning({ userId: emailVerifications.userId });
      if (!v) throw linkGone();
      await tx
        .update(users)
        .set({ emailVerifiedAt: sql`now()` })
        .where(and(eq(users.id, v.userId), isNull(users.emailVerifiedAt)));
    });
  }

  /** Sends a new confirmation link; earlier links stop working. No-op once confirmed. */
  async resendVerification(userId: string): Promise<void> {
    const sent = await systemDb.transaction(async (tx) => {
      const [user] = await tx
        .select({
          email: users.email,
          firstName: users.firstName,
          locale: users.locale,
          verifiedAt: users.emailVerifiedAt,
        })
        .from(users)
        .where(eq(users.id, userId));
      if (!user || user.verifiedAt) return undefined;
      await tx
        .update(emailVerifications)
        .set({ usedAt: sql`now()` })
        .where(and(eq(emailVerifications.userId, userId), isNull(emailVerifications.usedAt)));
      return { user, token: await this.storeVerification(tx, userId) };
    });
    if (sent) {
      const { email, firstName, locale } = sent.user;
      await this.sendVerification(
        { userId, email, firstName, locale: locale as Locale },
        sent.token,
      );
    }
  }

  private async storeVerification(tx: Tx, userId: string): Promise<string> {
    const raw = randomToken();
    await tx.insert(emailVerifications).values({
      userId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    });
    return raw;
  }

  /** Never throws: the account exists either way, and the member can ask for a new link. */
  private async sendVerification(
    to: { userId: string; email: string; firstName: string; locale: Locale },
    rawToken: string,
  ): Promise<void> {
    try {
      await this.mail.send(
        verifyEmailMail(to.locale, {
          to: to.email,
          firstName: to.firstName,
          link: `${getEnv().WEB_ORIGIN}/verify-email/${rawToken}`,
        }),
      );
    } catch (err) {
      // The user id, not the address: no personal data in logs.
      this.logger.error(
        `Verification email for user ${to.userId} failed: ${(err as Error).message}`,
      );
    }
  }
}
