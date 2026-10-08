import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const root = new URL('../public/', import.meta.url);
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  crcTable[n] = value >>> 0;
}

const crc32 = buffer => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const name = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
};

const roundedRectContains = (x, y, left, top, right, bottom, radius) => {
  const nearestX = Math.max(left + radius, Math.min(right - radius, x));
  const nearestY = Math.max(top + radius, Math.min(bottom - radius, y));
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
};

const distanceToSegment = (x, y, x1, y1, x2, y2) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared)) : 0;
  return Math.hypot(x - (x1 + amount * dx), y - (y1 + amount * dy));
};

const makePng = size => {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const scale = size / 512;
  const colors = { gold: [244, 166, 36, 255], dark: [33, 25, 47, 255], white: [255, 255, 255, 255], orange: [229, 93, 0, 255] };
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const px = (x + 0.5) / scale;
      const py = (y + 0.5) / scale;
      let color = colors.gold;
      if (roundedRectContains(px, py, 112, 150, 400, 362, 38)) color = colors.dark;
      if (Math.abs(px - 256) < 6 && py > 170 && py < 342 && Math.floor((py - 170) / 25) % 2 === 0) color = colors.gold;
      if (Math.hypot(px - 190, py - 256) < 37) color = colors.white;
      if (distanceToSegment(px, py, 175, 256, 187, 268) < 7 || distanceToSegment(px, py, 187, 268, 208, 242) < 7) color = colors.orange;
      const offset = row + 1 + x * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = color[3];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
};

for (const size of [180, 192, 512]) {
  writeFileSync(new URL(`pwa-icon-${size}.png`, root), makePng(size));
}
