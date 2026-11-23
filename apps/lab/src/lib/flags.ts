import { useSyncExternalStore } from "react";

/**
 * The lab's settings live in the query string, so every view can be linked:
 * `?theme=dark&material=clear&tint=clear&specular&auto&hud`. `tint` is the scene's `tintAmount`:
 * "clear", "tinted" or a number 0..1 (absent: the default).
 */
export interface LabSettings {
  readonly theme: "auto" | "light" | "dark";
  readonly material: "regular" | "clear";
  readonly tint: "clear" | "default" | "tinted" | number;
  readonly specular: boolean;
  readonly auto: boolean;
  readonly hud: boolean;
  readonly params: URLSearchParams;
}

const changed = "lab:settings";
let cachedKey = "";
let cached: LabSettings | null = null;

const flag = (params: URLSearchParams, name: string) =>
  params.has(name) && params.get(name) !== "0";

function read(): LabSettings {
  if (cached && location.search === cachedKey) return cached;
  const params = new URLSearchParams(location.search);
  const theme = params.get("theme");
  cachedKey = location.search;
  cached = {
    theme: theme === "light" || theme === "dark" ? theme : "auto",
    material: params.get("material") === "clear" ? "clear" : "regular",
    tint: tintOf(params.get("tint")),
    specular: flag(params, "specular"),
    auto: flag(params, "auto"),
    hud: flag(params, "hud"),
    params,
  };
  return cached;
}

function tintOf(value: string | null): LabSettings["tint"] {
  if (value === "clear" || value === "tinted") return value;
  const amount = value === null || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(amount) ? amount : "default";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(changed, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(changed, onChange);
  };
}

export function useSettings(): LabSettings {
  return useSyncExternalStore(subscribe, read, read);
}

/** Sets (or with null/false, removes) a query parameter without reloading. */
export function setParam(name: string, value: string | boolean | null): void {
  const params = new URLSearchParams(location.search);
  if (value === null || value === false) params.delete(name);
  else params.set(name, value === true ? "" : value);
  const query = params.toString().replace(/=(?=&|$)/g, "");
  history.replaceState(
    history.state,
    "",
    `${location.pathname}${query ? `?${query}` : ""}${location.hash}`,
  );
  window.dispatchEvent(new Event(changed));
}

/** The appearance the page shows: the setting, or the system's when it is "auto". */
export function useAppearance(theme: LabSettings["theme"]): "light" | "dark" {
  const system = useSyncExternalStore(
    (onChange) => {
      const query = matchMedia("(prefers-color-scheme: dark)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
  return theme === "auto" ? (system ? "dark" : "light") : theme;
}
