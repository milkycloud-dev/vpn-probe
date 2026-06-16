import type { ProbeDefinition } from "../types";
import { analyzeDnsAnswers, isLikelyRknPoisonIp, poisonedAnswers } from "./russia-common";
import { classifyFetchError, withTimeout } from "../utils";

const DOH_CF = "https://cloudflare-dns.com/dns-query";
const DOH_GOOGLE = "https://dns.google/resolve";

const AAAA_COMPARE_DOMAINS = [
  { id: "x", domain: "x.com", label: "X (Twitter)" },
  { id: "instagram", domain: "instagram.com", label: "Instagram" },
  { id: "protonvpn", domain: "protonvpn.com", label: "ProtonVPN" },
];

export interface Ipv6DetectResult {
  available: boolean;
  address?: string;
  latencyMs?: number;
  detail: string;
}

export async function detectIpv6Connectivity(): Promise<Ipv6DetectResult> {
  const endpoints = [
    "https://ipv6.icanhazip.com",
    "https://ipv6.google.com/generate_204",
  ];

  for (const url of endpoints) {
    const start = performance.now();
    try {
      const response = await withTimeout(
        fetch(url, { cache: "no-store", mode: "cors" }),
        6000,
      );
      const elapsed = Math.round(performance.now() - start);
      if (!response.ok) continue;

      let address = "";
      if (url.includes("icanhazip")) {
        address = (await response.text()).trim();
      }

      return {
        available: true,
        address: address || undefined,
        latencyMs: elapsed,
        detail: address
          ? `IPv6 работает (${address}, ${elapsed} мс)`
          : `IPv6 работает — ответ от ${new URL(url).hostname} за ${elapsed} мс`,
      };
    } catch {
      /* try next endpoint */
    }
  }

  return {
    available: false,
    detail: "IPv6 недоступен — нет ответа от ipv6.icanhazip.com и ipv6.google.com",
  };
}

async function fetchTimed(url: string, timeoutMs: number): Promise<{ ok: boolean; elapsed: number; error?: string }> {
  const start = performance.now();
  try {
    await withTimeout(fetch(url, { cache: "no-store", mode: "no-cors" }), timeoutMs);
    return { ok: true, elapsed: Math.round(performance.now() - start) };
  } catch (error) {
    const elapsed = Math.round(performance.now() - start);
    const classified = classifyFetchError(error, elapsed);
    return { ok: false, elapsed, error: classified.detail };
  }
}

async function dohResolve(
  resolver: string,
  domain: string,
  type: "A" | "AAAA",
): Promise<{ answers: string[]; elapsed: number }> {
  const start = performance.now();
  const url = `${resolver}?name=${encodeURIComponent(domain)}&type=${type}`;
  const response = await fetch(url, {
    headers: { Accept: "application/dns-json" },
    cache: "no-store",
  });
  const data = (await response.json()) as {
    Answer?: Array<{ data: string; type: number }>;
  };
  const typeCode = type === "A" ? 1 : 28;
  const answers = data.Answer?.filter((a) => a.type === typeCode).map((a) => a.data) ?? [];
  return { answers, elapsed: Math.round(performance.now() - start) };
}

function analyzeAaaaVsA(
  aAnswers: string[],
  aaaaAnswers: string[],
): {
  status: "ok" | "blocked" | "error" | "inconclusive";
  errorClass: "none" | "dns_poisoned" | "dns_failure";
  detail: string;
  asymmetric: boolean;
} {
  const aPoison = poisonedAnswers(aAnswers);
  const aaaaPoison = aaaaAnswers.filter((ip) => {
    const v = ip.toLowerCase();
    return v === "::1" || v === "::" || v.startsWith("::ffff:127.") || isLikelyRknPoisonIp(ip);
  });

  const aHasPoison = aPoison.length > 0;
  const aaaaHasPoison = aaaaPoison.length > 0;
  const aEmpty = aAnswers.length === 0;
  const aaaaEmpty = aaaaAnswers.length === 0;

  if (aHasPoison && !aaaaHasPoison && !aaaaEmpty) {
    return {
      status: "ok",
      errorClass: "dns_poisoned",
      detail: `A подменён (${aPoison.join(", ")}), AAAA чистый — обход через IPv6 возможен`,
      asymmetric: true,
    };
  }

  if (aHasPoison && aaaaHasPoison) {
    return {
      status: "error",
      errorClass: "dns_poisoned",
      detail: `Подмена и A (${aPoison.join(", ")}), и AAAA (${aaaaPoison.join(", ")})`,
      asymmetric: false,
    };
  }

  if (aHasPoison && aaaaEmpty) {
    return {
      status: "inconclusive",
      errorClass: "dns_poisoned",
      detail: `A подменён (${aPoison.join(", ")}), AAAA пуст — v6-обход маловероятен`,
      asymmetric: false,
    };
  }

  if (!aHasPoison && !aaaaHasPoison && !aEmpty) {
    return {
      status: "ok",
      errorClass: "none",
      detail: aaaaEmpty
        ? `A=${aAnswers.join(", ")} · AAAA не опубликован`
        : `A=${aAnswers.join(", ")} · AAAA=${aaaaAnswers.join(", ")}`,
      asymmetric: false,
    };
  }

  if (aEmpty && aaaaEmpty) {
    return {
      status: "blocked",
      errorClass: "dns_failure",
      detail: "DoH не вернул ни A, ни AAAA",
      asymmetric: false,
    };
  }

  return {
    status: "inconclusive",
    errorClass: "none",
    detail: `A: ${aAnswers.join(", ") || "—"} · AAAA: ${aaaaAnswers.join(", ") || "—"}`,
    asymmetric: false,
  };
}

