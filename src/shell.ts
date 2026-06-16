import type { ShellContext, ShellResult } from "./shell-types";
import {
  handleApt,
  handleAptGet,
  handleAptCache,
  handleAptitude,
  handleDpkg,
  handlePacman,
  handleSnap,
  handleYum,
} from "./shell-apt";
import { resolveExternal } from "./shell-stubs";

export type { ShellContext, ShellResult };
type CmdFn = (args: string[], ctx: ShellContext, stdin: string) => ShellResult;

const VFS: Record<string, "file" | "dir"> = {
  "/": "dir",
  "/home": "dir",
  "/home/milky": "dir",
  "/home/milky/vpn-probe": "file",
  "/home/milky/README.md": "file",
  "/home/milky/config.ru.yml": "file",
  "/home/milky/rkn-registry.db": "file",
  "/home/milky/.bash_history": "file",
  "/home/milky/probes": "dir",
  "/home/milky/probes/baseline.sh": "file",
  "/home/milky/probes/dns.sh": "file",
  "/home/milky/probes/russia.sh": "file",
  "/home/milky/probes/websocket.sh": "file",
  "/home/milky/probes/udp.sh": "file",
  "/home/milky/probes/cascade.sh": "file",
  "/etc": "dir",
  "/etc/hosts": "file",
  "/etc/resolv.conf": "file",
  "/var": "dir",
  "/var/log": "dir",
  "/var/log/vpn-probe.log": "file",
  "/tmp": "dir",
  "/usr": "dir",
  "/usr/bin": "dir",
  "/bin": "dir",
};

const FILE_CONTENT: Record<string, string[]> = {
  "/home/milky/README.md": [
    "VPN Probe — network diagnostics for RU censorship filters.",
    "Run ./vpn-probe --full to start a scan from this device.",
  ],
  "/home/milky/config.ru.yml": [
    "region: RU",
    "registry_checks: 27",
    "control_checks: 10",
    "cascade_hops: 12",
  ],
  "/etc/hosts": [
    "127.0.0.1 localhost",
    "::1 localhost ip6-localhost",
    "1.1.1.1 cloudflare-dns",
  ],
  "/etc/resolv.conf": [
    "nameserver 1.1.1.1",
    "nameserver 8.8.8.8",
    "options edns0",
  ],
  "/var/log/vpn-probe.log": [
    "[info] session started",
    "[info] probe runner online",
  ],
};

function ok(stdout: string | string[], extra?: Partial<ShellResult>): ShellResult {
  return {
    stdout: Array.isArray(stdout) ? stdout : [stdout],
    stderr: [],
    exitCode: 0,
    ...extra,
  };
}

function err(msg: string, code = 1): ShellResult {
  return { stdout: [], stderr: msg ? [msg] : [], exitCode: code };
}

function resolvePath(ctx: ShellContext, path: string): string {
  if (path.startsWith("/")) return normalizePath(path);
  if (path === "~" || path.startsWith("~/")) {
    return normalizePath(ctx.home + path.slice(1));
  }
  return normalizePath(`${ctx.cwd}/${path}`);
}

function normalizePath(p: string): string {
  const parts = p.split("/").filter(Boolean);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return "/" + stack.join("/");
}

function listDir(path: string): string[] {
  const prefix = path === "/" ? "/" : path + "/";
  const names = new Set<string>();
  for (const key of Object.keys(VFS)) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const seg = rest.split("/")[0];
    if (seg) names.add(rest.includes("/") ? seg + "/" : seg);
  }
  return [...names].sort();
}

function hasFlag(args: string[], ...flags: string[]): boolean {
  return args.some((a) => flags.includes(a) || flags.some((f) => a.startsWith(f.replace("--", "-"))));
}

function scanStatusLines(ctx: ShellContext): string[] {
  if (ctx.scanDone) return ["scan: completed, report ready"];
  if (!ctx.scan) return ["scan: idle"];
  const p = ctx.scan;
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  const elapsed = Math.round((Date.now() - p.startedAt) / 1000);
  return [
    `phase=${p.phase ?? "probes"}`,
    `progress=${p.done}/${p.total} (${pct}%)`,
    `elapsed=${elapsed}s`,
    p.label ? `current=${p.label}` : "current=—",
  ];
}

