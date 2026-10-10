import { createContext, useContext, useEffect, useState } from "react"
import type { ReactNode } from "react"
import type { GlassMaterial } from "@glass-sdk/liquid-glass"

const SiteMaterialContext = createContext<{
  material: GlassMaterial
  setMaterial: (material: GlassMaterial) => void
} | null>(null)

export function SiteMaterialProvider({ children }: { children: ReactNode }) {
  const [material, setMaterial] = useState<GlassMaterial>(() => {
    try {
      return localStorage.getItem("liquid-glass-site-material") === "regular" ? "regular" : "clear"
    } catch {
      return "clear"
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem("liquid-glass-site-material", material)
    } catch {
      /* Storage may be disabled. */
    }
  }, [material])
  return <SiteMaterialContext.Provider value={{ material, setMaterial }}>{children}</SiteMaterialContext.Provider>
}

export function useSiteMaterial() {
  const value = useContext(SiteMaterialContext)
  if (!value) throw new Error("Site glass controls require SiteMaterialProvider")
  return value
}
