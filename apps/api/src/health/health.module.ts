import { Module } from '@nestjs/common';
import { ConsentsController } from './consents.controller';
import { ConsentsService } from './consents.service';
import { ProgressPhotosController } from './progress-photos.controller';
import { ProgressPhotosService } from './progress-photos.service';
import { MeasurementsController } from './measurements.controller';
import { MeasurementsService } from './measurements.service';

/** A member's health data: consent and body measurements (progress photos are added to it too). */
@Module({
  controllers: [ConsentsController, MeasurementsController, ProgressPhotosController],
  providers: [ConsentsService, MeasurementsService, ProgressPhotosService],
  exports: [ConsentsService],
})
export class HealthDataModule {}
