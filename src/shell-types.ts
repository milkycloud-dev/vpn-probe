import type { ScanProgress } from "./types";

export interface ShellContext {
  cwd: string;
  user: string;
  host: string;
  home: string;
  scan: ScanProgress | null;
  scanDone: boolean;
  history: string[];
  env: Record<string, string>;
  elevated?: boolean;
  aptUpdated?: boolean;
  installedPkgs?: Set<string>;
}

export interface ShellResult {
  stdout: string[];
  stderr: string[];
  exitCode: number;
  cwd?: string;
  env?: Record<string, string>;
}
