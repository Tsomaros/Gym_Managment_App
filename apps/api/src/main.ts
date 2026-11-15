import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

/** Builds the app without listening. Every e2e test starts here. */
export async function createApp(): Promise<INestApplication> {
  return NestFactory.create(AppModule, { logger: ['error', 'warn'] });
}

async function bootstrap(): Promise<void> {
  loadEnv(); // fail fast on a missing or invalid key
  const app = await createApp();
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}

if (require.main === module) {
  void bootstrap();
}
