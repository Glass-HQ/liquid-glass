import { getLayoutSize } from "@lisse/core";
import { concentricOutline, contentInsets, cornerPlacement, insetShape, polygonClip } from "../core/concentric.js";
import type { ShapeGeometry, ShapePoint } from "../core/concentric.js";
import { cornerOptions } from "../core/shape.js";
import type { GlassRadius } from "../core/shape.js";
import { createTicker } from "./ticker.js";
import type { Ticker } from "./ticker.js";

/** A measurement step: whether anything changed, and the writes to apply once
 * every job has measured, so reads and writes never interleave. */
type Job = () => { changed: boolean; write?: () => void } | undefined;
const jobs = new Set<Job>();
let ticker: Ticker | undefined;
let contentGroups = new Map<HTMLElement, { left: number; right: number }>();
function tick() {
  contentGroups = new Map();
  const writes: Array<(() => void) | undefined> = [];
  let changed = false;
  for (const job of jobs) {
    try {
      const result = job();
      if (result?.changed) changed = true;
      writes.push(result?.write);
    }
    catch (error) { jobs.delete(job); queueMicrotask(() => { throw error; }); }
  }
  return { active: changed, write: () => { for (const write of writes) write?.(); } };
}
/** All shape jobs share one demand-driven loop: it wakes on input, scroll,
 * resize, and DOM mutation anywhere in the document, and sleeps once the
 * measured geometry stops changing. */
