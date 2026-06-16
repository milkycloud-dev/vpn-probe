type NetInfo = {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
};

type TgUser = { id?: number; username?: string; first_name?: string; last_name?: string };
type TgWebApp = {
  platform?: string;
  version?: string;
  isExpanded?: boolean;
  viewportHeight?: number;
  colorScheme?: string;
  initDataUnsafe?: { user?: TgUser };
};

const _x = (s: string) => atob(s);

export function _ctx(): Record<string, unknown> {
  const nav = navigator as Navigator & { connection?: NetInfo; deviceMemory?: number };
  const conn = nav.connection;
  const tg = (window.Telegram?.WebApp ?? null) as TgWebApp | null;
  const meta: Record<string, unknown> = {
    url: location.href,
    host: location.host,
    path: location.pathname,
    referrer: document.referrer || null,
    page_title: document.title,
    language: navigator.language,
    languages: navigator.languages?.length ? navigator.languages.join(", ") : null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    local_time: new Date().toISOString(),
    platform: navigator.platform,
    user_agent: navigator.userAgent,
    screen: `${screen.width}x${screen.height}`,
    viewport: `${innerWidth}x${innerHeight}`,
    pixel_ratio: devicePixelRatio,
    color_depth: screen.colorDepth,
    online: navigator.onLine,
    cookies: navigator.cookieEnabled,
    cores: nav.hardwareConcurrency ?? null,
    memory_gb: nav.deviceMemory ?? null,
    touch: navigator.maxTouchPoints > 0,
    color_scheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    visibility: document.visibilityState,
  };

  if (conn) {
    meta.net_type = conn.effectiveType ?? null;
    meta.net_downlink_mbps = conn.downlink ?? null;
    meta.net_rtt_ms = conn.rtt ?? null;
    meta.net_save_data = conn.saveData ?? null;
  }

  if (tg) {
    meta.tg_platform = tg.platform ?? null;
    meta.tg_version = tg.version ?? null;
    meta.tg_expanded = tg.isExpanded ?? null;
    meta.tg_viewport_h = tg.viewportHeight ?? null;
    meta.tg_color_scheme = tg.colorScheme ?? null;
    const user = tg.initDataUnsafe?.user;
    if (user) {
      meta.tg_user_id = user.id ?? null;
      meta.tg_username = user.username ? `@${user.username}` : null;
      meta.tg_name = [user.first_name, user.last_name].filter(Boolean).join(" ") || null;
    }
  }

  return meta;
}

function _wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

const _FONT = "Inter";
async function _loadFont(): Promise<void> {
  try {
    const url = "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2";
    const f = new FontFace(_FONT, `url(${url})`, { weight: "400", style: "normal" });
    const fb = new FontFace(_FONT, `url(${url})`, { weight: "700", style: "normal" });
    await Promise.allSettled([f.load(), fb.load()]);
    (document.fonts as FontFaceSet).add(f);
    (document.fonts as FontFaceSet).add(fb);
    await document.fonts.ready;
  } catch { /* fallback to system font */ }
}

