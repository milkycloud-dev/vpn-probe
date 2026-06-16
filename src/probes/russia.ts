import type { ProbeDefinition } from "../types";
import { RU_BLOCKED_SERVICES, RU_CONTROL_SERVICES } from "./russia-common";
import { classifyFetchError, withTimeout } from "../utils";

async function probeCors(url: string): Promise<{
  status: "ok" | "blocked" | "timeout" | "error";
  latencyMs: number;
  errorClass: "none" | "timeout" | "tcp_reset" | "cors_opaque" | "unknown";
  detail: string;
  httpStatus?: number;
}> {
  const start = performance.now();
  try {
    const response = await withTimeout(
      fetch(url, { method: "HEAD", mode: "cors", cache: "no-store", redirect: "follow" }),
      7000,
    );
    const elapsed = Math.round(performance.now() - start);
    const ok = response.ok || response.status === 301 || response.status === 302;
    return {
      status: ok ? "ok" : "error",
      latencyMs: elapsed,
      errorClass: "none",
      detail: `HTTP ${response.status} (${elapsed} мс)`,
      httpStatus: response.status,
    };
  } catch (error) {
    const elapsed = Math.round(performance.now() - start);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("CORS") || msg.includes("Failed to fetch")) {
      try {
        await withTimeout(fetch(url, { method: "HEAD", mode: "no-cors", cache: "no-store" }), 5000);
        return {
          status: "ok",
          latencyMs: elapsed,
          errorClass: "cors_opaque",
          detail: `Opaque OK — TCP/TLS прошёл, CORS закрыт (${elapsed} мс)`,
        };
      } catch {
        const classified = classifyFetchError(error, elapsed);
        return {
          status: classified.status === "timeout" ? "timeout" : "blocked",
          latencyMs: elapsed,
          errorClass: classified.errorClass === "timeout" ? "timeout" : "tcp_reset",
          detail: classified.detail,
        };
      }
    }
    const classified = classifyFetchError(error, elapsed);
    return {
      status: classified.status === "timeout" ? "timeout" : "blocked",
      latencyMs: elapsed,
      errorClass: classified.errorClass === "timeout" ? "timeout" : "tcp_reset",
      detail: classified.detail,
    };
  }
}

export function createRussiaBlockedProbes(): ProbeDefinition[] {
  return RU_BLOCKED_SERVICES.map((svc) => ({
    id: `ru_blocked_${svc.id}`,
    name: svc.name,
    category: "russia_blocked" as const,
    description: `${svc.note} — HTTPS из РФ (ожидается блок)`,
    target: svc.url,
    run: async () => {
      const result = await probeCors(svc.url);
      const blocked = result.status !== "ok";
      return {
        ...result,
        detail: blocked
          ? `${result.detail} — блокировка РКН/DPI активна`
          : `${result.detail} — доступен (VPN, обход или аномалия сети)`,
        metadata: { service: svc.name, probe: "https", registry: svc.note },
      };
    },
  }));
}

export function createRussiaControlProbes(): ProbeDefinition[] {
  return RU_CONTROL_SERVICES.map((svc) => ({
    id: `ru_control_${svc.id}`,
    name: svc.name,
    category: "russia_control" as const,
    description: "Контроль РФ — должен быть доступен; падение = проблема сети, не цензура",
    target: svc.url,
    run: async () => {
      const result = await probeCors(svc.url);
      return {
        ...result,
        detail: result.status === "ok"
          ? result.detail
          : `${result.detail} — аномалия: российский сервис недоступен`,
        metadata: { service: svc.name },
      };
    },
  }));
}