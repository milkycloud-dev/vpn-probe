import type { ProbeDefinition } from "../types";
import { classifyFetchError, withTimeout } from "../utils";

const HTTPS_TARGETS = [
  { host: "https://www.cloudflare.com/cdn-cgi/trace", label: "Cloudflare" },
  { host: "https://www.google.com/generate_204", label: "Google" },
  { host: "https://github.com/favicon.ico", label: "GitHub" },
  { host: "https://www.wikipedia.org/favicon.ico", label: "Wikipedia" },
  { host: "https://1.1.1.1/cdn-cgi/trace", label: "Cloudflare DNS IP" },
  { host: "https://ya.ru/favicon.ico", label: "Яндекс (контроль РФ)" },
  { host: "https://vk.com/favicon.ico", label: "VK (контроль РФ)" },
];

export function createBaselineProbes(): ProbeDefinition[] {
  return HTTPS_TARGETS.map((target) => ({
    id: `https_${target.label.toLowerCase().replace(/\s+/g, "_")}`,
    name: `HTTPS → ${target.label}`,
    category: "baseline",
    description: "Базовая проверка TLS/HTTPS доступности",
    target: target.host,
    run: async () => {
      const start = performance.now();
      try {
        const response = await withTimeout(
          fetch(target.host, {
            method: "GET",
            mode: "cors",
            cache: "no-store",
            signal: AbortSignal.timeout(8000),
          }),
          8500,
        );
        const elapsed = Math.round(performance.now() - start);
        return {
          status: response.ok || response.status === 204 ? "ok" : "error",
          latencyMs: elapsed,
          errorClass: "none",
          detail: `HTTP ${response.status}, ${elapsed} мс`,
          metadata: { httpStatus: response.status },
        };
      } catch (error) {
        const elapsed = Math.round(performance.now() - start);
        const classified = classifyFetchError(error, elapsed);
        return { latencyMs: elapsed, ...classified };
      }
    },
  }));
}

export function createTlsProbes(): ProbeDefinition[] {
  const sniTargets = [
    "https://mozilla.org",
    "https://www.debian.org",
    "https://www.rust-lang.org",
    "https://telegram.org",
  ];

  return sniTargets.map((host) => ({
    id: `tls_sni_${new URL(host).hostname.replace(/\./g, "_")}`,
    name: `TLS SNI → ${new URL(host).hostname}`,
    category: "tls",
    description: "Проверка TLS handshake с разными SNI (имитация VPN-туннеля через 443)",
    target: host,
    run: async () => {
      const start = performance.now();
      try {
        await withTimeout(
          fetch(host, { method: "HEAD", mode: "no-cors", cache: "no-store" }),
          8000,
        );
        const elapsed = Math.round(performance.now() - start);
        return {
          status: "ok",
          latencyMs: elapsed,
          errorClass: "cors_opaque",
          detail: `TLS handshake завершён (opaque), ${elapsed} мс`,
        };
      } catch (error) {
        const elapsed = Math.round(performance.now() - start);
        const classified = classifyFetchError(error, elapsed);
        return { latencyMs: elapsed, ...classified };
      }
    },
  }));
}
