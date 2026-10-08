import { expect, test } from "bun:test";
import { insetShape, concentricOutline, cornerPlacement, contentInsets } from "./concentric.js";
import { shapePolygon } from "./shape.js";
function clearance(points: [number,number][], p: [number,number]) {
  let min=Infinity;
  for(let i=1;i<points.length;i++) {const a=points[i-1]!,b=points[i]!,dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length>.0002)min=Math.min(min,(dx*(p[1]-a[1])-dy*(p[0]-a[0]))/length);}
  return min;
}
test("short first and last menu rows remain inside a true inset at exaggerated radii",()=>{
  for(const radius of [8,24,40,64]) {
    const shape={width:176,height:190,radius}, outer=shapePolygon(176,190,radius), inset=insetShape(shape,4);
    for(const y of [4,32,158]) {
      const row=concentricOutline(inset,{x:4,y,width:168,height:28},8);
      expect(row.length).toBeGreaterThan(3);
      for(const [x,py] of row) expect(clearance(outer,[x+4,py+y])).toBeGreaterThanOrEqual(3.99);
      const content=contentInsets(row,168,28,20);
      expect(content.left).toBeGreaterThanOrEqual(0);
      expect(content.left+content.right).toBeLessThan(168);
    }
  }
});
test("corner placement preserves gap for the entire control and responds to curvature",()=>{
  let previous=0;
  for(const radius of [8,24,44,64]) {
    const shape={width:280,height:440,radius},d=cornerPlacement(shape,28,28,10),outer=shapePolygon(280,440,radius);
    expect(d).toBeGreaterThanOrEqual(previous-0.001); previous=d;
    for(const [x,y] of shapePolygon(28,28,"circle")) expect(clearance(outer,[x+d,y+d])).toBeGreaterThanOrEqual(9.99);
  }
  expect(previous).toBeGreaterThan(10);
});
test("impossible placement and invalid insets fail explicitly",()=>{
  expect(()=>cornerPlacement({width:20,height:20,radius:8},28,28,4)).toThrow();
  expect(()=>insetShape({width:100,height:100,radius:8},-1)).toThrow();
});
test("nested container offsets accumulate instead of reverting to an independent radius",()=>{
  const outer=shapePolygon(240,120,48);
  const first=insetShape({width:240,height:120,radius:48},4);
  const second=insetShape({width:240,height:120,radius:8,outline:first},3);
  expect(second.length).toBeGreaterThan(3);
  for(const point of second) expect(clearance(outer,point)).toBeGreaterThanOrEqual(6.99);
});
