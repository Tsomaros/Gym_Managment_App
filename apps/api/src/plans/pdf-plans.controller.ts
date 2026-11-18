import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_PDF_BYTES, type Plan, type PdfPlanFields, PdfPlanFieldsSchema } from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PdfPlansService } from './pdf-plans.service';

const upload = () => FileInterceptor('file', { limits: { fileSize: MAX_PDF_BYTES, files: 1 } });

/** A trainer with write access uploads or replaces a client's PDF plan (10 MB at most). */
@Controller('gyms/:gymId')
export class PdfPlansController {
  constructor(private readonly pdfs: PdfPlansService) {}

  // GymRoles first: the guards run before the interceptor reads the upload body.
  @Post('members/:memberId/plans/pdf')
  @GymRoles('trainer')
  @UseInterceptors(upload())
  create(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(PdfPlanFieldsSchema)) fields: PdfPlanFields,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ): Promise<Plan> {
    if (!file) throw new UnsupportedMediaTypeException('Send the PDF as multipart field "file"');
    return this.pdfs.create(
      gym.id,
      { userId: req.user!.id, roles: gym.roles },
      memberId,
      file.buffer,
      fields,
    );
  }

  @Put('plans/:planId/pdf')
  @HttpCode(200)
  @GymRoles('trainer')
  @UseInterceptors(upload())
  replace(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ): Promise<Plan> {
    if (!file) throw new UnsupportedMediaTypeException('Send the PDF as multipart field "file"');
    return this.pdfs.replace(
      gym.id,
      { userId: req.user!.id, roles: gym.roles },
      planId,
      file.buffer,
    );
  }
}
