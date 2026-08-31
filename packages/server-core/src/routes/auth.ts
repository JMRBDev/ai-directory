import type { Context } from 'hono';
import { jsonBody } from '../http.js';
import { isCrossOrigin } from '../pairing.js';
import { parsePairSessionRequest } from '../requests.js';
import type { RequestBody, RouteContext } from '../types.js';
import type { SessionStore } from '../auth.js';

function sessionTokenFrom(context: Context): string | null {
  const header = context.req.header('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export function registerAuthRoutes({ app, options }: RouteContext, store: SessionStore): void {
  const authEnabled = options.pairingTokens !== undefined && options.pairingTokens.length > 0;

  app.post('/api/auth/sessions', async (context) => {
    if (!authEnabled) {
      return context.json({ error: 'This server does not use pairing tokens.' }, 400);
    }

    let body: RequestBody;
    try {
      body = await jsonBody(context);
    } catch {
      return context.json({ error: 'Request body must be valid JSON.' }, 400);
    }

    let token: string;
    try {
      token = parsePairSessionRequest(body).token;
    } catch {
      return context.json({ error: 'token must be a non-empty string.' }, 400);
    }

    if (!store.consumePairingToken(token)) {
      return context.json({ error: 'The pairing token is invalid or was already used.' }, 401);
    }

    const { sessionToken, session } = store.mintSessionToken(sessionLabelFor(context));
    return context.json({ sessionToken, session }, 201);
  });

  // SAFETY: same-origin callers (the local page served by `aid web`) are trusted
  // without a session, matching the existing API trust model. Cross-origin callers
  // must present a session token so the pairing token is never reusable.
  app.get('/api/auth/sessions', async (context) => {
    if (!authEnabled) return context.json({ sessions: [] });
    if (!authenticated(context, store)) return context.json({ error: 'A valid session token is required.' }, 401);
    return context.json({ sessions: store.listSessions() });
  });

  app.delete('/api/auth/sessions/:id', async (context) => {
    if (!authEnabled) return context.json({ error: 'A valid session token is required.' }, 401);
    if (!authenticated(context, store)) return context.json({ error: 'A valid session token is required.' }, 401);
    return context.json({ ok: store.revokeSession(context.req.param('id')) });
  });
}

function authenticated(context: Context, store: SessionStore): boolean {
  if (!isCrossOrigin(context.req.raw)) return true;
  const sessionToken = sessionTokenFrom(context);
  return sessionToken !== null && store.verifySessionToken(sessionToken) !== null;
}

function sessionLabelFor(context: Context): string {
  const origin = context.req.header('origin');
  if (!origin) return 'Remote session';
  try {
    const host = context.req.header('host');
    if (host && new URL(origin).host === host) return 'Local browser';
    return `Hosted site (${new URL(origin).hostname})`;
  } catch {
    return origin;
  }
}
