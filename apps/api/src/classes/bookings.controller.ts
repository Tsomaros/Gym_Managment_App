import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { type Attendee, type BookingView, type CreateBooking, CreateBookingSchema } from '@gym/shared';
import { z } from 'zod';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BookingsService } from './bookings.service';

const UpcomingQuerySchema = z.object({
  upcoming: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

@Controller('gyms/:gymId')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /** A member books themselves; reception books for the member named in the body. */
  @Post('class-sessions/:id/bookings')
  @GymRoles('member', 'reception')
  book(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(CreateBookingSchema)) body: CreateBooking,
  ) {
    const staff = gym.roles.includes('reception') || gym.roles.includes('owner');
    if (body.memberId && body.memberId !== req.user!.id && !staff) throw new ForbiddenException();
    const memberId = staff && body.memberId ? body.memberId : req.user!.id;
    // A staff caller without a member role must name the member.
    if (!body.memberId && !gym.roles.includes('member')) throw new ForbiddenException();
    return this.bookings.book(gym.id, req.user!.id, id, memberId);
  }

  @Delete('me/bookings/:id')
  @GymRoles('member')
  cancelOwn(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ) {
    return this.bookings.cancelOwn(gym.id, req.user!.id, id);
  }

  @Get('me/bookings')
  @GymRoles('member')
  mine(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Query(new ZodValidationPipe(UpcomingQuerySchema)) q: z.infer<typeof UpcomingQuerySchema>,
  ): Promise<BookingView[]> {
    return this.bookings.mine(gym.id, req.user!.id, q.upcoming);
  }

  @Delete('bookings/:id')
  @HttpCode(204)
  @GymRoles('reception')
  async cancelByStaff(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.bookings.cancelByStaff(gym.id, req.user!.id, id);
  }

  @Get('class-sessions/:id/attendees')
  @GymRoles('trainer', 'reception')
  attendees(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<Attendee[]> {
    return this.bookings.attendees(gym.id, req.user!.id, gym.roles, id);
  }
}
