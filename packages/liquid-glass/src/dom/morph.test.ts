import { expect, test } from "bun:test";
import { attachGeometryMotion, prepareSubmenuHandoff } from "./morph.js";
import { retainLatestExit } from "./exit-handoff.js";

type PopupConfig = {
  glass?: boolean; neck?: number; parentMenu?: Element; submenu?: boolean;
  morph?: "become" | "detach";
  initiallyClosed?: boolean;
  width?: number; height?: number; scale?: number; starting?: boolean; motion?: "full" | "none";
};
function withPopups(run: (create: (prepared?: () => boolean, config?: PopupConfig) => ReturnType<typeof popup>) => void) {
  const observer = globalThis.MutationObserver;
  const ratio = Object.getOwnPropertyDescriptor(globalThis, "devicePixelRatio");
  const clock = Object.getOwnPropertyDescriptor(performance, "now");
  const view = Object.getOwnPropertyDescriptor(globalThis, "window");
  const htmlElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  class TestHTMLElement {}
  let time = 0;
  let mutate = () => {};
  globalThis.MutationObserver = class {
    constructor(callback: () => void) { mutate = callback; }
    observe() {}
    disconnect() {}
  } as unknown as typeof MutationObserver;
  Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 1 });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: TestHTMLElement });
  Object.defineProperty(performance, "now", { configurable: true, value: () => time });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    getComputedStyle: (element: HTMLElement) => ({ width: element.style?.width ?? "auto", height: element.style?.height ?? "auto", boxSizing: "border-box" }),
  } });
  const targets: ReturnType<typeof popup>[] = [];
  const create = (prepared: () => boolean = () => true, config: PopupConfig = {}) => {
    let notify = () => {};
    const target = popup(prepared, () => notify(), (at) => { time = at; }, config);
    notify = mutate;
    targets.push(target);
    return target;
  };
  try { run(create); }
  finally {
    for (const target of targets) target.animator.dispose();
    globalThis.MutationObserver = observer;
    if (ratio) Object.defineProperty(globalThis, "devicePixelRatio", ratio);
    else Reflect.deleteProperty(globalThis, "devicePixelRatio");
    if (clock) Object.defineProperty(performance, "now", clock);
    else Reflect.deleteProperty(performance, "now");
    if (view) Object.defineProperty(globalThis, "window", view);
    else Reflect.deleteProperty(globalThis, "window");
    if (htmlElement) Object.defineProperty(globalThis, "HTMLElement", htmlElement);
    else Reflect.deleteProperty(globalThis, "HTMLElement");
  }
}
function withPopup(run: (popup: ReturnType<typeof popup>) => void, prepared: () => boolean = () => true, config: PopupConfig = {}) {
  withPopups((create) => run(create(prepared, config)));
}

function popup(prepared: () => boolean, mutate: () => void, setClock: (at: number) => void, config: PopupConfig) {
  let ending = false, exited = false, hold = 0, finished = false;
  let closed = Boolean(config.initiallyClosed);
  const width = config.width ?? 180, height = config.height ?? 200, scale = config.scale ?? 1;
  const sourceProperties = new Map<string, string>();
  const source = {
    isConnected: true,
    dataset: {},
    style: { width: "40px", height: "28px", setProperty(name: string, value: string) { sourceProperties.set(name, value); }, removeProperty(name: string) { sourceProperties.delete(name); } },
    classList: { contains: () => config.glass ?? false },
    parentElement: config.parentMenu ? { closest: (selector: string) => selector === ".lg-menu" ? config.parentMenu : null } : null,
    offsetWidth: 40, offsetHeight: 28,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 20, top: 20, width: 40, height: 28 }),
  } as unknown as Element;
  Object.setPrototypeOf(source, HTMLElement.prototype);
  const element = {
    isConnected: true,
    getAttribute: () => "28",
    dataset: {},
    style: { width: `${width}px`, height: `${height}px`, setProperty() {}, removeProperty() {} },
    hasAttribute: (name: string) => name === "data-ending-style" ? ending : name === "data-closed" ? closed : name === "data-starting-style" && Boolean(config.starting),
    getBoundingClientRect: () => ({ left: 20, top: 60, width: width * scale, height: height * scale }),
    offsetWidth: Math.round(width), offsetHeight: Math.round(height),
    animate: (_frames: unknown, options: { duration: number }) => { hold = options.duration; return { cancel() {}, pause() {}, play() {}, finish() { finished = true; } }; },
    dispatchEvent: (event: Event) => { if (event.type === "glass:exited") exited = true; return true; },
  } as unknown as HTMLElement;
  const attached = attachGeometryMotion(element, { submenu: config.submenu, from: () => source, morph: config.morph ?? "detach", neck: config.neck ?? 0, radius: 28, motion: () => config.motion ?? "full", prepared });
  const animator = { ...attached, frame(at: number) { setClock(at); return attached.frame(at); } };
  return {
    source,
    sourceConceal: () => sourceProperties.get("--lg-morph-source"),
    animator,
    exit(at?: number) { if (at !== undefined) setClock(at); ending = true; closed = true; mutate(); },
    finishClosed() { ending = false; mutate(); },
    reopen(at?: number) { if (at !== undefined) setClock(at); ending = false; closed = false; mutate(); },
    finished: () => finished,
    exited: () => exited,
    hold: () => hold,
    place(start = 100) { for (const time of [start, start + 16, start + 32]) animator.frame(time); },
  };
}

