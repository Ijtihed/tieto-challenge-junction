// Per architecture/schema-v3.md §3.2
import { randomUUID } from "node:crypto";

export function newRequestId(): string {
  return `req_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
