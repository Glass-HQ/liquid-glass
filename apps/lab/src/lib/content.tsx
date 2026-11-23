/** Demanding things to put behind glass: long text in several scripts, photos, gradients, lists. */

export const paragraphs = [
  "Glass reads what is behind it. Every line of this paragraph is a run of text the capture rasterises on the page, so kerning, ligatures and hinting are the browser's own, and the worker only places the bitmaps. Move a surface over it and the letters should bend at the rim and stay crisp in the middle.",
  "Small type is the hard case: 11 px grey on white turns to mush under a heavy blur and shimmers under a light one. Thin rules, hairline borders and 1 px icons are the next hardest, because refraction moves them by fractions of a pixel every frame.",
  "Mixed scripts in one line: English, العربية تُكتب من اليمين إلى اليسار, עברית גם כן, 日本語の文章、한국어 문장, and emoji 👩🏽‍💻🧑🏻‍🚀🏳️‍🌈 with skin tones and joiners. Each run is captured as the browser shaped it.",
  "Numbers in columns: 1,234.56 · 7,890.12 · 3,456.78 — tabular figures should line up through the glass as well as beside it. A price, €1 299,00, a time, 23:59:59.999, and a long word, Donaudampfschifffahrtsgesellschaftskapitän.",
] as const;

export const rtl =
  "مرحبا بالعالم — هذا نص عربي طويل يمر تحت الزجاج ويجب أن يبقى صحيحا من اليمين إلى اليسار.";

export const gradients = [
  "linear-gradient(135deg, #ff375f, #ff9f0a 40%, #ffd60a)",
  "radial-gradient(circle at 30% 30%, #64d2ff, #0a84ff 45%, #5e5ce6)",
  "conic-gradient(from 90deg, #30d158, #64d2ff, #bf5af2, #ff375f, #30d158)",
  "repeating-linear-gradient(45deg, #1c1c1e 0 10px, #f2f2f7 10px 20px)",
] as const;

export const listItems = Array.from({ length: 60 }, (_, i) => ({
  id: i,
  title:
    ["Inbox", "Photos", "Notes", "Music", "Maps", "Weather", "Files", "Wallet"][i % 8] ?? "Item",
  detail: `${(i * 37) % 97} items · updated ${(i * 7) % 59} min ago`,
  hue: (i * 47) % 360,
}));

export function Photo({
  className = "stage-photo",
  position = "50% 60%",
  night = false,
}: {
  className?: string;
  position?: string;
  night?: boolean;
}) {
  return (
    <img
      className={className}
      src={night ? "./photo-night.webp" : "./photo-day.webp"}
      alt=""
      style={{ objectPosition: position }}
      decoding="async"
      draggable={false}
    />
  );
}

/** Everything at once, for the stress test: tiles, a photo, paragraphs, a table. */
export function BusyContent({ night }: { night: boolean }) {
  return (
    <div className="busy">
      {Array.from({ length: 3 }, (_, block) => (
        <section key={block} className="busy-block">
          <div className="busy-tiles">
            {gradients.map((gradient, i) => (
              <div key={i} className="busy-tile" style={{ background: gradient }} />
            ))}
            <Photo className="busy-photo" position={`${block * 30}% 50%`} night={night} />
          </div>
          {paragraphs.map((text, i) => (
            <p key={i}>{text}</p>
          ))}
          <p dir="rtl" lang="ar">
            {rtl}
          </p>
          <table className="busy-table">
            <tbody>
              {Array.from({ length: 4 }, (_, row) => (
                <tr key={row}>
                  {Array.from({ length: 6 }, (_, col) => (
                    <td key={col}>{((row + 1) * (col + 3) * 137.29 + block).toFixed(2)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