test("initial map placement wait ends when settled and has a frame ceiling", () => {
  withPopup(({ animator, place }) => {
    expect(animator.positioning()).toBe(true);
    expect(animator.waypoints()).toHaveLength(0);
    place();
    expect(animator.positioning()).toBe(false);
    expect(animator.waypoints().length).toBeGreaterThan(0);
  });
  withPopup(({ animator }) => {
    for (let i = 0; i < 8; i++) animator.frame(100 + i * 16);
    expect(animator.positioning()).toBe(true);
    animator.frame(228);
    expect(animator.positioning()).toBe(false);
    expect(animator.waypoints().length).toBeGreaterThan(0);
    animator.frame(244);
    expect(animator.geometry()!.width).toBeGreaterThan(40);
  }, () => true, { starting: true });
  withPopup(({ animator }) => {
    expect(animator.positioning()).toBe(false);
    expect(animator.opacity()).toBe(1);
  }, () => true, { motion: "none" });
});

test("resting morph maps keep fractional layout dimensions under transforms", () => {
  withPopup(({ animator, place }) => {
    place();
    const end = animator.waypoints().at(-1)!;
    expect(end.width).toBe(180.25);
    expect(end.height).toBe(200.75);
    expect(end.dpr).toBe(1);
  }, () => true, { width: 180.25, height: 200.75, scale: 1.5 });
});

test("popup morphs cover the same distance with dropped frames", () => {
  let fineWidth = 0;
  withPopup(({ animator, place }) => {
    place();
    for (let time = 142; time <= 332; time += 10) animator.frame(time);
    fineWidth = animator.geometry()!.width;
  });
  withPopup(({ animator, place }) => {
    place();
    animator.frame(332);
    expect(animator.geometry()!.width).toBeCloseTo(fineWidth, 6);
  });
});

test("a superseded submenu exit releases its optical layer and can reopen before unmount", () => {
  const parentMenu = {} as Element;
  withPopup(({ animator, place, exit, reopen, exited, finished }) => {
    place(); animator.frame(1132); exit(1200);
    const releaseReplacement = retainLatestExit(parentMenu, () => {});
    expect(finished()).toBe(true);
    expect(exited()).toBe(true);
    expect(animator.opacity()).toBe(0);
    expect(animator.geometry()).toBeUndefined();
    reopen(); animator.frame(1216); animator.frame(1316);
    expect(animator.opacity()).toBeGreaterThan(0);
    expect(animator.geometry()).toBeDefined();
    releaseReplacement();
  }, () => true, { parentMenu });
});

test("a submenu releases the previous sibling's exit when its entrance begins", () => {
  const parentMenu = {} as Element;
  let finished = false;
  const release = retainLatestExit(parentMenu, () => { finished = true; });
  withPopup(({ place, animator }) => {
    expect(finished).toBe(false);
    place();
    expect(finished).toBe(true);
    expect(animator.geometry()).toBeDefined();
  }, () => true, { parentMenu });
  release();
});

