import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * Generates the PWA icons without a native image dependency.
 *
 * Draws a rounded square in the accent colour with a white "L", then encodes it
 * as a PNG by hand. Keeps `npm install` free of a canvas toolchain on Windows.
 */

const ACCENT = [79, 87, 196];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function png(size, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Each scanline is prefixed with a filter byte (0 = none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixels(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function icon(size) {
  const radius = size * 0.22;
  // "L" geometry, proportional to the canvas.
  const stemLeft = size * 0.36;
  const stemRight = size * 0.46;
  const top = size * 0.28;
  const bottom = size * 0.72;
  const footRight = size * 0.66;
  const footTop = size * 0.62;

  const insideRounded = (x, y) => {
    const cx = Math.min(Math.max(x, radius), size - radius);
    const cy = Math.min(Math.max(y, radius), size - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };

  return png(size, (x, y) => {
    if (!insideRounded(x + 0.5, y + 0.5)) return [0, 0, 0, 0];

    const inStem = x >= stemLeft && x <= stemRight && y >= top && y <= bottom;
    const inFoot = x >= stemLeft && x <= footRight && y >= footTop && y <= bottom;
    if (inStem || inFoot) return [...WHITE, 255];

    return [...ACCENT, 255];
  });
}

mkdirSync("public/icons", { recursive: true });

for (const size of [192, 512]) {
  writeFileSync(`public/icons/icon-${size}.png`, icon(size));
  console.log(`public/icons/icon-${size}.png`);
}
writeFileSync("public/icons/apple-touch-icon.png", icon(180));
console.log("public/icons/apple-touch-icon.png");

// Vector version for browsers that prefer it.
writeFileSync(
  "public/icons/icon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="113" fill="rgb(${ACCENT.join(",")})"/>
  <path d="M184 143h51v179h112v47H184z" fill="#fff"/>
</svg>
`,
);
console.log("public/icons/icon.svg");
