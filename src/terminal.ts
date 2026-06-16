import type { FullReport, ScanProgress } from "./types";
import { createShellContext, executeShellLine, type ShellContext } from "./shell";

const CATEGORY_CMD: Record<string, string> = {
  baseline: "curl -I",
  dns: "doh-query",
  dns_blocked: "doh-blocked",
  tls: "tls-handshake",
  websocket: "wss-probe",
  parallel_ws: "wss-parallel",
  long_lived: "wss-hold",
  path_obfuscation: "wss-path",
  udp: "stun/udp",
  webtransport: "webtransport",
  ipv6: "ipv6-probe",
  image_probe: "img-load",
  throttle: "throttle-test",
  stability: "stability",
  russia_blocked: "ru-block",
  russia_control: "ru-control",
  cascade: "cascade",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ts(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function fmtEta(seconds: number): string {
  if (seconds <= 0) return "0с";
  if (seconds < 60) return `~${seconds}с`;
  return `~${Math.floor(seconds / 60)}м ${seconds % 60}с`;
}

function statusGlyph(status?: string): string {
  if (status === "running") return "◌";
  if (status === "ok") return "✓";
  if (status === "blocked" || status === "timeout" || status === "error") return "✗";
  if (status === "inconclusive" || status === "skipped") return "?";
  return "›";
}

function statusClass(status?: string): string {
  if (status === "ok") return "t-ok";
  if (status === "blocked" || status === "timeout" || status === "error") return "t-bad";
  if (status === "running") return "t-run";
  return "t-muted";
}

function escapeHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type { ScanProgress };

export class ScanTerminal {
  private readonly root: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly currentEl: HTMLElement;
  private readonly inputEl: HTMLInputElement;
  private readonly shell: ShellContext;
  private lineCount = 0;
  private readonly maxLines = 120;
  private lastProgress: ScanProgress | null = null;
  private finished = false;
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onInputKeyDown: (e: KeyboardEvent) => void;
  private readonly onInputLineClick: () => void;
  private readonly onInputPointer: (e: Event) => void;
  private inputLineEl: HTMLElement | null = null;

  constructor(root: HTMLElement) {
    this.shell = createShellContext();
    this.root = root;
    this.root.innerHTML = `
      <div class="term">
        <div class="term-titlebar">
          <span class="term-dots"><i></i><i></i><i></i></span>
          <span class="term-title">milky@net: ~/vpn-probe</span>
        </div>
        <div class="term-body" id="term-body">
          <div class="term-prompt">milky@net:~$ <span class="term-cmd">./vpn-probe --full --from-device</span></div>
          <div class="term-stats" id="term-stats"></div>
          <div class="term-current" id="term-current"></div>
          <div class="term-log" id="term-log"></div>
          <div class="term-input-line">
            <span class="term-prompt">milky@net:~$</span>
            <input
              id="term-input"
              class="term-input"
              type="text"
              spellcheck="false"
              autocomplete="off"
              autocapitalize="off"
              enterkeyhint="send"
              aria-label="Команда терминала"
            />
          </div>
        </div>
      </div>
    `;
    this.statsEl = root.querySelector("#term-stats")!;
    this.currentEl = root.querySelector("#term-current")!;
    this.logEl = root.querySelector("#term-log")!;
    this.inputEl = root.querySelector("#term-input")!;

    this.onKeyDown = (e) => {
      if (e.key === "l" && e.ctrlKey) {
        e.preventDefault();
        this.runCommand("clear");
      }
    };
    this.onInputKeyDown = (e) => this.handleInputKey(e);
    this.onInputLineClick = () => this.activateInput();
    this.onInputPointer = (e: Event) => {
      if (e.target === this.inputEl) return;
      this.activateInput();
    };

    document.addEventListener("keydown", this.onKeyDown);
    this.inputEl.addEventListener("keydown", this.onInputKeyDown);
    this.inputEl.addEventListener("touchstart", this.onInputLineClick, { passive: true });
    const inputLine = root.querySelector(".term-input-line") as HTMLElement;
    this.inputLineEl = inputLine;
    inputLine.addEventListener("click", this.onInputPointer);
    inputLine.addEventListener("touchstart", this.onInputLineClick, { passive: true });

    this.appendSystem("Linux net 6.1.0-amd64 — probe runner attached");
  }

  private activateInput(): void {
    this.inputEl.focus({ preventScroll: true });
  }

  private promptPath(): string {
    const cwd = this.shell.cwd;
    if (cwd === this.shell.home) return "~";
    if (cwd.startsWith(this.shell.home + "/")) return "~" + cwd.slice(this.shell.home.length);
    return cwd;
  }

  private handleInputKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      const line = this.inputEl.value;
      this.inputEl.value = "";
      this.echoCommand(line);
      if (line.trim()) {
        this.shell.history.push(line);
        if (this.shell.history.length > 100) this.shell.history.shift();
      }
      this.runCommand(line);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!this.shell.history.length) return;
      const idx = this.shell.history.length - 1;
      const cur = this.inputEl.dataset.histIdx;
      const next = cur === undefined ? idx : Math.max(0, parseInt(cur, 10) - 1);
      this.inputEl.dataset.histIdx = String(next);
      this.inputEl.value = this.shell.history[next] ?? "";
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const cur = this.inputEl.dataset.histIdx;
      if (cur === undefined) return;
      const next = parseInt(cur, 10) + 1;
      if (next >= this.shell.history.length) {
        delete this.inputEl.dataset.histIdx;
        this.inputEl.value = "";
      } else {
        this.inputEl.dataset.histIdx = String(next);
        this.inputEl.value = this.shell.history[next] ?? "";
      }
    }
  }

  private echoCommand(line: string): void {
    this.pushLine(
      `<span class="term-prompt">milky@net:${escapeHtml(this.promptPath())}$</span> ${escapeHtml(line)}`,
      "term-echo",
    );
  }

  private runCommand(line: string): void {
    if (!line.trim()) return;

    this.syncShellScan();
    const result = executeShellLine(line, this.shell);

    if (result.stdout.includes("__CLEAR__")) {
      this.logEl.innerHTML = "";
      this.lineCount = 0;
      return;
    }

    for (const row of result.stdout) {
      if (row === "__CLEAR__") continue;
      this.appendOutput(row);
    }
    for (const row of result.stderr) {
      this.appendOutput(row, "t-bad");
    }
  }

  private syncShellScan(): void {
    this.shell.scan = this.lastProgress;
    this.shell.scanDone = this.finished;
  }

  private appendSystem(text: string): void {
    this.pushLine(`[${ts()}] <span class="t-sys">[sys]</span> ${escapeHtml(text)}`, "t-sys");
  }

  private appendOutput(text: string, cls = "t-out"): void {
    if (!text) return;
    this.pushLine(escapeHtml(text), cls);
  }

  private pushLine(html: string, cls = ""): void {
    const line = document.createElement("div");
    line.className = `term-line ${cls}`;
    line.innerHTML = html;
    this.logEl.appendChild(line);
    this.lineCount++;
    while (this.lineCount > this.maxLines) {
      const first = this.logEl.firstElementChild;
      if (first) { first.remove(); this.lineCount--; }
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  update(p: ScanProgress): void {
    this.lastProgress = p;
    this.syncShellScan();

    const elapsed = Math.max(0.1, (Date.now() - p.startedAt) / 1000);
    const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
    const perItem = p.done > 0 ? elapsed / p.done : 2.5;
    const remaining = Math.max(0, Math.ceil((p.total - p.done) * perItem));
    const barLen = 20;
    const filled = Math.round((pct / 100) * barLen);
    const bar = "█".repeat(filled) + "░".repeat(barLen - filled);

    const phase = p.phase ?? "probes";
    const phaseLabel =
      phase === "cascade" ? "Каскад маршрута" :
      phase === "init" ? "Подготовка" : "Сканирование проб";

    this.statsEl.innerHTML = `
      <div class="term-stat-row">
        <span class="t-accent">[${pct}%]</span>
        <span class="term-bar">${bar}</span>
        <span class="t-muted">${p.done}/${p.total}</span>
      </div>
      <div class="term-stat-row sub">
        <span>${phaseLabel}</span>
        <span>прошло ${Math.round(elapsed)}с</span>
        <span class="t-warn">осталось ${fmtEta(remaining)}</span>
      </div>
    `;

    const cmd = CATEGORY_CMD[p.category ?? ""] ?? "probe";
    const glyph = statusGlyph(p.status);
    const cls = statusClass(p.status);

    if (p.status === "running") {
      this.currentEl.innerHTML = `
        <div class="term-active ${cls}">
          <span class="t-spin">${glyph}</span>
          <span class="t-cmd">${cmd}</span>
          <span class="t-target">${escapeHtml(p.label)}</span>
          <span class="t-muted">выполняется…</span>
        </div>
      `;
    } else if (p.status && p.label) {
      const lat = p.latencyMs !== null && p.latencyMs !== undefined ? ` <span class="t-muted">${p.latencyMs}ms</span>` : "";
      this.pushLine(
        `[${ts()}] <span class="${cls}">${glyph}</span> <span class="t-cmd">${cmd}</span> ${escapeHtml(p.label)}${lat}`,
        cls,
      );
      this.currentEl.innerHTML = "";
    }
  }

  logPhase(message: string): void {
    this.appendSystem(message);
  }

  finish(ok: boolean): void {
    this.finished = true;
    this.syncShellScan();
    this.currentEl.innerHTML = "";
    this.appendSystem(ok ? "сканирование завершено — формируем отчёт" : "сканирование прервано");
    this.statsEl.innerHTML = `<div class="term-stat-row"><span class="${ok ? "t-ok" : "t-bad"}">${ok ? "✓ Готово" : "✗ Прервано"}</span></div>`;
  }

  showCompleted(report: FullReport): void {
    this.finished = true;
    this.syncShellScan();
    this.currentEl.innerHTML = "";
    const s = report.statistics;
    const barLen = 20;
    const bar = "█".repeat(barLen);
    this.statsEl.innerHTML = `
      <div class="term-stat-row">
        <span class="t-ok">✓ Все тесты выполнены</span>
        <span class="term-bar">${bar}</span>
        <span class="t-muted">${s.total}/${s.total}</span>
      </div>
      <div class="term-stat-row sub">
        <span>${s.ok} ок · ${s.blocked + s.timeout} блок · ${s.inconclusive} неопр.</span>
        <span>${(report.durationMs / 1000).toFixed(0)}с</span>
      </div>
    `;
    this.appendSystem(
      `Сессия завершена · ${s.total} проб · цензура ${s.censorshipLikelihood}% · отчёт готов`,
    );
  }

  clearLog(): void {
    this.logEl.innerHTML = "";
    this.lineCount = 0;
  }

  clear(): void {
    this.clearLog();
    this.currentEl.innerHTML = "";
    this.statsEl.innerHTML = "";
    this.appendSystem("session reset");
    this.finished = false;
    this.lastProgress = null;
    this.syncShellScan();
  }

  destroy(): void {
    document.removeEventListener("keydown", this.onKeyDown);
    this.inputEl.removeEventListener("keydown", this.onInputKeyDown);
    this.inputEl.removeEventListener("touchstart", this.onInputLineClick);
    this.inputLineEl?.removeEventListener("click", this.onInputPointer);
    this.inputLineEl?.removeEventListener("touchstart", this.onInputLineClick);
    this.inputLineEl = null;
  }
}
