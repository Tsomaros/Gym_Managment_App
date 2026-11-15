import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { verifyAccessToken } from '../auth/tokens';
import type { GymContext } from './gym-context';

export interface CurrentUser {
  id: string;
  /** From the access token; PlatformAdminGuard re-checks it against the database. */
  isPlatformAdmin: boolean;
}

export type AppRequest = Request & { user?: CurrentUser; gym?: GymContext };

/** Requires `Authorization: Bearer <access token>` and sets `req.user`. 401 otherwise. */
@Injectable()
export class JwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();
    try {
      const claims = verifyAccessToken(token);
      req.user = { id: claims.sub, isPlatformAdmin: claims.adm };
    } catch {
      throw new UnauthorizedException();
    }
    return true;
  }
}
