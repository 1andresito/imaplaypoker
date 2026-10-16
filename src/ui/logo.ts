// The logo: stacks of poker chips in different colors, drawn as SVG so it stays
// crisp at any size. This one source produces the in-app logo, the favicon and
// the desktop app icon (see scripts/make-icons.mjs).

interface ChipColor {
  top: string;
  side: string;
}

export const COLORS: Record<string, ChipColor> = {
  white: { top: "#ece4cf", side: "#a39778" },
  red: { top: "#e04848", side: "#9e2626" },
  blue: { top: "#3d7fe6", side: "#1f4c96" },
  green: { top: "#34b366", side: "#1d6e3e" },
  black: { top: "#3a3a3a", side: "#141414" },
  gold: { top: "#f5c754", side: "#b48828" },
  purple: { top: "#9a5be0", side: "#5e2f99" },
};

interface Dims {
  rx: number; // chip radius (horizontal)
  ry: number; // chip radius (vertical, perspective)
  t: number; // chip thickness
}

export const dims = (k: number): Dims => ({ rx: 42 * k, ry: 17.5 * k, t: 15 * k });

/** One chip whose top face is centered at (x, y). */
export function chip(x: number, y: number, c: ChipColor, { rx, ry, t }: Dims): string {
  // Side band: left edge down, bottom half-ellipse across, right edge up.
  const side = `M${x - rx},${y} v${t} a${rx},${ry} 0 0 0 ${2 * rx},0 v${-t} Z`;
  // White edge spots on the side band, following the curve of the bottom ellipse.
  const sw = rx * 0.22;
  const spots = [-0.72, -0.24, 0.24, 0.72]
    .map((f) => {
      const curve = ry * Math.sqrt(1 - f * f);
      return `<rect x="${x + f * rx - sw / 2}" y="${y + curve - 1}" width="${sw}" height="${t * 0.75}" rx="${sw / 5}" fill="#fff" opacity="0.92"/>`;
    })
    .join("");
  return `<g>
    <path d="${side}" fill="${c.side}"/>${spots}
    <ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${c.top}"/>
    <ellipse cx="${x}" cy="${y}" rx="${rx * 0.86}" ry="${ry * 0.84}" fill="none" stroke="#fff" stroke-width="${rx * 0.1}" stroke-dasharray="${rx * 0.22} ${rx * 0.18}" opacity="0.92"/>
    <ellipse cx="${x}" cy="${y}" rx="${rx * 0.62}" ry="${ry * 0.58}" fill="${c.top}" stroke="rgba(0,0,0,0.2)" stroke-width="1.5"/>
    <ellipse cx="${x - rx * 0.18}" cy="${y - ry * 0.2}" rx="${rx * 0.34}" ry="${ry * 0.24}" fill="#fff" opacity="0.2"/>
  </g>`;
}

/** A stack from the bottom chip up; small horizontal jitter makes it look hand-stacked. */
function stack(x: number, bottomY: number, colors: string[], jitter: number[], d: Dims): string {
  return colors.map((name, i) => chip(x + (jitter[i] ?? 0), bottomY - i * d.t, COLORS[name], d)).join("");
}

export interface LogoOptions {
  /** Draw a rounded felt-green tile behind the chips (for app icons). */
  background?: boolean;
  /** One stack of bigger chips, for tiny sizes (favicon). */
  simple?: boolean;
}

export function chipStackSvg({ background = false, simple = false }: LogoOptions = {}): string {
  let chips: string;
  let shadow: string;
  if (simple) {
    const d = dims(1.35);
    chips = stack(100, 122, ["blue", "green", "red", "gold"], [0, 3, -2, 1], d);
    shadow = `<ellipse cx="100" cy="${122 + d.t + d.ry - 4}" rx="${d.rx + 12}" ry="10" fill="#000" opacity="0.3"/>`;
  } else {
    const d = dims(1);
    // Back stack first, then the tall middle stack, then a short stack in front.
    chips =
      stack(118, 94, ["purple", "blue", "black"], [0, -3, 2], d) +
      stack(76, 120, ["black", "green", "blue", "red", "gold"], [0, 3, -2, 2, -1], d) +
      stack(128, 128, ["red", "gold"], [0, -3], d);
    shadow = `<ellipse cx="102" cy="160" rx="84" ry="13" fill="#000" opacity="0.3"/>`;
  }
  const bg = background
    ? `<rect width="200" height="200" rx="44" fill="#1f7a50"/><rect x="6" y="6" width="188" height="188" rx="39" fill="none" stroke="#2c9a68" stroke-width="3"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${bg}${shadow}${chips}</svg>`;
}

/** A single column of chips, bottom chip first, sized tightly to the stack (for bets and pots). */
export function chipColumnSvg(colors: string[]): string {
  const d = dims(1);
  const w = 2 * d.rx + 8;
  const h = 6 + 2 * d.ry + colors.length * d.t;
  const y0 = h - 3 - d.t - d.ry;
  const body = colors.map((name, i) => chip(w / 2, y0 - i * d.t, COLORS[name], d)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}
