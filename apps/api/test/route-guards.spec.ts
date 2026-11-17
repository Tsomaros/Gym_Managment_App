import {
  Controller,
  Get,
  type INestApplication,
  Module,
  SetMetadata,
  type Type,
} from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { afterEach, describe, expect, it } from 'vitest';
import { GYM_ROLES_KEY, GymRolesGuard } from '../src/access/gym-roles.guard';
import { GymRoles } from '../src/access/roles.decorator';
import { DeviceGuard } from '../src/devices/device.guard';
import { AppModule } from '../src/app.module';
import { createApp } from '../src/main';

/** Every route whose path contains :gymId, with whether @GymRoles (roles + guard) covers it. */
function gymRoutes(app: INestApplication): { id: string; guarded: boolean }[] {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const found: { id: string; guarded: boolean }[] = [];

  for (const wrapper of discovery.getControllers()) {
    // metatype (not instance) so request-scoped or not-yet-built controllers are not skipped
    const controller = wrapper.metatype as Type | null;
    if (!controller) throw new Error(`controller without a class: ${wrapper.name}`);
    const base = Reflect.getMetadata(PATH_METADATA, controller) as string | string[] | undefined;
    const proto = controller.prototype as Record<string, unknown>;

    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name] as (...args: unknown[]) => unknown;
      const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
      if (sub === undefined) continue; // not a route
      // Nest accepts arrays for both; check every combination
      for (const b of [base ?? ''].flat()) {
        for (const s of [sub].flat()) {
          const path = `/${b}/${s}`.replace(/\/+/g, '/');
          if (!path.includes(':gymId')) continue;
          const roles = reflector.getAllAndOverride<unknown[] | undefined>(GYM_ROLES_KEY, [
            handler,
            controller,
          ]);
          const guards = [
            ...((Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[] | undefined) ?? []),
            ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? []),
          ];
          const guarded = !!roles?.length && guards.includes(GymRolesGuard);
          found.push({ id: `${controller.name}.${name} ${path}`, guarded });
        }
      }
    }
  }
  return found;
}

/** Every /kiosk route except the public pairing one must carry DeviceGuard. */
function kioskRoutes(app: INestApplication): { id: string; guarded: boolean }[] {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const found: { id: string; guarded: boolean }[] = [];
  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype as Type | null;
    if (!controller) continue;
    const base = Reflect.getMetadata(PATH_METADATA, controller) as string | string[] | undefined;
    const proto = controller.prototype as Record<string, unknown>;
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name] as (...args: unknown[]) => unknown;
      const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
      if (sub === undefined) continue;
      for (const b of [base ?? ''].flat()) {
        for (const p of [sub].flat()) {
          const path = `/${b}/${p}`.replace(/\/+/g, '/');
          if (!path.startsWith('/kiosk/')) continue;
          const guards = [
            ...((Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[] | undefined) ?? []),
            ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? []),
          ];
          found.push({ id: `${controller.name}.${name} ${path}`, guarded: guards.includes(DeviceGuard) });
        }
      }
    }
  }
  return found;
}

const unguarded = (app: INestApplication): string[] =>
  gymRoutes(app)
    .filter((r) => !r.guarded)
    .map((r) => r.id);

@Controller('gyms/:gymId')
class ProbeController {
  @Get('guarded')
  @GymRoles('owner')
  guarded(): void {}

  @Get('forgotten')
  forgotten(): void {}
}

@Controller()
class ProbeHandlerPathController {
  @Get('gyms/:gymId/x')
  forgotten(): void {}

  @Get(['gyms/:gymId/ok1', 'gyms/:gymId/ok2'])
  @GymRoles('reception')
  guardedArray(): void {}

  @Get(['public', 'gyms/:gymId/arr'])
  forgottenArray(): void {}

  @Get('not-a-gym-route')
  other(): void {}
}

@Controller('gyms/:gymId/covered')
@GymRoles('owner')
class ProbeClassGuardedController {
  @Get('a')
  a(): void {}
}

@Controller(['gyms/:gymId/p', 'other'])
class ProbeArrayBaseController {
  @Get('q')
  forgotten(): void {}
}

/** Roles metadata alone, without the guard, protects nothing. */
@Controller('gyms/:gymId/meta')
class ProbeMetadataOnlyController {
  @Get('a')
  @SetMetadata(GYM_ROLES_KEY, ['owner'])
  a(): void {}
}

@Module({
  imports: [AppModule, DiscoveryModule],
  controllers: [
    ProbeController,
    ProbeHandlerPathController,
    ProbeClassGuardedController,
    ProbeArrayBaseController,
    ProbeMetadataOnlyController,
  ],
})
class ProbeModule {}

@Module({ imports: [AppModule, DiscoveryModule] })
class RealModule {}

describe('every /gyms/:gymId route carries @GymRoles', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('the checker flags a gym route without @GymRoles and passes a guarded one', async () => {
    app = await createApp(ProbeModule);
    await app.init();
    expect(unguarded(app).sort()).toEqual(
      [
        'ProbeController.forgotten /gyms/:gymId/forgotten',
        'ProbeHandlerPathController.forgotten /gyms/:gymId/x',
        'ProbeHandlerPathController.forgottenArray /gyms/:gymId/arr',
        'ProbeArrayBaseController.forgotten /gyms/:gymId/p/q',
        'ProbeMetadataOnlyController.a /gyms/:gymId/meta/a',
      ].sort(),
    );
    const guarded = gymRoutes(app)
      .filter((r) => r.guarded && r.id.startsWith('Probe'))
      .map((r) => r.id);
    expect(guarded.sort()).toEqual(
      [
        'ProbeController.guarded /gyms/:gymId/guarded',
        'ProbeHandlerPathController.guardedArray /gyms/:gymId/ok1',
        'ProbeHandlerPathController.guardedArray /gyms/:gymId/ok2',
        'ProbeClassGuardedController.a /gyms/:gymId/covered/a',
      ].sort(),
    );
  });

  it('every /kiosk route except /kiosk/pair carries DeviceGuard', async () => {
    app = await createApp(RealModule);
    await app.init();
    const routes = kioskRoutes(app);
    expect(routes.filter((r) => !r.guarded).map((r) => r.id)).toEqual([
      'DevicesController.pair /kiosk/pair',
    ]);
    // not vacuous: the scan must see the real kiosk routes
    expect(routes.map((r) => r.id)).toContain('DevicesController.me /kiosk/me');
  });

  it('the real app has no unguarded gym routes', async () => {
    app = await createApp(RealModule);
    await app.init();
    expect(unguarded(app)).toEqual([]);
    // not vacuous: the scan must see the app's real gym routes
    expect(gymRoutes(app)).toContainEqual({
      id: 'InvitationsController.invite /gyms/:gymId/invitations',
      guarded: true,
    });
  });
});