function schedule(job: Job, ...observed: Element[]) {
  jobs.add(job);
  ticker ??= createTicker(tick, { root: document });
  for (const element of observed) ticker.observe(element);
  ticker.wake();
  return () => {
    jobs.delete(job);
    for (const element of observed) ticker?.unobserve(element);
    if (!jobs.size) { ticker?.dispose(); ticker = undefined; }
  };
}
/** Wake the shared loop, for callers that learn of a container change first. */
export function wakeShapeLayout(element?: Element) {
  if (element) ticker?.observe(element);
  ticker?.wake();
}
export function shapeContainerAttributes(radius: GlassRadius) {
  cornerOptions(radius);
  return { "data-lg-container": "", "data-lg-container-radius": String(radius) };
}
/** Declare geometry for DOM consumers without clipping or changing layout. */
export function registerShapeContainer(element: HTMLElement, radius: GlassRadius) {
  const attrs = shapeContainerAttributes(radius);
  const saved = Object.keys(attrs).map(key => [key,element.getAttribute(key)] as const);
  // Rewriting an identical attribute still dirties style; skip what is already there.
  for(const [key,value] of Object.entries(attrs)) if(element.getAttribute(key)!==value) element.setAttribute(key,value);
  let released=false;
  return () => { if(released) return; released=true; for(const [key,value] of saved) {if(value===null) element.removeAttribute(key);else element.setAttribute(key,value);} };
}
const resolvedContours=new WeakMap<HTMLElement,ShapePoint[]>();
export function setResolvedShape(element: HTMLElement, points?: ShapePoint[]) {
  if(points) resolvedContours.set(element,points);else resolvedContours.delete(element);
}
function geometry(element: HTMLElement): ShapeGeometry {
  const value = element.getAttribute("data-lg-container-radius");
  if(value === null) throw new Error("Declare the container with GlassShapeContainer, GlassShape, GlassSurface, or registerShapeContainer.");
  const {width,height}=getLayoutSize(element);
  const radius = value === "circle" || value === "capsule" ? value : Number(value);
  return {width,height,radius,outline:resolvedContours.get(element)};
}
function findContainer(element: HTMLElement, explicit?: () => HTMLElement | null) {
  if (explicit) return explicit();
  const parent = element.parentElement?.closest<HTMLElement>("[data-lg-container]");
  if (!parent && element.isConnected) throw new Error("Container-relative geometry requires a declared shape container.");
  return parent ?? null;
}
export interface ConcentricOptions {
  /** Gap from the container outline. Defaults to the smallest measured edge inset. */
  inset?: number;
  /** Radius for portions of the child away from the container boundary. */
  radius?: GlassRadius;
  /** Keep a centered text/icon band inside the inherited curve. */
  contentPadding?: number;
}
export function observeConcentricShape(element: HTMLElement, options: ConcentricOptions = {}, container?: () => HTMLElement | null) {
  if (options.contentPadding !== undefined && (!Number.isFinite(options.contentPadding) || options.contentPadding < 0))
    throw new RangeError("Content padding must be finite and nonnegative.");
  const release=registerShapeContainer(element,options.radius ?? 8);
  const saved = {clipPath:element.style.clipPath,paddingLeft:element.style.paddingLeft,paddingRight:element.style.paddingRight};
  let last="", parentKey="", outline: ShapePoint[]=[], clip="", written="";
  let content: {left:number;right:number}|undefined;
  let pointsForContainer: ShapePoint[]=[];
  let observedParent: HTMLElement | undefined;
  const stop=schedule(() => {
    const parent=findContainer(element,container);
    if(!parent || !element.isConnected) return;
    if(parent!==observedParent) { observedParent=parent; wakeShapeLayout(parent); }
    const shape=geometry(parent), box=getLayoutSize(element), pr=parent.getBoundingClientRect(), er=element.getBoundingClientRect();
    if(!shape.width || !shape.height || !box.width || !box.height || !pr.width || !pr.height) return;
    const x=(er.left-pr.left)*shape.width/pr.width,y=(er.top-pr.top)*shape.height/pr.height;
    const key=JSON.stringify([shape,box.width,box.height,x,y,options]);
    const changed=last!==key;
    if(changed) {
    last=key;
    const inset=options.inset ?? Math.max(0,Math.min(x,y,shape.width-x-box.width,shape.height-y-box.height));
    const pk=JSON.stringify([shape,inset]);
    if(pk!==parentKey) {outline=insetShape(shape,inset);parentKey=pk;}
    const points=concentricOutline(outline,{x,y,width:box.width,height:box.height},options.radius ?? 8);
    clip=polygonClip(points);
    pointsForContainer=points;
    const band=Math.min(box.height,Math.max(16,parseFloat(getComputedStyle(element).lineHeight)||20));
    content=options.contentPadding===undefined ? undefined : contentInsets(points,box.width,box.height,band);
    }
    if(content) {
      const group=contentGroups.get(parent) ?? {left:0,right:0};
      group.left=Math.max(group.left,content.left);group.right=Math.max(group.right,content.right);
      contentGroups.set(parent,group);
    }
    return { changed, write: () => {
      setResolvedShape(element, pointsForContainer);
      // Reading the inline clip back serializes a long polygon; compare what was written.
      if(written!==clip) { element.style.clipPath=clip; written=clip; }
      if(content) {
        const group=contentGroups.get(parent)!;
        const left=`${group.left+options.contentPadding!}px`, right=`${group.right+options.contentPadding!}px`;
        if(element.style.paddingLeft!==left) element.style.paddingLeft=left;
        if(element.style.paddingRight!==right) element.style.paddingRight=right;
      }
    } };
  }, element);
  return () => {stop();release();setResolvedShape(element);Object.assign(element.style,saved);};
}
export type GlassCornerPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export interface CornerOptions { corner?: GlassCornerPosition; gap?: number; radius?: GlassRadius }
export function observeCornerPlacement(element: HTMLElement, options: CornerOptions = {}, container?: () => HTMLElement | null) {
  const saved={left:element.style.left,top:element.style.top,right:element.style.right,bottom:element.style.bottom};
  let last="", geometryKey="", distance=0;
  let observedParent: HTMLElement | undefined;
  const stop=schedule(() => {
    const parent=findContainer(element,container);
    if(!parent || !element.isConnected) return;
    if(parent!==observedParent) { observedParent=parent; wakeShapeLayout(parent); }
    const shape=geometry(parent),size=getLayoutSize(element),pr=parent.getBoundingClientRect();
    if(!shape.width||!shape.height||!size.width||!size.height||!pr.width||!pr.height) return;
    const fixed=getComputedStyle(element).position==="fixed";
    const anchor=fixed?null:element.offsetParent as HTMLElement|null;
    const ar=anchor?.getBoundingClientRect();
    const key=JSON.stringify([shape,size.width,size.height,pr.x,pr.y,pr.width,pr.height,ar?.x,ar?.y,anchor?.scrollLeft,anchor?.scrollTop,options]);
    if(key===last) return { changed: false };
    last=key;
    const gk=JSON.stringify([shape,size.width,size.height,options]);
    if(gk!==geometryKey) { distance=cornerPlacement(shape,size.width,size.height,options.gap ?? 8,options.radius ?? "circle");geometryKey=gk; }
    const d=distance;
    const corner=options.corner ?? "top-right";
    const x=corner.endsWith("right")?shape.width-d-size.width:d;
    const y=corner.startsWith("bottom")?shape.height-d-size.height:d;
    const sx=pr.width/shape.width,sy=pr.height/shape.height;
    const asx=anchor&&ar?ar.width/anchor.offsetWidth:1,asy=anchor&&ar?ar.height/anchor.offsetHeight:1;
    const left=(pr.left+x*sx-(ar?.left??0))/asx+(anchor?.scrollLeft??0)-(anchor?.clientLeft??0);
    const top=(pr.top+y*sy-(ar?.top??0))/asy+(anchor?.scrollTop??0)-(anchor?.clientTop??0);
    return { changed: true, write: () => {element.style.left=`${left}px`;element.style.top=`${top}px`;element.style.right="auto";element.style.bottom="auto";} };
  }, element);
  return () => {stop();Object.assign(element.style,saved);};
}

/** Resolve a glass surface contour once per geometry change, including nested containers. */
export function createConcentricResolver(element: HTMLElement, inset: number | undefined, radius: GlassRadius) {
  let last="", result: ShapePoint[]=[];
  return () => {
    const parent=findContainer(element);
    if(!parent) return undefined;
    const shape=geometry(parent), size=getLayoutSize(element),pr=parent.getBoundingClientRect(),er=element.getBoundingClientRect();
    if(!shape.width||!shape.height||!pr.width||!pr.height||!size.width||!size.height) return undefined;
    const bounds={x:(er.left-pr.left)*shape.width/pr.width,y:(er.top-pr.top)*shape.height/pr.height,width:size.width,height:size.height};
    const key=JSON.stringify([shape,bounds,inset,radius]);
    const gap=inset ?? Math.max(0,Math.min(bounds.x,bounds.y,shape.width-bounds.x-bounds.width,shape.height-bounds.y-bounds.height));
    if(key!==last) {result=concentricOutline(insetShape(shape,gap),bounds,radius);last=key;}
    return result;
  };
}
