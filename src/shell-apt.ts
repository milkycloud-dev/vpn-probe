import type { ShellContext, ShellResult } from "./shell-types";

function ok(stdout: string | string[]): ShellResult {
  return { stdout: Array.isArray(stdout) ? stdout : [stdout], stderr: [], exitCode: 0 };
}

function err(msg: string, code = 1): ShellResult {
  return { stdout: [], stderr: msg ? [msg] : [], exitCode: code };
}

function hasFlag(args: string[], ...flags: string[]): boolean {
  return args.some((a) => flags.includes(a) || flags.some((f) => a.startsWith(f)));
}

function posArgs(args: string[]): string[] {
  return args.filter((a) => !a.startsWith("-"));
}

const PERM = "E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)";

export const PKG_DB: Record<string, { ver: string; size: string; desc: string }> = {
  curl: { ver: "7.88.1-10+deb12u5", size: "266 kB", desc: "command line tool for transferring data" },
  wget: { ver: "1.21.3-1+b2", size: "892 kB", desc: "retrieves files from the web" },
  openvpn: { ver: "2.6.3-1", size: "412 kB", desc: "virtual private network daemon" },
  wireguard: { ver: "1.0.20210914-1", size: "91 kB", desc: "fast, modern, secure VPN tunnel" },
  "wireguard-tools": { ver: "1.0.20210914-1", size: "84 kB", desc: "wireguard userspace tools" },
  nmap: { ver: "7.93+dfsg1-1", size: "3,912 kB", desc: "network mapper" },
  dnsutils: { ver: "1:9.18.19-1~deb12u1", size: "148 kB", desc: "DNS lookup utilities (dig, nslookup)" },
  netcat: { ver: "1.10-47", size: "42 kB", desc: "TCP/IP swiss army knife" },
  traceroute: { ver: "1:2.1.2-1", size: "52 kB", desc: "traces the route to a host" },
  iptables: { ver: "1.8.9-2", size: "360 kB", desc: "administration tools for packet filtering" },
  tcpdump: { ver: "4.99.3-1", size: "434 kB", desc: "network traffic analyzer" },
  htop: { ver: "3.2.2-2", size: "144 kB", desc: "interactive process viewer" },
  vim: { ver: "2:9.0.1378-2", size: "1,428 kB", desc: "Vi IMproved" },
  git: { ver: "1:2.39.2-1.1", size: "8,124 kB", desc: "fast, scalable, distributed revision control" },
  python3: { ver: "3.11.2-1+b1", size: "24 kB", desc: "interactive high-level language" },
  nodejs: { ver: "18.19.0+dfsg-1", size: "342 kB", desc: "evented I/O for V8 javascript" },
  docker: { ver: "24.0.7-1", size: "18,200 kB", desc: "Linux container runtime" },
  tor: { ver: "0.4.7.16-1", size: "1,892 kB", desc: "anonymizing overlay network" },
  shadowsocks: { ver: "3.3.5+ds-8", size: "128 kB", desc: "secure socks5 proxy" },
  openssl: { ver: "3.0.11-1~deb12u2", size: "1,402 kB", desc: "Secure Sockets Layer toolkit" },
  ca: { ver: "20230311", size: "162 kB", desc: "Common CA certificates" },
  "ca-certificates": { ver: "20230311", size: "162 kB", desc: "Common CA certificates" },
  build: { ver: "12.9", size: "12 kB", desc: "automatic configuration file builder" },
  "build-essential": { ver: "12.9", size: "12 kB", desc: "development tools" },
  vpn: { ver: "1.0.0-1", size: "48 kB", desc: "generic VPN helper meta package" },
};

const INSTALLED_BASE = new Set([
  "ca-certificates", "curl", "wget", "dnsutils", "openssl", "python3", "git", "vim", "iptables",
]);

function installed(ctx: ShellContext): Set<string> {
  if (!ctx.installedPkgs) ctx.installedPkgs = new Set(INSTALLED_BASE);
  return ctx.installedPkgs;
}

function aptHeaders(): string[] {
  return [
    "Hit:1 http://deb.debian.org/debian bookworm InRelease",
    "Hit:2 http://deb.debian.org/debian bookworm-updates InRelease",
    "Hit:3 http://security.debian.org/debian-security bookworm-security InRelease",
    "Reading package lists... Done",
  ];
}

