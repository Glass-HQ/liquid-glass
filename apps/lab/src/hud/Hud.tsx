import type { TelemetryReport } from "@glass-sdk/liquid-glass";
import { useGlassScene } from "@glass-sdk/liquid-glass/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Counters = TelemetryReport["counters"];

interface Mark {
  readonly name: string;
  readonly at: number;
}

const historyLength = 60;

/**
 * Live numbers from the scene's telemetry, once a second. It renders into document.body,
 * outside the scene's root, so its own updates are never captured under glass.
 *
 * Every report is also kept on `window.__labTelemetry` (the last 120) for scripts.
 */
export function Hud() {
  const scene = useGlassScene();
  const [report, setReport] = useState<TelemetryReport | null>(null);
  const [marks, setMarks] = useState<readonly Mark[]>(readMarks);
  const [expanded, setExpanded] = useState(false);
  const history = useRef<number[]>([]);
  const sparkRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!scene) return;
    const telemetry = scene.telemetry;
    const wasEnabled = telemetry.enabled;
    telemetry.setEnabled(true);
    const kept: TelemetryReport[] = [];
    Object.assign(window, { __labTelemetry: kept });
    const unsubscribe = telemetry.subscribe((next) => {
      kept.push(next);
      if (kept.length > 120) kept.shift();
      history.current.push(perSecond(next.counters, "worker.present", next.intervalMs));
      if (history.current.length > historyLength) history.current.shift();
      drawSpark(sparkRef.current, history.current);
      setReport(next);
      setMarks(readMarks());
    });
    return () => {
      unsubscribe();
      telemetry.setEnabled(wasEnabled);
    };
  }, [scene]);

  const c = report?.counters ?? {};
  const interval = report?.intervalMs ?? 1000;
  const rate = (name: string) => perSecond(c, name, interval);
  const presented = count(c, "worker.present");
  const perFrame = (name: string) => (presented > 0 ? ms(c, name) / presented : 0);
  const posted = count(c, "page.frame");
  const inFlight = c["page.inflight"];
  const captures = count(c, "page.capture");
  const items = c["page.capture.items"];
  const known = new Set(knownCounters);
  const others = Object.keys(c)
    .filter((name) => !known.has(name))
    .sort();

  const rows: [string, string][] = [
    ["Presented", `${fmt(rate("worker.present"))} fps`],
    ["Posted", `${fmt(rate("page.frame"))} /s`],
    [
      "In flight",
      inFlight && inFlight.count > 0
        ? `${(inFlight.ms / inFlight.count).toFixed(2)} avg`
        : `${Math.max(0, posted - presented)} unanswered`,
    ],
    ["Gaps ≥20 ms", `${count(c, "page.gap")}`],
    ["Input", `${fmt(rate("input.sample"))} /s · ${fmt(rate("input.unique"))} unique`],
    ["Measure", `${(posted > 0 ? ms(c, "page.measure") / posted : 0).toFixed(2)} ms/frame`],
    ["Underlay", `${perFrame("worker.underlay").toFixed(2)} ms/frame`],
    ["Frost", `${perFrame("worker.frost").toFixed(2)} ms/frame`],
    ["Glass", `${perFrame("worker.glass").toFixed(2)} ms/frame`],
    ["Copy", `${perFrame("worker.copy").toFixed(2)} ms/frame`],
    ["Commit", `${perFrame("worker.commit").toFixed(2)} ms/frame`],
    [
      "Capture",
      `${ms(c, "page.capture").toFixed(1)} ms · ${captures}× · ${items ? Math.round(items.ms || items.count) : 0} items`,
    ],
  ];

  const copy = () => {
    const data = { report, marks, userAgent: navigator.userAgent, url: location.href };
    void navigator.clipboard?.writeText(JSON.stringify(data, null, 2));
  };

  return createPortal(
    <aside className="hud" aria-label="Telemetry" data-expanded={expanded || undefined}>
      <header>
        <strong>Telemetry</strong>
        <span className="hud-actions">
          <button type="button" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Less" : "More"}
          </button>
          <button type="button" onClick={copy}>
            Copy
          </button>
        </span>
      </header>
      {!scene && <p className="hud-note">No glass scene.</p>}
      {scene && !report && <p className="hud-note">Waiting for the first report…</p>}
      <canvas className="hud-spark" ref={sparkRef} aria-hidden="true" />
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {expanded && (
        <>
          {others.length > 0 && (
            <>
              <h3>Other counters</h3>
              <dl>
                {others.map((name) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>
                      {count(c, name)}× · {ms(c, name).toFixed(1)} ms
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          <h3>Boot</h3>
          {marks.length === 0 ? (
            <p className="hud-note">No marks yet.</p>
          ) : (
            <dl>
              {marks.map((mark) => (
                <div key={mark.name}>
                  <dt>{mark.name}</dt>
                  <dd>{mark.at.toFixed(1)} ms</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </aside>,
    document.body,
  );
}

const knownCounters = [
  "page.frame",
  "page.measure",
  "page.capture",
  "page.capture.items",
  "page.gap",
  "page.inflight",
  "input.sample",
  "input.unique",
  "worker.present",
  "worker.underlay",
  "worker.frost",
  "worker.glass",
  "worker.copy",
  "worker.commit",
];

function count(counters: Counters, name: string): number {
  return counters[name]?.count ?? 0;
}

function ms(counters: Counters, name: string): number {
  return counters[name]?.ms ?? 0;
}

function perSecond(counters: Counters, name: string, intervalMs: number): number {
  return intervalMs > 0 ? (count(counters, name) * 1000) / intervalMs : 0;
}

function fmt(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
}

/** The library's marks (tagged with detail.source), else every mark on the page. */
function readMarks(): Mark[] {
  const entries = performance.getEntriesByType("mark") as PerformanceMark[];
  const tagged = entries.filter((entry) => {
    const detail: unknown = entry.detail;
    return (
      typeof detail === "object" &&
      detail !== null &&
      (detail as { source?: unknown }).source === "liquid-glass"
    );
  });
  return (tagged.length > 0 ? tagged : entries).map((entry) => ({
    name: entry.name,
    at: entry.startTime,
  }));
}

function drawSpark(canvas: HTMLCanvasElement | null, values: readonly number[]): void {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ink = getComputedStyle(canvas).color;
  const ceiling = Math.max(120, ...values);
  const bar = width / historyLength;
  context.globalAlpha = 0.3;
  context.fillStyle = ink;
  for (const guide of [60, 120])
    context.fillRect(0, Math.round(height - (guide / ceiling) * height), width, 1);
  context.globalAlpha = 1;
  values.forEach((value, index) => {
    const h = (value / ceiling) * height;
    const x = width - (values.length - index) * bar;
    context.fillStyle = value >= 110 ? "#30d158" : value >= 55 ? "#ffd60a" : "#ff453a";
    context.fillRect(x, height - h, Math.max(1, bar - 1), h);
  });
}
