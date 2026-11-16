import { Global, Injectable, Module } from '@nestjs/common';

/** The current instant. Injected so tests can pin "today"; production uses the system clock. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({ providers: [Clock], exports: [Clock] })
export class ClockModule {}
