import { useState, useEffect, useRef } from "react";
import type { SchemaSession } from "@schema-ai/client";
import type { SessionEvent } from "@schema-ai/client";

interface UseEventsResult {
  events: SessionEvent[];
  clear: () => void;
}

export function useEvents(session: SchemaSession | null, maxEvents: number = 500): UseEventsResult {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!session) return;
    cleanupRef.current = session.subscribe((event) => {
      setEvents((prev) => [...prev.slice(-(maxEvents - 1)), event]);
    });
    return () => { cleanupRef.current?.(); };
  }, [session, maxEvents]);

  const clear = () => setEvents([]);

  return { events, clear };
}
