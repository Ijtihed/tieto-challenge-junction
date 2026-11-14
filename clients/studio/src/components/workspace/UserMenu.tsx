"use client";

import { useEffect, useRef, useState } from "react";
import { publicEnv } from "@/lib/env.public";

const SESSION_KEY = "schema:session";

interface SessionData {
  email: string;
  expiresAt: number;
}

function getSession(): SessionData | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SessionData;
    if (data.expiresAt < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return data;
  } catch { return null; }
}

export function setSession(email: string) {
  const data: SessionData = { email, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 };
  localStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function useSession() {
  const [session, setSessionState] = useState<SessionData | null>(null);
  useEffect(() => { setSessionState(getSession()); }, []);
  return session;
}

export default function UserMenu() {
  const [session, setSessionState] = useState<SessionData | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSessionState(getSession());
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!publicEnv.authEnabled || !session) {
    return (
      <a
        href={`${publicEnv.SITE_URL}/signup`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-3 py-1.5 border border-outline-variant hover:border-neutral-600 transition-colors text-xs text-on-surface-variant hover:text-white"
      >
        <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'wght' 300" }}>login</span>
        Sign in
      </a>
    );
  }

  const initials = session.email
    .split("@")[0]!
    .slice(0, 2)
    .toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="user-menu-button"
        className="w-8 h-8 flex items-center justify-center border border-outline-variant hover:border-neutral-600 transition-colors rounded-full"
        title={session.email}
      >
        <span className="text-[11px] text-neutral-300 font-medium">{initials}</span>
      </button>

      {open && (
        <div
          data-testid="user-menu-dropdown"
          className="absolute right-0 top-full mt-1 w-[220px] z-30 border border-outline-variant bg-surface shadow-xl rounded"
        >
          <div className="px-4 py-3 border-b border-outline-variant">
            <p className="font-[JetBrains_Mono] text-xs text-on-surface-faint truncate">
              {session.email}
            </p>
          </div>
          <a
            href={`${publicEnv.SITE_URL}/account`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-xs text-on-surface-muted hover:text-white hover:bg-white/[0.04] transition-colors"
          >
            Account
          </a>
          <button
            type="button"
            onClick={() => { clearSession(); setSessionState(null); setOpen(false); }}
            className="w-full text-left px-4 py-2.5 text-xs text-on-surface-muted hover:text-white hover:bg-white/[0.04] transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
