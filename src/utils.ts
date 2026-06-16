import type { ErrorClass, ProbeStatus } from "./types";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function classifyFetchError(error: unknown, elapsed: number): {
  status: ProbeStatus;
  errorClass: ErrorClass;
  detail: string;
} {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("abort") || message.includes("timeout") || elapsed >= 7900) {
    return {
      status: "timeout",
      errorClass: "timeout",
      detail: `Таймаут (${elapsed} мс) — типично для DPI/фильтрации`,
    };
  }

  if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
    return {
      status: "blocked",
      errorClass: "tcp_reset",
      detail: `Сеть отклонила соединение: ${message}`,
    };
  }

  return {
    status: "error",
    errorClass: "unknown",
    detail: message,
  };
}

export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; elapsed: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, elapsed: Math.round(performance.now() - start) };
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export function statusLabel(status: ProbeStatus): string {
  const map: Record<ProbeStatus, string> = {
    ok: "Доступен",
    blocked: "Заблокирован",
    timeout: "Таймаут",
    error: "Ошибка",
    inconclusive: "Неопределённо",
    skipped: "Пропущен",
  };
  return map[status];
}

export function verdictLabel(verdict: string): string {
  const map: Record<string, string> = {
    likely_open: "Вероятно открыт",
    likely_blocked: "Вероятно заблокирован",
    inconclusive: "Неопределённо",
  };
  return map[verdict] ?? verdict;
}

export function statusColor(status: ProbeStatus): string {
  const map: Record<ProbeStatus, string> = {
    ok: "var(--ok)",
    blocked: "var(--bad)",
    timeout: "var(--warn)",
    error: "var(--bad)",
    inconclusive: "var(--muted)",
    skipped: "var(--muted)",
  };
  return map[status];
}
