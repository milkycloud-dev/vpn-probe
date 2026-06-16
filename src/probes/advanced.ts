import type { ProbeDefinition } from "../types";
import {
  analyzeDnsAnswers,
  isLikelyStubImage,
  RU_BLOCKED_DOMAINS_DNS,
  RU_BLOCKED_SERVICES,
} from "./russia-common";
import { withTimeout } from "../utils";

const DOH_CF = "https://cloudflare-dns.com/dns-query";
const DOH_GOOGLE = "https://dns.google/resolve";

async function dohResolve(
  resolver: string,
  domain: string,
): Promise<{ answers: string[]; elapsed: number }> {
  const start = performance.now();
  const url = `${resolver}?name=${encodeURIComponent(domain)}&type=A`;
  const response = await fetch(url, {
    headers: { Accept: "application/dns-json" },
    cache: "no-store",
  });
  const data = (await response.json()) as {
    Answer?: Array<{ data: string; type: number }>;
    Status?: number;
  };
  const answers =
    data.Answer?.filter((a) => a.type === 1).map((a) => a.data) ?? [];
  return { answers, elapsed: Math.round(performance.now() - start) };
}

export function createBlockedDnsProbes(): ProbeDefinition[] {
  return RU_BLOCKED_DOMAINS_DNS.map((domain) => ({
    id: `doh_blocked_${domain.replace(/\./g, "_")}`,
    name: `DoH → ${domain}`,
    category: "dns_blocked",
    description: "Резолв домена из реестра РФ — DNS-poison vs IP-блок",
    target: domain,
    run: async () => {
      try {
        const [cf, google] = await Promise.all([
          withTimeout(dohResolve(DOH_CF, domain), 6000),
          withTimeout(dohResolve(DOH_GOOGLE, domain), 6000),
        ]);
        const analysis = analyzeDnsAnswers(cf.answers, google.answers);
        return {
          status: analysis.status,
          latencyMs: Math.round((cf.elapsed + google.elapsed) / 2),
          errorClass: analysis.errorClass,
          detail: analysis.detail,
          metadata: {
            cloudflare: cf.answers.join(","),
            google: google.answers.join(","),
            poisoned: analysis.poisoned,
            rknIp: analysis.rknIp,
          },
        };
      } catch (error) {
        return {
          status: "blocked",
          latencyMs: null,
          errorClass: "dns_failure",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
  }));
}

function probeImage(url: string, timeoutMs: number): Promise<{
  loaded: boolean;
  elapsed: number;
  width: number;
  height: number;
}> {
  return new Promise((resolve) => {
    const start = performance.now();
    const img = new Image();
    const timer = setTimeout(() => {
      img.src = "";
      resolve({ loaded: false, elapsed: timeoutMs, width: 0, height: 0 });
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve({
        loaded: true,
        elapsed: Math.round(performance.now() - start),
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve({
        loaded: false,
        elapsed: Math.round(performance.now() - start),
        width: 0,
        height: 0,
      });
    };
    img.src = `${url}${url.includes("?") ? "&" : "?"}_t=${Date.now()}`;
  });
}

const IMAGE_TARGETS = RU_BLOCKED_SERVICES.filter((s) =>
  ["x", "instagram", "facebook", "meduza", "protonvpn", "tor", "reddit", "discord", "openai", "rutracker", "spotify", "linkedin"].includes(s.id),
);

export function createImageProbes(): ProbeDefinition[] {
  return IMAGE_TARGETS.map((t) => ({
    id: `img_${t.id}`,
    name: `IMG → ${t.name}`,
    category: "image_probe",
    description: "Favicon без CORS — обходит заголовки, видит IP/DPI-блок в РФ",
    target: t.favicon,
    run: async () => {
      const r = await probeImage(t.favicon, 8000);
      const stubSuspect = r.loaded && isLikelyStubImage(r.width, r.height);
      return {
        status: r.loaded && !stubSuspect ? "ok" : r.loaded ? "error" : "blocked",
        latencyMs: r.elapsed,
        errorClass: stubSuspect ? "tcp_reset" : r.loaded ? "none" : "tcp_reset",
        detail: r.loaded
          ? stubSuspect
            ? `Заглушка РКН? ${r.width}×${r.height}px — подозрительный размер`
            : `Загружено ${r.width}×${r.height} за ${r.elapsed} мс`
          : `Не загрузилось — типично для блокировки в РФ`,
        metadata: { w: r.width, h: r.height, stub: stubSuspect },
      };
    },
  }));
}

export function createThrottleProbes(): ProbeDefinition[] {
  const pairs = [
    { fast: "https://ya.ru/favicon.ico", slow: "https://www.instagram.com/favicon.ico", label: "Instagram vs Яндекс" },
    { fast: "https://vk.com/favicon.ico", slow: "https://x.com/favicon.ico", label: "X vs VK" },
    { fast: "https://rutube.ru/favicon.ico", slow: "https://www.youtube.com/generate_204", label: "YouTube vs Rutube" },
    { fast: "https://www.gosuslugi.ru/favicon.ico", slow: "https://protonvpn.com/favicon.ico", label: "ProtonVPN vs Госуслуги" },
    { fast: "https://www.google.com/generate_204", slow: "https://www.youtube.com/generate_204", label: "YouTube vs Google" },
  ];

  return pairs.map((p, i) => ({
    id: `throttle_${i}`,
    name: `Throttle: ${p.label}`,
    category: "throttle",
    description: "Замедление зарубежных сервисов vs российских — типичный приём DPI в РФ",
    target: p.slow,
    run: async () => {
      const measure = async (url: string) => {
        const s = performance.now();
        try {
          await withTimeout(fetch(url, { mode: "no-cors", cache: "no-store" }), 8000);
          return Math.round(performance.now() - s);
        } catch {
          return 8000;
        }
      };
      const [fastMs, slowMs] = await Promise.all([measure(p.fast), measure(p.slow)]);
      const ratio = fastMs > 0 ? slowMs / fastMs : slowMs;
      const throttled = ratio >= 3 && slowMs > 1500;

      return {
        status: throttled ? "blocked" : slowMs >= 8000 ? "timeout" : "ok",
        latencyMs: slowMs,
        errorClass: throttled ? "throttled" : "none",
        detail: `RU-контроль ${fastMs}мс vs цель ${slowMs}мс · ratio ${ratio.toFixed(1)}×`,
        metadata: { fastMs, slowMs, ratio: Math.round(ratio * 10) / 10 },
      };
    },
  }));
}

function probeWs(url: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => { try { ws.close(); } catch { /* */ } resolve(false); }, ms);
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { clearTimeout(t); resolve(false); return; }
    ws.onopen = () => { clearTimeout(t); ws.close(); resolve(true); };
    ws.onerror = () => { /* */ };
    ws.onclose = () => { if (!ws) return; };
  });
}

export function createParallelWsProbe(): ProbeDefinition {
  return {
    id: "parallel_wss",
    name: "Параллельные WSS ×5",
    category: "parallel_ws",
    description: "5 одновременных WSS — DPI в РФ режет по объёму соединений",
    target: "wss://echo.websocket.org",
    run: async () => {
      const start = performance.now();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => probeWs("wss://echo.websocket.org", 8000)),
      );
      const open = results.filter(Boolean).length;
      const elapsed = Math.round(performance.now() - start);
      return {
        status: open >= 4 ? "ok" : open >= 2 ? "inconclusive" : "blocked",
        latencyMs: elapsed,
        errorClass: open < 2 ? "websocket_rejected" : "none",
        detail: `${open}/5 WSS открыты за ${elapsed} мс`,
        metadata: { opened: open, total: 5 },
      };
    },
  };
}

export function createStabilityProbes(): ProbeDefinition[] {
  return [
    {
      id: "stability_wss",
      name: "Стабильность WSS ×2",
      category: "stability",
      description: "Двойной WSS — нестабильность типична для ТСПУ/DPI в РФ",
      target: "wss://echo.websocket.org",
      run: async () => {
        const r1 = await probeWs("wss://echo.websocket.org", 6000);
        await new Promise((r) => setTimeout(r, 400));
        const r2 = await probeWs("wss://echo.websocket.org", 6000);
        const unstable = r1 !== r2;
        return {
          status: unstable ? "inconclusive" : r1 && r2 ? "ok" : "blocked",
          latencyMs: null,
          errorClass: unstable ? "unknown" : "none",
          detail: `run1=${r1 ? "ok" : "fail"} run2=${r2 ? "ok" : "fail"}${unstable ? " — флаппинг DPI" : ""}`,
          metadata: { run1: r1, run2: r2, unstable },
        };
      },
    },
    {
      id: "stability_https",
      name: "Стабильность HTTPS ×2",
      category: "stability",
      description: "Повторный fetch — нестабильная фильтрация провайдера",
      target: "https://www.cloudflare.com/cdn-cgi/trace",
      run: async () => {
        const once = async () => {
          try {
            await withTimeout(fetch("https://www.cloudflare.com/cdn-cgi/trace", { cache: "no-store" }), 6000);
            return true;
          } catch { return false; }
        };
        const r1 = await once();
        await new Promise((r) => setTimeout(r, 300));
        const r2 = await once();
        return {
          status: r1 !== r2 ? "inconclusive" : r1 ? "ok" : "blocked",
          latencyMs: null,
          errorClass: "none",
          detail: `run1=${r1} run2=${r2}`,
          metadata: { run1: r1, run2: r2 },
        };
      },
    },
    {
      id: "stability_ru_block",
      name: "Стабильность блок X ×2",
      category: "stability",
      description: "Двойная проверка x.com — DPI в РФ иногда нестабилен",
      target: "https://x.com/favicon.ico",
      run: async () => {
        const once = async () => {
          try {
            await withTimeout(fetch("https://x.com/favicon.ico", { mode: "no-cors", cache: "no-store" }), 7000);
            return true;
          } catch { return false; }
        };
        const r1 = await once();
        await new Promise((r) => setTimeout(r, 350));
        const r2 = await once();
        const unstable = r1 !== r2;
        return {
          status: unstable ? "inconclusive" : !r1 && !r2 ? "ok" : r1 || r2 ? "error" : "blocked",
          latencyMs: null,
          errorClass: unstable ? "unknown" : "none",
          detail: unstable
            ? "x.com то доступен, то нет — нестабильный DPI"
            : !r1 && !r2
              ? "Стабильно заблокирован (ожидаемо в РФ)"
              : "x.com отвечает — обход или аномалия",
          metadata: { run1: r1, run2: r2, unstable },
        };
      },
    },
  ];
}

export function createCdnWsProbes(): ProbeDefinition[] {
  const targets = [
    { id: "ifelse", url: "wss://ws.ifelse.io", name: "ifelse.io" },
    { id: "socketsbay", url: "wss://socketsbay.com/wss/v2/1/demo/", name: "SocketsBay" },
    { id: "binance", url: "wss://fstream.binance.com/ws", name: "Binance WS" },
  ];
  return targets.map((t) => ({
    id: `wss_cdn_${t.id}`,
    name: `WSS CDN → ${t.name}`,
    category: "websocket",
    description: "Разные WSS-хосты — SNI-фильтрация ТСПУ",
    target: t.url,
    run: async () => {
      const start = performance.now();
      const ok = await probeWs(t.url, 8000);
      return {
        status: ok ? "ok" : "blocked",
        latencyMs: Math.round(performance.now() - start),
        errorClass: ok ? "none" : "websocket_rejected",
        detail: ok ? "Handshake OK" : "WSS отклонён — типично при DPI",
      };
    },
  }));
}
