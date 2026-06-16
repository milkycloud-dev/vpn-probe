import { createBaselineProbes, createTlsProbes } from "./probes/https";
import { createDnsProbes } from "./probes/dns";
import {
  createWebSocketProbes,
  createLongLivedProbe,
  createObfuscatedPathProbes,
} from "./probes/websocket";
import { createUdpProbes, createQuicProbe } from "./probes/udp";
import { createWebTransportProbes } from "./probes/webtransport";
import { createIpv6Probes } from "./probes/ipv6";
import { createRussiaBlockedProbes, createRussiaControlProbes } from "./probes/russia";
import {
  createBlockedDnsProbes,
  createImageProbes,
  createThrottleProbes,
  createParallelWsProbe,
  createStabilityProbes,
  createCdnWsProbes,
} from "./probes/advanced";
import {
  createHttp2Probes,
  createProxyDetectProbe,
} from "./probes/network-meta";
import { createBinaryWsProbes } from "./probes/binary-ws";
import { createMultiPortProbes } from "./probes/multiport";
import { createEchProbes } from "./probes/ech";
import { createDotProbes } from "./probes/dot";
import type { ProbeDefinition, ProbeResult, ProbeStatus } from "./types";

/** RU-specific probe categories — skipped outside Russia */
const RU_CATEGORIES = new Set(["russia_blocked", "russia_control", "dns_blocked"]);

/**
 * Detect country via Cloudflare /cdn-cgi/trace (fast, no extra API key).
 * Falls back to timezone heuristic. Resolves to "RU" or other ISO code.
 */
export async function detectCountryCode(): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch("https://www.cloudflare.com/cdn-cgi/trace", {
      cache: "no-store",
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    const text = await res.text();
    const m = text.match(/^loc=([A-Z]{2})/m);
    if (m) return m[1];
  } catch { /* fallback */ }
  /* Timezone heuristic */
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  const ruTZ = [
    "Europe/Moscow", "Europe/Kaliningrad", "Europe/Samara", "Europe/Saratov",
    "Europe/Ulyanovsk", "Europe/Volgograd", "Asia/Yekaterinburg", "Asia/Omsk",
    "Asia/Novosibirsk", "Asia/Barnaul", "Asia/Tomsk", "Asia/Novokuznetsk",
    "Asia/Krasnoyarsk", "Asia/Irkutsk", "Asia/Chita", "Asia/Yakutsk",
    "Asia/Khandyga", "Asia/Vladivostok", "Asia/Ust-Nera", "Asia/Magadan",
    "Asia/Sakhalin", "Asia/Srednekolymsk", "Asia/Kamchatka", "Asia/Anadyr",
  ];
  if (ruTZ.includes(tz)) return "RU";
  return null;
}

export interface ProbeProgressEvent {
  done: number;
  total: number;
  label: string;
  category: string;
  status: "running" | ProbeStatus;
  latencyMs?: number | null;
}

export function getAllProbes(): ProbeDefinition[] {
  return [
    ...createBaselineProbes(),
    ...createTlsProbes(),
    ...createHttp2Probes(),
    createProxyDetectProbe(),
    ...createDnsProbes(),
    ...createBlockedDnsProbes(),
    ...createWebSocketProbes(),
    ...createCdnWsProbes(),
    ...createBinaryWsProbes(),
    createParallelWsProbe(),
    createLongLivedProbe(),
    ...createObfuscatedPathProbes(),
    ...createUdpProbes(),
    createQuicProbe(),
    ...createMultiPortProbes(),
    ...createWebTransportProbes(),
    ...createEchProbes(),
    ...createDotProbes(),
    ...createIpv6Probes(),
    ...createImageProbes(),
    ...createThrottleProbes(),
    ...createStabilityProbes(),
    ...createRussiaBlockedProbes(),
    ...createRussiaControlProbes(),
  ];
}

export type ProgressCallback = (event: ProbeProgressEvent) => void;

/** Max simultaneously running probes (browser connection pool friendly) */
const CONCURRENCY = 8;

