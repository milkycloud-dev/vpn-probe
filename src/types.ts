export type ProbeStatus =
  | "ok"
  | "blocked"
  | "timeout"
  | "error"
  | "inconclusive"
  | "skipped";

export type ErrorClass =
  | "none"
  | "dns_failure"
  | "dns_poisoned"
  | "tls_handshake"
  | "tls_cert"
  | "tcp_reset"
  | "connection_refused"
  | "timeout"
  | "websocket_rejected"
  | "cors_opaque"
  | "udp_blocked"
  | "throttled"
  | "unknown";

export type ProbeCategory =
  | "baseline"
  | "dns"
  | "dns_blocked"
  | "tls"
  | "websocket"
  | "udp"
  | "long_lived"
  | "path_obfuscation"
  | "parallel_ws"
  | "image_probe"
  | "throttle"
  | "stability"
  | "webtransport"
  | "ipv6"
  | "russia_blocked"
  | "russia_control"
  | "cascade"
  | "http2_check"
  | "proxy_detect"
  | "binary_ws"
  | "multiport"
  | "ech"
  | "dot_probe"
  | "timing_analysis";

export interface ScanProgress {
  done: number;
  total: number;
  label: string;
  category?: string;
  status?: "running" | ProbeStatus;
  latencyMs?: number | null;
  phase?: string;
  startedAt: number;
}

export interface ProbeResult {
  id: string;
  name: string;
  category: ProbeCategory;
  description: string;
  status: ProbeStatus;
  latencyMs: number | null;
  errorClass: ErrorClass;
  detail: string;
  target: string;
  timestamp: number;
  metadata?: Record<string, string | number | boolean>;
}

export type ProtocolVerdict = "likely_open" | "likely_blocked" | "inconclusive";

export interface ProtocolAssessment {
  id: string;
  name: string;
  transport: string;
  verdict: ProtocolVerdict;
  confidence: number;
  summary: string;
  signals: string[];
  relatedProbes: string[];
}

export interface LayerSummary {
  layer: string;
  icon: string;
  status: ProbeStatus;
  openCount: number;
  blockedCount: number;
  inconclusiveCount: number;
  total: number;
  avgLatencyMs: number | null;
}

export interface TraceHop {
  hop: number;
  label: string;
  target: string;
  latencyMs: number | null;
  deltaMs: number | null;
  status: ProbeStatus;
  detail: string;
}

export interface SplitScores {
  censorship: number;
  vpnTransport: number;
  baseline: number;
}

export interface StatisticsSummary {
  total: number;
  ok: number;
  blocked: number;
  timeout: number;
  error: number;
  inconclusive: number;
  latencyP50: number | null;
  latencyP95: number | null;
  latencyMin: number | null;
  latencyMax: number | null;
  errorBreakdown: Record<string, number>;
  russiaBlockedTotal: number;
  russiaBlockedDown: number;
  russiaBlockedIndex: number;
  russiaControlTotal: number;
  russiaControlUp: number;
  censorshipLikelihood: number;
  dnsBlockedPoisoned: number;
  imageBlockDetected: number;
  throttleRatio: number | null;
}

export interface FullReport {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  probes: ProbeResult[];
  protocols: ProtocolAssessment[];
  layers: LayerSummary[];
  cascadeRoute: TraceHop[];
  statistics: StatisticsSummary;
  splitScores: SplitScores;
  environment: Record<string, string>;
  overallScore: number;
  overallVerdict: string;
}

export interface ProbeDefinition {
  id: string;
  name: string;
  category: ProbeCategory;
  description: string;
  target: string;
  requiresIpv6?: boolean;
  run: () => Promise<Omit<ProbeResult, "id" | "name" | "category" | "description" | "target" | "timestamp">>;
}
