import { useState, useEffect, useCallback, useRef } from "react";
import { createSchemaClient, type SchemaSession } from "@schema-ai/client";
import type { SummaryData, SessionEvent, ConnectionStatus } from "@schema-ai/client";

interface UseSchemaResult {
  session: SchemaSession | null;
  summary: SummaryData | null;
  events: SessionEvent[];
  status: ConnectionStatus;
  error: string | null;
  loading: boolean;
  reconnect: () => void;
}

export function useSchema(serverUrl: string, uri: string): UseSchemaResult {
  const [session, setSession] = useState<SchemaSession | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const cleanupRef = useRef<(() => void) | null>(null);

  const connect = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEvents([]);
    setSummary(null);

    try {
      const client = createSchemaClient(serverUrl);
      const sess = await client.connect([uri]);
      setSession(sess);

      cleanupRef.current = sess.subscribe(
        (event) => setEvents((prev) => [...prev.slice(-499), event]),
        (s) => setStatus(s),
      );

      const sum = await sess.graphSummary();
      setSummary(sum);
      setStatus("connected");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    } finally {
      setLoading(false);
    }
  }, [serverUrl, uri]);

  useEffect(() => {
    connect();
    return () => {
      cleanupRef.current?.();
      session?.close().catch(() => {});
    };
  }, [serverUrl, uri]);

  return { session, summary, events, status, error, loading, reconnect: connect };
}
