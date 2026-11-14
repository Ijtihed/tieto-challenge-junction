// Per architecture/schema-v3.md §3.5 + §7.3
// Session store with factory pattern for testability.

import type { Session, SessionId, SessionInit } from "./session.ts";
import { createSession } from "./session.ts";
import { logger } from "../obs/index.ts";

export interface SessionStoreOptions {
  ttlMs?: number;
  sweepIntervalMs?: number;
  maxSessions?: number;
}

export interface SessionStore {
  open(workspaceUris: readonly string[], init?: SessionInit): Session;
  get(id: SessionId): Session | null;
  close(id: SessionId): boolean;
  all(): readonly Session[];
  touch(id: SessionId): void;
  dispose(): void;
}

function uriSetKey(uris: readonly string[]): string {
  return [...uris].sort().join("\0");
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes idle
const DEFAULT_SWEEP_MS = 60 * 1000; // sweep every 60 seconds
const DEFAULT_MAX_SESSIONS = 50;

export function createSessionStore(opts?: SessionStoreOptions): SessionStore {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const sweepIntervalMs = opts?.sweepIntervalMs ?? DEFAULT_SWEEP_MS;
  const maxSessions = opts?.maxSessions ?? DEFAULT_MAX_SESSIONS;

  const sessions = new Map<SessionId, Session>();
  const uriIndex = new Map<string, SessionId>();

  function reapStale(): void {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (session.closed || now - session.lastActivityAt > ttlMs) {
        if (!session.closed) session.close();
        sessions.delete(id);
        const key = uriSetKey(session.workspaceUris);
        uriIndex.delete(key);
        logger.info("session-store", "reaped stale session", { sessionId: id, idleMs: now - session.lastActivityAt });
      }
    }
  }

  const sweepTimer = setInterval(reapStale, sweepIntervalMs);
  sweepTimer.unref();

  return {
    open(workspaceUris, init) {
      const key = uriSetKey(workspaceUris);
      const existingId = uriIndex.get(key);

      if (existingId) {
        const existing = sessions.get(existingId);
        if (existing && !existing.closed) {
          logger.info("session-store", "reusing existing session", {
            sessionId: existing.id,
            uris: workspaceUris,
          });
          existing.lastActivityAt = Date.now();
          return existing;
        }
      }

      if (sessions.size >= maxSessions) {
        reapStale();
        if (sessions.size >= maxSessions) {
          throw new Error(`Session limit reached (${maxSessions}). Close unused sessions.`);
        }
      }

      const session = createSession(workspaceUris, init);
      sessions.set(session.id, session);
      uriIndex.set(key, session.id);

      session.eventBus.emit({ kind: "workspace.opened", at: Date.now() });

      logger.info("session-store", "session opened", {
        sessionId: session.id,
        uris: workspaceUris,
      });

      return session;
    },

    get(id) {
      return sessions.get(id) ?? null;
    },

    close(id) {
      const session = sessions.get(id);
      if (!session || session.closed) return false;
      session.close();
      sessions.delete(id);
      const key = uriSetKey(session.workspaceUris);
      uriIndex.delete(key);
      logger.info("session-store", "session closed", { sessionId: id });
      return true;
    },

    all() {
      return [...sessions.values()];
    },

    touch(id) {
      const session = sessions.get(id);
      if (session && !session.closed) session.lastActivityAt = Date.now();
    },

    dispose() {
      clearInterval(sweepTimer);
      for (const [id, session] of sessions) {
        if (!session.closed) session.close();
      }
      sessions.clear();
      uriIndex.clear();
    },
  };
}

// Default singleton store — used by actions that need a global.
// Tests should create their own via createSessionStore().
const defaultStore = createSessionStore();
export const openSession = defaultStore.open;
export const getSession = defaultStore.get;
export const closeSession = defaultStore.close;
export const allSessions = defaultStore.all;
export const touchSession = defaultStore.touch;