function simulateInstall(pkgs: string[], ctx: ShellContext): ShellResult {
  const inst = installed(ctx);
  const newPkgs = pkgs.filter((p) => PKG_DB[p] && !inst.has(p));
  if (!newPkgs.length) return ok(["Reading package lists... Done", "Building dependency tree... Done", "0 upgraded, 0 newly installed, 0 to remove."]);

  const lines = [
    "Reading package lists... Done",
    "Building dependency tree... Done",
    "Reading state information... Done",
    "The following NEW packages will be installed:",
    ...newPkgs.map((p) => `  ${p}`),
    `0 upgraded, ${newPkgs.length} newly installed, 0 to remove and 0 not upgraded.`,
    `Need to get ${newPkgs.map((p) => PKG_DB[p].size).join(", ")} of archives.`,
    "After this operation, additional disk space will be used.",
    ...newPkgs.map((p, i) => `Get:${i + 1} http://deb.debian.org/debian bookworm/main amd64 ${p} amd64 ${PKG_DB[p].ver} [${PKG_DB[p].size}]`),
    `Fetched ${newPkgs.length * 200} kB in 1s (420 kB/s)`,
    "Selecting previously unselected package(s).",
    "(Reading database ... 68421 files and directories currently installed.)",
    ...newPkgs.flatMap((p) => [
      `Preparing to unpack .../${p}_${PKG_DB[p].ver}_amd64.deb ...`,
      `Unpacking ${p} (${PKG_DB[p].ver}) ...`,
      `Setting up ${p} (${PKG_DB[p].ver}) ...`,
    ]),
  ];
  newPkgs.forEach((p) => inst.add(p));
  return ok(lines);
}

function needRoot(ctx: ShellContext): ShellResult | null {
  if (!ctx.elevated) return err(PERM, 100);
  return null;
}

export function handleApt(args: string[], ctx: ShellContext): ShellResult {
  const sub = args.find((a) => !a.startsWith("-")) ?? "";
  const rest = posArgs(args).slice(1);

  if (!sub || hasFlag(args, "--help", "-h")) {
    return ok([
      "apt 2.6.1 (amd64)",
      "Usage: apt [options] command",
      "commands: update, upgrade, install, remove, purge, search, show, list, autoremove, full-upgrade",
    ]);
  }

  if (sub === "update") {
    const deny = needRoot(ctx);
    if (deny) return deny;
    ctx.aptUpdated = true;
    return ok([...aptHeaders(), "Building dependency tree... Done", "Reading state information... Done", "All packages are up to date."]);
  }

  if (sub === "upgrade" || sub === "full-upgrade") {
    const deny = needRoot(ctx);
    if (deny) return deny;
    return ok([
      "Reading package lists... Done",
      "Building dependency tree... Done",
      "Reading state information... Done",
      "Calculating upgrade... Done",
      "0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.",
    ]);
  }

  if (sub === "install") {
    const deny = needRoot(ctx);
    if (deny) return deny;
    const pkgs = rest.length ? rest : ["curl"];
    const unknown = pkgs.filter((p) => !PKG_DB[p]);
    if (unknown.length) {
      return err(`E: Unable to locate package ${unknown[0]}`, 100);
    }
    return simulateInstall(pkgs, ctx);
  }

  if (sub === "remove" || sub === "purge") {
    const deny = needRoot(ctx);
    if (deny) return deny;
    const pkgs = rest;
    if (!pkgs.length) return err("E: Need at least one package name", 100);
    const inst = installed(ctx);
    const lines = ["Reading package lists... Done", "Building dependency tree... Done"];
    for (const p of pkgs) {
      if (inst.has(p)) {
        inst.delete(p);
        lines.push(`Removing ${p} (${PKG_DB[p]?.ver ?? "unknown"}) ...`);
      }
    }
    return ok(lines);
  }

  if (sub === "search") {
    const q = (rest[0] ?? "").toLowerCase();
    const hits = Object.entries(PKG_DB).filter(([n, m]) => n.includes(q) || m.desc.includes(q));
    if (!hits.length) return ok([]);
    return ok(hits.map(([n, m]) => `${n}/${m.ver} amd64  ${m.desc}`));
  }

  if (sub === "show") {
    const p = rest[0];
    if (!p || !PKG_DB[p]) return err(`E: No packages found matching ${p ?? ""}`, 100);
    const m = PKG_DB[p];
    const inst = installed(ctx).has(p);
    return ok([
      `Package: ${p}`,
      `Version: ${m.ver}`,
      `Status: ${inst ? "install ok installed" : "not installed"}`,
      `Priority: optional`,
      `Architecture: amd64`,
      `Description: ${m.desc}`,
    ]);
  }

  if (sub === "list") {
    const inst = installed(ctx);
    if (hasFlag(args, "--installed")) {
      return ok([...inst].map((p) => `${p}/${PKG_DB[p]?.ver ?? "unknown"} amd64 [installed]`));
    }
    return ok(Object.keys(PKG_DB).map((p) => {
      const st = inst.has(p) ? "installed" : "not installed";
      return `${p}/${PKG_DB[p].ver} amd64 [${st}]`;
    }));
  }

  if (sub === "autoremove") {
    const deny = needRoot(ctx);
    if (deny) return deny;
    return ok(["Reading package lists... Done", "Building dependency tree... Done", "0 to remove, 0 not upgraded"]);
  }

  if (sub === "cache" && rest[0] === "policy") {
    const p = rest[1];
    if (!p) return ok(["Package files:", " 100 /var/lib/dpkg/status", " release a=now", " pinned a=now"]);
    if (!PKG_DB[p]) return ok([`${p}:`, "  Unable to locate package"]);
    return ok([
      `${p}:`,
      `  Installed: ${installed(ctx).has(p) ? `(none)` : "(none)"}`,
      `  Candidate: ${PKG_DB[p].ver}`,
      `     Version table:`,
      `        ${PKG_DB[p].ver} 500`,
      `           500 http://deb.debian.org/debian bookworm/main amd64 Packages`,
    ]);
  }

  return err(`E: Invalid operation ${sub}`, 100);
}

