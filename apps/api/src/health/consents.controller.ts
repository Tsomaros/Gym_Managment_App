import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { type ConsentKind, ConsentKindSchema, type ConsentState } from '@gym/shared';
import type { Response } from 'express';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ConsentsService } from './consents.service';

const kindPipe = new ZodValidationPipe(ConsentKindSchema);

/**
 * Consent to store health data (spec §8). The member grants and withdraws; the member and their
 * trainers read the state (healthAccess). Reception and the owner pass the role guard so
 * healthAccess answers them with 404.
 */
@Controller('gyms/:gymId')
export class ConsentsController {
  constructor(private readonly consents: ConsentsService) {}

  @Get(['members/:memberId/consents', 'me/consents'])
  @GymRoles('member', 'trainer', 'reception')
  state(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', new ParseUUIDPipe({ optional: true })) memberId: string | undefined,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<ConsentState> {
    return this.consents.state(
      gym.id,
      { userId: req.user!.id, roles: gym.roles },
      memberId ?? req.user!.id,
    );
  }

  /** 201 when consent is given now, 200 when it was already in force. */
  @Post('me/consents/:kind')
  @GymRoles('member')
  async grant(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('kind', kindPipe) kind: ConsentKind,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ConsentState> {
    const { state, created } = await this.consents.grant(gym.id, req.user!.id, kind);
    res.status(created ? 201 : 200);
    return state;
  }

  @Delete('me/consents/:kind')
  @HttpCode(204)
  @GymRoles('member')
  withdraw(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('kind', kindPipe) kind: ConsentKind,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.consents.withdraw(gym.id, req.user!.id, kind);
  }
}
