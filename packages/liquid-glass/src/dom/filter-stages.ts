/** Count this library's generated SVG primitives, excluding their child
 * transfer functions and merge inputs. Gecko's operation cap counts the
 * descriptions before expanding merge inputs into GPU operations. */
export function filterPrimitiveCount(markup: string): number {
  return [...markup.matchAll(/<fe(?!Func[RGBA]\b|MergeNode\b)[A-Z][\w]*\b/g)].length;
}

export { gecko } from "./engine.js";
