import crypto from 'crypto';
import type { Request } from 'express';

export interface CanaryDecision {
  enabled: boolean;
  variant: 'stable' | 'canary';
  cohortKey: string;
  percentage: number;
}

function parsePercentage(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.min(100, parsed);
}

function normalizeSeed(value: string | undefined): string {
  return value && value.trim() ? value.trim() : 'facoffee-canary';
}

function getCandidateKey(req: Request): string {
  const explicitKey = req.header('x-canary-key');
  if (explicitKey && explicitKey.trim()) {
    return explicitKey.trim();
  }

  const auth = req.auth;
  if (auth?.sub) {
    return auth.sub;
  }

  if (auth?.email) {
    return auth.email;
  }

  if (auth?.preferred_username) {
    return auth.preferred_username;
  }

  return req.ip || 'anonymous';
}

function computeBucket(cohortKey: string, seed: string): number {
  const digest = crypto.createHash('sha256').update(`${seed}:${cohortKey}`).digest('hex');
  const firstEight = digest.slice(0, 8);
  return parseInt(firstEight, 16) % 100;
}

export function resolveCanaryDecision(req: Request): CanaryDecision {
  const percentage = parsePercentage(process.env.CANARY_PERCENTAGE);
  const enabled = process.env.CANARY_ENABLED === 'true' && percentage > 0;
  const cohortKey = getCandidateKey(req);
  const seed = normalizeSeed(process.env.CANARY_SEED);

  if (!enabled) {
    return {
      enabled: false,
      variant: 'stable',
      cohortKey,
      percentage
    };
  }

  const bucket = computeBucket(cohortKey, seed);
  return {
    enabled: bucket < percentage,
    variant: bucket < percentage ? 'canary' : 'stable',
    cohortKey,
    percentage
  };
}
