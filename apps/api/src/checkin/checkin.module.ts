import { Module } from '@nestjs/common';
import { MemberCheckInController } from './member-checkin.controller';

@Module({ controllers: [MemberCheckInController] })
export class CheckInModule {}
