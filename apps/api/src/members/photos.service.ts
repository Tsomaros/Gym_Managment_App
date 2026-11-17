import {
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { gymRoles, memberPhotos } from '../db/schema';
import { lockMember } from '../memberships/memberships.service';
import { type Tx, withGym } from '../db/tenant';
import { StorageService } from '../storage/storage.service';

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/** The type by the first bytes (never by file name or the type the client claims), or null. */
export function sniffImage(b: Buffer): ImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    b.length >= 12 &&
    b.toString('latin1', 0, 4) === 'RIFF' &&
    b.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

@Injectable()
export class PhotosService {
  private readonly log = new Logger(PhotosService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** Signed links (5 minutes) for the members that have a photo; absent members have none. */
  async urlsFor(tx: Tx, memberIds: readonly string[]): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    if (!memberIds.length) return urls;
    const rows = await tx
      .select({ memberId: memberPhotos.memberId, key: memberPhotos.objectKey })
      .from(memberPhotos)
      .where(inArray(memberPhotos.memberId, [...new Set(memberIds)]));
    await Promise.all(
      rows.map(async (r) => urls.set(r.memberId, await this.storage.signedGetUrl(r.key))),
    );
    return urls;
  }

  /** Replaces the member's photo. The new object is stored first; the old one goes after commit. */
  async set(gymId: string, actorId: string, memberId: string, file: Buffer): Promise<void> {
    const type = sniffImage(file);
    if (!type) throw new UnsupportedMediaTypeException('Only JPEG, PNG or WebP images');

    await this.assertMember(gymId, memberId);
    const key = `gyms/${gymId}/members/${memberId}/${randomUUID()}.jpg`;
    await this.storage.put(key, file, type);

    let oldKey: string | undefined;
    try {
      oldKey = await withGym(gymId, async (tx) => {
        // Two uploads for one member queue here: the second sees the first's row, so it replaces
        // it instead of failing on the primary key, and the first's object is deleted, not orphaned.
        await lockMember(tx, gymId, memberId);
        const [old] = await tx
          .select({ key: memberPhotos.objectKey })
          .from(memberPhotos)
          .where(eq(memberPhotos.memberId, memberId))
          .for('update');
        if (old) {
          await tx
            .update(memberPhotos)
            .set({ objectKey: key, updatedAt: new Date(), updatedBy: actorId })
            .where(eq(memberPhotos.memberId, memberId));
        } else {
          await tx
            .insert(memberPhotos)
            .values({ gymId, memberId, objectKey: key, updatedBy: actorId });
        }
        await this.audit.record(tx, {
          gymId,
          actorId,
          action: 'member.photo_updated',
          entity: 'member',
          entityId: memberId,
          data: { replaced: !!old },
        });
        return old?.key;
      });
    } catch (err) {
      await this.storage.remove(key).catch(() => undefined); // do not leave an orphan
      throw err;
    }
    if (oldKey) await this.removeQuietly(oldKey);
  }

  async remove(gymId: string, actorId: string, memberId: string): Promise<void> {
    const key = await withGym(gymId, async (tx) => {
      const [gone] = await tx
        .delete(memberPhotos)
        .where(eq(memberPhotos.memberId, memberId))
        .returning({ key: memberPhotos.objectKey });
      if (!gone) throw new NotFoundException('No photo');
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'member.photo_removed',
        entity: 'member',
        entityId: memberId,
      });
      return gone.key;
    });
    await this.removeQuietly(key);
  }

  private async assertMember(gymId: string, memberId: string): Promise<void> {
    const [row] = await withGym(gymId, (tx) =>
      tx
        .select({ userId: gymRoles.userId })
        .from(gymRoles)
        .where(and(eq(gymRoles.userId, memberId), eq(gymRoles.role, 'member'))),
    );
    if (!row) throw new NotFoundException({ message: 'Not a member of this gym' });
  }

  /** The row is already updated; a failed delete only leaves an unreachable object behind. */
  private async removeQuietly(key: string): Promise<void> {
    await this.storage
      .remove(key)
      .catch((err: Error) => this.log.warn(`Could not delete ${key}: ${err.message}`));
  }
}
