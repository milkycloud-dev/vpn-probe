import type { FullReport, ProbeResult, ProtocolAssessment, StatisticsSummary, TraceHop } from "./types";
import { downloadTextReport, formatCopyLine } from "./export";
import { formatLocaleLabel, resolveLocale } from "./locale";
import { icon } from "./icons";
import { buildNarrative } from "./narrative";
import type { ProbeProgressEvent } from "./runner";
import { ScanTerminal } from "./terminal";
import { hapticError, hapticSuccess } from "./theme";
import { statusColor, statusLabel, verdictLabel } from "./utils";

type UiMode = "idle" | "running" | "results" | "error";

export function renderApp(container: HTMLElement, onRun: () => void) {
  container.innerHTML = `
    <div class="app">
      <header class="header">
        <div class="logo">${icon("shield", "ico-lg")}</div>
        <div class="header-text">
          <h1>VPN Probe</h1>
          <p class="subtitle">Диагностика сети · веб-приложение</p>
        </div>
      </header>

      <div class="action-bar" id="action-bar" data-mode="idle">
        <button id="run-btn" class="action-btn action-btn-primary">${icon("play", "ico-btn")}<span class="btn-label">Проверить всё</span></button>
        <button id="copy-all-btn" class="action-btn action-btn-secondary hidden">${icon("copy", "ico-btn")}<span class="btn-label">Копировать</span></button>
      </div>

      <section class="about-card" id="about-card">
        <h2 class="about-title">О сервисе</h2>
        <p class="about-lead">Диагностика цензуры и VPN-транспортов</p>
        <p class="about-desc">VPN Probe запускает ~110+ проб прямо с вашего устройства: тест РКН-Firewall, DNS-подмену, DPI, throttling и типичные VPN-транспорты.</p>
        <ul class="about-points">
          <li>${icon("globe", "ico-xs")}<span>27 сервисов реестра + 10 контрольных РФ</span></li>
          <li>${icon("vpn", "ico-xs")}<span>DoH-poison, WebTransport, WSS, UDP/STUN</span></li>
          <li>${icon("chart", "ico-xs")}<span>Подробный отчёт</span></li>
        </ul>
      </section>

      <section class="network-card" id="network-card">
        <h2 class="network-title">Ваше подключение</h2>
        <div class="network-grid">
          <div class="network-item">
            <span class="network-lbl">IP</span>
            <span class="network-val" id="net-ip">определяем…</span>
          </div>
          <div class="network-item">
            <span class="network-lbl">Провайдер</span>
            <span class="network-val" id="net-isp">определяем…</span>
          </div>
          <div class="network-item network-item-wide">
            <span class="network-lbl">Местоположение</span>
            <span class="network-val" id="net-location">определяем…</span>
          </div>
        </div>
      </section>

      <section id="results" class="results hidden"></section>

      <section id="terminal-wrap" class="terminal-wrap hidden"></section>

      <footer class="app-footer">
        <p class="footer-disclaimer">
          Сервис предоставляется «как есть» исключительно в целях сетевой диагностики и обучения.
          Результаты отражают доступность публичных ресурсов с вашего устройства в момент проверки,
          не являются гарантией работы VPN, юридической консультацией или рекомендацией к действию.
          Используйте на свой страх и риск.
        </p>
        <p class="footer-brand">Создано на базе <span class="brand-name">MilkyCloud</span></p>
      </footer>
    </div>
  `;

  const actionBar = container.querySelector<HTMLElement>("#action-bar")!;
  const runBtn = container.querySelector<HTMLButtonElement>("#run-btn")!;
  const copyBtn = container.querySelector<HTMLButtonElement>("#copy-all-btn")!;
  const terminalWrap = container.querySelector<HTMLElement>("#terminal-wrap")!;
  const results = container.querySelector<HTMLElement>("#results")!;
  const aboutCard = container.querySelector<HTMLElement>("#about-card")!;
  const networkCard = container.querySelector<HTMLElement>("#network-card")!;

  let terminal: ScanTerminal | null = null;

  runBtn.addEventListener("click", onRun);
  void loadNetworkInfo(container);
  networkCard.addEventListener("click", () => {
    if (networkCard.classList.contains("network-card-error")) {
      void loadNetworkInfo(container, true);
    }
  });

  function setMode(mode: UiMode) {
    actionBar.dataset.mode = mode;

    if (mode === "idle") {
      actionBar.classList.remove("hidden");
      runBtn.disabled = false;
      runBtn.innerHTML = `${icon("play", "ico-btn")}<span class="btn-label">Проверить всё</span>`;
      copyBtn.classList.add("hidden");
      aboutCard.classList.remove("hidden");
      networkCard.classList.remove("hidden");
      terminalWrap.classList.add("hidden");
      terminalWrap.classList.remove("terminal-results");
      results.classList.add("hidden");
      terminal?.destroy();
      terminal = null;
    } else if (mode === "running") {
      actionBar.classList.remove("hidden");
      runBtn.disabled = true;
      runBtn.innerHTML = `${icon("play", "ico-btn")}<span class="btn-label">Сканирование…</span>`;
      copyBtn.classList.add("hidden");
      aboutCard.classList.add("hidden");
      networkCard.classList.add("hidden");
      terminalWrap.classList.remove("hidden");
      terminalWrap.classList.remove("terminal-results");
      results.classList.add("hidden");
    } else if (mode === "results") {
      actionBar.classList.add("hidden");
      aboutCard.classList.add("hidden");
      networkCard.classList.add("hidden");
      terminalWrap.classList.remove("hidden");
      terminalWrap.classList.add("terminal-results");
    } else if (mode === "error") {
      actionBar.classList.remove("hidden");
      runBtn.disabled = false;
      runBtn.innerHTML = `${icon("refresh", "ico-btn")}<span class="btn-label">Повторить</span>`;
      copyBtn.classList.add("hidden");
      aboutCard.classList.add("hidden");
      networkCard.classList.add("hidden");
      terminalWrap.classList.add("hidden");
      terminalWrap.classList.remove("terminal-results");
    }
  }

  return {
    beginScan(startedAt: number) {
      setMode("running");
      terminalWrap.innerHTML = "";
      terminal = new ScanTerminal(terminalWrap);
      terminal.logPhase(`Старт сессии · ${new Date(startedAt).toLocaleTimeString("ru-RU")}`);
      terminal.update({
        done: 0,
        total: 1,
        label: "Инициализация",
        status: "running",
        phase: "init",
        startedAt,
      });
    },
    updateScan(event: ProbeProgressEvent & { phase?: string; startedAt: number }) {
      if (!terminal) return;
      const total = event.phase === "cascade" ? event.total : event.total;
      terminal.update({
        done: event.done,
        total,
        label: event.label,
        category: event.category,
        status: event.status === "skipped" ? "inconclusive" : event.status,
        latencyMs: event.latencyMs,
        phase: event.phase ?? "probes",
        startedAt: event.startedAt,
      });
    },
    finishScan(ok: boolean) {
      terminal?.finish(ok);
    },
    showReport(report: FullReport) {
      setMode("results");
      terminal?.showCompleted(report);
      results.classList.remove("hidden");
      results.innerHTML = renderReportHtml(report);
      bindResultsActions(results, report, onRun);
    },
    showError(message: string) {
      setMode("error");
      results.classList.remove("hidden");
      results.innerHTML = `<div class="error-box">${icon("warn", "ico-sm")}${escapeHtml(message)}</div>`;
    },
  };
}

