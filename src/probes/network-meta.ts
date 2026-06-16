/**
 * Мета-пробы сети: HTTP/2 деградация, прозрачный прокси, connection info,
 * timing side-channel анализ.
 */
import type { ProbeDefinition, ProbeResult } from "../types";
import { withTimeout } from "../utils";

/* ───────────────────── HTTP/2 degradation (Resource Timing) ──────────── */

const H2_TARGETS = [
  { id: "cf", url: "https://www.cloudflare.com/cdn-cgi/trace", label: "Cloudflare" },
  { id: "google", url: "https://www.google.com/generate_204", label: "Google" },
];

export function createHttp2Probes(): ProbeDefinition[] {
  return H2_TARGETS.map((t) => ({
    id: `h2_${t.id}`,
    name: `HTTP/2 → ${t.label}`,
    category: "http2_check" as const,
    description: "ALPN h2 деградация — DPI/ТСПУ иногда понижает до HTTP/1.1",
    target: t.url,
    run: async () => {
      const start = performance.now();
      try {
        await withTimeout(
          fetch(t.url, { cache: "no-store", mode: "cors" }),
          8000,
        );
        const elapsed = Math.round(performance.now() - start);

        const entries = performance.getEntriesByName(t.url, "resource") as PerformanceResourceTiming[];
        const entry = entries.length ? entries[entries.length - 1] : null;
        const protocol = entry?.nextHopProtocol ?? "unknown";

        /* Cleanup resource timing buffer for this URL */
        try { performance.clearResourceTimings(); } catch { /* older browsers */ }

        const degraded = protocol === "http/1.1" || protocol === "http/1.0";

        return {
          status: degraded ? "error" : protocol === "unknown" ? "inconclusive" : "ok",
          latencyMs: elapsed,
          errorClass: degraded ? "unknown" as const : "none" as const,
          detail: degraded
            ? `Деградация: ${protocol} вместо h2 — возможен MITM/DPI (${elapsed} мс)`
            : `Протокол: ${protocol} (${elapsed} мс)`,
          metadata: { protocol, degraded },
        };
      } catch (error) {
        const elapsed = Math.round(performance.now() - start);
        return {
          status: "blocked" as const,
          latencyMs: elapsed,
          errorClass: "tcp_reset" as const,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
  }));
}

/* ──────────────── Transparent proxy / Via header detection ────────────── */

const PROXY_HEADERS_TO_CHECK = ["via", "x-forwarded-for", "x-cache", "x-proxy-id", "x-squid-error"];

export function createProxyDetectProbe(): ProbeDefinition {
  return {
    id: "proxy_detect_headers",
    name: "Прозрачный прокси (заголовки)",
    category: "proxy_detect",
    description: "Проверка Via / X-Forwarded-For — индикатор прозрачного прокси / ТСПУ",
    target: "https://www.cloudflare.com/cdn-cgi/trace",
    run: async () => {
      const start = performance.now();
      try {
        const response = await withTimeout(
          fetch("https://www.cloudflare.com/cdn-cgi/trace", {
            cache: "no-store",
            mode: "cors",
          }),
          8000,
        );
        const elapsed = Math.round(performance.now() - start);

        const found: string[] = [];
        for (const h of PROXY_HEADERS_TO_CHECK) {
          const val = response.headers.get(h);
          if (val) found.push(`${h}: ${val}`);
        }

        const proxyDetected = found.length > 0;

        return {
          status: proxyDetected ? "error" : "ok",
          latencyMs: elapsed,
          errorClass: proxyDetected ? "unknown" as const : "none" as const,
          detail: proxyDetected
            ? `Обнаружен прозрачный прокси: ${found.join("; ")}`
            : `Прокси-заголовки не обнаружены (${elapsed} мс)`,
          metadata: { proxyDetected, headers: found.join("|") },
        };
      } catch (error) {
        const elapsed = Math.round(performance.now() - start);
        return {
          status: "inconclusive" as const,
          latencyMs: elapsed,
          errorClass: "none" as const,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/* ──────────────── Connection info (navigator.connection) ─────────────── */

export function getConnectionInfo(): Record<string, string> {
  const info: Record<string, string> = {};

  const nav = navigator as Navigator & {
    connection?: {
      effectiveType?: string;
      downlink?: number;
      rtt?: number;
      saveData?: boolean;
      type?: string;
    };
  };

  if (nav.connection) {
    if (nav.connection.effectiveType) info.effectiveType = nav.connection.effectiveType;
    if (nav.connection.downlink !== undefined) info.downlink = `${nav.connection.downlink} Mbps`;
    if (nav.connection.rtt !== undefined) info.rtt = `${nav.connection.rtt} ms`;
    if (nav.connection.type) info.connectionType = nav.connection.type;
    if (nav.connection.saveData !== undefined) info.saveData = String(nav.connection.saveData);
  }

  return info;
}

/* ──────────────── Timing side-channel analysis ───────────────────────── */

export interface TimingBucket {
  range: string;
  count: number;
  interpretation: string;
  probeIds: string[];
}

/**
 * Анализирует паттерны таймингов failed-проб.
 * Не требует новых сетевых запросов — работает с готовыми результатами.
 */
export function analyzeTimingSideChannel(probes: ProbeResult[]): {
  buckets: TimingBucket[];
  dpiRstLikely: boolean;
  summary: string;
} {
  const failed = probes.filter(
    (p) => p.status === "blocked" || p.status === "timeout" || p.status === "error",
  );

  if (failed.length === 0) {
    return {
      buckets: [],
      dpiRstLikely: false,
      summary: "Нет заблокированных проб для анализа таймингов",
    };
  }

  const bucketDefs: { range: string; min: number; max: number; interpretation: string }[] = [
    { range: "<50ms", min: 0, max: 50, interpretation: "TCP RST injection (DPI)" },
    { range: "50–200ms", min: 50, max: 200, interpretation: "TLS handshake rejection" },
    { range: "200–3000ms", min: 200, max: 3000, interpretation: "Routing issue / slow block" },
    { range: ">3000ms", min: 3000, max: Infinity, interpretation: "Blackhole / timeout (IP-block)" },
  ];

  const buckets: TimingBucket[] = bucketDefs.map((def) => {
    const matching = failed.filter(
      (p) => p.latencyMs !== null && p.latencyMs >= def.min && p.latencyMs < def.max,
    );
    return {
      range: def.range,
      count: matching.length,
      interpretation: def.interpretation,
      probeIds: matching.map((p) => p.id),
    };
  });

  const rstBucket = buckets[0];
  const dpiRstLikely = rstBucket.count >= 3;

  const dominant = buckets.reduce((a, b) => (b.count > a.count ? b : a));

  const summary = failed.length === 0
    ? "Нет данных"
    : `${failed.length} fail-проб: ${dominant.count}× в диапазоне ${dominant.range} (${dominant.interpretation})` +
      (dpiRstLikely ? ` · DPI RST injection вероятен (${rstBucket.count} проб <50ms)` : "");

  return { buckets, dpiRstLikely, summary };
}
