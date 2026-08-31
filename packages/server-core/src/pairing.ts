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

export function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}