export function handleAptGet(args: string[], ctx: ShellContext): ShellResult {
  if (!args.length || hasFlag(args, "--help", "-h")) {
    return ok(["apt-get 2.6.1 (amd64)", "Usage: apt-get [options] command", "commands: update, upgrade, install, remove, dist-upgrade"]);
  }
  const mapped = args[0] === "dist-upgrade" ? ["full-upgrade", ...args.slice(1)] : args;
  return handleApt(mapped, ctx);
}

export function handleDpkg(args: string[], ctx: ShellContext): ShellResult {
  if (hasFlag(args, "-l", "--list")) {
    const inst = installed(ctx);
    const lines = ["Desired=Unknown/Install/Remove/Purge/Hold", "| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend", "|/ Err?=(none)/Reinst-required (Status,Err: uppercase=bad)", "||/ Name           Version           Architecture Description", ...[...inst].map((p) => `ii  ${p.padEnd(15)} ${(PKG_DB[p]?.ver ?? "?").padEnd(17)} amd64        ${PKG_DB[p]?.desc ?? ""}`)];
    return ok(lines);
  }
  if (hasFlag(args, "-s", "--status")) {
    const p = posArgs(args)[0];
    if (!p || !PKG_DB[p]) return err(`dpkg-query: package '${p ?? ""}' is not installed`, 1);
    return ok([`Package: ${p}`, `Status: install ok installed`, `Version: ${PKG_DB[p].ver}`]);
  }
  if (hasFlag(args, "-i", "--info")) {
    const p = posArgs(args)[0];
    if (!p || !PKG_DB[p]) return err(`dpkg: error: --info requires a valid package name`, 2);
    return ok([` new Debian package, version 2.0.`, ` Package: ${p}`, ` Version: ${PKG_DB[p].ver}`, ` Description: ${PKG_DB[p].desc}`]);
  }
  return ok(["dpkg 1.21.22 (amd64)", "Use dpkg --help for help about installing and deinstalling packages"]);
}

