/**
 * DNS-over-TLS (DoT) port 853 probe — в РФ порт 853 массово блокируется.
 * Браузер не может DoT напрямую, но можно зондировать порт через
 * fetch/WebSocket, проверяя TCP-доступность.
 */
import type { ProbeDefinition } from "../types";

const DOT_TARGETS = [
  { id: "google", host: "dns.google", label: "Google DoT" },
  { id: "cloudflare", host: "one.one.one.one", label: "Cloudflare DoT" },
  { id: "quad9", host: "dns.quad9.net", label: "Quad9 DoT" },
];

function probePort853(host: string, timeoutMs: number): Promise<{
  reachable: boolean;
  elapsed: number;
  error?: string;
}> {
  return new Promise((resolve) => {
    const start = performance.now();
    let settled = false;

    const finish = (result: { reachable: boolean; elapsed: number; error?: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    /* Try fetch first — more reliable signal */
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      finish({
        reachable: false,
        elapsed: Math.round(performance.now() - start),
        error: `timeout ${timeoutMs}ms — порт 853 вероятно заблокирован`,
      });
    }, timeoutMs);

    fetch(`https://${host}:853/`, {
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(() => {
        clearTimeout(timer);
        finish({
          reachable: true,
          elapsed: Math.round(performance.now() - start),
        });
      })
      .catch((error) => {
        if (settled) return;
        clearTimeout(timer);
        const elapsed = Math.round(performance.now() - start);
        const msg = error instanceof Error ? error.message : String(error);

        /* Quick failure < 200ms usually means RST/refused = port reachable but protocol mismatch */
        /* This is actually good — it means the port isn't blackholed */
        if (elapsed < 300 && !msg.includes("abort") && !msg.includes("timeout")) {
          finish({
            reachable: true,
            elapsed,
            error: `Быстрый отказ (${elapsed} мс) — порт доступен, протокол не совпадает (ожидаемо)`,
          });
        } else {
          finish({
            reachable: false,
            elapsed,
            error: msg,
          });
        }
      });
  });
}

export function createDotProbes(): ProbeDefinition[] {
  return DOT_TARGETS.map((t) => ({
    id: `dot_853_${t.id}`,
    name: `DoT :853 → ${t.label}`,
    category: "dot_probe" as const,
    description: "DNS-over-TLS порт 853 — в РФ массово блокируется как обходной DNS",
    target: `${t.host}:853`,
    run: async () => {
      const result = await probePort853(t.host, 8000);

      if (result.reachable) {
        return {
          status: "ok",
          latencyMs: result.elapsed,
          errorClass: "none" as const,
          detail: result.error
            ? `Порт 853 доступен: ${result.error}`
            : `Порт 853 отвечает (${result.elapsed} мс) — DoT не заблокирован`,
          metadata: { port: 853, host: t.host },
        };
      }

      const isTimeout = result.error?.includes("timeout") || result.elapsed >= 7900;

      return {
        status: isTimeout ? "timeout" : "blocked",
        latencyMs: result.elapsed,
        errorClass: isTimeout ? "timeout" as const : "tcp_reset" as const,
        detail: isTimeout
          ? `Порт 853 таймаут — вероятно заблокирован (${result.elapsed} мс)`
          : `Порт 853 заблокирован: ${result.error}`,
        metadata: { port: 853, host: t.host },
      };
    },
  }));
}