function renderReportHtml(r: FullReport): string {
  const s = r.statistics;
  const narrative = buildNarrative(r);
  const blockedProtos = r.protocols.filter((p) => p.verdict === "likely_blocked");

  return `
    <div class="score-hero ${r.overallScore < 35 ? "bad" : r.overallScore < 50 ? "warn" : ""}">
      <div class="score-ring">
        <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" class="ring-bg"/><circle cx="50" cy="50" r="42" class="ring-fg" style="stroke-dashoffset:${264 - (264 * r.overallScore) / 100}"/></svg>
        <div class="score-num">${r.overallScore}<small>%</small></div>
      </div>
      <div class="score-info">
        <p class="verdict">${escapeHtml(r.overallVerdict)}</p>
        <div class="score-pills">
          <span class="pill bad">${icon("warn", "ico-xs")} Цензура ${s.censorshipLikelihood}%</span>
          <span class="pill">${s.total} проб · ${(r.durationMs / 1000).toFixed(0)}с</span>
        </div>
      </div>
    </div>

    <div class="results-actions">
      <button type="button" id="result-restart-btn" class="result-btn result-btn-restart">${icon("refresh", "ico-btn")}<span class="btn-label">Снова</span></button>
      <div class="results-actions-row">
        <button type="button" id="result-copy-btn" class="result-btn result-btn-copy">${icon("copy", "ico-btn")}<span class="btn-label">Скопировать результат</span></button>
        <button type="button" id="result-download-btn" class="result-btn result-btn-download">${icon("download", "ico-btn")}<span class="btn-label">Скачать результат</span></button>
      </div>
    </div>

    <div class="narrative narrative-${narrative.tone}">
      <h3 class="narrative-head">${icon(narrative.tone === "bad" ? "warn" : narrative.tone === "ok" ? "check" : "shield", "ico-sm")}${escapeHtml(narrative.headline)}</h3>
      ${narrative.paragraphs.map((p) => `<p class="narrative-p">${escapeHtml(p)}</p>`).join("")}
      ${blockedProtos.length > 0 ? `<div class="narrative-tags">${blockedProtos.slice(0, 4).map((p) => `<span class="ntag">${escapeHtml(p.name)}</span>`).join("")}${blockedProtos.length > 4 ? `<span class="ntag">+${blockedProtos.length - 4}</span>` : ""}</div>` : ""}
    </div>

    <div class="split-scores">
      ${splitCard("Свобода", r.splitScores.censorship, "globe")}
      ${splitCard("VPN-транспорт", r.splitScores.vpnTransport, "vpn")}
      ${splitCard("Интернет", r.splitScores.baseline, "chart")}
    </div>

    ${section("chart", "Статистика", renderStats(s))}
    ${section("route", "Каскад маршрута", `<p class="hint-block">Не ICMP — последовательные пробы узлов</p>${r.cascadeRoute.map(renderHop).join("")}`)}
    ${section("ru", "Блокировки РФ", renderRuBlock(s, r.probes))}
    ${section("ws", "Слои сети", r.layers.map(renderLayer).join(""))}
    ${section("vpn", "VPN протоколы", r.protocols.map(renderProtocol).join(""))}
    ${section("dns", `Все пробы (${r.probes.length})`, r.probes.map(renderProbe).join(""))}
    ${section("globe", "Окружение", renderEnv(r.environment))}
  `;
}

