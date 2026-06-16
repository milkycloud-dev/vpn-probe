import { buildNarrative } from "./narrative";
import type { FullReport, ProbeResult, ProtocolAssessment } from "./types";
import { statusLabel, verdictLabel } from "./utils";

const DIVIDER = "═".repeat(72);
const SECTION = "─".repeat(72);

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium" });
}

function fmtLatency(ms: number | null): string {
  return ms !== null ? `${ms} ms` : "—";
}

function lines(...rows: Array<string | undefined | null>): string[] {
  return rows.filter((r): r is string => Boolean(r));
}

function section(title: string, body: string[]): string {
  return [`\n${SECTION}`, title, SECTION, ...body].join("\n");
}

function formatMetadata(meta?: Record<string, string | number | boolean>): string {
  if (!meta || !Object.keys(meta).length) return "";
  return Object.entries(meta)
    .map(([k, v]) => `      ${k}=${v}`)
    .join("\n");
}

function formatProbe(p: ProbeResult): string {
  const meta = formatMetadata(p.metadata);
  return lines(
    `[${p.id}] ${p.name}`,
    `  category: ${p.category}`,
    `  status: ${p.status} (${statusLabel(p.status)})`,
    `  error_class: ${p.errorClass}`,
    `  latency: ${fmtLatency(p.latencyMs)}`,
    `  target: ${p.target}`,
    `  description: ${p.description}`,
    `  detail: ${p.detail}`,
    meta ? `  metadata:\n${meta}` : undefined,
    `  timestamp: ${fmtTime(p.timestamp)}`,
  ).join("\n");
}

function formatProtocol(p: ProtocolAssessment): string {
  return lines(
    `${p.name} (${p.transport})`,
    `  id: ${p.id}`,
    `  verdict: ${p.verdict} (${verdictLabel(p.verdict)})`,
    `  confidence: ${p.confidence}%`,
    `  summary: ${p.summary}`,
    `  signals:`,
    ...p.signals.map((s) => `    - ${s}`),
    `  related_probes: ${p.relatedProbes.join(", ") || "—"}`,
  ).join("\n");
}

function groupProbes(probes: ProbeResult[]): Map<string, ProbeResult[]> {
  const map = new Map<string, ProbeResult[]>();
  for (const p of probes) {
    const list = map.get(p.category) ?? [];
    list.push(p);
    map.set(p.category, list);
  }
  return map;
}

