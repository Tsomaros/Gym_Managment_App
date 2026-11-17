import { Injectable } from '@nestjs/common';
import { randomToken } from '../auth/opaque-token';
import { Clock } from '../common/clock';

export const LIVE_TICKET_TTL_MS = 30_000;

/**
 * Single-use stream tickets: EventSource cannot send an Authorization header, so a signed-in
 * user trades their bearer token for a ticket that opens one stream of one gym within 30 s.
 * shortcut: in-memory tickets, use Redis when running more than one API instance
 */
@Injectable()
export class LiveTickets {
  private readonly tickets = new Map<string, { gymId: string; userId: string; expiresAt: number }>();

  constructor(private readonly clock: Clock) {}

  issue(gymId: string, userId: string): string {
    const now = this.clock.now().getTime();
    for (const [t, v] of this.tickets) if (v.expiresAt <= now) this.tickets.delete(t);
    const ticket = randomToken();
    this.tickets.set(ticket, { gymId, userId, expiresAt: now + LIVE_TICKET_TTL_MS });
    return ticket;
  }

  /** True once per ticket, for the gym it was issued for, within its lifetime. */
  consume(ticket: string | undefined, gymId: string): boolean {
    if (!ticket) return false;
    const found = this.tickets.get(ticket);
    if (!found) return false;
    this.tickets.delete(ticket);
    return found.gymId === gymId && found.expiresAt > this.clock.now().getTime();
  }
}
