/** Общие данные и эвристики для диагностики в сетях РФ (РКН, DNS-poison, DPI). */

export interface RussiaService {
  id: string;
  name: string;
  url: string;
  favicon: string;
  note: string;
}

/** IP и подсети, часто встречающиеся при DNS-подмене и заглушках РКН. */
export const RKN_POISON_IPS = new Set([
  "0.0.0.0",
  "127.0.0.1",
  "127.0.0.2",
  "10.0.0.0",
  "192.168.1.1",
  "94.140.14.14",
  "94.140.15.15",
]);

const RKN_POISON_PREFIXES = ["127.", "0.0.0.", "10.", "192.168.", "198.18.", "100.64."];

export function isLikelyRknPoisonIp(ip: string): boolean {
  const trimmed = ip.trim();
  if (!trimmed) return false;
  if (RKN_POISON_IPS.has(trimmed)) return true;
  return RKN_POISON_PREFIXES.some((p) => trimmed.startsWith(p));
}

export function poisonedAnswers(answers: string[]): string[] {
  return answers.filter(isLikelyRknPoisonIp);
}

export function isLikelyStubImage(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= 2 && height <= 2;
}

/** Сервисы из реестра / массово блокируемые в РФ. */
export const RU_BLOCKED_SERVICES: RussiaService[] = [
  { id: "x", name: "X (Twitter)", url: "https://x.com", favicon: "https://x.com/favicon.ico", note: "Реестр, с 2022" },
  { id: "facebook", name: "Facebook", url: "https://www.facebook.com", favicon: "https://www.facebook.com/favicon.ico", note: "Meta" },
  { id: "instagram", name: "Instagram", url: "https://www.instagram.com", favicon: "https://www.instagram.com/favicon.ico", note: "Meta" },
  { id: "linkedin", name: "LinkedIn", url: "https://www.linkedin.com", favicon: "https://www.linkedin.com/favicon.ico", note: "С 2016" },
  { id: "discord", name: "Discord", url: "https://discord.com", favicon: "https://discord.com/favicon.ico", note: "Реестр 2022" },
  { id: "reddit", name: "Reddit", url: "https://www.reddit.com", favicon: "https://www.redditstatic.com/desktop2x/img/favicon/favicon-32x32.png", note: "Реестр" },
  { id: "medium", name: "Medium", url: "https://medium.com", favicon: "https://medium.com/favicon.ico", note: "Реестр" },
  { id: "pinterest", name: "Pinterest", url: "https://www.pinterest.com", favicon: "https://www.pinterest.com/favicon.ico", note: "Реестр" },
  { id: "meduza", name: "Meduza", url: "https://meduza.io", favicon: "https://meduza.io/favicon.ico", note: "СМИ, реестр" },
  { id: "bbc", name: "BBC", url: "https://www.bbc.com", favicon: "https://www.bbc.com/favicon.ico", note: "Ограничения" },
  { id: "dw", name: "Deutsche Welle", url: "https://www.dw.com", favicon: "https://www.dw.com/favicon.ico", note: "Реестр" },
  { id: "euronews", name: "Euronews", url: "https://www.euronews.com", favicon: "https://www.euronews.com/favicon.ico", note: "Реестр" },
  { id: "rutracker", name: "RuTracker", url: "https://rutracker.org", favicon: "https://rutracker.org/favicon.ico", note: "Трекер" },
  { id: "protonvpn", name: "ProtonVPN", url: "https://protonvpn.com", favicon: "https://protonvpn.com/favicon.ico", note: "VPN-сайт" },
  { id: "nordvpn", name: "NordVPN", url: "https://nordvpn.com", favicon: "https://nordvpn.com/favicon.ico", note: "VPN-сайт" },
  { id: "mullvad", name: "Mullvad", url: "https://mullvad.net", favicon: "https://mullvad.net/favicon.ico", note: "VPN-сайт" },
  { id: "expressvpn", name: "ExpressVPN", url: "https://www.expressvpn.com", favicon: "https://www.expressvpn.com/favicon.ico", note: "VPN-сайт" },
  { id: "signal", name: "Signal", url: "https://signal.org", favicon: "https://signal.org/favicon.ico", note: "Мессенджер" },
  { id: "twitch", name: "Twitch", url: "https://www.twitch.tv", favicon: "https://www.twitch.tv/favicon.ico", note: "Реестр 2024" },
  { id: "openai", name: "OpenAI", url: "https://openai.com", favicon: "https://openai.com/favicon.ico", note: "Ограничения API" },
  { id: "notion", name: "Notion", url: "https://www.notion.so", favicon: "https://www.notion.so/images/favicon.ico", note: "Сервис" },
  { id: "tor", name: "Tor Project", url: "https://www.torproject.org", favicon: "https://www.torproject.org/favicon.ico", note: "Реестр" },
  { id: "spotify", name: "Spotify", url: "https://open.spotify.com", favicon: "https://open.spotify.com/favicon.ico", note: "Реестр 2024" },
  { id: "soundcloud", name: "SoundCloud", url: "https://soundcloud.com", favicon: "https://soundcloud.com/favicon.ico", note: "Реестр" },
  { id: "canva", name: "Canva", url: "https://www.canva.com", favicon: "https://www.canva.com/favicon.ico", note: "Реестр" },
  { id: "roblox", name: "Roblox", url: "https://www.roblox.com", favicon: "https://www.roblox.com/favicon.ico", note: "Реестр" },
  { id: "odysee", name: "Odysee", url: "https://odysee.com", favicon: "https://odysee.com/favicon.ico", note: "Видео" },
];

