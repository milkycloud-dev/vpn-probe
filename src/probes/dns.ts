import type { ProbeDefinition } from "../types";
import { withTimeout } from "../utils";

const DOH_RESOLVERS = [
  {
    id: "cloudflare",
    name: "Cloudflare DoH",
    url: "https://cloudflare-dns.com/dns-query",
  },
  {
    id: "google",
    name: "Google DoH",
    url: "https://dns.google/resolve",
  },
  {
    id: "yandex",
    name: "Яндекс DoH",
    url: "https://dns.yandex.ru/dns-query",
  },
  {
    id: "quad9",
    name: "Quad9 DoH",
    url: "https://dns.quad9.net/dns-query",
  },
  {
    id: "opendns",
    name: "OpenDNS DoH",
    url: "https://doh.opendns.com/dns-query",
  },
];

const TEST_DOMAINS = [
  "telegram.org",
  "www.google.com",
  "github.com",
  "www.wikipedia.org",
];

async function dohQuery(
  resolverUrl: string,
  domain: string,
): Promise<{ answers: string[]; elapsed: number }> {
  const start = performance.now();
  const url = `${resolverUrl}?name=${encodeURIComponent(domain)}&type=A`;

  const response = await fetch(url, {
    headers: { Accept: "application/dns-json" },
    cache: "no-store",
  });

  const elapsed = Math.round(performance.now() - start);
  const data = (await response.json()) as {
    Answer?: Array<{ data: string; type: number }>;
    Status?: number;
  };

  const answers =
    data.Answer?.filter((a) => a.type === 1 || a.type === 28).map((a) => a.data) ?? [];

  if (data.Status && data.Status !== 0 && answers.length === 0) {
    throw new Error(`DNS status ${data.Status}`);
  }

  return { answers, elapsed };
}

export function createDnsProbes(): ProbeDefinition[] {
  const probes: ProbeDefinition[] = [];

  for (const resolver of DOH_RESOLVERS) {
    probes.push({
      id: `doh_${resolver.id}`,
      name: resolver.name,
      category: "dns",
      description: "DNS-over-HTTPS — в РФ часто режут или подменяют; важен для обхода",
      target: resolver.url,
      run: async () => {
        const domain = TEST_DOMAINS[0];
        try {
          const { answers, elapsed } = await withTimeout(
            dohQuery(resolver.url, domain),
            8000,
          );
          return {
            status: answers.length > 0 ? "ok" : "blocked",
            latencyMs: elapsed,
            errorClass: answers.length > 0 ? "none" : "dns_failure",
            detail:
              answers.length > 0
                ? `${domain} → ${answers.join(", ")} (${elapsed} мс)`
                : `Нет ответа для ${domain}`,
            metadata: { domain, answers: answers.join(",") },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            status: message.includes("timeout") ? "timeout" : "blocked",
            latencyMs: null,
            errorClass: "dns_failure",
            detail: message,
          };
        }
      },
    });
  }

  for (const domain of TEST_DOMAINS) {
    probes.push({
      id: `doh_compare_${domain.replace(/\./g, "_")}`,
      name: `DNS сверка → ${domain}`,
      category: "dns",
      description: "Сравнение DoH-резолверов — детекция подмены DNS (ТСПУ/РКН)",
      target: domain,
      run: async () => {
        const results: Record<string, string[]> = {};
        const timings: number[] = [];

        for (const resolver of DOH_RESOLVERS) {
          try {
            const { answers, elapsed } = await withTimeout(
              dohQuery(resolver.url, domain),
              6000,
            );
            results[resolver.id] = answers;
            timings.push(elapsed);
          } catch {
            results[resolver.id] = [];
          }
        }

        const uniqueSets = new Set(
          Object.values(results).map((a) => a.sort().join("|")),
        );
        const allEmpty = Object.values(results).every((a) => a.length === 0);
        const poisoned = uniqueSets.size > 1 && !allEmpty;

        return {
          status: allEmpty ? "blocked" : poisoned ? "error" : "ok",
          latencyMs: timings.length ? Math.round(timings.reduce((a, b) => a + b, 0) / timings.length) : null,
          errorClass: allEmpty ? "dns_failure" : poisoned ? "dns_poisoned" : "none",
          detail: poisoned
            ? `Расхождение ответов: ${JSON.stringify(results)}`
            : allEmpty
              ? "Все резолверы не ответили"
              : `Согласовано: ${[...uniqueSets][0]}`,
          metadata: { resolvers: Object.keys(results).length, poisoned },
        };
      },
    });
  }

  return probes;
}
