import { GlassToolbar, GlassToolbarButton } from "@glass-sdk/liquid-glass/react";
import type { CSSProperties, ReactNode } from "react";
import { Photo } from "./content";

/** A section of the page: a heading, a line on what to look for, then its stage. */
export function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      <p className="note">{note}</p>
      {children}
    </section>
  );
}

/**
 * Where a test happens: a rounded frame, the photo behind (or the stage's own backdrop), and
 * when a test has them, its controls as small glass toolbars along the bottom.
 */
export function Stage({
  photo,
  night = false,
  height,
  className,
  style,
  controls,
  children,
}: {
  photo?: string;
  night?: boolean;
  height?: number;
  className?: string;
  style?: CSSProperties;
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={className ? `stage ${className}` : "stage"}
      style={height === undefined ? style : { ...style, height }}
    >
      {photo !== undefined && <Photo position={photo} night={night} />}
      {children}
      {controls !== undefined && <div className="stage-controls">{controls}</div>}
    </div>
  );
}

/** A row of choices on a small glass toolbar, the chosen one pressed. */
export function Options<T extends string | number>({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  items: ReadonlyArray<readonly [T, string]>;
}) {
  return (
    <GlassToolbar aria-label={label} className="options">
      {items.map(([item, name]) => (
        <GlassToolbarButton key={item} aria-pressed={value === item} onClick={() => onChange(item)}>
          {name}
        </GlassToolbarButton>
      ))}
    </GlassToolbar>
  );
}

/** A two-way switch on a small glass toolbar. */
export function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <GlassToolbar aria-label={label} className="options">
      <GlassToolbarButton aria-pressed={on} onClick={() => onChange(!on)}>
        {label}
      </GlassToolbarButton>
    </GlassToolbar>
  );
}
