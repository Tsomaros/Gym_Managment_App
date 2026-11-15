import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { type AccessClaims, verifyAccessToken } from './tokens';

export type AuthedRequest = Request & { user: AccessClaims };

/** Requires `Authorization: Bearer <access token>` and puts its claims on `req.user`. */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: AccessClaims }>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();
    try {
      req.user = verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException();
    }
    return true;
  }
}
