import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { MAX_PROGRESS_PHOTOS, type ProgressPhoto } from '@gym/shared';
import { and, count, desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { progressPhotos } from '../db/schema';
import { type Tx, withGym } from '../db/tenant';
import { gymToday } from '../memberships/memberships.service';
import { sniffImage } from '../members/photos.service';
import { StorageService } from '../storage/storage.service';
import { type HealthAccess, healthAccess } from '../workouts/health-access';
import { activeConsent, type Caller, lockConsent } from './consents.service';

@Injectable()
export class ProgressPhotosService {
  private readonly log = new Logger(ProgressPhotosService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private async access(
    tx: Tx,
    gymId: string,
    caller: Caller,
    memberId: string,
  ): Promise<{ access: HealthAccess; today: string }> {
    const today = await gymToday(tx, gymId, this.clock.now());
    const access = await healthAccess(tx, gymId, caller, memberId, today);
    if (!access.read) throw new NotFoundException();
    return { access, today };
  }

  /** Newest day first, each with a fresh signed link (5 minutes). The object key never leaves. */
  list(gymId: string, caller: Caller, memberId: string): Promise<ProgressPhoto[]> {
    return withGym(gymId, async (tx) => {
      await this.access(tx, gymId, caller, memberId);
      const rows = await tx
        .select()
        .from(progressPhotos)
        .where(eq(progressPhotos.memberId, memberId))
        .orderBy(desc(progressPhotos.takenOn), desc(progressPhotos.createdAt));
      return Promise.all(
        rows.map(async (r) => ({
          id: r.id,
          takenOn: r.takenOn,
          url: await this.storage.signedGetUrl(r.objectKey, 300),
          uploadedBy: r.uploadedBy,
        })),
      );
    });
  }

  /**
   * Adds a photo for the member (the member or their primary trainer). Checks first so nothing is
   * uploaded for a request that will fail, stores the object, then re-checks consent under the
   * consent lock in the transaction that inserts the row: a photo racing a withdrawal is either
   * deleted with the rest or refused, never left behind.
   */
  async add(
    gymId: string,
    caller: Caller,
    memberId: string,
    requestedDay: string | undefined,
    file: Buffer,
  ): Promise<ProgressPhoto> {
    const takenOn = await withGym(gymId, async (tx) => {
      const { access, today } = await this.access(tx, gymId, caller, memberId);
      if (!access.writePhotos) throw new ForbiddenException();
      // the gym's calendar, not the sender's clock
      const day = requestedDay ?? today;
      if (day > today) {
        throw new BadRequestException({ message: 'The photo day is in the future' });
      }
      if (!(await activeConsent(tx, memberId, 'photos'))) {
        throw new ConflictException({ message: 'No consent' });
      }
      return day;
    });
    const type = sniffImage(file);
    if (!type) throw new UnsupportedMediaTypeException('Only JPEG, PNG or WebP images');

    const key = `gyms/${gymId}/progress/${memberId}/${randomUUID()}.jpg`;
    await this.storage.put(key, file, type);
    let row: typeof progressPhotos.$inferSelect;
    try {
      row = await withGym(gymId, async (tx) => {
        await lockConsent(tx, memberId);
        if (!(await activeConsent(tx, memberId, 'photos'))) {
          throw new ConflictException({ message: 'No consent' });
        }
        // Under the consent lock, so two uploads at once cannot both pass the cap.
        const [{ n } = { n: 0 }] = await tx
          .select({ n: count() })
          .from(progressPhotos)
          .where(eq(progressPhotos.memberId, memberId));
        if (n >= MAX_PROGRESS_PHOTOS) {
          throw new ConflictException({ message: 'Too many photos' });
        }
        const [inserted] = await tx
          .insert(progressPhotos)
          .values({ gymId, memberId, takenOn, objectKey: key, uploadedBy: caller.userId })
          .returning();
        // Never the key: the history is read by the owner, who may not see progress photos.
        await this.audit.record(tx, {
          gymId,
          actorId: caller.userId,
          action: 'progress_photo.added',
          entity: 'progress_photo',
          entityId: inserted!.id,
          data: { memberId },
        });
        return inserted!;
      });
    } catch (err) {
      await this.removeQuietly(key); // do not leave an orphan
      throw err;
    }
    // Outside the try: the row is committed, so a failure here must not delete its object.
    return {
      id: row.id,
      takenOn: row.takenOn,
      url: await this.storage.signedGetUrl(key, 300),
      uploadedBy: row.uploadedBy,
    };
  }

  async remove(gymId: string, caller: Caller, memberId: string, id: string): Promise<void> {
    const key = await withGym(gymId, async (tx) => {
      const { access } = await this.access(tx, gymId, caller, memberId);
      if (!access.writePhotos) throw new ForbiddenException();
      const [gone] = await tx
        .delete(progressPhotos)
        .where(and(eq(progressPhotos.id, id), eq(progressPhotos.memberId, memberId)))
        .returning({ key: progressPhotos.objectKey });
      if (!gone) throw new NotFoundException();
      await this.audit.record(tx, {
        gymId,
        actorId: caller.userId,
        action: 'progress_photo.deleted',
        entity: 'progress_photo',
        entityId: id,
        data: { memberId },
      });
      return gone.key;
    });
    await this.removeQuietly(key);
  }

  /** The row is already gone; a failed delete only leaves an unreachable object behind. */
  async removeQuietly(key: string): Promise<void> {
    await this.storage
      .remove(key)
      .catch((err: Error) => this.log.warn(`Could not delete ${key}: ${err.message}`));
  }
}
