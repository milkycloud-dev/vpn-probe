/**
 * Multi-port HTTPS probe — Cloudflare поддерживает нестандартные порты
 * для HTTPS (8443, 2053, 2083, 2087, 2096). DPI часто блокирует их.
 * VPN на нестандартных портах — основной способ обхода.
 */
import type { ProbeDefinition } from "../types";
import { classifyFetchError, withTimeout } from "../utils";

const CF_ALT_PORTS = [
  { port: 8443, label: "8443" },
  { port: 2053, label: "2053" },
  { port: 2083, label: "2083" },
  { port: 2087, label: "2087" },
  { port: 2096, label: "2096" },
];

export function createMultiPortProbes(): ProbeDefinition[] {
  /* Baseline 443 for comparison */
  const baseline: ProbeDefinition = {
    id: "multiport_443",
    name: "HTTPS :443 (контроль)",
    category: "multiport",
    description: "Контрольный порт 443 для сравнения с нестандартными",
    target: "https://www.cloudflare.com:443/cdn-cgi/trace",
    run: async () => {
      const start = performance.now();
      try {
        await withTimeout(
          fetch("https://www.cloudflare.com:443/cdn-cgi/trace", {
            cache: "no-store",
            mode: "cors",
          }),
          8000,
        );
        const elapsed = Math.round(performance.now() - start);
        return {
          status: "ok",
          latencyMs: elapsed,
          errorClass: "none",
          detail: `Порт 443 OK (${elapsed} мс) — контрольный`,
          metadata: { port: 443 },
        };
      } catch (error) {
        const elapsed = Math.round(performance.now() - start);
        const classified = classifyFetchError(error, elapsed);
        return { latencyMs: elapsed, ...classified, metadata: { port: 443 } };
      }
    },
  };

  const altProbes = CF_ALT_PORTS.map((p): ProbeDefinition => ({
    id: `multiport_${p.port}`,
    name: `HTTPS :${p.label}`,
    category: "multiport" as const,
    description: `Порт ${p.port} — VPN часто использует нестандартные порты для обхода DPI`,
    target: `https://www.cloudflare.com:${p.port}/cdn-cgi/trace`,
    run: async () => {
      const start = performance.now();
      try {
        /* no-cors — порт может быть открыт, но CORS закрыт */
        const response = await withTimeout(
          fetch(`https://www.cloudflare.com:${p.port}/cdn-cgi/trace`, {
            cache: "no-store",
            mode: "cors",
          }),
          8000,
        );
        const elapsed = Math.round(performance.now() - start);
        return {
          status: response.ok ? "ok" as const : "error" as const,
          latencyMs: elapsed,
          errorClass: "none" as const,
          detail: response.ok
            ? `Порт ${p.port} открыт (${elapsed} мс) — VPN-транспорт возможен`
            : `Порт ${p.port}: HTTP ${response.status}`,
          metadata: { port: p.port, httpStatus: response.status },
        };
      } catch (error) {
        const elapsed = Math.round(performance.now() - start);
        const msg = error instanceof Error ? error.message : String(error);

        /* CORS failure with opaque response = port is reachable */
        if (msg.includes("CORS") || msg.includes("Failed to fetch")) {
          try {
            await withTimeout(
              fetch(`https://www.cloudflare.com:${p.port}/cdn-cgi/trace`, {
                mode: "no-cors",
                cache: "no-store",
              }),
              5000,
            );
            return {
              status: "ok" as const,
              latencyMs: elapsed,
              errorClass: "cors_opaque" as const,
              detail: `Порт ${p.port} отвечает (opaque, ${elapsed} мс) — TCP/TLS OK`,
              metadata: { port: p.port, httpStatus: 0 },
            };
          } catch {
            /* fall through */
          }
        }

        const classified = classifyFetchError(error, elapsed);
        return {
          status: classified.status,
          errorClass: classified.errorClass,
          latencyMs: elapsed,
          detail: `Порт ${p.port}: ${classified.detail}`,
          metadata: { port: p.port, httpStatus: 0 },
        };
      }
    },
  }));

  return [baseline, ...altProbes];
}
