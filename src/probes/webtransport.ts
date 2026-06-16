import type { ProbeDefinition } from "../types";
import { withTimeout } from "../utils";

interface WtTarget {
  id: string;
  name: string;
  url: string;
  note: string;
}

const WT_TARGETS: WtTarget[] = [
  {
    id: "cloudflare",
    name: "Cloudflare WT",
    url: "https://webtransport.cloudflareclients.com/webtransport",
    note: "Официальный echo — QUIC/HTTP3 из браузера, близко к Hysteria",
  },
  {
    id: "day",
    name: "webtransport.day",
    url: "https://webtransport.day/api/wt",
    note: "Публичный демо-сервер WebTransport over HTTP/3",
  },
];

function wtSupported(): boolean {
  return typeof WebTransport !== "undefined";
}

async function probeWebTransport(
  url: string,
  timeoutMs: number,
): Promise<{ connected: boolean; elapsed: number; error?: string }> {
  const start = performance.now();

  if (!wtSupported()) {
    return {
      connected: false,
      elapsed: 0,
      error: "WebTransport API недоступен в этом браузере",
    };
  }

  let transport: WebTransport | null = null;

  try {
    transport = new WebTransport(url);
    await withTimeout(transport.ready, timeoutMs);
    const elapsed = Math.round(performance.now() - start);
    transport.close();
    return { connected: true, elapsed };
  } catch (error) {
    const elapsed = Math.round(performance.now() - start);
    const message = error instanceof Error ? error.message : String(error);
    try {
      transport?.close();
    } catch {
      /* ignore */
    }
    return { connected: false, elapsed, error: message };
  }
}

export function createWebTransportProbes(): ProbeDefinition[] {
  const apiProbe: ProbeDefinition = {
    id: "wt_api_support",
    name: "WebTransport API",
    category: "webtransport",
    description: "Проверка поддержки WebTransport в браузере — без неё QUIC-пробы невозможны",
    target: "WebTransport",
    run: async () => {
      if (!wtSupported()) {
        return {
          status: "inconclusive",
          latencyMs: null,
          errorClass: "none",
          detail: "API недоступен (Safari/Firefox без флага) — только косвенные QUIC-сигналы",
          metadata: { apiAvailable: 0 },
        };
      }
      return {
        status: "ok",
        latencyMs: null,
        errorClass: "none",
        detail: "WebTransport API доступен — можно тестировать QUIC/HTTP3",
        metadata: { apiAvailable: 1 },
      };
    },
  };

  const endpointProbes: ProbeDefinition[] = WT_TARGETS.map((target) => ({
    id: `wt_${target.id}`,
    name: `WebTransport → ${target.name}`,
    category: "webtransport" as const,
    description: target.note,
    target: target.url,
    run: async () => {
      if (!wtSupported()) {
        return {
          status: "skipped",
          latencyMs: null,
          errorClass: "none",
          detail: "Пропущено — WebTransport API недоступен",
          metadata: { apiAvailable: 0, endpoint: "" },
        };
      }

      const result = await probeWebTransport(target.url, 10000);

      if (result.connected) {
        return {
          status: "ok",
          latencyMs: result.elapsed,
          errorClass: "none",
          detail: `QUIC-сессия установлена за ${result.elapsed} мс`,
          metadata: { apiAvailable: 1, endpoint: target.id },
        };
      }

      const isTimeout = result.error?.includes("timeout");
      const quicBlocked =
        result.error?.includes("QUIC") ||
        result.error?.includes("Failed") ||
        result.error?.includes("network") ||
        result.error?.includes("WebTransportError");

      return {
        status: isTimeout ? "timeout" : quicBlocked ? "blocked" : "inconclusive",
        latencyMs: result.elapsed,
        errorClass: isTimeout ? "timeout" : quicBlocked ? "udp_blocked" : "unknown",
        detail: result.error ?? "Не удалось установить WebTransport",
        metadata: { apiAvailable: 1, endpoint: target.id },
      };
    },
  }));

  return [apiProbe, ...endpointProbes];
}
