import { randomBytes } from 'node:crypto';

export function generatePairingToken(): string {
  return randomBytes(16).toString('hex');
}

export function isCrossOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  const host = request.headers.get('host');
  if (!host) return true;

  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export function hasValidPairingToken(request: Request, expectedToken: string): boolean {
  const authorization = request.headers.get('authorization');
  return authorization === `Bearer ${expectedToken}`;
}
