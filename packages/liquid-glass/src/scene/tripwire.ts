/**
 * Wakes the parked frame loop the moment the page scrolls.
 *
 * A parked loop listens to nothing that runs per frame. Scroll events would wake it, but iOS
 * delivers them late during a fling. An IntersectionObserver is told by the compositor instead:
 * when the loop parks, a 1 px wide marker is laid across the top edge of the viewport, half in and
 * half out (4 device pixels each way). Any scroll of a few device pixels pushes it past 5% or 95%
 * visible, and the observer fires.
 */

import { tripwireClass } from "./styles";

const reachDevicePixels = 4;
const thresholds = [0.05, 0.95];

export interface Tripwire {
  /** Lay the marker across the viewport's top edge where the page is now. */
  arm(): void;
  destroy(): void;
}

export function createTripwire(tripped: () => void): Tripwire | null {
  // Only the document scroller moves the viewport's top edge over the page.
  if (
    typeof IntersectionObserver === "undefined" ||
    document.scrollingElement !== document.documentElement
  )
    return null;
  const marker = document.createElement("div");
  marker.className = tripwireClass;
  marker.setAttribute("aria-hidden", "true");
  marker.setAttribute("data-lg-ignore", "");
  document.body.append(marker);
  let armed = false;
  const observer = new IntersectionObserver(
    (entries) => {
      if (!armed) return;
      if (
        entries.some(
          (entry) =>
            entry.intersectionRatio <= (thresholds[0] ?? 0) ||
            entry.intersectionRatio >= (thresholds[1] ?? 1),
        )
      ) {
        armed = false;
        tripped();
      }
    },
    { threshold: thresholds },
  );
  observer.observe(marker);
  return {
    arm() {
      const reach = reachDevicePixels / (window.devicePixelRatio || 1);
      // The marker's containing block may be offset (a positioned body with a margin), so it is
      // placed by correcting its measured position rather than trusting scrollY.
      const placed = parseFloat(marker.style.top) || 0;
      const at = marker.getBoundingClientRect().top;
      marker.style.top = `${placed - at - reach}px`;
      marker.style.height = `${reach * 2}px`;
      armed = true;
    },
    destroy() {
      observer.disconnect();
      marker.remove();
    },
  };
}