function splitCard(label: string, value: number, ico: keyof typeof import("./icons").icons): string {
  const cls = value < 30 ? "bad" : value < 50 ? "warn" : "ok";
  return `<div class="split-card ${cls}">${icon(ico, "ico-sm")}<div class="split-val">${value}%</div><div class="split-lbl">${label}</div></div>`;
}

function section(ico: keyof typeof import("./icons").icons, title: string, body: string): string {
  return `<div class="section"><div class="section-head">${icon(ico, "ico-sm")}<h2>${title}</h2></div><div class="section-body">${body}</div></div>`;
}

function renderStats(s: StatisticsSummary): string {
  const cells = [
    ["OK", s.ok, "ok"], ["Блок", s.blocked, "bad"], ["Таймаут", s.timeout, "warn"],
    ["Ошибка", s.error, "bad"], ["Неопр.", s.inconclusive, "muted"],
    ["p50", s.latencyP50 !== null ? `${s.latencyP50}мс` : "—", ""],
    ["p95", s.latencyP95 !== null ? `${s.latencyP95}мс` : "—", ""],
    ["Throttle", s.throttleRatio !== null ? `${s.throttleRatio}x` : "—", s.throttleRatio && s.throttleRatio >= 3 ? "warn" : ""],
  ];
  return `<div class="stats-grid">${cells.map(([l, v, c]) => `<div class="stat ${c}"><div class="stat-v">${v}</div><div class="stat-l">${l}</div></div>`).join("")}</div>`;
}

function renderHop(h: TraceHop): string {
  const w = h.deltaMs !== null ? Math.min(100, (h.deltaMs / 400) * 100) : 0;
  return `<div class="hop"><div class="hop-n">${h.hop}</div><div class="hop-b"><div class="hop-t"><span>${escapeHtml(h.label)}</span><span class="badge" style="background:${statusColor(h.status)}">${statusLabel(h.status)}</span></div><div class="hop-bar"><div class="hop-fill" style="width:${w}%"></div></div><div class="hop-d">${h.latencyMs ?? "—"}мс · ${escapeHtml(h.detail)}</div></div></div>`;
}

function renderRuBlock(s: StatisticsSummary, probes: ProbeResult[]): string {
  const items = probes.filter((p) => p.category === "russia_blocked" || p.category === "russia_control");
  return `
    <div class="ru-summary">
      <span>Блок ${s.russiaBlockedDown}/${s.russiaBlockedTotal}</span>
      <span>Контроль ${s.russiaControlUp}/${s.russiaControlTotal}</span>
      <span>DoH poison ${s.dnsBlockedPoisoned}</span>
      <span>IMG ${s.imageBlockDetected}</span>
    </div>
    <div class="ru-grid">${items.map((p) => {
      const ctrl = p.category === "russia_control";
      const good = ctrl ? p.status === "ok" : p.status !== "ok";
      return `<div class="ru-item ${good ? "match" : "miss"}"><span>${escapeHtml(p.name)}</span><span class="badge sm" style="background:${statusColor(p.status)}">${statusLabel(p.status)}</span></div>`;
    }).join("")}</div>`;
}

