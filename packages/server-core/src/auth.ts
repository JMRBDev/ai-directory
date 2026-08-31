import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type RemoteSession = {
  id: string;
  label: string;
  createdAt: string;
};

export type MintedSession = {
  sessionToken: string;
  session: RemoteSession;
};

type StoredSession = RemoteSession & {
  token: string;
};

export type SessionStore = {
  mintSessionToken: (label?: string) => MintedSession;
  verifySessionToken: (token: string) => RemoteSession | null;
  revokeSession: (id: string) => boolean;
  listSessions: () => RemoteSession[];
  consumePairingToken: (token: string) => boolean;
};

function sessionId(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSessionStore(pairingTokens: string[]): SessionStore {
  const pairing = new Set(pairingTokens);
  const sessions = new Map<string, StoredSession>();

  function makeSession(sessionToken: string, label: string): RemoteSession {
    return {
      id: sessionId(sessionToken),
      label,
      createdAt: new Date().toISOString(),
    };
  }

  return {
    mintSessionToken(label = 'Remote session'): MintedSession {
      const sessionToken = randomBytes(16).toString('hex');
      const session = makeSession(sessionToken, label);
      sessions.set(session.id, { ...session, token: sessionToken });
      return { sessionToken, session };
    },

    verifySessionToken(token: string): RemoteSession | null {
      const id = sessionId(token);
      const stored = sessions.get(id);
      if (!stored) return null;
      const candidate = Buffer.from(token);
      const expected = Buffer.from(stored.token);
      if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return null;
      const session: RemoteSession = {
        id: stored.id,
        label: stored.label,
        createdAt: stored.createdAt,
      };
      return session;
    },

    revokeSession(id: string): boolean {
      return sessions.delete(id);
    },

    listSessions(): RemoteSession[] {
      const list: RemoteSession[] = [];
      for (const stored of sessions.values()) {
        list.push({
          id: stored.id,
          label: stored.label,
          createdAt: stored.createdAt,
        });
      }
      return list;
    },

    consumePairingToken(token: string): boolean {
      return pairing.delete(token);
    },
  };
}
