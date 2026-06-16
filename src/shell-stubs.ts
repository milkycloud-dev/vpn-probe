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

type StubFn = (args: string[], ctx: ShellContext) => ShellResult;

function digHost(args: string[]): ShellResult {
  const name = args.find((a) => !a.startsWith("-")) ?? "localhost";
  const ip = `104.21.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  return ok([`${name} has address ${ip}`]);
}

const STUBS: Record<string, StubFn> = {
  git: () => ok("git version 2.39.2"),
  node: () => ok("v20.11.0"),
  npm: () => ok("10.2.4"),
  python3: () => ok("Python 3.11.6"),
  pip3: () => ok("pip 23.2.1 from /usr/lib/python3/dist-packages/pip (python 3.11)"),
  go: () => ok("go version go1.21.5 linux/amd64"),
  rustc: () => ok("rustc 1.74.1"),
  cargo: () => ok("cargo 1.74.1"),
  docker: () => err("Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?", 1),
  ssh: () => err("ssh: connect to host port 22: Connection refused", 255),
  scp: () => err("ssh: connect to host port 22: Connection refused", 255),
  find: (args) => {
    if (args.includes("-name")) {
      const name = args[args.indexOf("-name") + 1]?.replace(/'/g, "");
      if (name) return ok([`/home/milky/${name}`, `/usr/bin/${name}`]);
    }
    return ok(["/home/milky/vpn-probe", "/home/milky/probes/baseline.sh", "/etc/hosts"]);
  },
  locate: () => ok(["/home/milky/vpn-probe", "/usr/bin/ping", "/usr/bin/apt"]),
  lsb_release: () => ok(["Distributor ID:\tDebian", "Description:\tDebian GNU/Linux 12 (bookworm)"]),
  lscpu: () => ok(["Architecture:            x86_64", "CPU(s):                  4"]),
  lsblk: () => ok(["NAME   MAJ:MIN RM  SIZE RO TYPE MOUNTPOINT", "sda      8:0    0   50G  0 disk /"]),
  nmap: (args) => ok([`Nmap scan report for ${args[0] ?? "127.0.0.1"}`, "Host is up.", "443/tcp open https"]),
  make: () => ok(["make: Nothing to be done for 'all'."]),
  gcc: () => ok("gcc (Debian 12.2.0-14) 12.2.0"),
  host: (args) => digHost(args),
  ufw: () => ok(["Status: inactive"]),
  iptables: () => err("iptables: Permission denied", 4),
  nmcli: () => ok(["eth0    ethernet  connected  Wired connection 1"]),
  lspci: () => ok(["00:02.0 VGA compatible controller: Intel Corporation UHD Graphics 620"]),
  groups: (_a, c) => ok(`${c.user} net sudo`),
  w: () => ok(["milky    pts/0    192.168.1.10     11:46    0.00s  w"]),
  who: () => ok(["milky    pts/0        2024-06-14 11:46 (192.168.1.10)"]),
  hostnamectl: () => ok([" Static hostname: net", "Operating System: Debian GNU/Linux 12 (bookworm)"]),
  vi: () => ok(["Vim: Warning: Output is not to a terminal"]),
  vim: () => ok(["Vim: Warning: Output is not to a terminal"]),
  nano: () => ok(["GNU nano 7.2 — terminal size too small"]),
  python: () => ok("Python 3.11.6"),
  ruby: () => ok("ruby 3.2.2"),
  mount: () => ok(["/dev/sda1 on / type ext4 (rw,relatime)"]),
  route: () => ok([
    "Kernel IP routing table",
    "Destination     Gateway         Genmask         Flags Metric Ref    Use Iface",
    "0.0.0.0         192.168.1.1     0.0.0.0         UG    100    0        0 eth0",
  ]),
  arp: () => ok([
    "Address                  HWtype  HWaddress           Flags Mask            Iface",
    "192.168.1.1            ether   aa:bb:cc:dd:ee:ff   C                     eth0",
  ]),
  dmesg: () => ok([
    "[    0.000000] Linux version 6.1.0-amd64",
    "[    1.224411] eth0: link up",
  ]),
  openssl: () => ok("OpenSSL 3.0.11 19 Sep 2023"),
  nc: () => ok([]),
  netcat: () => ok([]),
  jq: () => err("jq: error: syntax error, unexpected end of file", 2),
  telnet: () => err("telnet: Unable to connect to remote host: Connection refused", 1),
  ftp: () => err("ftp: connect: Connection refused", 1),
  bash: () => ok([]),
  sh: () => ok([]),
};

function genericFallback(cmd: string, args: string[]): ShellResult {
  if (hasFlag(args, "--help", "-h")) {
    return ok([`Usage: ${cmd} [OPTION]...`, `Try '${cmd} --help' for more information.`]);
  }
  if (hasFlag(args, "--version", "-V", "-v")) return ok(`${cmd} 1.0.0`);
  if (/^(is-|check-|test-)/.test(cmd)) return ok(["yes"]);
  if (cmd.endsWith("ctl")) return ok([`${cmd}: active (running)`]);
  if (/^[a-z][a-z0-9+_-]{0,48}$/i.test(cmd)) {
    return args.length === 0 ? ok([`${cmd}: ready`]) : ok([`${cmd}: done (${args.join(" ")})`]);
  }
  return err(`bash: ${cmd}: command not found`, 127);
}

export function resolveExternal(cmd: string, args: string[], ctx: ShellContext): ShellResult {
  const key = cmd.replace(/-/g, "_");
  const fn = STUBS[cmd] ?? STUBS[key];
  if (fn) return fn(args, ctx);
  return genericFallback(cmd, args);
}