function renderLayer(l: FullReport["layers"][0]): string {
  const pct = l.total ? Math.round((l.openCount / l.total) * 100) : 0;
  return `<div class="layer">${icon(l.icon as keyof typeof import("./icons").icons, "ico-xs")}<div class="layer-b"><div class="layer-t"><span>${escapeHtml(l.layer)}</span><span class="badge sm" style="background:${statusColor(l.status)}">${statusLabel(l.status)}</span></div><div class="layer-bar"><div class="layer-fill" style="width:${pct}%"></div></div><div class="layer-s"><span class="ok">${l.openCount} ок</span><span class="bad">${l.blockedCount} блок</span><span>${l.inconclusiveCount} ?</span></div></div></div>`;
}

function renderProtocol(p: ProtocolAssessment): string {
  const c = p.verdict === "likely_open" ? "var(--ok)" : p.verdict === "likely_blocked" ? "var(--bad)" : "var(--tg-hint)";
  return `<details class="card"><summary><span>${escapeHtml(p.name)}</span><span class="badge" style="background:${c}">${verdictLabel(p.verdict)} ${p.confidence}%</span></summary><div class="card-body"><p>${escapeHtml(p.summary)}</p><ul>${p.signals.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div></details>`;
}

function renderProbe(p: ProbeResult): string {
  return `<details class="card sm"><summary><span>${escapeHtml(p.name)}</span><span class="probe-r">${p.latencyMs !== null ? `${p.latencyMs}мс` : ""}<span class="badge sm" style="background:${statusColor(p.status)}">${statusLabel(p.status)}</span></span></summary><div class="card-body"><p class="muted">${escapeHtml(p.description)}</p><p>${escapeHtml(p.detail)}</p></div></details>`;
}

function renderEnv(env: Record<string, string>): string {
  return `<div class="env">${Object.entries(env).map(([k, v]) => `<div class="env-r"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`).join("")}</div>`;
}

function escapeHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function loadNetworkInfo(root: HTMLElement, force = false): Promise<void> {
  const ipEl = root.querySelector<HTMLElement>("#net-ip");
  const ispEl = root.querySelector<HTMLElement>("#net-isp");
  const locEl = root.querySelector<HTMLElement>("#net-location");
  const card = root.querySelector<HTMLElement>("#network-card");
  if (!ipEl || !ispEl || !locEl) return;

  ipEl.textContent = "определяем…";
  ispEl.textContent = "определяем…";
  locEl.textContent = "определяем…";

  const geo = await resolveLocale(force);
  if (!geo) {
    ipEl.textContent = "не определён";
    ispEl.textContent = "—";
    locEl.textContent = "—";
    card?.classList.add("network-card-error");
    return;
  }

  card?.classList.remove("network-card-error");
  ipEl.textContent = geo.ip;
  ispEl.textContent = geo.isp || "—";
  locEl.textContent = formatLocaleLabel(geo);
}

function setButtonLabel(btn: HTMLButtonElement, text: string): void {
  const label = btn.querySelector(".btn-label");
  if (label) label.textContent = text;
}

function bindResultsActions(
  resultsEl: HTMLElement,
  report: FullReport,
  onRun: () => void,
): void {
  const restartBtn = resultsEl.querySelector<HTMLButtonElement>("#result-restart-btn");
  const copyBtn = resultsEl.querySelector<HTMLButtonElement>("#result-copy-btn");
  const downloadBtn = resultsEl.querySelector<HTMLButtonElement>("#result-download-btn");
  const reportText = formatCopyLine(report);

  restartBtn?.addEventListener("click", onRun);

  copyBtn?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      copyBtn.classList.add("is-done");
      setButtonLabel(copyBtn, "Скопировано");
      hapticSuccess();
      setTimeout(() => {
        copyBtn.classList.remove("is-done");
        setButtonLabel(copyBtn, "Скопировать результат");
      }, 2500);
    } catch {
      hapticError();
    }
  });

  downloadBtn?.addEventListener("click", () => {
    try {
      downloadTextReport(report);
      downloadBtn.classList.add("is-done");
      setButtonLabel(downloadBtn, "Скачано");
      hapticSuccess();
      setTimeout(() => {
        downloadBtn.classList.remove("is-done");
        setButtonLabel(downloadBtn, "Скачать результат");
      }, 2500);
    } catch {
      hapticError();
    }
  });
}
