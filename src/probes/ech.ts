/**
 * ECH (Encrypted Client Hello) detection — ТСПУ в РФ активно блокирует ECH.
 * Проверяем через DoH type=65 (HTTPS/SVCB record) наличие ECH-ключей,
 * и сравниваем доступность CF-доменов с ECH.
 */
import type { ProbeDefinition } from "../types";
import { withTimeout } from "../utils";

const DOH_CF = "https://cloudflare-dns.com/dns-query";

interface DnsAnswer {
  type: number;
  data: string;
  name?: string;
}

async function dohQueryType65(
  resolver: string,
  domain: string,
): Promise<{ answers: DnsAnswer[]; elapsed: number }> {
  const start = performance.now();
  const url = `${resolver}?name=${encodeURIComponent(domain)}&type=HTTPS`;
  const response = await fetch(url, {
    headers: { Accept: "application/dns-json" },
    cache: "no-store",
  });
  const data = (await response.json()) as {
    Answer?: DnsAnswer[];
    Status?: number;
  };
  return {
    answers: data.Answer ?? [],
    elapsed: Math.round(performance.now() - start),
  };
}

export function createEchProbes(): ProbeDefinition[] {
  const echDnsProbe: ProbeDefinition = {
    id: "ech_dns_svcb",
    name: "ECH DNS (HTTPS record)",
    category: "ech",
    description: "DoH type=65 (SVCB/HTTPS) — наличие ECH-ключей в DNS",
    target: "cloudflare-ech.com",
    run: async () => {
      try {
        const { answers, elapsed } = await withTimeout(
          dohQueryType65(DOH_CF, "crypto.cloudflare.com"),
          8000,
        );

        const hasEch = answers.some(
          (a) => a.type === 65 && (a.data.includes("ech=") || a.data.includes("ECH")),
        );
        const hasHttpsRecord = answers.some((a) => a.type === 65);

        if (hasEch) {
          return {
            status: "ok",
            latencyMs: elapsed,
            errorClass: "none",
            detail: `ECH-ключи найдены в DNS HTTPS record (${elapsed} мс)`,
            metadata: { echFound: true, httpsRecord: true },
          };
        }

        if (hasHttpsRecord) {
          return {
            status: "inconclusive",
            latencyMs: elapsed,
            errorClass: "none",
            detail: `HTTPS record есть, но ECH-ключи не обнаружены (${elapsed} мс)`,
            metadata: { echFound: false, httpsRecord: true },
          };
        }

        return {
          status: "inconclusive",
          latencyMs: elapsed,
          errorClass: "none",
          detail: `Нет HTTPS record (type 65) — резолвер может не поддерживать`,
          metadata: { echFound: false, httpsRecord: false },
        };
      } catch (error) {
        return {
          status: "blocked",
          latencyMs: null,
          errorClass: "dns_failure",
          detail: error instanceof Error ? error.message : String(error),
          metadata: { echFound: false, httpsRecord: false },
        };
      }
    },
  };

  const echFetchProbe: ProbeDefinition = {
    id: "ech_fetch",
    name: "ECH-enabled fetch",
    category: "ech",
    description: "Fetch к ECH-enabled домену — если ТСПУ блокирует ECH, соединение упадёт",
    target: "https://crypto.cloudflare.com/cdn-cgi/trace",
    run: async () => {
      const start = performance.now();
      try {
        const response = await withTimeout(
          fetch("https://crypto.cloudflare.com/cdn-cgi/trace", {
            cache: "no-store",
            mode: "cors",
          }),
          8000,
        );
        const elapsed = Math.round(performance.now() - start);

        if (response.ok) {
          const text = await response.text();
          const sni = text.includes("sni=encrypted") || text.includes("sni=plaintext");
          const encrypted = text.includes("sni=encrypted");

          return {
            status: "ok",
            latencyMs: elapsed,
            errorClass: "none",
            detail: encrypted
              ? `ECH активен — sni=encrypted (${elapsed} мс). ТСПУ не блокирует ECH`
              : sni
                ? `ECH-домен доступен, но sni=plaintext — ECH не применён браузером (${elapsed} мс)`
                : `ECH-домен доступен (${elapsed} мс)`,
            metadata: { echActive: encrypted, sniField: sni },
          };
        }

        return {
          status: "error",
          latencyMs: elapsed,
          errorClass: "none",
          detail: `HTTP ${response.status} — ECH-домен вернул ошибку`,
        };
      } catch (error) {
        const elapsed = Math.round(performance.now() - start);
        const msg = error instanceof Error ? error.message : String(error);
        const isTimeout = msg.includes("timeout") || elapsed >= 7900;

        return {
          status: isTimeout ? "timeout" : "blocked",
          latencyMs: elapsed,
          errorClass: isTimeout ? "timeout" : "tls_handshake",
          detail: isTimeout
            ? `ECH-домен таймаут — возможна блокировка ECH (${elapsed} мс)`
            : `ECH-домен заблокирован: ${msg} — ТСПУ вероятно блокирует ECH`,
        };
      }
    },
  };

  return [echDnsProbe, echFetchProbe];
}
