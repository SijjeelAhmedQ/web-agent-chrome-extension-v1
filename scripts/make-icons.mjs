// Renders the extension icons (emerald→sky rounded square with a white four-point sparkle)
// to public/icons/*.png. No dependencies: rasterised with 4×4 supersampling, encoded by hand.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const A = [16, 185, 129], B = [6, 182, 212], C = [14, 165, 233];
function gradient(t) {
  const [p, q, u] = t < 0.55 ? [A, B, t / 0.55] : [B, C, (t - 0.55) / 0.45];
  return p.map((v, i) => lerp(v, q[i], u));
}
function insideRoundRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
// Astroid sparkle: |dx|^(2/3) + |dy|^(2/3) <= R^(2/3)
function insideSparkle(x, y, R) {
  const dx = Math.abs(x - 0.5), dy = Math.abs(y - 0.5);
  return Math.cbrt(dx * dx) + Math.cbrt(dy * dy) <= Math.cbrt(R * R);
}

function render(size) {
  const ss = 4, out = Buffer.alloc(size * size * 4);
  const radius = size <= 16 ? 0.22 : 0.26, R = size <= 16 ? 0.36 : 0.33;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let bg = 0, star = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const x = (px + (sx + 0.5) / ss) / size, y = (py + (sy + 0.5) / ss) / size;
      if (insideRoundRect(x, y, radius)) { bg++; if (insideSparkle(x, y, R)) star++; }
    }
    const n = ss * ss, a = bg / n, s = bg ? star / bg : 0;
    const g = gradient(((px + py) / (2 * size)));
    const i = (py * size + px) * 4;
    out[i] = Math.round(lerp(g[0], 255, s));
    out[i + 1] = Math.round(lerp(g[1], 255, s));
    out[i + 2] = Math.round(lerp(g[2], 255, s));
    out[i + 3] = Math.round(a * 255);
  }
  return png(size, out);
}

mkdirSync('public/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(`public/icons/icon-${size}.png`, render(size));
console.log('icons written');
