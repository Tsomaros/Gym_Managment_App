import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshStore } from './refresh-store';

@Module({
  controllers: [AuthController],
  providers: [AuthService, RefreshStore],
  exports: [RefreshStore],
})
export class AuthModule {}