test("a kept-mounted superseded popup restores its become source and can conceal it again on reopen", () => {
  const parentMenu = {} as Element;
  withPopups((create) => {
    const a = create(() => true, { parentMenu, glass: true, morph: "become" });
    a.place();
    for (let at = 148; at < 500; at += 16) a.animator.frame(at);
    a.animator.frame(1132);
    expect(a.sourceConceal()).toBe("1.000");
    a.exit(1200);
    const b = create(() => true, { parentMenu });
    b.place(1216);
    expect(a.finished()).toBe(true);
    expect(a.animator.opacity()).toBe(0);
    expect(a.sourceConceal()).toBeUndefined();
    expect((a.source as HTMLElement).dataset.glassMorphSource).toBeUndefined();
    a.finishClosed(); a.animator.frame(1290);
    expect(a.animator.opacity()).toBe(0);
    expect(a.sourceConceal()).toBeUndefined();
    // Keep A attached: a keepMounted owner does not dispose it after exit.
    b.exit(1300); a.reopen(1300); a.animator.frame(1316); a.animator.frame(1500);
    expect((a.source as HTMLElement).dataset.glassMorphSource).toBe("");
    expect(Number(a.sourceConceal())).toBeGreaterThan(0);
    a.exit(1600); a.animator.frame(1600 + a.hold() - 1);
    expect(a.exited()).toBe(true);
    expect(a.sourceConceal()).toBeUndefined();
    expect((a.source as HTMLElement).dataset.glassMorphSource).toBeUndefined();
  });
});

test("an initially closed kept-mounted popup waits for its first real opening", () => {
  withPopup(({ animator, source, sourceConceal, reopen, place }) => {
    animator.frame(100); animator.frame(600);
    expect(animator.positioning()).toBe(false);
    expect(animator.opacity()).toBe(0);
    expect(animator.waypoints()).toHaveLength(0);
    expect((source as HTMLElement).dataset.glassMorphSource).toBeUndefined();
    expect(sourceConceal()).toBeUndefined();
    reopen(700); place(716);
    expect(animator.waypoints().length).toBeGreaterThan(0);
    expect((source as HTMLElement).dataset.glassMorphSource).toBe("");
    animator.frame(800);
    expect(animator.opacity()).toBeGreaterThan(0);
    expect(Number(sourceConceal())).toBeGreaterThan(0);
  }, () => true, { initiallyClosed: true, glass: true, morph: "become" });
});

test("reopening a retained submenu completes its replacement's outgoing layer", () => {
  const parentMenu = {} as Element;
  withPopups((create) => {
    const a = create(() => true, { parentMenu });
    a.place(); a.animator.frame(1132); a.exit(1200);
    const b = create(() => true, { parentMenu });
    b.place(1216);
    expect(a.finished()).toBe(true);
    expect(a.animator.opacity()).toBe(0);
    b.animator.frame(1280); b.exit(1300);
    a.reopen(); a.animator.frame(1316);
    expect(b.finished()).toBe(true);
    expect(b.exited()).toBe(true);
    expect(b.animator.opacity()).toBe(0);
    expect(a.animator.opacity()).toBeGreaterThan(0);
    expect(a.animator.geometry()).toBeDefined();
  });
});

test("a cold submenu keeps the previous return until its maps can move", () => {
  const parentMenu = {} as Element;
  withPopups((create) => {
    const a = create(() => true, { parentMenu });
    a.place(); a.animator.frame(1132); a.exit(1200);
    let ready = false;
    const b = create(() => ready, { parentMenu });
    b.place(1216); a.animator.frame(1264); b.animator.frame(1280);
    expect(b.animator.pending()).toBe(true);
    expect(a.finished()).toBe(false);
    expect(a.animator.opacity()).toBeGreaterThan(0);
    ready = true; b.animator.frame(1296);
    expect(b.animator.pending()).toBe(false);
    expect(a.finished()).toBe(true);
    expect(a.animator.opacity()).toBe(0);
  });
});

test("a previous return can complete normally while its replacement prepares", () => {
  const parentMenu = {} as Element;
  withPopups((create) => {
    const a = create(() => true, { parentMenu });
    a.place(); a.animator.frame(1132); a.exit(1200);
    let ready = false;
    const b = create(() => ready, { parentMenu });
    b.place(1496);
    a.animator.frame(1200 + a.hold() - 1);
    expect(a.exited()).toBe(true);
    expect(a.finished()).toBe(false);
    ready = true; b.animator.frame(1580);
    expect(b.animator.pending()).toBe(false);
    expect(a.finished()).toBe(false);
  });
});

