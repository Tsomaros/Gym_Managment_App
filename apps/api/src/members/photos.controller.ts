import {
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { MAX_PHOTO_BYTES, PhotosService } from './photos.service';

/** Reception takes or replaces a member's photo (spec §6.0). */
@Controller('gyms/:gymId/members/:memberId/photo')
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  // GymRoles first: the guards run before the interceptor reads the upload body.
  @Put()
  @HttpCode(200)
  @GymRoles('reception')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  async set(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ): Promise<void> {
    if (!file) throw new UnsupportedMediaTypeException('Send the image as multipart field "photo"');
    await this.photos.set(gym.id, req.user!.id, memberId, file.buffer);
  }

  @Delete()
  @HttpCode(204)
  @GymRoles('reception')
  remove(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.photos.remove(gym.id, req.user!.id, memberId);
  }
}
