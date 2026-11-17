import { Module } from '@nestjs/common';
import { PdfPlansController } from './pdf-plans.controller';
import { PdfPlansService } from './pdf-plans.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  controllers: [PlansController, TemplatesController, PdfPlansController],
  providers: [PlansService, TemplatesService, PdfPlansService],
  exports: [PlansService],
})
export class PlansModule {}
