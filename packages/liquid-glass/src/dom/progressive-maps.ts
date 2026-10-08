import { getMaterialRenderer } from "../gpu/index.js";
import type { PhysicalEdge } from "../core/progressive.js";
import { encodeMapPixels } from "./map-encoding.js";
import { loadStoredMaps, peekStoredMaps, saveStoredMaps } from "./map-store.js";
export interface ProgressiveMaps {
  weights: string[];
  displacement: string;
}
const cache = new Map<PhysicalEdge, Promise<ProgressiveMaps>>();
export function getProgressiveMaps(
  edge: PhysicalEdge,
): Promise<ProgressiveMaps> {
  const cached = cache.get(edge);
  if (cached) return cached;
  const vertical = edge === "top" || edge === "bottom";
  // Profiles are fixed per edge, so a stored copy spares the GPU entirely.
  const key = `progressive-2|${edge}`;
  const stored = peekStoredMaps(key);
  const promise = (stored ? Promise.resolve(stored) : loadStoredMaps(key))
    .then(async (found) => {
      if (found) return found.planes;
      const { pixels } = await (await getMaterialRenderer()).renderProgressive(vertical ? 1 : 0, edge === "top" || edge === "left");
      // Eight rows of 256 texels become eight one-pixel-wide or -tall images.
      const planes = await Promise.all(Array.from({ length: 8 }, (_, row) => {
        const rowPixels = pixels.subarray(row * 1024, (row + 1) * 1024);
        const width = vertical ? 1 : 256, height = vertical ? 256 : 1;
        // A vertical profile is one column: the row's texels become rows.
        return encodeMapPixels(rowPixels, width, height).then((encoded) => encoded[0]![0]!);
      }));
      saveStoredMaps(key, { planes: planes.map((url) => [url]), duration: 0 });
      return planes.map((url) => [url]);
    })
    .then((planes) => {
      const urls = planes.map((images) => images[0]!);
      return { weights: urls.slice(0, 7), displacement: urls[7]! };
    })
    .catch((error) => {
      cache.delete(edge);
      throw error;
    });
  cache.set(edge, promise);
  return promise;
}
