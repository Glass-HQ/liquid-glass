import { insetShape, concentricOutline } from "../packages/liquid-glass/dist/core.js";
import { init } from "../packages/liquid-glass/node_modules/vgpu/dist/node.js";
import { MaterialRenderer } from "../packages/liquid-glass/dist/gpu.js";
const gpu = await init();
const renderer = new MaterialRenderer(gpu);
let inwardPixels = 0;
// Sampling bounds depend on this optical invariant, not on the precise SDF:
// symmetric maps point toward each image axis. Check the whole opaque map,
// including its transparent-mask corners, because another map can reveal
// those pixels when two shapes crossfade in the same image rectangle.
function assertInwardField(map) {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const offset = (y * map.width + x) * 4;
      const r = map.pixels[offset], g = map.pixels[offset + 1];
      // 127 and 128 straddle exact neutral in an eight-bit map. This is the
      // only outward bias allowed by the source-sampling bound.
      if (map.pixels[offset + 3] !== 255 ||
          (x + 0.5 < map.width / 2 && r < 127) ||
          (x + 0.5 > map.width / 2 && r > 128) ||
          (y + 0.5 < map.height / 2 && g < 127) ||
          (y + 0.5 > map.height / 2 && g > 128)) {
        throw new Error(`Symmetric displacement points outward at ${x},${y} in ${map.width}×${map.height}`);
      }
      inwardPixels++;
    }
  }
}
try {
  const map = await renderer.render({
    width: 100,
    height: 60,
    radius: 30,
    dpr: 1,
  });
  const pixel = (plane, x, y) => [
    ...map.pixels.slice(
      ((plane * map.height + y) * map.width + x) * 4,
      ((plane * map.height + y) * map.width + x) * 4 + 4,
    ),
  ];
  assertInwardField(map);
  console.log({
    size: [map.width, map.height],
    time: map.duration,
    center: pixel(1, 52, 32),
    corner: pixel(1, 0, 0),
    leftDisplacement: pixel(0, 3, 32),
    rightDisplacement: pixel(0, 100, 32),
  });
  if (
    pixel(1, 52, 32)[3] !== 255 ||
    pixel(1, 0, 0)[3] !== 0 ||
    pixel(0, 3, 32)[0] <= 128 ||
    pixel(0, 100, 32)[0] >= 128
  )
    throw new Error("GPU map invariant failed");
  // Capsules must leave their side arcs to the outline, rather than wrapping
  // the bright top/bottom band around the full perimeter.
  for (const dpr of [1, 2]) {
    const capsule = await renderer.render({ width: 284, height: 112, radius: 56, dpr });
    assertInwardField(capsule);
    let highlight = 0, sideHighlight = 0, outline = 0;
    for (let y = 0; y < capsule.height; y++) {
      for (let x = 0; x < capsule.width; x++) {
        const alpha = capsule.pixels[((2 * capsule.height + y) * capsule.width + x) * 4 + 3];
        highlight += alpha;
        // The corner transition shares light and outline; the middle of each
        // side remains free of the top/bottom highlight.
        if (y / dpr >= 40 && y / dpr <= 76) sideHighlight += alpha;
        outline += capsule.pixels[((3 * capsule.height + y) * capsule.width + x) * 4 + 3];
      }
    }
    console.log({ dpr, highlight, sideHighlight, outline });
    if (highlight === 0 || outline === 0 || sideHighlight / highlight > 0.01)
      throw new Error("Capsule highlight overlaps the side outline");
  }
  // Fixed end caps plus a stretched straight middle must reproduce the GPU
  // fields of the actual narrow/wide tabs, for all four optical planes.
  for (const dpr of [1, 2]) {
    const baked = await renderer.render({ width: 90, height: 30, radius: "capsule", dpr });
    assertInwardField(baked);
    const cap = 32 * dpr;
    for (const width of [75, 100, 118]) {
      const actual = await renderer.render({ width, height: 30, radius: "capsule", dpr });
      let maxError = 0;
      for (let plane = 0; plane < 4; plane++) for (let y = 0; y < actual.height; y++) for (let x = 0; x < actual.width; x++) {
        const sx = x < cap ? x : x >= actual.width - cap ? baked.width - (actual.width - x) :
          cap + Math.floor((x - cap + 0.5) * (baked.width - 2 * cap) / (actual.width - 2 * cap));
        for (let channel = 0; channel < 4; channel++) {
          const a = actual.pixels[((plane * actual.height + y) * actual.width + x) * 4 + channel];
          const b = baked.pixels[((plane * baked.height + y) * baked.width + sx) * 4 + channel];
          maxError = Math.max(maxError, Math.abs(a - b));
        }
      }
      console.log({ capsuleWidth: width, dpr, slicedMapMaxError: maxError });
      // Odd physical widths shift fragment derivative pairs at the right edge;
      // allow their small AA difference at 1x. At 2x these fields match exactly.
      if (maxError > (dpr === 1 ? 10 : 1)) throw new Error("Sliced capsule differs from its exact GPU field");
    }
  }
  // Verify Lisse's fixed, zero-radius, circular and vertical capsule masks on
  // the actual GPU. Symmetry catches quadrant clipping and normal-sign errors.
  for (const geometry of [
    { width: 80, height: 60, radius: 0 },
    { width: 80, height: 60, radius: 14 },
    { width: 32, height: 32, radius: "circle" },
    { width: 32, height: 100, radius: "capsule" },
  ]) {
    const map = await renderer.render(geometry);
    assertInwardField(map);
    const alpha = (x, y) => map.pixels[((map.height + y) * map.width + x) * 4 + 3];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (Math.abs(alpha(x,y)-alpha(map.width-1-x,y)) > 2 ||
            Math.abs(alpha(x,y)-alpha(x,map.height-1-y)) > 2)
          throw new Error(`Asymmetric Lisse mask: ${JSON.stringify(geometry)}`);
      }
    }
    if (alpha(Math.floor(map.width/2), Math.floor(map.height/2)) !== 255 || alpha(0,0) !== 0)
      throw new Error("Lisse mask has invalid interior or exterior coverage");
    console.log({ geometry, mask: "symmetric; interior and exterior coverage correct" });
  }
  const inherited = concentricOutline(insetShape({width:176,height:190,radius:40},4),{x:4,y:4,width:168,height:28},8);
  for (const dpr of [1,2]) {
    const map = await renderer.render({width:168,height:28,radius:8,outline:inherited,dpr});
    let checked=0;
    for(let y=0;y<map.height;y++) for(let x=0;x<map.width;x++) {
      const px=(x+0.5)/dpr-2,py=(y+0.5)/dpr-2;
      let inside=false, distance=Infinity;
      for(let i=0;i<inherited.length;i++) {
        const a=inherited[i],b=inherited[(i+1)%inherited.length];
        if((a[1]>py)!==(b[1]>py) && px<(b[0]-a[0])*(py-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
        const dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy;
        if(len<1e-10) continue;
        const t=Math.max(0,Math.min(1,((px-a[0])*dx+(py-a[1])*dy)/len));
        distance=Math.min(distance,Math.hypot(px-a[0]-t*dx,py-a[1]-t*dy));
      }
      if(distance<2) continue;
      const alpha=map.pixels[((map.height+y)*map.width+x)*4+3];
      if(alpha!==(inside?255:0)) throw new Error(`Concentric GPU coverage disagrees with contour at ${px},${py}`);
      checked++;
    }
    console.log({dpr,concentricPixelsChecked:checked,mask:"asymmetric inherited contour matches CPU"});
  }
  // Concurrent readbacks must retain their own geometry and shader parameters.
  const geometries = Array.from({ length: 12 }, (_, i) => ({
    width: 46 + i * 3, height: 26 + i % 3,
    radius: i % 2 ? "capsule" : 8, dpr: i % 2 + 1,
    appearance: i % 3 ? "light" : "dark",
  }));
  const expected = [];
  for (const geometry of geometries) expected.push(await renderer.render(geometry));
  const concurrent = await Promise.all(geometries.map((geometry) => renderer.render(geometry)));
  concurrent.forEach((map, i) => {
    if (map.pixels.length !== expected[i].pixels.length ||
      map.pixels.some((value, offset) => value !== expected[i].pixels[offset]))
      throw new Error(`Concurrent map ${i} differs from its sequential pixels`);
  });
  console.log({ concurrentMaps: concurrent.length, pixels: "identical to sequential rendering" });
  console.log({ inwardPixels, displacement: "opaque symmetric fields point inward within RGBA8 neutral quantization" });
} finally {
  renderer.dispose();
}
