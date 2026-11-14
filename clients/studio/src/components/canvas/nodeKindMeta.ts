import type { NodeKind } from "@/lib/types";

export const KIND_META: Record<string, { label: string; color: string; accent: string }> = {
  contract: { label: "interface", color: "text-kind-external", accent: "bg-kind-external" },
  route_handler: { label: "route", color: "text-kind-route", accent: "bg-kind-route" },
  middleware: { label: "middleware", color: "text-kind-middleware", accent: "bg-kind-middleware" },
  service: { label: "service", color: "text-kind-service", accent: "bg-kind-service" },
  data_access: { label: "data", color: "text-kind-data", accent: "bg-kind-data" },
  model: { label: "model", color: "text-kind-model", accent: "bg-kind-model" },
  external: { label: "external", color: "text-kind-external", accent: "bg-kind-external" },
  utility: { label: "utility", color: "text-kind-utility", accent: "bg-kind-utility" },
};

export const HTTP_METHOD_COLOR: Record<string, string> = {
  GET: "text-kind-data",
  POST: "text-kind-route",
  PUT: "text-kind-service",
  PATCH: "text-kind-service",
  DELETE: "text-kind-model",
  PAGE: "text-kind-utility",
};
