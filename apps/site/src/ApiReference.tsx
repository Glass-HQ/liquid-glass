import type { ExampleKind } from "./Examples"

type Row = readonly [prop: string, type: string, description: string]
type Part = { name: string; description?: string; rows: readonly Row[] }
function materialRows(kind: ExampleKind): readonly Row[] {
  const thumb = kind === "slider" || kind === "switch"
  const radius = kind === "surface" ? "8px" : kind === "menu" ? "28px" : kind === "buttons" ? "capsule (circle for icon buttons)" : "capsule"
  return [
    ["material", '"clear" | "regular"', thumb ? "Pressed thumb material. Default: clear." : kind === "menu" ? "Default: regular." : "Inherits from the scene."],
    ["appearance", '"light" | "dark"', "Inherits from the scene."],
    ["radius", 'number | "capsule" | "circle"', `Continuous corner radius. Default: ${radius}.`],
    ["refraction", "number", thumb ? `Pressed thumb displacement in pixels. Default: ${kind === "slider" ? 5 : 7.75}.` : "Displacement in pixels. Default: 60; nested surfaces limit it to their inset."],
    ["tint", "string", thumb ? "Six-digit hex track color." : "Six-digit hex glass color; leaves text and icons unchanged."],
  ]
}
const motionRows: Record<"surface" | "control" | "menu", readonly Row[]> = {
  surface: [
    ["interactive", "boolean", "Press and drag feedback. Default: false."],
    ["morphFrom", "RefObject<Element | null> | element getter", "Source element for opening and closing transitions."],
    ["morph", '"become" | "detach"', "Replace the source or separate from it. Defaults to become for glass triggers, detach for triggers inside glass."],
    ["fluid", "boolean", "Animate layout size changes. Default: false."],
    ["motion", '"full" | "reduced" | "none"', "Inherits from the scene. System reduced motion always applies."],
  ],
  control: [
    ["interactive", "boolean", "Press and drag feedback. Default: true."],
    ["motion", '"full" | "reduced" | "none"', "Inherits from the scene. System reduced motion always applies."],
  ],
  menu: [
    ["morph", '"become" | "detach"', "Replace the trigger or separate from its glass. Default: become; detach inside a toolbar."],
    ["interactive", "boolean", "Elastic press, drag and light response on the popup. Default: false."],
    ["motion", '"full" | "reduced" | "none"', "Inherits from the scene. System reduced motion always applies."],
  ],
}
const menuParts: readonly Part[] = [
  { name: "GlassMenu", rows: [
    ["open / defaultOpen", "boolean", "Controlled or initial open state."],
    ["onOpenChange", "(open, eventDetails) => void", "Called when the menu opens or closes."],
    ["modal", "boolean", "Modal interaction. Default: true."],
  ] },
  { name: "GlassMenuTrigger", rows: [
    ["render", "ReactElement | render function", "Compose a GlassButton or a toolbar button with a single trigger element."],
    ["disabled", "boolean", "Disable interaction."],
    ["openOnHover", "boolean", "Open on hover. Default: false."],
  ] },
  { name: "GlassMenuContent", description: "Positions the popup inside its scene and avoids viewport collisions.", rows: [
    ["side", '"top" | "bottom" | "left" | "right" | "inline-start" | "inline-end"', "Popup side. Default: bottom. Logical sides follow text direction."],
    ["align", '"start" | "center" | "end"', "Alignment along the trigger. Default: end."],
    ["sideOffset", "number | offset function", "Distance from the trigger. Default: 8."],
    ["alignOffset", "number | offset function", "Offset along the alignment axis. Default: 0."],
    ["collisionAvoidance", "Base UI collision options", "Control side flipping and alignment shifting."],
    ["positionerProps", "Menu.Positioner props", "Advanced anchor and collision configuration. Direct placement props take precedence."],
    ["portalProps", "Menu.Portal props", "Portal options, such as keepMounted. Content stays inside its GlassScene."],
    ["children", "ReactNode", "Items, groups, separators and nested submenus."],
  ] },
  { name: "GlassMenuItem", rows: [
    ["onClick", "event handler", "Run the selected action."],
    ["disabled", "boolean", "Disable selection."],
    ["closeOnClick", "boolean", "Close the menu after selection. Default: true."],
  ] },
  { name: "GlassMenuSubmenu", description: "Wraps a submenu trigger and its content inside a parent menu.", rows: [
    ["open / defaultOpen", "boolean", "Controlled or initial submenu state."],
    ["onOpenChange", "(open, eventDetails) => void", "Called when the submenu opens or closes."],
  ] },
  { name: "GlassMenuSubmenuTrigger", rows: [
    ["children", "ReactNode", "Submenu label and an optional direction indicator."],
    ["disabled", "boolean", "Disable the submenu."],
    ["openOnHover", "boolean", "Open on hover. Default: true."],
    ["delay / closeDelay", "number", "Hover timing in milliseconds. Defaults: 40 / 0."],
  ] },
  { name: "GlassMenuSubmenuContent", description: "Accepts the same props as GlassMenuContent and uses the same glass surface. Defaults to side=inline-end and align=start.", rows: [] },
]
const parts: Record<ExampleKind, readonly Part[]> = {
  slider: [{ name: "GlassSlider", description: "Single-value slider. Supply aria-label or aria-labelledby.", rows: [
    ["value / defaultValue", "number", "Controlled or initial value. Default: min."],
    ["min / max / step", "number", "Defaults: 0 / 100 / 0.1. Requires min < max and step > 0."],
    ["onValueChange / onValueCommitted", "(value, eventDetails) => void", "Live changes and committed changes."],
    ["ticks", "boolean", "Show step marks; requires 1–100 evenly divided intervals."],
    ["thumbProps", "Slider.Thumb props", "Input ref, accessible value text and input handlers."],
    ["orientation", '"horizontal" | "vertical"', "Default: horizontal. Supports RTL."],
    ["name / form", "Base UI props", "Form integration."],
  ] }],
  switch: [{ name: "GlassSwitch", description: "Wrap in a label or supply aria-label.", rows: [
    ["checked / defaultChecked", "boolean", "Controlled or initial state."],
    ["onCheckedChange", "(checked, eventDetails) => void", "Called when the state changes."],
    ["readOnly / required", "boolean", "Interaction and validation."],
    ["name / value / uncheckedValue / form", "string", "Form submission. Checked value defaults to on."],
    ["inputRef", "Ref<HTMLInputElement>", "Access the form input."],
  ] }],
  surface: [{ name: "GlassSurface", rows: [["concentric", "boolean | { inset?: number }", "Follow the nearest shape container; optionally set the inset in pixels."], ["render", "ReactElement | render function", "Compose your own element with glass; forwards props and refs."], ["children", "ReactNode", "Content displayed above the refracted layer."], ["className / style", "string / CSSProperties", "Control layout and dimensions."]] }],
  buttons: [{ name: "GlassButton", rows: [["size", '"default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg"', "Default height: 28px. Icon sizes are square."], ["render", "ReactElement | render function", "Compose a link or another button element."], ["disabled", "boolean", "Disable the button."], ["onClick", "event handler", "Run the button action."]] }],
  toolbar: [
    { name: "GlassToolbar", rows: [["orientation", '"horizontal" | "vertical"', "Keyboard navigation axis. Default: horizontal."], ["aria-label", "string", "Accessible toolbar name."], ["children", "ReactNode", "Buttons, links, groups, spacers and menus."]] },
    { name: "GlassToolbarButton", rows: [["size", '"icon" | "default"', "22px icon button by default; default sizes to its label."], ["render", "ReactElement | render function", "Use GlassMenuTrigger to compose a menu button."], ["aria-pressed", "boolean", "Expose a toggle state."], ["disabled", "boolean", "Disable interaction."]] },
    { name: "GlassToolbarSpacer", rows: [["sizing", '"fixed" | "flexible"', "Fixed 8px spacing or flexible remaining space. Default: flexible."]] },
  ],
  tabs: [{ name: "GlassTabs", rows: [["items", "{ value, label, disabled? }[]", "Tabs and their labels."], ["value / defaultValue", "string", "Controlled or initial selection; defaults to the first enabled tab."], ["onValueChange", "(value, eventDetails) => void", "Called when selection changes."], ["size", '"default" | "sm" | "lg"', "Heights: 32px, 28px and 36px."], ["aria-label", "string", "Accessible tab list name."]] }, { name: "Composable parts", description: "Use GlassTabsRoot, GlassTabsList, GlassTabsTrigger, GlassTabsIndicator and GlassTabsContent for custom triggers and panels.", rows: [] }],
  menu: menuParts,
  "progressive-blur": [
    { name: "GlassProgressiveBlur", description: "Blurs GlassContent at an edge. Foreground content stays sharp.", rows: [
      ["edge", '"top" | "bottom" | "inline-start" | "inline-end"', "Strongest edge. Default: bottom. Inline edges follow direction."],
      ["size", "number", "Depth in CSS pixels, 0–4096. Default: 80."],
      ["blur", "number", "Maximum Gaussian standard deviation in CSS pixels, 0–64. Default: 20."],
      ["refraction", "number", "Optional optical travel in CSS pixels, 0–32. Default: 0."],
      ["disabled", "boolean", "Leave content unfiltered. Also disabled for reduced transparency and forced colors."],
      ["className / style / ref", "standard div props", "Position and size the decorative region. No children or pointer interaction."],
    ] },
    { name: "GlassScrollEdges", description: "Uses the same blur and size props. Observes existing scrolling without replacing it. No effect at reached edges or when there is no overflow.", rows: [
      ["target", 'RefObject<HTMLElement | null>', "Required. The element that actually scrolls, including a ScrollArea viewport."],
      ["edges", "GlassBlurEdge[]", "Default: top and bottom. Use inline-start and inline-end for a horizontal scroller."],
    ] },
    { name: "GlassContent", rows: [["layout", '"overlay" | "flow" | "scroll"', "Overlay fills the scene; flow determines its height; scroll creates a native viewport with stationary glass. Default: overlay."]] },
  ],
}
const motionFor: Partial<Record<ExampleKind, readonly Row[]>> = {
  surface: motionRows.surface,
  buttons: motionRows.control,
  toolbar: motionRows.control,
  tabs: motionRows.control,
  menu: motionRows.menu,
  slider: [["interactive", "boolean", "Lift the thumb into glass under a press. Default: true."], motionRows.control[1]!],
  switch: [["interactive", "boolean", "Lift the thumb into glass under a press. Default: true."], motionRows.control[1]!],
}
function ReferencePart({ name, description, rows }: Part) {
  return <section>
    <h4>{name}</h4>
    {description && <p>{description}</p>}
    {rows.length > 0 && <div className="api-table-scroll">
      <table>
        <caption className="sr-only">{name} reference</caption>
        <thead><tr><th scope="col">Prop</th><th scope="col">Type</th><th scope="col">Description</th></tr></thead>
        <tbody>{rows.map(([prop, type, description]) => <tr key={prop}>
          <th scope="row"><code>{prop}</code></th><td><code>{type}</code></td><td>{description}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>
}
export function ApiReference({ kind }: { kind: ExampleKind }) {
  const sections: Part[] = [
    ...parts[kind],
    ...(kind === "progressive-blur" ? [] : [{ name: "Material props", rows: materialRows(kind) }]),
    ...(motionFor[kind] ? [{ name: "Motion props", rows: motionFor[kind] }] : []),
  ]
  return <div className="api-reference documentation">
    <h3>API reference</h3>
    {sections.map((part) => <ReferencePart key={part.name} {...part} />)}
    <p>GlassScene sets shared material, appearance and motion defaults. See the <a href="https://github.com/Glass-HQ/liquid-glass/tree/main/packages/liquid-glass#quick-start">scene setup guide</a>.</p>
    {kind === "toolbar" && <p>For toolbar menus, compose GlassMenuTrigger with GlassToolbarButton. See the <a href="#menu">menu example and props</a>.</p>}
    {kind !== "progressive-blur" && <p>For inherited props and behavior, see <a href={`https://base-ui.com/react/${kind === "surface" ? "utils/use-render" : `components/${kind === "buttons" ? "button" : kind === "tabs" ? "tabs" : kind}`}`}>the Base UI reference</a>.</p>}
    {kind === "menu" && <p>GlassMenuGroup, GlassMenuGroupLabel, GlassMenuSeparator, GlassMenuCheckboxItem, GlassMenuRadioGroup and GlassMenuRadioItem are also exported.</p>}
  </div>
}
