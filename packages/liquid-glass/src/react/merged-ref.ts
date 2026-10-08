import { useCallback } from "react";
import type { Ref } from "react";

function assign<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") return ref(value);
  if (ref) ref.current = value;
}
/** Combine two refs, preserving React 19 cleanup functions from callback refs. */
export function useMergedRef<T>(a: Ref<T> | undefined, b: Ref<T> | undefined) {
  return useCallback((value: T | null) => {
    const cleanups = [assign(a, value), assign(b, value)];
    return () => [a, b].forEach((ref, index) => {
      const cleanup = cleanups[index];
      if (typeof cleanup === "function") cleanup();
      else assign(ref, null);
    });
  }, [a, b]);
}
