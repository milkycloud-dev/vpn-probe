import type {
  FullReport,
  LayerSummary,
  ProbeResult,
  ProbeStatus,
  ProtocolAssessment,
  ProtocolVerdict,
  SplitScores,
  StatisticsSummary,
  TraceHop,
} from "./types";
import { getConnectionInfo, analyzeTimingSideChannel } from "./probes/network-meta";

function isOpen(s: ProbeStatus): boolean { return s === "ok"; }
function isBlocked(s: ProbeStatus): boolean { return s === "blocked" || s === "timeout" || s === "error"; }
function isWeak(s: ProbeStatus): boolean { return s === "inconclusive" || s === "skipped"; }

function avgLatency(probes: ProbeResult[]): number | null {
  const v = probes.map((p) => p.latencyMs).filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function scoreProbes(probes: ProbeResult[]): number {
  if (!probes.length) return 0;
  const w: Record<ProbeStatus, number> = { ok: 1, blocked: 0, timeout: 0.08, error: 0.12, inconclusive: 0.3, skipped: 0.25 };
  return Math.round((probes.reduce((s, p) => s + w[p.status], 0) / probes.length) * 100);
}

function layerSummary(layer: string, icon: string, probes: ProbeResult[]): LayerSummary {
  const open = probes.filter((p) => isOpen(p.status)).length;
  const blocked = probes.filter((p) => isBlocked(p.status)).length;
  const inconclusive = probes.filter((p) => isWeak(p.status)).length;
  const dominant: ProbeStatus = blocked + inconclusive * 0.4 > open ? "blocked" : open > 0 ? "ok" : "inconclusive";
  return { layer, icon, status: dominant, openCount: open, blockedCount: blocked, inconclusiveCount: inconclusive, total: probes.length, avgLatencyMs: avgLatency(probes) };
}

function assessProtocol(
  id: string, name: string, transport: string,
  relatedProbes: ProbeResult[], signals: string[],
  hasDirectProbe: boolean,
): ProtocolAssessment {
  if (!hasDirectProbe || relatedProbes.length === 0) {
    return {
      id, name, transport, verdict: "inconclusive", confidence: 18,
      summary: "Нет прямой пробы из браузера — оценка ненадёжна",
      signals: [...signals, "Требуется нативный VPN-клиент для точного теста"],
      relatedProbes: relatedProbes.map((p) => p.id),
    };
  }

  const open = relatedProbes.filter((p) => isOpen(p.status)).length;
  const blocked = relatedProbes.filter((p) => isBlocked(p.status)).length;
  const weak = relatedProbes.filter((p) => isWeak(p.status)).length;
  const total = relatedProbes.length;
  const effBlock = (blocked + weak * 0.55) / total;

  let verdict: ProtocolVerdict = "inconclusive";
  let confidence = 22;

  if (effBlock >= 0.4) { verdict = "likely_blocked"; confidence = Math.round(28 + effBlock * 35); }
  else if (open / total >= 0.75 && blocked === 0) { verdict = "likely_open"; confidence = Math.round(26 + (open / total) * 32); }
  else if (open / total >= 0.5) { verdict = "inconclusive"; confidence = Math.round(20 + (open / total) * 18); }

  confidence = Math.min(62, Math.max(12, confidence));

  return {
    id, name, transport, verdict, confidence,
    summary: verdict === "likely_blocked"
      ? `Транспорт вероятно фильтруется (${blocked} блок / ${total})`
      : verdict === "likely_open"
        ? `Транспорт может работать (${open}/${total}), без гарантий`
        : `Смешанные сигналы (${open} ок, ${blocked} блок, ${weak} неопр.)`,
    signals, relatedProbes: relatedProbes.map((p) => p.id),
  };
}

function byCat(probes: ProbeResult[], cats: string[]): ProbeResult[] {
  return probes.filter((p) => cats.includes(p.category));
}

function buildStatistics(probes: ProbeResult[], isRussia: boolean): StatisticsSummary {
  const latencies = probes.map((p) => p.latencyMs).filter((v): v is number => v !== null);
  const errorBreakdown: Record<string, number> = {};
  for (const p of probes) errorBreakdown[p.errorClass] = (errorBreakdown[p.errorClass] ?? 0) + 1;

  const ruBlocked = probes.filter((p) => p.category === "russia_blocked");
  const ruControl = probes.filter((p) => p.category === "russia_control");
  const ruBlockedDown = ruBlocked.filter((p) => isBlocked(p.status)).length;
  const ruControlUp = ruControl.filter((p) => isOpen(p.status)).length;
  const russiaBlockedIndex = ruBlocked.length ? Math.round((ruBlockedDown / ruBlocked.length) * 100) : 0;

  const dnsBlocked = probes.filter((p) => p.category === "dns_blocked");
  const dnsPoisoned = dnsBlocked.filter((p) => p.errorClass === "dns_poisoned" || p.status === "blocked").length;

  const imgProbes = probes.filter((p) => p.category === "image_probe");
  const imgBlocked = imgProbes.filter((p) => isBlocked(p.status) || p.status === "error").length;

  const throttleProbes = probes.filter((p) => p.category === "throttle");
  const throttleRatios = throttleProbes
    .map((p) => (typeof p.metadata?.ratio === "number" ? p.metadata.ratio : null))
    .filter((v): v is number => v !== null);
  const throttleRatio = throttleRatios.length
    ? Math.round((throttleRatios.reduce((a, b) => a + b, 0) / throttleRatios.length) * 10) / 10
    : null;

  const blockedRatio = probes.filter((p) => isBlocked(p.status)).length / Math.max(probes.length, 1);
  const timeoutRatio = probes.filter((p) => p.status === "timeout").length / Math.max(probes.length, 1);

  /* Outside Russia: RU-specific signals are not relevant — zero them out */
  const ruBlockIdx = isRussia ? russiaBlockedIndex : 0;
  const dnsPoisonRatio = isRussia ? (dnsPoisoned / Math.max(dnsBlocked.length, 1)) : 0;
  const ruControlPenalty = isRussia && ruControlUp < ruControl.length * 0.6 ? 8 : 0;

  const censorshipLikelihood = Math.min(95, Math.round(
    ruBlockIdx * 0.35 +
    dnsPoisonRatio * 20 +
    (imgBlocked / Math.max(imgProbes.length, 1)) * 18 +
    blockedRatio * 25 +
    timeoutRatio * 12 +
    ruControlPenalty +
    (throttleRatio != null && throttleRatio >= 3 ? 10 : 0),
  ));

  return {
    total: probes.length,
    ok: probes.filter((p) => p.status === "ok").length,
    blocked: probes.filter((p) => p.status === "blocked").length,
    timeout: probes.filter((p) => p.status === "timeout").length,
    error: probes.filter((p) => p.status === "error").length,
    inconclusive: probes.filter((p) => isWeak(p.status)).length,
    latencyP50: latencies.length ? percentile(latencies, 50) : null,
    latencyP95: latencies.length ? percentile(latencies, 95) : null,
    latencyMin: latencies.length ? Math.min(...latencies) : null,
    latencyMax: latencies.length ? Math.max(...latencies) : null,
    errorBreakdown,
    russiaBlockedTotal: ruBlocked.length,
    russiaBlockedDown: ruBlockedDown,
    russiaBlockedIndex,
    russiaControlTotal: ruControl.length,
    russiaControlUp: ruControlUp,
    censorshipLikelihood,
    dnsBlockedPoisoned: dnsPoisoned,
    imageBlockDetected: imgBlocked,
    throttleRatio,
  };
}

function buildSplitScores(probes: ProbeResult[], stats: StatisticsSummary): SplitScores {
  const vpnTransport = scoreProbes(byCat(probes, [
    "websocket", "path_obfuscation", "long_lived", "parallel_ws", "udp", "webtransport", "stability",
    "binary_ws", "multiport",
  ]));
  const baseline = scoreProbes(byCat(probes, ["baseline", "tls", "dns", "http2_check", "proxy_detect"]));
  return {
    censorship: Math.max(8, 100 - stats.censorshipLikelihood),
    vpnTransport: Math.min(100, vpnTransport),
    baseline: Math.min(100, baseline),
  };
}

export function buildReport(
  probes: ProbeResult[],
  startedAt: number,
  cascadeRoute: TraceHop[],
  isRussia = true,
): FullReport {
  const finishedAt = Date.now();
  const statistics = buildStatistics(probes, isRussia);
  const splitScores = buildSplitScores(probes, statistics);

  const wsAll = byCat(probes, ["websocket", "path_obfuscation", "long_lived", "parallel_ws", "binary_ws"]);
  const tlsProbes = byCat(probes, ["tls", "baseline"]);
  const udpProbes = byCat(probes, ["udp"]);
  const wtProbes = byCat(probes, ["webtransport"]);
  const quicProbes = [...udpProbes, ...wtProbes];
  const ipv6Probes = byCat(probes, ["ipv6"]);
  const echProbes = byCat(probes, ["ech"]);
  const multiportProbes = byCat(probes, ["multiport"]);

  const layers: LayerSummary[] = [
    layerSummary("Базовый интернет", "globe", byCat(probes, ["baseline"])),
    layerSummary("HTTP/2", "lock", byCat(probes, ["http2_check", "proxy_detect"])),
    layerSummary("DNS", "dns", byCat(probes, ["dns", "dns_blocked", "dot_probe"])),
    layerSummary("TLS 443", "lock", byCat(probes, ["tls"])),
    layerSummary("WebSocket", "ws", wsAll),
    layerSummary("UDP / QUIC", "udp", quicProbes),
    layerSummary("Порты", "lock", multiportProbes),
    layerSummary("ECH", "lock", echProbes),
    layerSummary("IPv6", "globe", ipv6Probes),
    layerSummary("IMG-пробы", "image", byCat(probes, ["image_probe"])),
    layerSummary("Throttling", "throttle", byCat(probes, ["throttle"])),
    layerSummary("РФ блок", "ru", byCat(probes, ["russia_blocked"])),
    layerSummary("РФ контроль", "check", byCat(probes, ["russia_control"])),
    layerSummary("Каскад", "route", cascadeRoute.map((h) => ({
      id: `cascade_${h.hop}`, name: h.label, category: "cascade" as const,
      description: "", status: h.status, latencyMs: h.latencyMs,
      errorClass: "none" as const, detail: h.detail, target: h.target, timestamp: finishedAt,
    }))),
  ];

  /* ECH signals for protocol assessments */
  const echBlocked = echProbes.some((p) => p.status === "blocked" || p.status === "timeout");
  const echSignal = echBlocked ? "ECH заблокирован — ТСПУ глубоко инспектирует TLS" : "ECH-домены доступны";

  /* Multiport signals */
  const portsOpen = multiportProbes.filter((p) => p.status === "ok").length;
  const portSignal = `${portsOpen}/${multiportProbes.length} портов открыты`;

  const protocols: ProtocolAssessment[] = [
    assessProtocol("vless_ws", "VLESS + TLS + WS", "WSS 443", wsAll, ["DPI режет WSS", "Долгие сессии", "CDN-SNI", echSignal], true),
    assessProtocol("vmess_ws", "VMess + WS", "WSS 443", wsAll, ["Аналогичный транспорт VLESS"], true),
    assessProtocol("trojan_tls", "Trojan", "TLS 443", [...tlsProbes, ...echProbes], ["Маскировка HTTPS", "Active probe не тестируется", echSignal], true),
    assessProtocol("shadowsocks_ws", "SS + WS", "WSS", wsAll.slice(0, 6), ["SS-over-WS"], true),
    assessProtocol("shadowsocks_raw", "Shadowsocks raw", "TCP/UDP", [], ["Браузер не умеет"], false),
    assessProtocol("wireguard", "WireGuard", "UDP", udpProbes, ["STUN ≠ WG порт", "Handshake невозможен", portSignal], true),
    assessProtocol("openvpn_udp", "OpenVPN UDP", "UDP", udpProbes, ["Порт 1194 недоступен"], false),
    assessProtocol("openvpn_tcp", "OpenVPN TCP", "TCP 443", [...tlsProbes, ...multiportProbes], ["Только TLS эвристика", portSignal], true),
    assessProtocol("hysteria", "Hysteria/QUIC", "UDP/QUIC", quicProbes, ["QUIC блокируют чаще", "WebTransport = прямой QUIC-тест"], true),
    assessProtocol("ikev2", "IKEv2", "UDP 500", [], ["Не тестируется"], false),
    assessProtocol("vless_reality", "VLESS Reality", "uTLS", echProbes, ["uTLS из браузера невозможен", echSignal], echProbes.length > 0),
  ];

  const overallScore = Math.max(3, Math.min(100, Math.round(
    splitScores.vpnTransport * 0.45 + splitScores.baseline * 0.3 + splitScores.censorship * 0.25 -
    statistics.censorshipLikelihood * 0.15,
  )));

  let overallVerdict = "Смешанная картина — VPN-транспорты под вопросом";
  if (statistics.censorshipLikelihood >= 60) {
    overallVerdict = "Сильная цензура — большинство обходов под запретом. VPN без обфускации не сработают";
  } else if (statistics.censorshipLikelihood >= 45 || splitScores.vpnTransport < 30) {
    overallVerdict = "VPN-протоколы без обфускации не сработают";
  } else if (splitScores.vpnTransport >= 55 && statistics.censorshipLikelihood < 35) {
    overallVerdict = "Транспорты частично доступны — без гарантий";
  } else if (statistics.censorshipLikelihood >= 30) {
    overallVerdict = "Умеренные ограничения — нужны обходные протоколы";
  }

  /* Timing side-channel analysis (no network requests) */
  const timingAnalysis = analyzeTimingSideChannel(probes);

  /* Connection info from Navigator API */
  const connInfo = getConnectionInfo();

  const environment: Record<string, string> = {
    platform: navigator.platform,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    probes: String(probes.length),
    cascade: String(cascadeRoute.length),
    ...connInfo,
    timingAnalysis: timingAnalysis.summary,
    dpiRstLikely: String(timingAnalysis.dpiRstLikely),
  };

  return {
    startedAt, finishedAt, durationMs: finishedAt - startedAt,
    probes, protocols, layers, cascadeRoute, statistics, splitScores,
    environment, overallScore, overallVerdict,
  };
}