export function createIpv6Probes(): ProbeDefinition[] {
  const availability: ProbeDefinition = {
    id: "ipv6_availability",
    name: "IPv6 доступность",
    category: "ipv6",
    description: "Проверяет, есть ли у клиента рабочий IPv6 — без него сравнение v4/v6 бессмысленно",
    target: "https://ipv6.icanhazip.com",
    run: async () => {
      const r = await detectIpv6Connectivity();
      if (r.available) {
        return {
          status: "ok",
          latencyMs: r.latencyMs ?? null,
          errorClass: "none",
          detail: r.detail,
          metadata: { ipv6Available: true, address: r.address ?? "" },
        };
      }
      return {
        status: "inconclusive",
        latencyMs: null,
        errorClass: "none",
        detail: `${r.detail} — сравнительные пробы v4/v6 пропущены`,
        metadata: { ipv6Available: false, address: "" },
      };
    },
  };

  const latencyCompare: ProbeDefinition = {
    id: "ipv6_v4_latency",
    name: "IPv6 vs IPv4: задержка",
    category: "ipv6",
    description: "Сравнение RTT до icanhazip по стекам — асимметрия типична у некоторых ISP в РФ",
    target: "ipv4.icanhazip.com vs ipv6.icanhazip.com",
    requiresIpv6: true,
    run: async () => {
      const [v4, v6] = await Promise.all([
        fetchTimed("https://ipv4.icanhazip.com", 6000),
        fetchTimed("https://ipv6.icanhazip.com", 6000),
      ]);

      if (!v4.ok && !v6.ok) {
        return {
          status: "blocked",
          latencyMs: null,
          errorClass: "tcp_reset",
          detail: `Оба стека недоступны: v4=${v4.error ?? "fail"}, v6=${v6.error ?? "fail"}`,
          metadata: { v4Ms: v4.elapsed, v6Ms: v6.elapsed, ratio: 0, v4Only: 0, v6Only: 0 },
        };
      }

      if (!v4.ok && v6.ok) {
        return {
          status: "ok",
          latencyMs: v6.elapsed,
          errorClass: "none",
          detail: `Только IPv6 отвечает (${v6.elapsed} мс) — v4: ${v4.error ?? "fail"}`,
          metadata: { v4Ms: v4.elapsed, v6Ms: v6.elapsed, ratio: 0, v4Only: 0, v6Only: 1 },
        };
      }

      if (v4.ok && !v6.ok) {
        return {
          status: "inconclusive",
          latencyMs: v4.elapsed,
          errorClass: "none",
          detail: `Только IPv4 отвечает (${v4.elapsed} мс) — странно после успешного precheck`,
          metadata: { v4Ms: v4.elapsed, v6Ms: v6.elapsed, ratio: 0, v4Only: 1, v6Only: 0 },
        };
      }

      const ratio = v4.elapsed > 0 ? v6.elapsed / v4.elapsed : v6.elapsed;
      const asymmetric = ratio >= 2.5 || ratio <= 0.4;

      return {
        status: "ok",
        latencyMs: Math.round((v4.elapsed + v6.elapsed) / 2),
        errorClass: "none",
        detail: asymmetric
          ? `Асимметрия: v4 ${v4.elapsed} мс vs v6 ${v6.elapsed} мс (×${ratio.toFixed(1)})`
          : `v4 ${v4.elapsed} мс · v6 ${v6.elapsed} мс — близко`,
        metadata: { v4Ms: v4.elapsed, v6Ms: v6.elapsed, ratio: Math.round(ratio * 10) / 10, v4Only: 0, v6Only: 0 },
      };
    },
  };

  const googleReach: ProbeDefinition = {
    id: "ipv6_v4_google",
    name: "IPv6 vs IPv4: Google",
    category: "ipv6",
    description: "Доступность ipv4.google.com и ipv6.google.com — контрольная пара dual-stack",
    target: "ipv4.google.com vs ipv6.google.com",
    requiresIpv6: true,
    run: async () => {
      const [v4, v6] = await Promise.all([
        fetchTimed("https://ipv4.google.com/generate_204", 6000),
        fetchTimed("https://ipv6.google.com/generate_204", 6000),
      ]);

      if (v4.ok && v6.ok) {
        return {
          status: "ok",
          latencyMs: Math.round((v4.elapsed + v6.elapsed) / 2),
          errorClass: "none",
          detail: `Оба стека живы: v4 ${v4.elapsed} мс, v6 ${v6.elapsed} мс`,
          metadata: { v4Ok: 1, v6Ok: 1, v4Ms: v4.elapsed, v6Ms: v6.elapsed },
        };
      }

      if (v4.ok && !v6.ok) {
        return {
          status: "inconclusive",
          latencyMs: v4.elapsed,
          errorClass: "none",
          detail: `v4 OK (${v4.elapsed} мс), v6 fail — ${v6.error ?? "нет ответа"}`,
          metadata: { v4Ok: 1, v6Ok: 0, v4Ms: v4.elapsed, v6Ms: v6.elapsed },
        };
      }

      if (!v4.ok && v6.ok) {
        return {
          status: "ok",
          latencyMs: v6.elapsed,
          errorClass: "none",
          detail: `Только v6 OK (${v6.elapsed} мс) — v4: ${v4.error ?? "fail"}`,
          metadata: { v4Ok: 0, v6Ok: 1, v4Ms: v4.elapsed, v6Ms: v6.elapsed },
        };
      }

      return {
        status: "blocked",
        latencyMs: null,
        errorClass: "tcp_reset",
        detail: `Оба недоступны: v4 ${v4.error ?? "fail"}, v6 ${v6.error ?? "fail"}`,
        metadata: { v4Ok: 0, v6Ok: 0, v4Ms: v4.elapsed, v6Ms: v6.elapsed },
      };
    },
  };

  const aaaaProbes: ProbeDefinition[] = AAAA_COMPARE_DOMAINS.map((t) => ({
    id: `ipv6_doh_aaaa_${t.id}`,
    name: `DoH A vs AAAA → ${t.label}`,
    category: "ipv6" as const,
    description: "Сравнение DNS-подмены на A и AAAA — в РФ иногда v6 чистый при poisoned v4",
    target: t.domain,
    requiresIpv6: true,
    run: async () => {
      try {
        const [cfA, cfAAAA, gA, gAAAA] = await Promise.all([
          withTimeout(dohResolve(DOH_CF, t.domain, "A"), 6000),
          withTimeout(dohResolve(DOH_CF, t.domain, "AAAA"), 6000),
          withTimeout(dohResolve(DOH_GOOGLE, t.domain, "A"), 6000),
          withTimeout(dohResolve(DOH_GOOGLE, t.domain, "AAAA"), 6000),
        ]);

        const aMerged = [...new Set([...cfA.answers, ...gA.answers])];
        const aaaaMerged = [...new Set([...cfAAAA.answers, ...gAAAA.answers])];
        const aAnalysis = analyzeDnsAnswers(cfA.answers, gA.answers);
        const analysis = analyzeAaaaVsA(aMerged, aaaaMerged);
        const elapsed = Math.round((cfA.elapsed + cfAAAA.elapsed + gA.elapsed + gAAAA.elapsed) / 4);

        return {
          status: analysis.status,
          latencyMs: elapsed,
          errorClass: analysis.errorClass,
          detail: analysis.detail,
          metadata: {
            asymmetric: analysis.asymmetric,
            aPoisoned: aAnalysis.poisoned,
            a: aMerged.join(","),
            aaaa: aaaaMerged.join(","),
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

  return [availability, latencyCompare, googleReach, ...aaaaProbes];
}
