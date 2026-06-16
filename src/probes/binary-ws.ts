/**
 * WSS Binary vs Text frame probe — DPI в РФ иногда различает
 * текстовые и бинарные фреймы WebSocket. VPN-трафик всегда binary.
 */
import type { ProbeDefinition } from "../types";

function probeBinaryWs(
  url: string,
  timeoutMs: number,
): Promise<{
  textOk: boolean;
  binaryOk: boolean;
  textEcho: boolean;
  binaryEcho: boolean;
  elapsed: number;
  error?: string;
}> {
  return new Promise((resolve) => {
    const start = performance.now();
    let settled = false;

    const finish = (result: {
      textOk: boolean;
      binaryOk: boolean;
      textEcho: boolean;
      binaryEcho: boolean;
      elapsed: number;
      error?: string;
    }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* */ }
      finish({
        textOk: false,
        binaryOk: false,
        textEcho: false,
        binaryEcho: false,
        elapsed: Math.round(performance.now() - start),
        error: `timeout ${timeoutMs}ms`,
      });
    }, timeoutMs);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
    } catch (error) {
      clearTimeout(timer);
      finish({
        textOk: false,
        binaryOk: false,
        textEcho: false,
        binaryEcho: false,
        elapsed: Math.round(performance.now() - start),
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let textEchoReceived = false;
    let binaryEchoReceived = false;
    let phase: "text" | "binary" | "done" = "text";

    ws.onopen = () => {
      /* Phase 1: send text frame */
      ws.send("vpn-probe-text-test");
    };

    ws.onmessage = (event) => {
      if (phase === "text") {
        textEchoReceived = typeof event.data === "string" && event.data.includes("vpn-probe-text-test");
        phase = "binary";
        /* Phase 2: send binary frame */
        const buf = new Uint8Array(32);
        crypto.getRandomValues(buf);
        /* Marker in first 4 bytes */
        buf[0] = 0xDE; buf[1] = 0xAD; buf[2] = 0xBE; buf[3] = 0xEF;
        ws.send(buf.buffer);
      } else if (phase === "binary") {
        if (event.data instanceof ArrayBuffer) {
          const view = new Uint8Array(event.data);
          binaryEchoReceived = view.length >= 4 && view[0] === 0xDE && view[1] === 0xAD;
        }
        phase = "done";
        clearTimeout(timer);
        ws.close();
        finish({
          textOk: true,
          binaryOk: true,
          textEcho: textEchoReceived,
          binaryEcho: binaryEchoReceived,
          elapsed: Math.round(performance.now() - start),
        });
      }
    };

    ws.onerror = () => { /* wait for close */ };
    ws.onclose = () => {
      if (settled) return;
      clearTimeout(timer);
      finish({
        textOk: phase !== "text",
        binaryOk: phase === "done",
        textEcho: textEchoReceived,
        binaryEcho: binaryEchoReceived,
        elapsed: Math.round(performance.now() - start),
        error: phase === "text" ? "connection closed before text echo" : "connection closed before binary echo",
      });
    };
  });
}

export function createBinaryWsProbes(): ProbeDefinition[] {
  const targets = [
    { id: "echo", url: "wss://echo.websocket.org", label: "Echo" },
    { id: "postman", url: "wss://ws.postman-echo.com/raw", label: "Postman" },
  ];

  return targets.map((t) => ({
    id: `wss_binary_${t.id}`,
    name: `WSS Binary → ${t.label}`,
    category: "binary_ws" as const,
    description: "Binary vs Text WSS frame — VPN-трафик binary, DPI может фильтровать",
    target: t.url,
    run: async () => {
      const result = await probeBinaryWs(t.url, 10000);

      if (result.textOk && result.binaryOk) {
        const bothEcho = result.textEcho && result.binaryEcho;
        return {
          status: "ok" as const,
          latencyMs: result.elapsed,
          errorClass: "none" as const,
          detail: bothEcho
            ? `Text и Binary echo OK (${result.elapsed} мс) — DPI не фильтрует по типу фрейма`
            : `Text и Binary отправлены, echo: text=${result.textEcho} binary=${result.binaryEcho}`,
          metadata: {
            textEcho: result.textEcho,
            binaryEcho: result.binaryEcho,
          },
        };
      }

      if (result.textOk && !result.binaryOk) {
        return {
          status: "error" as const,
          latencyMs: result.elapsed,
          errorClass: "websocket_rejected" as const,
          detail: `Text OK, Binary fail — DPI вероятно фильтрует binary WSS (VPN не пройдёт)`,
          metadata: { textEcho: result.textEcho, binaryEcho: false },
        };
      }

      const isTimeout = result.error?.includes("timeout");
      return {
        status: isTimeout ? "timeout" as const : "blocked" as const,
        latencyMs: result.elapsed,
        errorClass: isTimeout ? "timeout" as const : "websocket_rejected" as const,
        detail: result.error ?? "WSS недоступен",
      };
    },
  }));
}
