import { createContext, useContext, useMemo, createElement, type ReactNode } from "react";
import { createSchemaClient, type SchemaClient } from "@schema-ai/client";

const SchemaContext = createContext<SchemaClient | null>(null);

export function SchemaProvider({ serverUrl, children }: { serverUrl: string; children: ReactNode }) {
  const client = useMemo(() => createSchemaClient(serverUrl), [serverUrl]);
  return createElement(SchemaContext.Provider, { value: client }, children);
}

export function useSchemaClient(): SchemaClient {
  const client = useContext(SchemaContext);
  if (!client) throw new Error("useSchemaClient must be used within a SchemaProvider");
  return client;
}
