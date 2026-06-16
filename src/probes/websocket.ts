import type { ProbeDefinition } from "../types";

interface WsTarget {
  id: string;
  name: string;
  url: string;
  note: string;
}

const WS_TARGETS: WsTarget[] = [
  {
    id: "echo",
    name: "WebSocket.org Echo",
    url: "wss://echo.websocket.org",
    note: "Классический WSS — базовый транспорт VLESS/VMess+WS",
  },
  {
    id: "postman",
    name: "Postman Echo WS",
    url: "wss://ws.postman-echo.com/raw",
    note: "WSS на 443 — имитация прокси-туннеля",
  },
  {
    id: "piesocket",
    name: "PieSocket Demo",
    url: "wss://demo.piesocket.com/v3/channel_123?api_key=VCXCEuvhGcBDP7XhiJJUDvR1e1D3eiVjgZ9VRiaV",
    note: "WSS с query-параметрами — похоже на VLESS path",
  },
  {
    id: "gemini",
    name: "Gemini Market WS",
    url: "wss://api.gemini.com/v1/marketdata/BTCUSD",
    note: "Публичный WSS API — долгоживущее соединение",
  },
];

function probeWebSocket(url: string, timeoutMs: number): Promise<{
  opened: boolean;
  elapsed: number;
  closeCode?: number;
  closeReason?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const start = performance.now();
    let settled = false;

    const finish = (result: ReturnType<typeof probeWebSocket> extends Promise<infer T> ? T : never) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      finish({
        opened: false,
        elapsed: Math.round(performance.now() - start),
        error: `timeout after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      clearTimeout(timer);
      finish({
        opened: false,
        elapsed: Math.round(performance.now() - start),
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    ws.onopen = () => {
      clearTimeout(timer);
      finish({
        opened: true,
        elapsed: Math.round(performance.now() - start),
      });
      ws.close();
    };

    ws.onerror = () => {
      /* wait for close or timeout */
    };

    ws.onclose = (event) => {
      if (settled) return;
      clearTimeout(timer);
      finish({
        opened: false,
        elapsed: Math.round(performance.now() - start),
        closeCode: event.code,
        closeReason: event.reason || undefined,
        error: `closed code=${event.code}`,
      });
    };
  });
}

export function createWebSocketProbes(): ProbeDefinition[] {
  return WS_TARGETS.map((target) => ({
    id: `wss_${target.id}`,
    name: `WSS → ${target.name}`,
    category: "websocket",
    description: target.note,
    target: target.url,
    run: async () => {
      const result = await probeWebSocket(target.url, 8000);

      if (result.opened) {
        return {
          status: "ok",
          latencyMs: result.elapsed,
          errorClass: "none",
          detail: `Handshake OK за ${result.elapsed} мс`,
        };
      }

      const isTimeout = result.error?.includes("timeout");
      const isReset = result.closeCode === 1006;

      return {
        status: isTimeout ? "timeout" : "blocked",
        latencyMs: result.elapsed,
        errorClass: isTimeout ? "timeout" : isReset ? "tcp_reset" : "websocket_rejected",
        detail: result.error ?? `code ${result.closeCode}`,
        metadata: {
          closeCode: result.closeCode ?? -1,
          closeReason: result.closeReason ?? "",
        },
      };
    },
  }));
}

export function createLongLivedProbe(): ProbeDefinition {
  return {
    id: "wss_long_lived",
    name: "Долгоживущий WSS",
    category: "long_lived",
    description:
      "VPN-соединения долгоживущие; DPI часто рвёт такие сессии через 5–30 с",
    target: "wss://echo.websocket.org",
    run: async () => {
      const holdMs = 12000;
      const start = performance.now();

      return new Promise((resolve) => {
        let opened = false;
        let dropped = false;
        const ws = new WebSocket("wss://echo.websocket.org");

        const timer = setTimeout(() => {
          const elapsed = Math.round(performance.now() - start);
          ws.close();
          resolve({
            status: opened && !dropped ? "ok" : dropped ? "blocked" : "timeout",
            latencyMs: elapsed,
            errorClass: dropped ? "tcp_reset" : opened ? "none" : "timeout",
            detail: opened && !dropped
              ? `Соединение выдержало ${holdMs / 1000} с — DPI не оборвал`
              : dropped
                ? `Соединение оборвано через ${elapsed} мс (подозрение на DPI)`
                : "Не удалось установить соединение",
            metadata: { holdMs, dropped, opened },
          });
        }, holdMs);

        ws.onopen = () => {
          opened = true;
          const ping = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send("ping");
          }, 2000);
          ws.addEventListener("close", () => clearInterval(ping));
        };

        ws.onclose = (event) => {
          if (performance.now() - start < holdMs - 500) {
            dropped = true;
            clearTimeout(timer);
            resolve({
              status: "blocked",
              latencyMs: Math.round(performance.now() - start),
              errorClass: "tcp_reset",
              detail: `Преждевременный обрыв: code ${event.code} через ${Math.round(performance.now() - start)} мс`,
              metadata: { closeCode: event.code, dropped: true },
            });
          }
        };

        ws.onerror = () => {
          /* handled by onclose */
        };
      });
    },
  };
}

export function createObfuscatedPathProbes(): ProbeDefinition[] {
  const paths = [
    "/api/v1/stream",
    "/ws-tunnel",
    "/ray",
    "/vless",
    "/X9kL2mN8pQ3rT7wY",
  ];

  return paths.map((path) => ({
    id: `wss_path_${path.replace(/[^a-zA-Z0-9]/g, "_")}`,
    name: `WSS путь ${path}`,
    category: "path_obfuscation",
    description:
      "Случайные/типичные VPN-пути на публичном WSS — проверка блокировки по URI",
    target: `wss://echo.websocket.org${path}`,
    run: async () => {
      const url = `wss://echo.websocket.org${path}`;
      const result = await probeWebSocket(url, 6000);

      return {
        status: result.opened ? "ok" : "blocked",
        latencyMs: result.elapsed,
        errorClass: result.opened ? "none" : "websocket_rejected",
        detail: result.opened
          ? `Путь ${path} не заблокирован (${result.elapsed} мс)`
          : `Путь ${path}: ${result.error}`,
      };
    },
  }));
}
