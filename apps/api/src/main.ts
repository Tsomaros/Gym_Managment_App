import 'reflect-metadata';
import type { INestApplication, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { getEnv } from './config/env';
import { seedPlatformAdmin } from './seed';

/**
 * Builds the app without listening. Every e2e test starts here; a test may pass a module that
 * imports AppModule and adds test-only controllers. Throws on an invalid environment.
 */
export async function createApp(rootModule: Type = AppModule): Promise<INestApplication> {
  const env = getEnv();
  const app = await NestFactory.create(rootModule, { logger: ['error', 'warn'] });
  app.use(cookieParser());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  return app;
}

async function bootstrap(): Promise<void> {
  const env = getEnv(); // fail fast on a missing or invalid key
  await seedPlatformAdmin(env.PLATFORM_ADMIN_EMAIL, env.PLATFORM_ADMIN_PASSWORD);
  const app = await createApp();
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}

if (require.main === module) {
  void bootstrap();
}