test("reopening before its original maps arrive waits before moving or handing off", () => {
  const parentMenu = {} as Element;
  withPopups((create) => {
    let ready = false;
    const a = create(() => ready, { parentMenu });
    a.place(); a.exit(140);
    const b = create(() => true, { parentMenu });
    b.place(156); b.animator.frame(240); b.exit(250);
    a.reopen(250);
    a.animator.frame(266); a.animator.frame(330);
    expect(a.animator.pending()).toBe(true);
    expect(a.animator.geometry()!.width).toBe(40);
    expect(b.finished()).toBe(false);
    ready = true; a.animator.frame(346);
    expect(a.animator.pending()).toBe(false);
    expect(a.animator.geometry()!.width).toBe(40);
    expect(b.finished()).toBe(true);
    a.animator.frame(362);
    expect(a.animator.geometry()!.width).toBeGreaterThan(40);
  });
});

test("a cold reopen gets its own bounded preparation wait", () => {
  withPopup(({ animator, place, exit, reopen }) => {
    place(); exit(140); reopen(300);
    animator.frame(400);
    expect(animator.pending()).toBe(true);
    expect(animator.geometry()!.width).toBe(40);
    animator.frame(441);
    expect(animator.pending()).toBe(false);
    expect(animator.geometry()!.width).toBe(40);
    animator.frame(457);
    expect(animator.geometry()!.width).toBeGreaterThan(40);
  }, () => false);
});

test("joined source association survives resting open and ends after closing; plain detachment has none", () => {
  withPopup(({ animator, source, place, exit, hold }) => {
    expect(animator.detachedSource()).toBeUndefined();
    place();
    expect(animator.detachedSource()).toBe(source);
    animator.frame(1132);
    expect(animator.geometry()).toBeUndefined();
    expect(animator.detachedSource()).toBe(source);
    exit(5000);
    animator.frame(5000 + hold() - 1);
    expect(animator.detachedSource()).toBeUndefined();
  }, () => true, { glass: true, neck: 18 });
  withPopup(({ animator, place }) => {
    place();
    animator.frame(1132);
    expect(animator.detachedSource()).toBeUndefined();
  }, () => true, { glass: true, neck: 0 });
});

test("preparing maps does not consume the entrance animation", () => {
  let ready = false;
  withPopup(({ animator, place }) => {
    place();
    expect(animator.pending()).toBe(true);
    ready = true;
    animator.frame(260);
    expect(animator.pending()).toBe(false);
    expect(animator.geometry()!.width).toBe(40);
    animator.frame(276);
    expect(animator.geometry()!.width).toBeGreaterThan(40);
    expect(animator.geometry()!.width).toBeLessThan(60);
  }, () => ready);
});

test("a slow exit reaches its source before its unmount hold expires", () => {
  withPopup(({ animator, place, exit, exited, hold }) => {
    place();
    animator.frame(1132);
    expect(animator.geometry()).toBeUndefined();
    exit();
    animator.frame(1148);
    expect(hold()).toBeGreaterThan(100);
    animator.frame(1148 + hold() - 16);
    expect(exited()).toBe(true);
    expect(animator.opacity()).toBe(0);
  });
});

test("a delayed first exit frame includes the time since closing began", () => {
  withPopup(({ animator, place, exit, exited, hold }) => {
    place();
    animator.frame(1132);
    expect(animator.geometry()).toBeUndefined();
    // The scene slept before closing, then its first exit paint was delayed.
    exit(5000);
    animator.frame(5000 + hold() - 1);
    expect(exited()).toBe(true);
    expect(animator.opacity()).toBe(0);
  });
});


test("a submenu fades in place and never morphs from or back into its row", () => {
  withPopup(({ animator, place, exit }) => {
    place();
    expect(animator.waypoints()).toHaveLength(0);
    expect(animator.geometry()).toBeUndefined();
    animator.frame(200);
    expect(animator.opacity()).toBeGreaterThan(0);
    animator.frame(1000);
    exit(1010);
    animator.frame(1080);
    expect(animator.waypoints()).toHaveLength(0);
    expect(animator.geometry()).toBeUndefined();
    expect(animator.opacity()).toBeLessThan(1);
    animator.frame(2000);
    expect(animator.opacity()).toBe(0);
  }, () => true, { submenu: true, parentMenu: {} as Element });
});

