import { Module } from '@nestjs/common';
import { AccessTokenGuard } from './access-token.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshStore } from './refresh-store';

@Module({
  controllers: [AuthController],
  providers: [AuthService, RefreshStore, AccessTokenGuard],
  exports: [AccessTokenGuard],
})
export class AuthModule {}