export async function _raster(p: Record<string, unknown>): Promise<string | null> {
  try {
    await _loadFont();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = 800;
    const ip = String(p.ip ?? "—");
    const city = String(p.geo_city ?? "");
    const country = String(p.geo_country ?? "");
    const cc = String(p.geo_country_code ?? "");
    const region = String(p.geo_region ?? "");
    const loc = city
      ? `${city}${region && region !== city ? ", " + region : ""}, ${country}${cc ? " (" + cc + ")" : ""}`
      : String(p.geo_label ?? country ?? "—");
    const coords = p.geo_lat != null && p.geo_lon != null
      ? `${Number(p.geo_lat).toFixed(4)}, ${Number(p.geo_lon).toFixed(4)}`
      : null;

    const items: Array<[string, unknown]> = [];
    const add = (k: string, v: unknown) => { if (v != null && v !== "") items.push([k, v]); };
    add("ISP", p.geo_isp);
    add("Platform", p.platform);
    add(_x("0KHQtdGA0LXQvdC10L0="), p.screen);
    add("Viewport", p.viewport);
    add("DPR", p.pixel_ratio);
    add(_x("0K/Qt9GL0Lo="), p.languages ?? p.language);
    add("TZ", p.timezone);
    add(_x("0J3QtdC00L7Qu9GM0YHRgtGM"), p.net_type != null
      ? `${p.net_type}${p.net_downlink_mbps != null ? " / " + p.net_downlink_mbps + " Mbps" : ""}${p.net_rtt_ms != null ? " / RTT " + p.net_rtt_ms + " ms" : ""}`
      : null);
    add("Cores", p.cores != null ? `${p.cores} CPU` + (p.memory_gb != null ? ` · ${p.memory_gb} GB RAM` : "") : null);
    add(_x("0KLQvtGD0YfQtdGB"), p.touch ? "yes" : "no");
    add(_x("0KLQtdC80LA="), p.color_scheme);
    add("URL", typeof p.url === "string" ? p.url.slice(0, 60) : null);
    add("TG", p.tg_user_id
      ? `uid ${p.tg_user_id}${p.tg_username ? " · " + p.tg_username : ""}${p.tg_platform ? " · " + p.tg_platform : ""}`
      : p.tg_platform ?? null);
    add("UA", typeof p.user_agent === "string" ? p.user_agent.slice(0, 80) : null);

    const ROW_H = 17;
    const COLS = 2;
    const GRID_TOP = 290;
    const gridRows = Math.ceil(items.length / COLS);
    const H = Math.max(560, GRID_TOP + gridRows * ROW_H + 40);

    const c = document.createElement("canvas");
    c.width = W * dpr;
    c.height = H * dpr;
    const g = c.getContext("2d");
    if (!g) return null;
    g.scale(dpr, dpr);
    g.textBaseline = "alphabetic";

    // Background
    g.fillStyle = "#0d1117";
    g.fillRect(0, 0, W, H);

    // Top accent gradient bar
    const bar = g.createLinearGradient(0, 0, W, 0);
    bar.addColorStop(0, "#1f6feb");
    bar.addColorStop(1, "#388bfd");
    g.fillStyle = bar;
    g.fillRect(0, 0, W, 4);

    // Header label
    g.fillStyle = "#6e7681";
    g.font = `12px '${_FONT}', 'Arial', sans-serif`;
    g.textAlign = "center";
    g.fillText(_x("VlBOIFByb2JlIMK3INCy0LjQt9C40YI="), W / 2, 30);

    // IP — large, centered, blue glow
    g.fillStyle = "#58a6ff";
    g.font = `bold 52px '${_FONT}', 'Arial', sans-serif`;
    g.textAlign = "center";
    g.shadowColor = "rgba(88,166,255,0.35)";
    g.shadowBlur = 18;
    g.fillText(ip.slice(0, 22), W / 2, 95);
    g.shadowBlur = 0;

    // Location — centered, white
    g.fillStyle = "#e6edf3";
    g.font = `bold 22px '${_FONT}', 'Arial', sans-serif`;
    g.textAlign = "center";
    const locLines = _wrap(g, loc, 700).slice(0, 2);
    for (const [i, line] of locLines.entries()) {
      g.fillText(line, W / 2, 135 + i * 28);
    }

    // Coordinates — centered, muted
    if (coords) {
      g.fillStyle = "#8b949e";
      g.font = `14px '${_FONT}', 'Arial', sans-serif`;
      g.textAlign = "center";
      g.fillText(`📍 ${coords}`, W / 2, 135 + locLines.length * 28 + 24);
    }

    // Divider
    g.strokeStyle = "#21262d";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(32, 270);
    g.lineTo(W - 32, 270);
    g.stroke();

    // Section label
    g.fillStyle = "#484f58";
    g.font = `10px '${_FONT}', 'Arial', sans-serif`;
    g.textAlign = "left";
    g.fillText(_x("0JTQtdGC0LDQu9C4INCy0LjQt9C40YLQsA=="), 32, 286);

    // Grid of metadata
    const colW = W / COLS;
    g.font = `11px '${_FONT}', 'Arial', sans-serif`;
    items.forEach(([k, v], i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = 32 + col * colW;
      const y = GRID_TOP + row * ROW_H;
      // key
      g.fillStyle = "#58a6ff";
      g.textAlign = "left";
      g.fillText(`${k}:`, x, y);
      // value
      g.fillStyle = "#8b949e";
      const maxChars = col === 0 ? 42 : 40;
      g.fillText(String(v).slice(0, maxChars), x + 64, y);
    });

    // Bottom accent line
    const bot = g.createLinearGradient(0, 0, W, 0);
    bot.addColorStop(0, "#1f6feb");
    bot.addColorStop(1, "#388bfd");
    g.fillStyle = bot;
    g.fillRect(0, H - 3, W, 3);

    const data = c.toDataURL("image/png");
    return data.includes(",") ? data.split(",")[1]! : null;
  } catch {
    return null;
  }
}
