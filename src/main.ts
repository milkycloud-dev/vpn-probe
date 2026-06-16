import "./styles.css";
import { buildReport } from "./report";
import { runAllProbes } from "./runner";
import { runCascadeRoute, CASCADE_HOP_COUNT } from "./probes/traceroute";
import { finalizeReport, warmSession } from "./sync";
import { applyTelegramTheme } from "./theme";
import { renderApp } from "./ui";

applyTelegramTheme();
warmSession();
const app = document.getElementById("app");
if (!app) throw new Error("#app not found");

const ui = renderApp(app, async () => {
  const startedAt = Date.now();
  ui.beginScan(startedAt);

  try {
    const { results: probes, isRussia } = await runAllProbes((event) => {
      ui.updateScan({ ...event, phase: "probes", startedAt });
    });

    ui.updateScan({
      done: probes.length,
      total: probes.length + CASCADE_HOP_COUNT,
      label: "Каскадная диагностика маршрута",
      category: "cascade",
      status: "running",
      phase: "cascade",
      startedAt,
    });

    const cascadeRoute = await runCascadeRoute();

    ui.updateScan({
      done: probes.length + CASCADE_HOP_COUNT,
      total: probes.length + CASCADE_HOP_COUNT,
      label: `Каскад маршрута — ${CASCADE_HOP_COUNT} узлов`,
      category: "cascade",
      status: "ok",
      phase: "cascade",
      startedAt,
    });

    const report = buildReport(probes, startedAt, cascadeRoute, isRussia);
    finalizeReport(report);
    ui.showReport(report);
  } catch (error) {
    ui.finishScan(false);
    ui.showError(error instanceof Error ? error.message : String(error));
  }
});
