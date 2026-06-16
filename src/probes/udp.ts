import type { ProbeDefinition } from "../types";

const STUN_SERVERS = [
  { id: "google", url: "stun:stun.l.google.com:19302", name: "Google STUN" },
  { id: "cloudflare", url: "stun:stun.cloudflare.com:3478", name: "Cloudflare STUN" },
  { id: "mozilla", url: "stun:stun.services.mozilla.com:3478", name: "Mozilla STUN" },
  { id: "twilio", url: "stun:global.stun.twilio.com:3478", name: "Twilio STUN" },
];

function probeStun(stunUrl: string, timeoutMs: number): Promise<{
  udpWorks: boolean;
  srflxCandidate: string | null;
  elapsed: number;
  error?: string;
}> {
  return new Promise((resolve) => {
    const start = performance.now();
    let settled = false;

    const finish = (result: {
      udpWorks: boolean;
      srflxCandidate: string | null;
      elapsed: number;
      error?: string;
    }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: stunUrl }],
    });

    const timer = setTimeout(() => {
      pc.close();
      finish({
        udpWorks: false,
        srflxCandidate: null,
        elapsed: Math.round(performance.now() - start),
        error: `ICE timeout ${timeoutMs}ms`,
      });
    }, timeoutMs);

    let srflx: string | null = null;

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        clearTimeout(timer);
        pc.close();
        finish({
          udpWorks: srflx !== null,
          srflxCandidate: srflx,
          elapsed: Math.round(performance.now() - start),
        });
        return;
      }

      if (event.candidate.type === "srflx") {
        srflx = `${event.candidate.address}:${event.candidate.port}`;
      }
    };

    pc.createDataChannel("probe");
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch((error) => {
        clearTimeout(timer);
        pc.close();
        finish({
          udpWorks: false,
          srflxCandidate: null,
          elapsed: Math.round(performance.now() - start),
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });
}

export function createUdpProbes(): ProbeDefinition[] {
  return STUN_SERVERS.map((server) => ({
    id: `stun_${server.id}`,
    name: `UDP/STUN → ${server.name}`,
    category: "udp",
    description:
      "UDP-доступность через STUN — критично для WireGuard, OpenVPN UDP, QUIC",
    target: server.url,
    run: async () => {
      const result = await probeStun(server.url, 8000);

      if (result.udpWorks && result.srflxCandidate) {
        return {
          status: "ok",
          latencyMs: result.elapsed,
          errorClass: "none",
          detail: `UDP работает, srflx ${result.srflxCandidate} (${result.elapsed} мс)`,
          metadata: { candidate: result.srflxCandidate },
        };
      }

      return {
        status: result.error?.includes("timeout") ? "timeout" : "blocked",
        latencyMs: result.elapsed,
        errorClass: "udp_blocked",
        detail: result.error ?? "Нет srflx candidate — UDP вероятно фильтруется",
      };
    },
  }));
}

export function createQuicProbe(): ProbeDefinition {
  return {
    id: "quic_http3_hint",
    name: "QUIC / HTTP3 (косвенно)",
    category: "udp",
    description:
      "Hysteria/QUIC используют UDP; прямой QUIC из браузера недоступен — проверяем alt-svc",
    target: "https://www.cloudflare.com",
    run: async () => {
      const start = performance.now();
      try {
        const response = await fetch("https://www.cloudflare.com/cdn-cgi/trace", {
          cache: "no-store",
        });
        const text = await response.text();
        const elapsed = Math.round(performance.now() - start);
        const hasHttp3 = text.includes("h3") || response.headers.get("alt-svc")?.includes("h3");

        return {
          status: hasHttp3 ? "ok" : "inconclusive",
          latencyMs: elapsed,
          errorClass: "none",
          detail: hasHttp3
            ? "Сервер объявляет HTTP/3 — QUIC инфраструктура доступна"
            : "HTTP/3 не обнаружен (не значит что QUIC заблокирован)",
          metadata: { http3Advertised: !!hasHttp3 },
        };
      } catch (error) {
        const elapsed = Math.round(performance.now() - start);
        return {
          status: "blocked",
          latencyMs: elapsed,
          errorClass: "udp_blocked",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
