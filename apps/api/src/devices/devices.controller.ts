import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type CreatePairingCode,
  CreatePairingCodeSchema,
  type Device,
  type KioskMe,
  type PairDevice,
  PairDeviceSchema,
  type PairDeviceResponse,
  type PairingCodeResponse,
} from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ThrottlePair } from '../auth/throttle';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentDevice, type CurrentDeviceInfo, DeviceGuard } from './device.guard';
import { DevicesService } from './devices.service';

/** Kiosk tablets: the owner pairs and revokes them; a tablet then acts with its device token. */
@Controller()
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post('gyms/:gymId/devices/pairing-codes')
  @GymRoles('owner')
  createCode(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(CreatePairingCodeSchema)) body: CreatePairingCode,
  ): Promise<PairingCodeResponse> {
    return this.devices.createPairingCode(gym.id, req.user!.id, body.name);
  }

  @Get('gyms/:gymId/devices')
  @GymRoles('owner')
  list(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
  ): Promise<Device[]> {
    return this.devices.list(gym.id);
  }

  @Post('gyms/:gymId/devices/:id/revoke')
  @HttpCode(204)
  @GymRoles('owner')
  revoke(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.devices.revoke(gym.id, req.user!.id, id);
  }

  @Post('kiosk/pair')
  @ThrottlePair()
  pair(
    @Body(new ZodValidationPipe(PairDeviceSchema)) body: PairDevice,
  ): Promise<PairDeviceResponse> {
    return this.devices.pair(body.code);
  }

  @Get('kiosk/me')
  @UseGuards(DeviceGuard)
  me(@CurrentDevice() device: CurrentDeviceInfo): Promise<KioskMe> {
    return this.devices.me(device.id);
  }
}
