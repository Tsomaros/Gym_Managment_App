import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  type Payment,
  type PaymentsQuery,
  PaymentsQuerySchema,
  type VoidPayment,
  VoidPaymentSchema,
} from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PaymentsService } from './payments.service';

/** Payments history and voiding are the owner's (spec §5). */
@Controller('gyms/:gymId/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @GymRoles('owner')
  list(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Query(new ZodValidationPipe(PaymentsQuerySchema)) query: PaymentsQuery,
  ): Promise<Payment[]> {
    return this.payments.list(gym.id, query);
  }

  @Post(':paymentId/void')
  @HttpCode(204)
  @GymRoles('owner')
  void(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(VoidPaymentSchema)) body: VoidPayment,
  ): Promise<void> {
    return this.payments.void(gym.id, req.user!.id, paymentId, body.reason);
  }
}
