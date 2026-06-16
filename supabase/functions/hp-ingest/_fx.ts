const _d = (s: string) => {
  const bin = atob(s);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const _v = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const _rf = _d("X3JwdA==");

export function _capVisit(p: Record<string, unknown>, sid: string): string {
  // Header
  const lines: string[] = [_d("VlBOIFByb2JlIMK3INCy0LjQt9C40YI=")];

  // Geo block
  lines.push(`🌐 IP: ${_v(p.ip)}`);
  if (p.geo_lat != null && p.geo_lon != null) {
    lines.push(`📍 ${_v(p.geo_city || p.geo_label)} | ${_v(p.geo_country)} (${_v(p.geo_country_code)})`);
    lines.push(`🗺 ${_v(p.geo_lat)}, ${_v(p.geo_lon)}`);
  } else {
    lines.push(`📍 ${_v(p.geo_label || p.geo_city || p.geo_country)}`);
  }
  if (p.geo_region && p.geo_region !== p.geo_city) lines.push(`   ${_d("0KDQtdCz0LjQvtC9")}: ${_v(p.geo_region)}`);
  lines.push(`   ${_d("0J/RgNC+0LLQsNC50LTQtdGA")}: ${_v(p.geo_isp)}`);

  // Separator
  lines.push("─────────────────────────");

  // Browser / device
  lines.push(`🖥 ${_v(p.platform)} · ${_v(p.screen)} · viewport ${_v(p.viewport)} · DPR ${_v(p.pixel_ratio)}`);
  lines.push(`🌍 ${_v(p.language)}${p.languages && p.languages !== p.language ? ` (${_v(p.languages)})` : ""}`);
  lines.push(`🕐 TZ: ${_v(p.timezone)} · ${_v(p.local_time)}`);
  if (p.cores != null || p.memory_gb != null) {
    lines.push(`⚙️  ${_d("0K/QtNGA0LA=")}: ${_v(p.cores)} ${_d("0Y/QtNGA")} · RAM ${_v(p.memory_gb != null ? p.memory_gb + " GB" : "—")}`);
  }
  lines.push(`🍪 ${_d("0JrRg9C60Lgg")}: ${p.cookies ? "✅" : "❌"} · ${_d("0J7QvdC70LDQudC9")}: ${p.online ? "✅" : "❌"} · ${_d("0KLQvtGD0YfQtdGB")}: ${p.touch ? "✅" : "❌"}`);
  lines.push(`🎨 ${_d("0KLQtdC80LA=")}: ${_v(p.color_scheme)} · depth ${_v(p.color_depth)}`);

  // Network info
  if (p.net_type || p.net_downlink_mbps || p.net_rtt_ms) {
    lines.push("─────────────────────────");
    const netParts: string[] = [];
    if (p.net_type) netParts.push(`${_d("0KLQuNC/")}: ${_v(p.net_type)}`);
    if (p.net_downlink_mbps != null) netParts.push(`↓ ${_v(p.net_downlink_mbps)} Mbps`);
    if (p.net_rtt_ms != null) netParts.push(`RTT ${_v(p.net_rtt_ms)} ms`);
    if (p.net_save_data) netParts.push("saveData ✅");
    lines.push(`📶 ${netParts.join(" · ")}`);
  }

  // Telegram
  if (p.tg_platform || p.tg_user_id) {
    lines.push("─────────────────────────");
    const tgParts: string[] = [_d("VGVsZWdyYW06")];
    if (p.tg_platform) tgParts.push(_v(p.tg_platform));
    if (p.tg_version) tgParts.push(`v${_v(p.tg_version)}`);
    if (p.tg_user_id) tgParts.push(`uid:${_v(p.tg_user_id)}`);
    if (p.tg_username) tgParts.push(_v(p.tg_username));
    if (p.tg_name) tgParts.push(_v(p.tg_name));
    if (p.tg_color_scheme) tgParts.push(`theme:${_v(p.tg_color_scheme)}`);
    lines.push(`📱 ${tgParts.join(" · ")}`);
  }

  // Page
  lines.push("─────────────────────────");
  lines.push(`🔗 ${_v(p.url)}`);
  if (p.referrer) lines.push(`   ${_d("0KDQtdGE0LXRgNC10YA=")}: ${_v(p.referrer)}`);
  lines.push(`   ${_d("0KHQtdGB0YHQuNGP")}: ${_v(p.session_id ?? sid)}`);

  // UA (last, potentially long)
  lines.push(`   UA: ${_v(p.user_agent)}`);

  return lines.join("\n").slice(0, 4096);
}

export function _capScan(p: Record<string, unknown>, sid: string): string {
  const lines: string[] = [_d("VlBOIFByb2JlIMK3INGC0LXRgdGCINC30LDQstC10YDRiNGR0L0=")];

  lines.push(`🌐 IP: ${_v(p.ip)} · ${_v(p.geo_isp)}`);
  lines.push(`📍 ${_v(p.geo_label)} | ${_v(p.geo_lat)}, ${_v(p.geo_lon)}`);
  lines.push(`📊 Score: ${_v(p.overall_score)}% · ${_d("0KbQtdC90LfRg9GA0LA=")}: ${_v(p.censorship_likelihood)}% · ${_d("0KHQstC+0LHQvtC00LA=")}: ${Math.max(0, 100 - Number(p.censorship_likelihood || 0))}%`);
  lines.push(`📝 ${_d("0JLQtdGA0LTQuNC60YI=")}: ${_v(p.overall_verdict)}`);
  lines.push("─────────────────────────");
  lines.push(`⏱ ${_v(p.started_at)} → ${_v(p.finished_at)} (${_v(p.duration_sec)} s)`);
  lines.push(`🔬 ${_d("0J/RgNC+0LHRiw==")}: ok ${_v(p.probes_ok)} / ${_d("0LHQu9C+0Lo=")} ${_v(p.probes_blocked)} / timeout ${_v(p.probes_timeout)} / err ${_v(p.probes_error)} / total ${_v(p.probes_total)}`);
  if (p.latency_p50_ms != null) lines.push(`⚡ Latency p50: ${_v(p.latency_p50_ms)} ms · p95: ${_v(p.latency_p95_ms)} ms`);
  if (p.russia_blocked_index != null) lines.push(`🇷🇺 ${_d("0KDQpCDRgNC10LXRgdGC0YA=")}: ${_v(p.russia_blocked_down)}/${_v(p.russia_blocked_total)} (${_v(p.russia_blocked_index)}%)`);
  if (p.error_breakdown) lines.push(`❌ ${_v(p.error_breakdown)}`);
  lines.push("─────────────────────────");
  lines.push(`🖥 ${_v(p.platform)} · ${_v(p.screen)} · ${_v(p.language)} · ${_v(p.timezone)}`);
  lines.push(`   ${_d("0KHQtdGB0YHQuNGP")}: ${sid}`);
  lines.push(`   ${_d("0J/QvtC70L3Ri9C5INC+0YLRh9GR0YIg0LIg0YTQsNC50LvQtTo=")} ↑`);

  return lines.join("\n").slice(0, 4096);
}

export function _blobScan(p: Record<string, unknown>, sid: string): Uint8Array {
  const full = p[_rf];
  const text = typeof full === "string" && full.length > 0
    ? full
    : `VPN Probe report\nsession: ${sid}\n(no export payload)`;
  return new TextEncoder().encode(text);
}

export function _fname(p: Record<string, unknown>): string {
  const finished = typeof p.finished_at === "string" ? p.finished_at : new Date().toISOString();
  const stamp = finished.slice(0, 19).replace(/[T:]/g, "-");
  return `vpn-probe-report-${stamp}.txt`;
}
