import { Module } from '@nestjs/common';
import { FreezesController } from './freezes.controller';
import { FreezesService } from './freezes.service';
import { MembershipTypesController } from './membership-types.controller';
import { MembershipTypesService } from './membership-types.service';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [
    MembershipTypesController,
    MembershipsController,
    PaymentsController,
    FreezesController,
  ],
  providers: [MembershipTypesService, MembershipsService, PaymentsService, FreezesService],
  exports: [MembershipTypesService, MembershipsService, PaymentsService],
})
export class MembershipsModule {}
