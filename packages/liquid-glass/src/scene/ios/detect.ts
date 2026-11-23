/**
 * The only feature detection in the library, and only for the iOS 120 Hz techniques.
 *
 * `GestureEvent` exists only in WebKit on iOS and iPadOS. There, rAF is held to 60 Hz while
 * the display runs at 120, so the frame loop, the boost and the controllers take over.
 *
 * `desynchronized` presentation is detected from the user agent instead: iPadOS reports itself
 * as a Mac, so a "MacIntel" platform with a touch screen counts too.
 */

export const hasGestureEvents = (): boolean =>
  typeof window !== "undefined" && "GestureEvent" in window;

export function isAppleTouchDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/\b(iPhone|iPad|iPod)\b/.test(navigator.userAgent)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}