test("sibling submenus morph from the outgoing panel size, not the row", () => {
  withPopups((create) => {
    const parentMenu = {} as Element;
    const first = create(undefined, { submenu: true, parentMenu, height: 80 });
    first.place(); first.animator.frame(1000);
    first.exit(1010);
    const next = create(undefined, { submenu: true, parentMenu, height: 160 });
    next.place(1010);
    expect(next.animator.waypoints()[0]!.height).toBe(80);
    expect(next.animator.waypoints().at(-1)!.height).toBe(160);
    expect(first.finished()).toBe(true);
    expect(first.animator.opacity()).toBe(0);
    next.animator.frame(1080);
    expect(next.animator.geometry()!.height).toBeGreaterThan(80);
    expect(next.animator.geometry()!.width).toBe(180);
    next.exit(1090); next.animator.frame(1130);
    expect(next.animator.geometry()).toBeUndefined();
    expect(next.animator.waypoints()).toHaveLength(0);
    next.reopen(1140); next.animator.frame(1500);
    expect(next.animator.opacity()).toBe(1);
    expect(next.animator.waypoints()).toHaveLength(0);
  });
});

test("submenu slots do not cross parents or survive disposal", () => {
  withPopups((create) => {
    const parentMenu = {} as Element;
    const first = create(undefined, { submenu: true, parentMenu });
    first.place(); first.animator.frame(1000);
    const nested = create(undefined, { submenu: true, parentMenu: {} as Element });
    nested.place(1000);
    expect(nested.animator.waypoints()).toHaveLength(0);
    first.animator.dispose();
    const next = create(undefined, { submenu: true, parentMenu });
    next.place(1000);
    expect(next.animator.waypoints()).toHaveLength(0);
  });
});


test("a sibling holds the outgoing panel through placement and cold maps", () => {
  withPopups((create) => {
    const parentMenu = {} as Element;
    const first = create(undefined, { submenu: true, parentMenu, height: 80 });
    first.place(); first.animator.frame(1132); first.exit(1200);
    const next = create(() => false, { submenu: true, parentMenu, height: 160 });
    const opacity = first.animator.opacity();
    first.animator.frame(1240);
    expect(first.animator.opacity()).toBe(opacity);
    next.place(1250);
    first.animator.frame(1350);
    expect(first.animator.opacity()).toBe(opacity);
    expect(first.exited()).toBe(false);
    next.animator.frame(1500);
    expect(first.exited()).toBe(true);
    expect(next.animator.geometry()!.height).toBe(80);
  });
});

test("aborting a replacement releases the outgoing submenu to finish closing", () => {
  withPopups((create) => {
    const parentMenu = {} as Element;
    const first = create(undefined, { submenu: true, parentMenu });
    first.place(); first.animator.frame(1132); first.exit(1200);
    const next = create(undefined, { submenu: true, parentMenu });
    next.animator.dispose();
    first.animator.frame(1600);
    expect(first.exited()).toBe(true);
  });
});


test("hover intent holds the visible panel before a sibling mounts", () => {
  withPopups((create) => {
    const parentMenu = {} as Element;
    const first = create(undefined, { submenu: true, parentMenu, height: 80 });
    first.place(); first.animator.frame(1132);
    const trigger = { parentElement: { closest: () => parentMenu } } as unknown as HTMLElement;
    const release = prepareSubmenuHandoff(trigger);
    first.exit(1200); first.animator.frame(1330);
    expect(first.animator.opacity()).toBe(1);
    const next = create(undefined, { submenu: true, parentMenu, height: 160 });
    next.place(1340);
    release();
    expect(first.exited()).toBe(true);
    expect(next.animator.geometry()!.height).toBe(80);
  });
});

test("leaving a pending sibling resumes the existing panel's exit", () => {
  withPopups((create) => {
    const parentMenu = {} as Element;
    const first = create(undefined, { submenu: true, parentMenu });
    first.place(); first.animator.frame(1132);
    const trigger = { parentElement: { closest: () => parentMenu } } as unknown as HTMLElement;
    const release = prepareSubmenuHandoff(trigger);
    first.exit(1200); first.animator.frame(1250);
    release(); release();
    first.animator.frame(1600);
    expect(first.exited()).toBe(true);
  });
});
