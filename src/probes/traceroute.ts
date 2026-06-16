import type { ProbeDefinition, ProbeStatus, TraceHop } from "../types";
import { classifyFetchError, withTimeout } from "../utils";

const ROUTE_HOPS = [
  { label: "Cloudflare edge", target: "https://www.cloudflare.com/cdn-cgi/trace", parseTrace: true },
  { label: "DoH telegram.org", target: "https://cloudflare-dns.com/dns-query?name=telegram.org&type=A", isDoh: true },
  { label: "РФ CDN (Яндекс)", target: "https://yastatic.net/jquery/3.3.1/jquery.min.js" },
  { label: "РФ контроль VK", target: "https://vk.com/favicon.ico" },
  { label: "Международный Google", target: "https://www.google.com/generate_204" },
  { label: "Реестр: X", target: "https://x.com/favicon.ico" },
  { label: "Реестр: Meduza", target: "https://meduza.io/favicon.ico" },
  { label: "Реестр: Reddit", target: "https://www.reddit.com/favicon.ico" },
  { label: "VPN-сайт Proton", target: "https://protonvpn.com/favicon.ico" },
  { label: "WSS транспорт", target: "wss://echo.websocket.org", isWs: true },
  { label: "UDP STUN", target: "stun:stun.l.google.com:19302", isStun: true },
  { label: "РФ Rutube", target: "https://rutube.ru/favicon.ico" },
];

export const CASCADE_HOP_COUNT = ROUTE_HOPS.length;

function parseCloudflareTrace(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key) result[key.trim()] = rest.join("=").trim();
  }
  return result;
}

function probeWs(url: string, timeoutMs: number): Promise<{ ok: boolean; ms: number; detail: string }> {
  return new Promise((resolve) => {
    const start = performance.now();
    let done = false;
    const finish = (r: { ok: boolean; ms: number; detail: string }) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, ms: Math.round(performance.now() - start), detail: "timeout" }), timeoutMs);
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch (e) {
      clearTimeout(timer);
      finish({ ok: false, ms: Math.round(performance.now() - start), detail: String(e) });
      return;
    }
    ws.onopen = () => { clearTimeout(timer); ws.close(); finish({ ok: true, ms: Math.round(performance.now() - start), detail: "WSS open" }); };
    ws.onclose = () => {
      if (!done && performance.now() - start < timeoutMs - 100) {
        clearTimeout(timer);
        finish({ ok: false, ms: Math.round(performance.now() - start), detail: "WSS closed" });
      }
    };
    ws.onerror = () => { /* */ };
  });
}

function probeStun(url: string): Promise<{ ok: boolean; ms: number; detail: string }> {
  return new Promise((resolve) => {
    const start = performance.now();
    const pc = new RTCPeerConnection({ iceServers: [{ urls: url }] });
    const timer = setTimeout(() => { pc.close(); resolve({ ok: false, ms: Math.round(performance.now() - start), detail: "ICE timeout" }); }, 6000);
    let srflx = false;
    pc.onicecandidate = (e) => {
      if (e.candidate?.type === "srflx") srflx = true;
      if (!e.candidate) {
        clearTimeout(timer);
        pc.close();
        resolve({ ok: srflx, ms: Math.round(performance.now() - start), detail: srflx ? "srflx ok" : "no srflx" });
      }
    };
    pc.createDataChannel("t");
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => {
      clearTimeout(timer);
      pc.close();
      resolve({ ok: false, ms: Math.round(performance.now() - start), detail: "ICE error" });
    });
  });
}

export async function runCascadeRoute(): Promise<TraceHop[]> {
  const hops: TraceHop[] = [];
  let prevLatency = 0;

  for (let i = 0; i < ROUTE_HOPS.length; i++) {
    const hop = ROUTE_HOPS[i];
    let status: ProbeStatus = "ok";
    let latencyMs: number | null = null;
    let detail = "";

    try {
      if ("isWs" in hop && hop.isWs) {
        const r = await probeWs(hop.target, 6000);
        latencyMs = r.ms;
        status = r.ok ? "ok" : "blocked";
        detail = r.detail;
      } else if ("isStun" in hop && hop.isStun) {
        const r = await probeStun(hop.target);
        latencyMs = r.ms;
        status = r.ok ? "ok" : "blocked";
        detail = r.detail;
      } else {
        const start = performance.now();
        const headers: Record<string, string> = {};
        if ("isDoh" in hop && hop.isDoh) headers.Accept = "application/dns-json";
        const response = await withTimeout(
          fetch(hop.target, {
            method: "GET",
            mode: hop.parseTrace || hop.isDoh ? "cors" : "no-cors",
            cache: "no-store",
            headers,
          }),
          7000,
        );
        latencyMs = Math.round(performance.now() - start);

        if (hop.parseTrace && response.ok) {
          const trace = parseCloudflareTrace(await response.text());
          detail = `colo=${trace.colo ?? "?"} ip=${trace.ip ?? "?"}`;
        } else if ("isDoh" in hop && hop.isDoh && response.ok) {
          const data = (await response.json()) as { Answer?: Array<{ data: string }> };
          detail = `A: ${data.Answer?.map((a) => a.data).join(", ") ?? "—"}`;
        } else {
          detail = `${latencyMs} мс`;
        }
      }
    } catch (error) {
      latencyMs = latencyMs ?? Math.round(performance.now());
      const classified = classifyFetchError(error, latencyMs);
      status = classified.status;
      detail = classified.detail;
    }

    const deltaMs = latencyMs !== null ? Math.max(0, latencyMs - prevLatency) : null;
    if (latencyMs !== null) prevLatency = latencyMs;

    hops.push({ hop: i + 1, label: hop.label, target: hop.target, latencyMs, deltaMs, status, detail });
  }

  return hops;
}

export function createCascadeProbe(): ProbeDefinition {
  return {
    id: "cascade_route",
    name: "Каскадная диагностика",
    category: "cascade",
    description: "Последовательная проверка узлов (не ICMP traceroute)",
    target: "cascade",
    run: async () => ({
      status: "inconclusive",
      latencyMs: null,
      errorClass: "none",
      detail: "Строится в отчёте",
    }),
  };
}
