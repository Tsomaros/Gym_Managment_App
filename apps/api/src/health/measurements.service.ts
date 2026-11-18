import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Measurement, MeasurementInput } from '@gym/shared';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { bodyMeasurements } from '../db/schema';
import { withGym } from '../db/tenant';
import { gymToday } from '../memberships/memberships.service';
import { type HealthAccess, healthAccess } from '../workouts/health-access';
import { activeConsent, type Caller, lockConsent } from './consents.service';

type Row = typeof bodyMeasurements.$inferSelect;
const num = (v: string | null) => (v === null ? null : Number(v));
const str = (v: number | null | undefined) => (v == null ? null : String(v));

const toMeasurement = (r: Row): Measurement => ({
  id: r.id,
  measuredOn: r.measuredOn,
  weightKg: num(r.weightKg),
  bodyFatPct: num(r.bodyFatPct),
  waistCm: num(r.waistCm),
  hipsCm: num(r.hipsCm),
  chestCm: num(r.chestCm),
  armCm: num(r.armCm),
  thighCm: num(r.thighCm),
  notes: r.notes,
  recordedBy: r.recordedBy,
});

@Injectable()
export class MeasurementsService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** The caller's access to the member (404 when none), and the gym's today. */
  private async access(
    tx: Parameters<Parameters<typeof withGym>[1]>[0],
    gymId: string,
    caller: Caller,
    memberId: string,
  ): Promise<{ access: HealthAccess; today: string }> {
    const today = await gymToday(tx, gymId, this.clock.now());
    const access = await healthAccess(tx, gymId, caller, memberId, today);
    if (!access.read) throw new NotFoundException();
    return { access, today };
  }

  list(gymId: string, caller: Caller, memberId: string): Promise<Measurement[]> {
    return withGym(gymId, async (tx) => {
      await this.access(tx, gymId, caller, memberId);
      const rows = await tx
        .select()
        .from(bodyMeasurements)
        .where(eq(bodyMeasurements.memberId, memberId))
        .orderBy(desc(bodyMeasurements.measuredOn), desc(bodyMeasurements.createdAt));
      return rows.map(toMeasurement);
    });
  }

  record(
    gymId: string,
    caller: Caller,
    memberId: string,
    input: MeasurementInput,
  ): Promise<Measurement> {
    return withGym(gymId, async (tx) => {
      const { access, today } = await this.access(tx, gymId, caller, memberId);
      if (!access.writeMeasurements) throw new ForbiddenException();
      const day = input.measuredOn ?? today; // the gym's calendar, not the sender's clock
      if (day > today) {
        throw new BadRequestException({ message: 'The measurement day is in the future' });
      }
      // Serialised with a withdrawal: the consent we see is the one still in force at commit.
      await lockConsent(tx, memberId);
      if (!(await activeConsent(tx, memberId, 'measurements'))) {
        throw new ConflictException({ message: 'No consent' });
      }
      const [row] = await tx
        .insert(bodyMeasurements)
        .values({
          gymId,
          memberId,
          measuredOn: day,
          weightKg: str(input.weightKg),
          bodyFatPct: str(input.bodyFatPct),
          waistCm: str(input.waistCm),
          hipsCm: str(input.hipsCm),
          chestCm: str(input.chestCm),
          armCm: str(input.armCm),
          thighCm: str(input.thighCm),
          notes: input.notes ?? null,
          recordedBy: caller.userId,
        })
        .returning();
      // Never the values themselves: the history is read by the owner, who may not see health data.
      await this.audit.record(tx, {
        gymId,
        actorId: caller.userId,
        action: 'measurement.recorded',
        entity: 'measurement',
        entityId: row!.id,
        data: { memberId },
      });
      return toMeasurement(row!);
    });
  }

  remove(gymId: string, caller: Caller, memberId: string, id: string): Promise<void> {
    return withGym(gymId, async (tx) => {
      const { access } = await this.access(tx, gymId, caller, memberId);
      if (!access.writeMeasurements) throw new ForbiddenException();
      const rows = await tx
        .delete(bodyMeasurements)
        .where(and(eq(bodyMeasurements.id, id), eq(bodyMeasurements.memberId, memberId)))
        .returning({ id: bodyMeasurements.id });
      if (!rows[0]) throw new NotFoundException();
      await this.audit.record(tx, {
        gymId,
        actorId: caller.userId,
        action: 'measurement.deleted',
        entity: 'measurement',
        entityId: id,
        data: { memberId },
      });
    });
  }
}
