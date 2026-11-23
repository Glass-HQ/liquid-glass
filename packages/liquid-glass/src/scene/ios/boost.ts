/**
 * Keeps an iOS display at 120 Hz while something moves.
 *
 * ProMotion only runs the display at 120 Hz when the system thinks something is moving fast.
 * A native smooth scroll is such a thing: a hidden 8 px scroller with 200 px of content is sent
 * smooth-scrolling back and forth every 250 ms. Next to it a 1 px mark runs a CSS animation,
 * which keeps the page compositing every frame. Neither is visible: the scroller's content is
 * `visibility: hidden` and the mark is 1% of the current colour, one pixel at the corner.
 *
 * The boost is paced from an rAF loop (the pacer's empty one), so it runs only while that loop
 * does, plus a hold after the last motion.
 */

import { boostClass, boostMarkClass, boostPacerClass } from "../styles";

/** Native smooth scroll period and travel. */
export const boostPeriodMs = 250;
export const boostTravelPx = 200;

export interface Boost {
  /** Call every rAF while boosting; scrolls once per period. */
  pace(now: number): void;
  /** Start: show the rate mark. */
  start(): void;
  /** Stop scrolling and remove the mark. */
  rest(): void;
  remove(): void;
}

export function createBoost(parent: HTMLElement = document.body): Boost {
  const host = document.createElement("div");
  host.className = boostClass;
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("data-lg-ignore", "");
  const pacer = document.createElement("div");
  pacer.className = boostPacerClass;
  const content = document.createElement("div");
  content.style.height = `${boostTravelPx * 2}px`;
  pacer.append(content);
  host.append(pacer);
  parent.append(host);
  const mark = document.createElement("span");
  mark.className = boostMarkClass;

  let forward = true;
  let lastAt = -Infinity;
  let started = false;

  return {
    pace(now) {
      if (now - lastAt < boostPeriodMs) return;
      lastAt = now;
      pacer.scrollTo({ top: forward ? boostTravelPx : 0, behavior: "smooth" });
      forward = !forward;
    },
    start() {
      if (started) return;
      started = true;
      host.append(mark);
    },
    rest() {
      started = false;
      lastAt = -Infinity;
      mark.remove();
    },
    remove() {
      mark.remove();
      host.remove();
    },
  };
}