export function handleYum(args: string[], ctx: ShellContext): ShellResult {
  if (!ctx.elevated) return err("Error: This command has to be run with superuser privileges (underlying: Permission denied)", 1);
  const sub = args[0] ?? "help";
  if (sub === "update" || sub === "check-update") {
    return ok(["Last metadata expiration check: 0:12:34 ago.", "Dependencies resolved.", "Nothing to do.", "Complete!"]);
  }
  if (sub === "install") {
    const p = args[1] ?? "curl";
    return ok([`Installing: ${p}`, "Transaction Summary", "Install  1 Package", "Complete!"]);
  }
  if (sub === "search") return ok([`${args[1] ?? "vpn"}.x86_64 : virtual private network tools`]);
  return ok(["Usage: yum [OPTIONS] COMMAND", "commands: install, update, search, remove, list"]);
}

export function handlePacman(args: string[], ctx: ShellContext): ShellResult {
  if (!ctx.elevated) return err("error: you cannot perform this operation unless you are root.", 1);
  const sub = args[0] ?? "";
  if (sub === "-S" || sub === "install") return ok(["resolving dependencies...", `installing ${args[1] ?? "curl"}...`, "Optional dependencies for curl", ":: Running post-transaction hooks..."]);
  if (sub === "-Sy" || sub === "-Syu") return ok([":: Synchronizing package databases...", " core downloading...", " extra downloading...", ":: Starting full system upgrade... there is nothing to do"]);
  if (sub === "-Qs") return ok(["local/curl 8.4.0-1", "    command line tool for transferring data"]);
  return ok(["usage: pacman <operation> [...]", "operations: -S, -R, -Ss, -Sy, -Syu, -Q, -Qi"]);
}

export function handleSnap(args: string[], _ctx: ShellContext): ShellResult {
  const sub = args[0] ?? "";
  if (sub === "install") return ok([`curl 8.4.0 from Canonical* installed`, "snap \"curl\" has no services to restart"]);
  if (sub === "list") return ok(["Name   Version   Rev   Tracking   Publisher   Notes", "core   16-2.58.3  17247  latest     canonical   core"]);
  return ok(["snap <command> [<opts>...]", "commands: install, remove, list, find, refresh"]);
}

export function handleAptCache(args: string[], ctx: ShellContext): ShellResult {
  const sub = args.find((a) => !a.startsWith("-")) ?? "";
  const rest = posArgs(args).slice(1);

  if (!sub || hasFlag(args, "--help", "-h")) {
    return ok(["apt-cache 2.6.1", "Usage: apt-cache [options] command", "commands: search, show, policy, depends, pkgnames, stats"]);
  }

  if (sub === "search") return handleApt(["search", ...rest], ctx);
  if (sub === "show") return handleApt(["show", ...rest], ctx);

  if (sub === "policy") {
    const p = rest[0];
    if (!p) return ok(["Package files:", " 100 /var/lib/dpkg/status", " release a=now", " pinned a=now"]);
    if (!PKG_DB[p]) return ok([`${p}:`, "  Unable to locate package"]);
    const inst = installed(ctx).has(p);
    return ok([
      `${p}:`,
      `  Installed: ${inst ? PKG_DB[p].ver : "(none)"}`,
      `  Candidate: ${PKG_DB[p].ver}`,
      `     Version table:`,
      `        ${PKG_DB[p].ver} 500`,
      `           500 http://deb.debian.org/debian bookworm/main amd64 Packages`,
    ]);
  }

  if (sub === "depends") {
    const p = rest[0];
    if (!p || !PKG_DB[p]) return err(`E: Can't find package ${p ?? ""}`, 100);
    return ok([`${p} depends on libc6 (>= 2.34)`, `${p} depends on ca-certificates`]);
  }

  if (sub === "pkgnames") return ok(Object.keys(PKG_DB).filter((n) => n.startsWith(rest[0] ?? "")));
  if (sub === "stats") {
    return ok([
      "Total package names: " + Object.keys(PKG_DB).length,
      "Total package structures: " + Object.keys(PKG_DB).length,
      "Regular packages: " + Object.keys(PKG_DB).length,
    ]);
  }

  return err(`E: Invalid operation ${sub}`, 100);
}

export function handleAptitude(args: string[], ctx: ShellContext): ShellResult {
  if (!ctx.elevated) return err("E: Could not open lock file /var/lib/dpkg/lock - open (13: Permission denied)", 100);
  return handleApt(["install", ...posArgs(args)], ctx);
}
