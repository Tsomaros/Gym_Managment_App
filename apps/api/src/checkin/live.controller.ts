import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { LiveTicketResponse } from '@gym/shared';
import type { Response } from 'express';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { CheckInEvents } from './checkin-events';
import { LiveTickets } from './live-tickets';

const PING_MS = 25_000;

/** Server-Sent Events for reception and trainers: each check-in and check-out as it happens. */
@Controller('gyms/:gymId/live')
export class LiveController {
  constructor(
    private readonly tickets: LiveTickets,
    private readonly events: CheckInEvents,
  ) {}

  @Post('tickets')
  @GymRoles('trainer', 'reception')
  ticket(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): LiveTicketResponse {
    return { ticket: this.tickets.issue(gym.id, req.user!.id) };
  }

  /**
   * No bearer token (EventSource cannot send one): the single-use ticket is the credential, and
   * it must have been issued for this gym. Not under @GymRoles; route-guards.spec lists it.
   */
  @Get()
  stream(
    @Param('gymId', ParseUUIDPipe) rawGymId: string,
    @Query('ticket') ticket: string | undefined,
    @Res() res: Response,
  ): void {
    const gymId = rawGymId.toLowerCase();
    if (!this.tickets.consume(ticket, gymId)) throw new UnauthorizedException();

    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx and similar proxies must not buffer the stream
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(': connected\n\n');

    const unsubscribe = this.events.subscribe(gymId, (e) => {
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    });
    const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
    ping.unref();
    // res, not req: it fires when the connection ends or drops, whatever the Node version
    res.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  }
}