/** Полный текстовый отчёт для разработчика — копирование и скачивание. */
export function formatDetailedReport(report: FullReport): string {
  const s = report.statistics;
  const narrative = buildNarrative(report);
  const grouped = groupProbes(report.probes);
  const categories = [...grouped.keys()].sort();

  const header = [
    DIVIDER,
    "VPN PROBE — ПОЛНЫЙ ОТЧЁТ ДИАГНОСТИКИ",
    DIVIDER,
    `generated_at: ${fmtTime(report.finishedAt)}`,
    `scan_started: ${fmtTime(report.startedAt)}`,
    `scan_finished: ${fmtTime(report.finishedAt)}`,
    `duration: ${(report.durationMs / 1000).toFixed(1)} s (${report.durationMs} ms)`,
    `probe_count: ${s.total}`,
    "",
    "ИТОГ",
    `  overall_score: ${report.overallScore}%`,
    `  overall_verdict: ${report.overallVerdict}`,
    `  narrative_headline: ${narrative.headline}`,
    `  narrative_tone: ${narrative.tone}`,
  ];

  const scores = section("СКОРИНГ", [
    `censorship_likelihood: ${s.censorshipLikelihood}%`,
    `split_censorship (свобода): ${report.splitScores.censorship}%`,
    `split_vpn_transport: ${report.splitScores.vpnTransport}%`,
    `split_baseline (интернет): ${report.splitScores.baseline}%`,
    `russia_blocked_index: ${s.russiaBlockedIndex}%`,
    `russia_blocked: ${s.russiaBlockedDown}/${s.russiaBlockedTotal}`,
    `russia_control: ${s.russiaControlUp}/${s.russiaControlTotal}`,
    `dns_blocked_poisoned: ${s.dnsBlockedPoisoned}`,
    `image_blocks_detected: ${s.imageBlockDetected}`,
    `throttle_ratio_avg: ${s.throttleRatio !== null ? `${s.throttleRatio}×` : "—"}`,
  ]);

  const stats = section("СТАТИСТИКА ПРОБ", [
    `ok: ${s.ok}`,
    `blocked: ${s.blocked}`,
    `timeout: ${s.timeout}`,
    `error: ${s.error}`,
    `inconclusive + skipped: ${s.inconclusive}`,
    `latency_p50: ${fmtLatency(s.latencyP50)}`,
    `latency_p95: ${fmtLatency(s.latencyP95)}`,
    `latency_min: ${fmtLatency(s.latencyMin)}`,
    `latency_max: ${fmtLatency(s.latencyMax)}`,
    "",
    "error_breakdown:",
    ...Object.entries(s.errorBreakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  ${k}: ${v}`),
  ]);

  const narrativeSec = section("РАЗБОР (NARRATIVE)", [
    narrative.headline,
    "",
    ...narrative.paragraphs.map((p, i) => `${i + 1}. ${p}`),
  ]);

  const layersSec = section("СЛОИ СЕТИ", report.layers.map((l) =>
    `${l.layer}: status=${l.status} ok=${l.openCount} block=${l.blockedCount} ` +
    `inconclusive=${l.inconclusiveCount} total=${l.total} avg_latency=${fmtLatency(l.avgLatencyMs)}`,
  ));

  const protoSec = section("VPN ПРОТОКОЛЫ", report.protocols.map(formatProtocol));

  const cascadeSec = section("КАСКАД МАРШРУТА", report.cascadeRoute.flatMap((h) => [
    `hop ${h.hop}: ${h.label}`,
    `  target: ${h.target}`,
    `  status: ${h.status} (${statusLabel(h.status)})`,
    `  latency: ${fmtLatency(h.latencyMs)} delta: ${h.deltaMs !== null ? `${h.deltaMs} ms` : "—"}`,
    `  detail: ${h.detail}`,
    "",
  ]));

  const envSec = section("ОКРУЖЕНИЕ КЛИЕНТА", Object.entries(report.environment).map(([k, v]) => `${k}: ${v}`));

  const probeSections = categories.map((cat) => {
    const probes = grouped.get(cat) ?? [];
    const ok = probes.filter((p) => p.status === "ok").length;
    const block = probes.filter((p) => ["blocked", "timeout", "error"].includes(p.status)).length;
    const body = probes.flatMap((p, i) => (i > 0 ? ["", formatProbe(p)] : [formatProbe(p)]));
    return section(`ПРОБЫ: ${cat.toUpperCase()} (${ok} ok / ${block} fail / ${probes.length} total)`, body);
  });

  const footer = [
    "",
    DIVIDER,
    "КОНЕЦ ОТЧЁТА",
    "Источник: VPN Probe (browser-side diagnostics, no backend)",
    "Все пробы с устройства пользователя на публичные endpoints.",
    DIVIDER,
  ];

  return [...header, scores, stats, narrativeSec, layersSec, protoSec, cascadeSec, envSec, ...probeSections, ...footer].join("\n");
}

/** Полный отчёт в одну строку для буфера — тот же дамп, что при скачивании, без разделителей. */
export function formatCopyLine(report: FullReport): string {
  return formatDetailedReport(report)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^[═─]{3,}$/.test(line))
    .join(" ")
    .replace(/\s{2,}/g, " ");
}

/** @deprecated используйте formatDetailedReport */
export const formatShareReport = formatDetailedReport;

export function reportFilename(report: FullReport): string {
  const stamp = new Date(report.finishedAt).toISOString().slice(0, 19).replace(/[T:]/g, "-");
  return `vpn-probe-report-${stamp}.txt`;
}

export function downloadTextReport(report: FullReport): void {
  const text = formatDetailedReport(report);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = reportFilename(report);
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
