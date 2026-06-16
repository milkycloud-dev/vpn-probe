const DARK = {
  bg: "#0e1117",
  secondary: "#161b22",
  section: "#1c2128",
  text: "#e6edf3",
  hint: "#7d8590",
  link: "#58a6ff",
  button: "#238636",
  buttonText: "#ffffff",
  accent: "#1f6feb",
  destructive: "#f85149",
  subtitle: "#8b949e",
  glow: "rgba(31, 111, 235, 0.15)",
};

export function applyTelegramTheme(): void {
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    tg.MainButton.hide();
  }

  const root = document.documentElement;
  root.dataset.scheme = "dark";

  const set = (name: string, value: string) => root.style.setProperty(name, value);

  set("--tg-bg", DARK.bg);
  set("--tg-secondary", DARK.secondary);
  set("--tg-section", DARK.section);
  set("--tg-text", DARK.text);
  set("--tg-hint", DARK.hint);
  set("--tg-link", DARK.link);
  set("--tg-button", DARK.button);
  set("--tg-button-text", DARK.buttonText);
  set("--tg-accent", DARK.accent);
  set("--tg-destructive", DARK.destructive);
  set("--tg-subtitle", DARK.subtitle);
  set("--tg-glow", DARK.glow);

  if (tg) {
    tg.setHeaderColor(DARK.bg);
    tg.setBackgroundColor(DARK.bg);
  }
}

export function hapticSuccess(): void {
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
}

export function hapticError(): void {
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready: () => void;
        expand: () => void;
        setHeaderColor: (color: string) => void;
        setBackgroundColor: (color: string) => void;
        HapticFeedback?: {
          notificationOccurred: (type: "error" | "success" | "warning") => void;
        };
        MainButton: { hide: () => void };
      };
    };
  }
}