const COMMANDS: Record<string, CmdFn> = {
  help: () => ok([
    "GNU bash builtins and common utilities available.",
    "Try: ls, cat README.md, ./vpn-probe --help, man ls, ping 1.1.1.1",
  ]),

  clear: () => ok(["__CLEAR__"]),

  pwd: (_a, c) => ok(c.cwd),

  cd: (args, c) => {
    const target = resolvePath(c, args[0] ?? c.home);
    if (VFS[target] !== "dir") return err(`bash: cd: ${args[0] ?? "~"}: No such file or directory`);
    return ok([], { cwd: target });
  },

  ls: (args, c) => {
    const showAll = hasFlag(args, "-a", "--all");
    const long = hasFlag(args, "-l", "--long");
    const paths = args.filter((a) => !a.startsWith("-"));
    const target = resolvePath(c, paths[0] ?? ".");
    if (VFS[target] === "file") return ok([target.split("/").pop()!]);
    if (VFS[target] !== "dir") return err(`ls: cannot access '${paths[0] ?? "."}': No such file or directory`);
    let items = listDir(target);
    if (!showAll) items = items.filter((n) => !n.startsWith("."));
    if (long) {
      return ok(items.map((n) => {
        const full = target === "/" ? `/${n.replace(/\/$/, "")}` : `${target}/${n.replace(/\/$/, "")}`;
        const kind = VFS[full] === "dir" || n.endsWith("/") ? "d" : "-";
        return `${kind}rwxr-xr-x 1 milky net 4096 ${new Date().toLocaleDateString("en-US", { month: "short", day: "2-digit" })} ${n}`;
      }));
    }
    return ok([items.join("  ")]);
  },

  ll: (args, c) => COMMANDS.ls(["-l", ...args], c, ""),
  la: (args, c) => COMMANDS.ls(["-a", ...args], c, ""),

  tree: (_a, c) => {
    const lines = ["."];
    const walk = (dir: string, indent: string) => {
      for (const name of listDir(dir)) {
        lines.push(`${indent}├── ${name}`);
        const full = dir === "/" ? `/${name.replace(/\/$/, "")}` : `${dir}/${name.replace(/\/$/, "")}`;
        if (VFS[full] === "dir") walk(full, indent + "│   ");
      }
    };
    walk(c.cwd, "");
    return ok(lines);
  },

  cat: (args, c) => {
    if (!args.length) return err("cat: missing file operand");
    const lines: string[] = [];
    for (const arg of args) {
      const p = resolvePath(c, arg);
      if (VFS[p] === "dir") return err(`cat: ${arg}: Is a directory`);
      if (VFS[p] !== "file") return err(`cat: ${arg}: No such file or directory`);
      lines.push(...(FILE_CONTENT[p] ?? [`[binary ${p}]`]));
    }
    return ok(lines);
  },

  head: (args, c, stdin) => {
    const n = parseInt(args.find((a) => a.startsWith("-"))?.replace(/\D/g, "") ?? "10", 10);
    if (stdin) return ok(stdin.split("\n").slice(0, n));
    const file = args.find((a) => !a.startsWith("-"));
    if (!file) return err("head: missing file operand");
    const p = resolvePath(c, file);
    const content = FILE_CONTENT[p];
    if (!content) return err(`head: cannot open '${file}' for reading`);
    return ok(content.slice(0, n));
  },

  tail: (args, c, stdin) => {
    const n = parseInt(args.find((a) => a.startsWith("-"))?.replace(/\D/g, "") ?? "10", 10);
    if (stdin) return ok(stdin.split("\n").slice(-n));
    const file = args.find((a) => !a.startsWith("-"));
    if (!file) return err("tail: missing file operand");
    const p = resolvePath(c, file);
    const content = FILE_CONTENT[p];
    if (!content) return err(`tail: cannot open '${file}' for reading`);
    return ok(content.slice(-n));
  },

  echo: (args, _c, stdin) => {
    if (stdin && !args.length) return ok([stdin.replace(/\n$/, "")]);
    const raw = args.join(" ");
    return ok([raw.replace(/^['"]|['"]$/g, "")]);
  },

  printf: (args) => ok([args.join(" ").replace(/\\n/g, "\n")]),

  whoami: (_a, c) => ok(c.user),
  id: (_a, c) => ok(`uid=1000(${c.user}) gid=1000(net) groups=1000(net),27(sudo)`),
  hostname: (_a, c) => ok(c.host),

  uname: (args) => {
    if (hasFlag(args, "-a")) return ok("Linux net 6.1.0-amd64 #1 SMP x86_64 GNU/Linux");
    if (hasFlag(args, "-r")) return ok("6.1.0-amd64");
    return ok("Linux");
  },

  date: () => ok(new Date().toString()),

  uptime: (_a, c) => {
    const load = (Math.random() * 0.8 + 0.1).toFixed(2);
    const sec = c.scan ? Math.round((Date.now() - c.scan.startedAt) / 1000) : 0;
    return ok(` ${new Date().toLocaleTimeString()} up ${sec || 1} min,  1 user,  load average: ${load}, ${load}, ${load}`);
  },

  free: () => ok([
    "              total        used        free      shared  buff/cache   available",
    "Mem:        8192000     3145728     2097152      131072     2949120     4718592",
    "Swap:       2097152           0     2097152",
  ]),

  df: () => ok([
    "Filesystem     1K-blocks    Used Available Use% Mounted on",
    "/dev/sda1       52428800 8388608  41943040  17% /",
    "tmpfs            4096000      12   4095988   1% /tmp",
  ]),

  du: (_a, c) => ok(["1024\t./probes", "48\t./config.ru.yml", `2048\t${c.cwd}`]),

  ps: () => ok([
    "  PID TTY          TIME CMD",
    " 1420 pts/0    00:00:00 bash",
    " 2841 pts/0    00:00:12 vpn-probe",
    " 3012 pts/0    00:00:00 ps",
  ]),

  top: () => ok([
    "PID USER      PR  NI    VIRT    RES  %CPU %MEM     TIME+ COMMAND",
    "2841 milky     20   0  128000  45600  18.2  0.6   0:12.44 vpn-probe",
    "1420 milky     20   0   10496   3840   0.0  0.1   0:00.02 bash",
  ]),

  kill: () => ok([]),

  which: (args) => {
    if (!args[0]) return err("which: missing argument");
    const known = args[0] in COMMANDS || ["ping", "curl", "dig", "grep", "vpn-probe"].includes(args[0]);
    return known ? ok(`/usr/bin/${args[0]}`) : ok([]);
  },

  type: (args, c) => COMMANDS.which(args, c, ""),
  whereis: (args) => ok(args[0] ? `${args[0]}: /usr/bin/${args[0]} /usr/share/man/man1/${args[0]}.1.gz` : ""),

  env: (_a, c) => ok(Object.entries(c.env).map(([k, v]) => `${k}=${v}`)),

  printenv: (args, c) => {
    if (!args[0]) return COMMANDS.env([], c, "");
    return c.env[args[0]] ? ok(c.env[args[0]]) : err("");
  },

  export: (args, c) => {
    if (!args[0]?.includes("=")) return ok([]);
    const [k, ...rest] = args[0].split("=");
    return ok([], { env: { ...c.env, [k]: rest.join("=") } });
  },

  history: (_a, c) => ok(c.history.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`)),

  alias: () => ok(["alias ll='ls -l'", "alias la='ls -A'", "alias grep='grep --color=auto'"]),

  grep: (args, _c, stdin) => {
    const pattern = args.find((a) => !a.startsWith("-"));
    if (!pattern) return err("grep: missing pattern");
    return ok((stdin || "").split("\n").filter((l) => l.includes(pattern)));
  },

  wc: (_a, _c, stdin) => {
    const lines = stdin ? stdin.split("\n").filter((l) => l.length > 0) : [];
    return ok([`${lines.length}  ${stdin.length}  ${stdin.length}`]);
  },

  sort: (_a, _c, stdin) => ok(stdin.split("\n").filter(Boolean).sort()),
  uniq: (_a, _c, stdin) => ok([...new Set(stdin.split("\n").filter(Boolean))]),

  cut: (args, _c, stdin) => {
    const delim = args.includes("-d") ? args[args.indexOf("-d") + 1] : ":";
    const field = parseInt(args.find((a) => a.startsWith("-f"))?.slice(2) ?? "1", 10);
    return ok(stdin.split("\n").filter(Boolean).map((l) => l.split(delim)[field - 1] ?? l));
  },

  ping: (args) => {
    const host = args.find((a) => !a.startsWith("-")) ?? "127.0.0.1";
    const ms = 28 + Math.floor(Math.random() * 95);
    return ok([
      `PING ${host} (${host}) 56(84) bytes of data.`,
      `64 bytes from ${host}: icmp_seq=1 ttl=56 time=${ms}.${Math.floor(Math.random() * 9)} ms`,
      `64 bytes from ${host}: icmp_seq=2 ttl=56 time=${ms + 3}.${Math.floor(Math.random() * 9)} ms`,
      "",
      `--- ${host} ping statistics ---`,
      "2 packets transmitted, 2 received, 0% packet loss, time 1001ms",
      `rtt min/avg/max/mdev = ${ms}.0/${ms + 2}.0/${ms + 8}.0/2.0 ms`,
    ]);
  },

  traceroute: (args) => {
    const host = args[0] ?? "8.8.8.8";
    return ok([
      `traceroute to ${host} (${host}), 30 hops max, 60 byte packets`,
      " 1  192.168.1.1 (192.168.1.1)  2.112 ms  1.884 ms  1.701 ms",
      " 2  10.0.0.1 (10.0.0.1)  8.441 ms  8.220 ms  8.105 ms",
      ` 3  ${host} (${host})  24.331 ms  23.902 ms  24.011 ms`,
    ]);
  },

  curl: (args) => {
    const url = args.find((a) => !a.startsWith("-")) ?? "https://example.com";
    if (hasFlag(args, "-I")) {
      return ok([
        "HTTP/2 200",
        `date: ${new Date().toUTCString()}`,
        "content-type: text/html",
        "server: cloudflare",
        `cf-ray: ${Math.random().toString(36).slice(2, 18)}`,
      ]);
    }
    return ok([`<!doctype html><!-- fetched ${url} -->`]);
  },

  wget: (args, c) => COMMANDS.curl(args, c, ""),

  dig: (args) => {
    const name = args.find((a) => !a.startsWith("-")) ?? "telegram.org";
    const ip = `${80 + Math.floor(Math.random() * 150)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
    return ok([
      `; <<>> DiG 9.18 <<>> ${name}`,
      ";; ANSWER SECTION:",
      `${name}.\t\t300\tIN\tA\t${ip}`,
      `;; Query time: ${12 + Math.floor(Math.random() * 40)} msec`,
    ]);
  },

  nslookup: (args) => {
    const host = args[0] ?? "cloudflare.com";
    return ok([
      "Server:\t\t1.1.1.1",
      "Address:\t1.1.1.1#53",
      "",
      `Name:\t${host}`,
      `Address: 104.21.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
    ]);
  },

  host: (args, c) => COMMANDS.dig(args, c, ""),

  ip: (args) => {
    if (hasFlag(args, "addr")) {
      return ok([
        "1: lo: <LOOPBACK,UP,LOWER_UP>",
        "    inet 127.0.0.1/8 scope host lo",
        "2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP>",
        "    inet 192.168.1.42/24 brd 192.168.1.255 scope global eth0",
      ]);
    }
    return ok(["Usage: ip addr"]);
  },

  ifconfig: () => ok([
    "eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500",
    "        inet 192.168.1.42  netmask 255.255.255.0  broadcast 192.168.1.255",
    "        RX packets 184233  bytes 198442211 (189.2 MiB)",
  ]),

  netstat: () => ok([
    "Active Internet connections (w/o servers)",
    "Proto Recv-Q Send-Q Local Address           Foreign Address         State",
    "tcp        0      0 192.168.1.42:44321      1.1.1.1:443             ESTABLISHED",
    "tcp        0      0 192.168.1.42:52811      104.21.8.132:443        ESTABLISHED",
  ]),

  ss: (args, c) => COMMANDS.netstat(args, c, ""),

  systemctl: (args) => {
    const unit = args.find((a) => !a.startsWith("-")) ?? "vpn-probe.service";
    if (hasFlag(args, "status")) {
      return ok([
        `● ${unit} - VPN Probe scan runner`,
        "   Loaded: loaded (/etc/systemd/system/vpn-probe.service; enabled)",
        `   Active: active (running) since ${new Date().toLocaleString()}`,
        " Main PID: 2841 (vpn-probe)",
      ]);
    }
    return ok([]);
  },

  journalctl: () => ok([
    `-- Logs begin at ${new Date().toLocaleDateString()} --`,
    "Jun 14 12:00:01 net vpn-probe[2841]: probe session started",
    "Jun 14 12:00:02 net vpn-probe[2841]: loading RU registry targets",
  ]),

  man: (args) => {
    const page = args[0] ?? "bash";
    return ok([
      "NAME",
      `    ${page} - user commands`,
      "SYNOPSIS",
      `    ${page} [OPTION]...`,
      "DESCRIPTION",
      `    Standard GNU/Linux utility. See info coreutils '${page}'.`,
    ]);
  },

  sudo: (args, ctx) => {
    if (!args.length) return err("usage: sudo -h | -K | -k | -V | -v | -l | -L | [-v] [-H] [-S] [-i] [-s] [command]", 1);
    if (hasFlag(args, "-l", "-L")) return ok(["User milky may run the following commands:", "    (ALL : ALL) ALL"]);
    if (hasFlag(args, "-V", "-v")) return ok(["Sudo version 1.9.13p3", "Sudoers policy: default"]);
    const was = ctx.elevated;
    ctx.elevated = true;
    const inner = executeShellLine(args.join(" "), ctx);
    ctx.elevated = was;
    return inner;
  },

  apt: (args, ctx) => handleApt(args, ctx),
  "apt-get": (args, ctx) => handleAptGet(args, ctx),
  "apt-cache": (args, ctx) => handleAptCache(args, ctx),
  dpkg: (args, ctx) => handleDpkg(args, ctx),
  aptitude: (args, ctx) => handleAptitude(args, ctx),
  yum: (args, ctx) => handleYum(args, ctx),
  dnf: (args, ctx) => handleYum(args, ctx),
  pacman: (args, ctx) => handlePacman(args, ctx),
  snap: (args, ctx) => handleSnap(args, ctx),

  chmod: () => ok([]),
  chown: () => ok([]),
  touch: () => ok([]),
  mkdir: () => ok([]),
  rm: () => ok([]),
  cp: () => ok([]),
  mv: () => ok([]),

  exit: () => ok(["logout"]),
  reset: () => ok(["__CLEAR__"]),
  true: () => ok([]),
  false: () => err("", 1),

  seq: (args) => {
    const end = parseInt(args[0] ?? "10", 10);
    return ok(Array.from({ length: end }, (_, i) => String(i + 1)));
  },

  bc: (args, _c, stdin) => {
    const expr = stdin.trim() || args.join(" ");
    try {
      if (!/^[\d\s+\-*/().]+$/.test(expr)) return err("bc: invalid expression");
      return ok([String(Function(`"use strict"; return (${expr})`)())]);
    } catch {
      return err("bc: syntax error");
    }
  },

  awk: (_a, _c, stdin) => ok(stdin.split("\n").filter(Boolean)),
  sed: (_a, _c, stdin) => ok(stdin.split("\n")),
  tee: (_a, _c, stdin) => ok(stdin.split("\n")),
  xargs: (_a, _c, stdin) => ok([stdin.replace(/\n/g, " ").trim()]),

  sleep: (args) => {
    const sec = Math.min(2, parseFloat(args[0] ?? "1") || 1);
    const until = Date.now() + sec * 1000;
    while (Date.now() < until) { /* capped sync wait */ }
    return ok([]);
  },

  status: (_a, c) => ok(scanStatusLines(c)),
  probes: (_a, c) => ok([
    "modules: baseline tls dns dns_blocked websocket udp webtransport ipv6 image throttle russia cascade",
    ...scanStatusLines(c),
  ]),

  "./vpn-probe": (args, c) => {
    if (hasFlag(args, "--help", "-h")) {
      return ok([
        "Usage: ./vpn-probe [--full] [--status] [--from-device]",
        "  --full         run all probes",
        "  --status       show scan progress",
        "  --from-device  use local network stack",
      ]);
    }
    if (hasFlag(args, "--status")) return ok(scanStatusLines(c));
    if (hasFlag(args, "--full")) return ok(["scan running in background", ...scanStatusLines(c)]);
    return ok(["vpn-probe 1.0.0 — pass --help for options"]);
  },

  "vpn-probe": (args, c) => COMMANDS["./vpn-probe"](args, c, ""),
};

const ALIASES: Record<string, string> = {
  ll: "ls -l",
  la: "ls -A",
  md: "mkdir",
  rd: "rmdir",
};

function splitPipeline(line: string): string[] {
  return line.split("|").map((s) => s.trim()).filter(Boolean);
}

function splitStatements(line: string): string[] {
  return line.split(/;|&&/).map((s) => s.trim()).filter(Boolean);
}

function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === " " || ch === "\t") {
      if (cur) { tokens.push(cur); cur = ""; }
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

function runSegment(segment: string, ctx: ShellContext, stdin: string): ShellResult {
  const tokens = tokenize(segment);
  if (!tokens.length) return ok([]);

  let cmd = tokens[0];
  let args = tokens.slice(1);

  if (ALIASES[cmd]) {
    const expanded = tokenize(`${ALIASES[cmd]} ${args.join(" ")}`.trim());
    cmd = expanded[0];
    args = expanded.slice(1);
  }

  if (cmd.startsWith("./") || (cmd.startsWith("/") && cmd !== "/")) {
    if (cmd === "./vpn-probe" || cmd.endsWith("/vpn-probe")) {
      return COMMANDS["./vpn-probe"](args, ctx, stdin);
    }
    const path = cmd.startsWith("./") ? resolvePath(ctx, cmd) : normalizePath(cmd);
    if (VFS[path] === "file") {
      return ok([`#!/bin/bash`, `# ${cmd}`, ...scanStatusLines(ctx)]);
    }
    return err(`bash: ${cmd}: No such file or directory`);
  }

  if (cmd === "time") return runSegment(args.join(" "), ctx, stdin);

  const handler = COMMANDS[cmd];
  if (handler) {
    const res = handler(args, ctx, stdin);
    if (res.cwd) ctx.cwd = res.cwd;
    if (res.env) Object.assign(ctx.env, res.env);
    if (res.cwd) ctx.env.PWD = res.cwd;
    return res;
  }

  return resolveExternal(cmd, args, ctx);
}

export function createShellContext(): ShellContext {
  return {
    cwd: "/home/milky",
    user: "milky",
    host: "net",
    home: "/home/milky",
    scan: null,
    scanDone: false,
    history: [],
    env: {
      HOME: "/home/milky",
      USER: "milky",
      HOSTNAME: "net",
      SHELL: "/bin/bash",
      PATH: "/usr/local/bin:/usr/bin:/bin",
      LANG: "ru_RU.UTF-8",
      TERM: "xterm-256color",
      PWD: "/home/milky",
    },
  };
}

export function executeShellLine(line: string, ctx: ShellContext): ShellResult {
  const statements = splitStatements(line);
  let last: ShellResult = ok([]);

  for (const stmt of statements) {
    const pipes = splitPipeline(stmt);
    let stdin = "";
    for (const pipe of pipes) {
      last = runSegment(pipe, ctx, stdin);
      if (last.exitCode !== 0) break;
      stdin = [...last.stdout, ...last.stderr].join("\n");
    }
    if (last.exitCode !== 0) break;
  }

  return last;
}
