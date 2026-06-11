import type { NextFunction, Request, Response } from 'express';

export interface AuthProfile {
  token: string;
  sub?: string;
  email?: string;
  preferred_username?: string;
  roles: string[];
  raw: Record<string, unknown>;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthProfile;
  }
}

function normalizeRoles(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((role) => String(role).trim())
    .filter(Boolean)
    .filter((role, index, array) => array.indexOf(role) === index);
}

export function extractRolesFromProfile(profile: Record<string, unknown>): string[] {
  const directRoles = normalizeRoles(profile.roles);
  const realmAccess = profile.realm_access as Record<string, unknown> | undefined;
  const realmRoles = normalizeRoles(realmAccess?.roles);

  return [...new Set([...directRoles, ...realmRoles])];
}

export function buildAuthProfile(token: string, profile: Record<string, unknown>): AuthProfile {
  return {
    token,
    sub: typeof profile.sub === 'string' ? profile.sub : undefined,
    email: typeof profile.email === 'string' ? profile.email : undefined,
    preferred_username: typeof profile.preferred_username === 'string' ? profile.preferred_username : undefined,
    roles: extractRolesFromProfile(profile),
    raw: profile
  };
}

function readBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) {
    return null;
  }

  const [scheme, token, ...rest] = headerValue.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) {
    return null;
  }

  return token;
}

export async function authenticateRequest(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
  const token = readBearerToken(req.header('authorization'));

  if (!token) {
    return res.status(401).json({ error: 'Authorization: Bearer <token> é obrigatório.' });
  }

  try {
    const response = await fetch('http://localhost:8080/realms/facoffee/protocol/openid-connect/userinfo', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }

    const profile = (await response.json()) as Record<string, unknown>;
    req.auth = buildAuthProfile(token, profile);
    return next();
  } catch (error) {
    console.error('Falha ao validar token no Keycloak:', error);
    return res.status(502).json({ error: 'Falha ao validar token no Keycloak.' });
  }
}

export function requireManager(req: Request, res: Response, next: NextFunction): Response | void {
  if (!req.auth?.roles.includes('MANAGER')) {
    return res.status(403).json({ error: 'Acesso restrito a gestores.' });
  }

  return next();
}

export function canAccessUser(req: Request, email: string): boolean {
  if (req.auth?.roles.includes('MANAGER')) {
    return true;
  }

  const subject = [req.auth?.email, req.auth?.preferred_username]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return subject.includes(email.toLowerCase());
}