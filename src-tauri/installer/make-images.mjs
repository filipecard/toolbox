// Draws the installer's brand images (24-bit BMP, what NSIS wants):
//   sidebar.bmp 164x314 — welcome/finish pages
//   header.bmp  150x57  — top-right of the other pages
// Petrol → green gradient with the launcher bubble and the tools' colored
// circles, as the quick menu opens on the desktop.
//   node src-tauri/installer/make-images.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** Tool circle colors, from src/shell/toolCatalog.ts. */
const TOOLS = ["#ada800", "#6e5ba4", "#4f8fd9", "#ffb10a", "#0ea5e9", "#66ac53", "#14b8a6", "#c70021", "#993871"].map(hex);
const GREEN = hex("#008f32");
const PETROL_DARK = hex("#0b2e36");
const PETROL = hex("#174e59");
const WHITE = [255, 255, 255];

function canvas(w, h) {
  const px = new Array(w * h);
  return {
    w,
    h,
    set(x, y, c, a = 1) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = y * w + x;
      px[i] = a >= 1 ? c : mix(px[i] ?? WHITE, c, a);
    },
    get: (x, y) => px[y * w + x],
    /** Anti-aliased filled circle. */
    circle(cx, cy, r, c) {
      for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
        for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          const a = Math.max(0, Math.min(1, r - d + 0.5));
          if (a > 0) this.set(x, y, c, a);
        }
      }
    },
  };
}

function toBmp({ w, h, get }) {
  const row = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + row * h;
  const buf = Buffer.alloc(size);
  buf.write("BM", 0);
  buf.writeUInt32LE(size, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) {
    const off = 54 + (h - 1 - y) * row; // bottom-up
    for (let x = 0; x < w; x++) {
      const [r, g, b] = get(x, y);
      buf[off + x * 3] = b;
      buf[off + x * 3 + 1] = g;
      buf[off + x * 3 + 2] = r;
    }
  }
  return buf;
}

/** The launcher bubble: green disc with the white center dot. */
function bubble(c, cx, cy, r) {
  c.circle(cx, cy + r * 0.12, r * 1.08, mix(PETROL_DARK, [0, 0, 0], 0.4)); // soft shadow
  c.circle(cx, cy, r, GREEN);
  c.circle(cx, cy, r * 0.24, WHITE);
}

// --- Sidebar: vertical gradient, bubble, and the tool circles fanning out.
{
  const c = canvas(164, 314);
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const t = y / c.h;
      const base = t < 0.65 ? mix(PETROL_DARK, PETROL, t / 0.65) : mix(PETROL, mix(PETROL, GREEN, 0.55), (t - 0.65) / 0.35);
      // Faint diagonal light.
      const glow = Math.max(0, 1 - Math.hypot(x - 40, y - 60) / 180) * 0.12;
      c.set(x, y, mix(base, WHITE, glow));
    }
  }
  bubble(c, 82, 92, 26);
  // Tools on an arc below the bubble, like the quick menu opening.
  TOOLS.forEach((col, i) => {
    const angle = Math.PI * (0.12 + (0.76 * i) / (TOOLS.length - 1));
    const x = 82 - Math.cos(angle) * 58;
    const y = 150 + Math.sin(angle) * 34;
    c.circle(x, y, 9, col);
  });
  // A small "window" card at the bottom.
  for (let y = 222; y < 282; y++) {
    for (let x = 30; x < 134; x++) {
      const bar = y < 232;
      c.set(x, y, bar ? hex("#171716") : hex("#000000"), 0.85);
    }
  }
  [hex("#7fd49a"), hex("#ffffff"), hex("#ffffff")].forEach((col, i) => {
    for (let x = 40; x < 40 + [52, 70, 36][i]; x++) for (let y = 242 + i * 12; y < 246 + i * 12; y++) c.set(x, y, col, 0.8);
  });
  writeFileSync(join(here, "sidebar.bmp"), toBmp(c));
}

// --- Header: light background, bubble with three tool circles on the right.
{
  const c = canvas(150, 57);
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) c.set(x, y, mix(WHITE, hex("#e8f1ef"), x / c.w));
  [TOOLS[2], TOOLS[0], TOOLS[5]].forEach((col, i) => c.circle(48 + i * 22, 28.5, 8, col));
  bubble(c, 124, 28.5, 16);
  writeFileSync(join(here, "header.bmp"), toBmp(c));
}

console.log("sidebar.bmp e header.bmp gerados em", here);
