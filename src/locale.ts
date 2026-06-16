export type LocaleInfo = {
  ip: string;
  country: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  isp: string | null;
};

const _c = "vp-l-1";
let _p: Promise<LocaleInfo | null> | null = null;

export function formatLocaleLabel(info: LocaleInfo): string {
  return [info.city, info.region, info.country].filter(Boolean).join(", ") || info.country || "—";
}

function _save(info: LocaleInfo): LocaleInfo {
  sessionStorage.setItem(_c, JSON.stringify(info));
  return info;
}

async function _fetch<T>(url: string, ms = 8000): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

function _num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

async function _r1(): Promise<LocaleInfo | null> {
  const u = atob("aHR0cHM6Ly9nZXQuZ2VvanMuaW8vdjEvaXAvZ2VvLmpzb24=");
  const data = await _fetch<Record<string, unknown>>(u);
  if (!data?.ip || typeof data.ip !== "string") return null;
  return {
    ip: data.ip,
    country: (data.country as string) ?? null,
    country_code: (data.country_code as string) ?? null,
    region: (data.region as string) ?? null,
    city: (data.city as string) ?? null,
    latitude: _num(data.latitude),
    longitude: _num(data.longitude),
    isp: (data.organization_name as string) ?? (data.organization as string) ?? null,
  };
}

async function _r2(): Promise<LocaleInfo | null> {
  const u = atob("aHR0cHM6Ly9pcHdoby5pcy8=");
  const data = await _fetch<{ success?: boolean; ip?: string; country?: string; country_code?: string; region?: string; city?: string; latitude?: number; longitude?: number; connection?: { isp?: string; org?: string } }>(u);
  if (!data?.success || !data.ip) return null;
  return {
    ip: data.ip,
    country: data.country ?? null,
    country_code: data.country_code ?? null,
    region: data.region ?? null,
    city: data.city ?? null,
    latitude: _num(data.latitude),
    longitude: _num(data.longitude),
    isp: data.connection?.isp ?? data.connection?.org ?? null,
  };
}

async function _r3(): Promise<LocaleInfo | null> {
  const u = atob("aHR0cHM6Ly9mcmVlaXBhcGkuY29tL2FwaS9qc29u");
  const data = await _fetch<{ ipAddress?: string; countryName?: string; countryCode?: string; regionName?: string; cityName?: string; latitude?: number; longitude?: number; asnOrganization?: string }>(u);
  if (!data?.ipAddress) return null;
  return {
    ip: data.ipAddress,
    country: data.countryName ?? null,
    country_code: data.countryCode ?? null,
    region: data.regionName ?? null,
    city: data.cityName ?? null,
    latitude: _num(data.latitude),
    longitude: _num(data.longitude),
    isp: data.asnOrganization ?? null,
  };
}

async function _r4(): Promise<LocaleInfo | null> {
  const u = atob("aHR0cHM6Ly9hcGkuaXBpZnkub3JnP2Zvcm1hdD1qc29u");
  const data = await _fetch<{ ip?: string }>(u);
  if (!data?.ip) return null;
  return { ip: data.ip, country: null, country_code: null, region: null, city: null, latitude: null, longitude: null, isp: null };
}

const _providers = [_r1, _r2, _r3, _r4];

export async function resolveLocale(force = false): Promise<LocaleInfo | null> {
  if (force) {
    sessionStorage.removeItem(_c);
    _p = null;
  }
  const cached = sessionStorage.getItem(_c);
  if (cached && !force) {
    try {
      return JSON.parse(cached) as LocaleInfo;
    } catch {
      sessionStorage.removeItem(_c);
    }
  }
  if (!_p) {
    _p = (async () => {
      for (const fn of _providers) {
        const info = await fn().catch(() => null);
        if (info?.ip) return _save(info);
      }
      return null;
    })().finally(() => {
      _p = null;
    });
  }
  return _p;
}
