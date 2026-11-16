import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, type ThrottlerStorageService } from '@nestjs/throttler';

/**
 * Forgets every throttle counter of `app`, for suites that sign in more often than a person would.
 * onApplicationShutdown is the in-memory store's public way to clear all hits.
 */
export function resetThrottle(app: INestApplication): void {
  app.get<ThrottlerStorageService>(ThrottlerStorage).onApplicationShutdown();
}
