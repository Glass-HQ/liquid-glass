import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import type { GlassMaterial } from "@glass-sdk/liquid-glass";

const SiteMaterialContext = createContext<{
  material: GlassMaterial;
  setMaterial: (material: GlassMaterial) => void;
} | null>(null);

/** Where a material the visitor chose is kept. Only a choice is saved, so the default stays
 * Regular, as on macOS, until someone picks Clear. */
const storageKey = "liquid-glass-site-material-choice";

export function SiteMaterialProvider({ children }: { children: ReactNode }) {
  const [material, setState] = useState<GlassMaterial>(() => {
    try {
      return localStorage.getItem(storageKey) === "clear" ? "clear" : "regular";
    } catch {
      return "regular";
    }
  });
  const setMaterial = useCallback((next: GlassMaterial) => {
    setState(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* Storage may be disabled. */
    }
  }, []);
  return (
    <SiteMaterialContext.Provider value={{ material, setMaterial }}>
      {children}
    </SiteMaterialContext.Provider>
  );
}

export function useSiteMaterial() {
  const value = useContext(SiteMaterialContext);
  if (!value) throw new Error("Site glass controls require SiteMaterialProvider");
  return value;
}
