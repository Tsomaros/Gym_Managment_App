import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  MAX_PROGRESS_PHOTO_BYTES,
  type ProgressPhoto,
  type ProgressPhotoFields,
  ProgressPhotoFieldsSchema,
} from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ProgressPhotosService } from './progress-photos.service';

const callerOf = (req: AppRequest, gym: GymContext) => ({
  userId: req.user!.id,
  roles: gym.roles,
});
const optionalUuid = new ParseUUIDPipe({ optional: true });

/**
 * Progress photos: the member and their primary trainer add and delete, a cover trainer only
 * reads (healthAccess). Reception and the owner pass the role guard so healthAccess answers
 * them with 404; they never see the photos.
 */
@Controller('gyms/:gymId')
export class ProgressPhotosController {
  constructor(private readonly photos: ProgressPhotosService) {}

  @Get(['members/:memberId/progress-photos', 'me/progress-photos'])
  @GymRoles('member', 'trainer', 'reception')
  list(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', optionalUuid) memberId: string | undefined,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<ProgressPhoto[]> {
    return this.photos.list(gym.id, callerOf(req, gym), memberId ?? req.user!.id);
  }

  // GymRoles first: the guards run before the interceptor reads the upload body.
  @Post(['members/:memberId/progress-photos', 'me/progress-photos'])
  @GymRoles('member', 'trainer', 'reception')
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: MAX_PROGRESS_PHOTO_BYTES, files: 1 } }),
  )
  add(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', optionalUuid) memberId: string | undefined,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(ProgressPhotoFieldsSchema)) body: ProgressPhotoFields,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ): Promise<ProgressPhoto> {
    if (!file) throw new UnsupportedMediaTypeException('Send the image as multipart field "photo"');
    return this.photos.add(
      gym.id,
      callerOf(req, gym),
      memberId ?? req.user!.id,
      body.takenOn,
      file.buffer,
    );
  }

  @Delete(['members/:memberId/progress-photos/:id', 'me/progress-photos/:id'])
  @HttpCode(204)
  @GymRoles('member', 'trainer', 'reception')
  remove(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', optionalUuid) memberId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.photos.remove(gym.id, callerOf(req, gym), memberId ?? req.user!.id, id);
  }
}
