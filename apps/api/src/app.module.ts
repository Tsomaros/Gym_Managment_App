import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { closeDb } from './db/client';
import { HealthController } from './health/health.controller';

@Module({
  imports: [AuthModule],
  controllers: [HealthController],
})
export class AppModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await closeDb();
  }
}
