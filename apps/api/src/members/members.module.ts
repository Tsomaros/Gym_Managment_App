import { Module } from '@nestjs/common';
import { MembershipsModule } from '../memberships/memberships.module';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';

@Module({
  imports: [MembershipsModule],
  controllers: [MembersController, PhotosController],
  providers: [MembersService, PhotosService],
  exports: [PhotosService],
})
export class MembersModule {}