/** Должны быть доступны из РФ — контроль «интернет жив». */
export const RU_CONTROL_SERVICES: RussiaService[] = [
  { id: "vk", name: "VK", url: "https://vk.com", favicon: "https://vk.com/favicon.ico", note: "Контроль" },
  { id: "yandex", name: "Яндекс", url: "https://ya.ru", favicon: "https://yastatic.net/s3/home/logos/favicon_logo.ico", note: "Контроль" },
  { id: "mailru", name: "Mail.ru", url: "https://mail.ru", favicon: "https://mail.ru/favicon.ico", note: "Контроль" },
  { id: "sber", name: "Сбер", url: "https://www.sberbank.ru", favicon: "https://www.sberbank.ru/favicon.ico", note: "Контроль" },
  { id: "gosuslugi", name: "Госуслуги", url: "https://www.gosuslugi.ru", favicon: "https://www.gosuslugi.ru/favicon.ico", note: "Контроль" },
  { id: "telegram", name: "Telegram", url: "https://telegram.org", favicon: "https://telegram.org/favicon.ico", note: "Контроль" },
  { id: "rutube", name: "Rutube", url: "https://rutube.ru", favicon: "https://rutube.ru/favicon.ico", note: "Контроль" },
  { id: "ozon", name: "Ozon", url: "https://www.ozon.ru", favicon: "https://www.ozon.ru/favicon.ico", note: "Контроль" },
  { id: "wildberries", name: "Wildberries", url: "https://www.wildberries.ru", favicon: "https://www.wildberries.ru/favicon.ico", note: "Контроль" },
  { id: "dzen", name: "Дзен", url: "https://dzen.ru", favicon: "https://dzen.ru/favicon.ico", note: "Контроль" },
];

/** Домены для DoH-проверки DNS-poison (подмножество реестра). */
export const RU_BLOCKED_DOMAINS_DNS = [
  "x.com",
  "instagram.com",
  "facebook.com",
  "discord.com",
  "reddit.com",
  "meduza.io",
  "linkedin.com",
  "openai.com",
  "rutracker.org",
  "protonvpn.com",
  "torproject.org",
  "twitch.tv",
];

export function analyzeDnsAnswers(
  cfAnswers: string[],
  googleAnswers: string[],
): {
  status: "ok" | "blocked" | "error";
  errorClass: "none" | "dns_failure" | "dns_poisoned";
  detail: string;
  poisoned: boolean;
  rknIp: boolean;
} {
  const cfPoison = poisonedAnswers(cfAnswers);
  const gPoison = poisonedAnswers(googleAnswers);
  const allCf = cfAnswers.join(",");
  const allG = googleAnswers.join(",");
  const noAnswer = cfAnswers.length === 0 && googleAnswers.length === 0;
  const mismatch = allCf !== allG && cfAnswers.length > 0 && googleAnswers.length > 0;
  const rknIp = cfPoison.length > 0 || gPoison.length > 0;

  if (noAnswer) {
    return {
      status: "blocked",
      errorClass: "dns_failure",
      detail: "DoH не резолвит — DNS-блок или NXDOMAIN",
      poisoned: false,
      rknIp: false,
    };
  }

  if (rknIp) {
    const ips = [...new Set([...cfPoison, ...gPoison])].join(", ");
    return {
      status: "error",
      errorClass: "dns_poisoned",
      detail: `Подмена DNS (РКН?): ${ips}`,
      poisoned: true,
      rknIp: true,
    };
  }

  if (mismatch) {
    return {
      status: "error",
      errorClass: "dns_poisoned",
      detail: `Расхождение CF[${allCf}] vs G[${allG}]`,
      poisoned: true,
      rknIp: false,
    };
  }

  return {
    status: "ok",
    errorClass: "none",
    detail: `OK: ${allCf || allG}`,
    poisoned: false,
    rknIp: false,
  };
}
