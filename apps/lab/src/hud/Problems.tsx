import { useGlassScene } from "@glass-sdk/liquid-glass/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Errors and warnings, shown on the page. Safari can't be scripted from outside without changing
 * its settings, so a screenshot of the window is how the lab checks it ran cleanly there.
 * Collects uncaught errors, rejected promises, console errors and warnings, and the scene's own
 * failure; renders nothing while there are none.
 */
export function Problems() {
  const scene = useGlassScene();
  const [problems, setProblems] = useState<readonly string[]>([]);

  useEffect(() => {
    const add = (kind: string, value: unknown) => {
      const text = value instanceof Error ? value.message : String(value);
      setProblems((list) => [...list.slice(-7), `${kind}: ${text}`]);
    };
    const onError = (event: ErrorEvent) => add("error", event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => add("rejection", event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    const { error, warn } = console;
    console.error = (...args: unknown[]) => {
      add("console.error", args.map(String).join(" "));
      error.apply(console, args);
    };
    console.warn = (...args: unknown[]) => {
      add("console.warn", args.map(String).join(" "));
      warn.apply(console, args);
    };
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      console.error = error;
      console.warn = warn;
    };
  }, []);

  // The scene reports a renderer failure on its `error` property; poll it, it changes once.
  useEffect(() => {
    if (!scene) return;
    const timer = setInterval(() => {
      if (scene.error) {
        setProblems((list) =>
          list.some((item) => item.startsWith("scene:"))
            ? list
            : [...list, `scene: ${scene.error}`],
        );
      }
    }, 500);
    return () => clearInterval(timer);
  }, [scene]);

  if (problems.length === 0) return null;
  return createPortal(
    <ol className="lab-problems" role="status">
      {problems.map((problem, index) => (
        <li key={index}>{problem}</li>
      ))}
    </ol>,
    document.body,
  );
}
