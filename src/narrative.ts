import type { FullReport } from "./types";

export function buildNarrative(r: FullReport): {
  headline: string;
  paragraphs: string[];
  tone: "bad" | "warn" | "ok";
} {
  const s = r.statistics;
  const blockedProtos = r.protocols.filter((p) => p.verdict === "likely_blocked").length;
  const openProtos = r.protocols.filter((p) => p.verdict === "likely_open").length;
  const inconclusive = r.protocols.filter((p) => p.verdict === "inconclusive").length;

  let tone: "bad" | "warn" | "ok" = "warn";
  let headline = "Сеть под давлением";

  if (s.censorshipLikelihood >= 65 || r.overallScore < 30) {
    tone = "bad";
    headline = "Жёсткая цензура обнаружена";
  } else if (s.censorshipLikelihood < 35 && r.splitScores.vpnTransport >= 45) {
    tone = "ok";
    headline = "Ограничения есть, но не критичные";
  } else if (s.censorshipLikelihood >= 40) {
    tone = "warn";
    headline = "Фильтрация активна — VPN под ударом";
  }

  const paragraphs: string[] = [
    `За ${(r.durationMs / 1000).toFixed(0)} секунд выполнено ${s.total} проб с вашего устройства. ` +
      `Из них ${s.ok} прошли успешно, ${s.blocked + s.timeout} заблокированы или оборваны, ` +
      `${s.inconclusive} остались неопределёнными.`,
  ];

  if (s.dnsBlockedPoisoned >= 3) {
    paragraphs.push(
      `DNS-подмена: ${s.dnsBlockedPoisoned} доменов из реестра дают poisoned/NXDOMAIN через DoH — ` +
        `типичный признак фильтрации на уровне резолвера или провайдера в РФ.`,
    );
  }

  if (s.russiaBlockedIndex >= 50) {
    paragraphs.push(
      `Индекс блокировок РФ — ${s.russiaBlockedIndex}%: ${s.russiaBlockedDown} из ${s.russiaBlockedTotal} ` +
        `запрещённых сервисов недоступны с вашей сети. Это сильный сигнал, что фильтрация работает на уровне IP/DNS/TLS.`,
    );
  } else if (s.russiaBlockedIndex >= 25) {
    paragraphs.push(
      `Часть заблокированных в России сервисов (${s.russiaBlockedDown}/${s.russiaBlockedTotal}) не отвечает — ` +
        `цензура проявляется выборочно, возможны обходы или нестабильность DPI.`,
    );
  } else {
    paragraphs.push(
      `Заблокированные в РФ сервисы в основном недоступны не по причине «мёртвого интернета» ` +
        `(контроль: ${s.russiaControlUp}/${s.russiaControlTotal} ок) — картина неоднозначная.`,
    );
  }

  paragraphs.push(
    `VPN-транспорты: ${blockedProtos} вероятно заблокированы, ${openProtos} могут работать, ` +
      `${inconclusive} без достаточных данных. ` +
      `WSS-оценка ${r.splitScores.vpnTransport}%, UDP/QUIC-слой ${r.splitScores.baseline > 50 ? "жив" : "под вопросом"}.`,
  );

  if (s.throttleRatio !== null && s.throttleRatio >= 3) {
    paragraphs.push(
      `Обнаружено замедление трафика (throttle ~${s.throttleRatio}×) — провайдер может искусственно ` +
        `душить отдельные сервисы, даже если формально они «доступны».`,
    );
  }

  if (tone === "bad") {
    paragraphs.push(
      `Итог: стандартные VPN-протоколы без обфускации просто не сработают. ` +
        `Нужны TLS+WebSocket, CDN-фронт, Reality — и то без гарантий из браузерного теста.`,
    );
  } else if (tone === "ok") {
    paragraphs.push(
      `Итог: базовые транспорты пока проходят, но браузерный тест не заменяет реальный VPN-клиент. ` +
        `При первых признаках блокировки перепроверьте сетку.`,
    );
  } else {
    paragraphs.push(
      `Итог: сеть в «серой зоне» — часть туннелей может работать сегодня и упасть завтра. ` +
        `Имеет смысл держать запасные протоколы и периодически перезапускать диагностику.`,
    );
  }

  return { headline, paragraphs, tone };
}