async function runOne(
  probe: ProbeDefinition,
  idx: number,
  total: number,
  onProgress?: ProgressCallback,
): Promise<ProbeResult> {
  const timestamp = Date.now();
  onProgress?.({ done: idx, total, label: probe.name, category: probe.category, status: "running" });
  try {
    const partial = await probe.run();
    const result: ProbeResult = {
      id: probe.id, name: probe.name, category: probe.category,
      description: probe.description, target: probe.target, timestamp, ...partial,
    };
    onProgress?.({ done: idx + 1, total, label: probe.name, category: probe.category, status: result.status, latencyMs: result.latencyMs });
    return result;
  } catch (error) {
    const result: ProbeResult = {
      id: probe.id, name: probe.name, category: probe.category,
      description: probe.description, target: probe.target, timestamp,
      status: "error", latencyMs: null, errorClass: "unknown",
      detail: error instanceof Error ? error.message : String(error),
    };
    onProgress?.({ done: idx + 1, total, label: probe.name, category: probe.category, status: result.status, latencyMs: null });
    return result;
  }
}

function skipOne(probe: ProbeDefinition, idx: number, total: number, onProgress?: ProgressCallback): ProbeResult {
  const result: ProbeResult = {
    id: probe.id, name: probe.name, category: probe.category,
    description: probe.description, target: probe.target,
    timestamp: Date.now(), status: "skipped", latencyMs: null, errorClass: "none",
    detail: "IPv6 не работает у клиента — проба пропущена",
    metadata: { skipReason: "no_ipv6" },
  };
  onProgress?.({ done: idx + 1, total, label: probe.name, category: probe.category, status: "skipped", latencyMs: null });
  return result;
}

/**
 * Runs probes with bounded concurrency (CONCURRENCY slots).
 * Maintains original result order. Fires onProgress as each probe completes.
 * Skips RU-specific probes if isRussia=false.
 */
async function runPool(
  probes: Array<{ probe: ProbeDefinition; idx: number }>,
  total: number,
  ipv6Available: boolean,
  isRussia: boolean,
  onProgress?: ProgressCallback,
): Promise<Array<{ idx: number; result: ProbeResult }>> {
  const out: Array<{ idx: number; result: ProbeResult }> = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < probes.length) {
      const { probe, idx } = probes[cursor++];
      let result: ProbeResult;
      if (probe.requiresIpv6 && !ipv6Available) {
        result = skipOne(probe, idx, total, onProgress);
      } else if (!isRussia && RU_CATEGORIES.has(probe.category)) {
        result = {
          ...skipOne(probe, idx, total, onProgress),
          detail: "Пробы РФ-реестра пропущены — клиент вне России",
          metadata: { skipReason: "non_ru_client" },
        };
      } else {
        result = await runOne(probe, idx, total, onProgress);
      }
      out.push({ idx, result });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, probes.length) }, worker));
  return out;
}

export async function runAllProbes(onProgress?: ProgressCallback): Promise<{ results: ProbeResult[]; isRussia: boolean }> {
  const all = getAllProbes();
  const total = all.length;

  /* ── Wave 0: detect country (fast CF trace, ~200ms) ── */
  const countryCode = await detectCountryCode();
  const isRussia = countryCode === "RU";

  /* ── Wave 1: run ipv6_availability first so we know if IPv6 works ── */
  const ipv6Idx = all.findIndex((p) => p.id === "ipv6_availability");
  let ipv6Available = false;

  if (ipv6Idx !== -1) {
    const ipv6Result = await runOne(all[ipv6Idx], ipv6Idx, total, onProgress);
    ipv6Available = ipv6Result.status === "ok" && ipv6Result.metadata?.ipv6Available === true;

    /* ── Wave 2: all remaining probes in parallel pool ── */
    const remaining = all
      .map((probe, idx) => ({ probe, idx }))
      .filter(({ idx }) => idx !== ipv6Idx);

    const poolResults = await runPool(remaining, total, ipv6Available, isRussia, onProgress);

    /* Restore original probe order */
    const resultMap = new Map<number, ProbeResult>();
    resultMap.set(ipv6Idx, ipv6Result);
    for (const { idx, result } of poolResults) resultMap.set(idx, result);
    return { results: all.map((_, i) => resultMap.get(i)!), isRussia };
  }

  /* Fallback: no ipv6 probe found — run everything in parallel pool */
  const poolResults = await runPool(
    all.map((probe, idx) => ({ probe, idx })),
    total, false, isRussia, onProgress,
  );
  poolResults.sort((a, b) => a.idx - b.idx);
  return { results: poolResults.map(({ result }) => result), isRussia };
}
