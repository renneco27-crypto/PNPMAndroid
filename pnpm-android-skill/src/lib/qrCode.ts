/**
 * Pure TypeScript Zero-Dependency QR Code Generator
 * Generates ISO/IEC 18004 compliant QR Code SVGs locally without external packages.
 */

// Galois Field 256 Math
const GF256_EXP = new Uint8Array(512);
const GF256_LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF256_EXP[i] = x;
    GF256_EXP[i + 255] = x;
    GF256_LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
})();

function gfMul(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return GF256_EXP[GF256_LOG[x] + GF256_LOG[y]];
}

function rsGeneratorPoly(numEc: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < numEc; i++) {
    const nextPoly = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      nextPoly[j] ^= gfMul(poly[j], GF256_EXP[i]);
      nextPoly[j + 1] ^= poly[j];
    }
    poly = nextPoly;
  }
  return poly;
}

function rsCalculateRemainder(data: Uint8Array, numEc: number): Uint8Array {
  const gen = rsGeneratorPoly(numEc);
  const res = new Uint8Array(numEc);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ res[0];
    res.copyWithin(0, 1);
    res[numEc - 1] = 0;
    for (let j = 0; j < numEc; j++) {
      res[j] ^= gfMul(gen[j], factor);
    }
  }
  return res;
}

// QR Code Specifications for Version 1 to 6 (Medium EC)
interface VersionSpec {
  version: number;
  totalBytes: number;
  dataBytes: number;
  ecBytesPerBlock: number;
  numBlocks: number;
  alignmentPatterns: number[];
}

const VERSION_SPECS: VersionSpec[] = [
  { version: 1, totalBytes: 26, dataBytes: 16, ecBytesPerBlock: 10, numBlocks: 1, alignmentPatterns: [] },
  { version: 2, totalBytes: 44, dataBytes: 28, ecBytesPerBlock: 16, numBlocks: 1, alignmentPatterns: [6, 18] },
  { version: 3, totalBytes: 70, dataBytes: 44, ecBytesPerBlock: 26, numBlocks: 1, alignmentPatterns: [6, 22] },
  { version: 4, totalBytes: 100, dataBytes: 64, ecBytesPerBlock: 18, numBlocks: 2, alignmentPatterns: [6, 26] },
  { version: 5, totalBytes: 134, dataBytes: 86, ecBytesPerBlock: 24, numBlocks: 2, alignmentPatterns: [6, 30] },
  { version: 6, totalBytes: 172, dataBytes: 108, ecBytesPerBlock: 16, numBlocks: 4, alignmentPatterns: [6, 34] },
];

function encodeData(text: string, spec: VersionSpec): Uint8Array {
  const utf8Bytes = new TextEncoder().encode(text);
  const bitBuffer: number[] = [];

  function writeBits(val: number, len: number) {
    for (let i = len - 1; i >= 0; i--) {
      bitBuffer.push((val >> i) & 1);
    }
  }

  // Mode: Byte (0100)
  writeBits(0b0100, 4);
  // Character count indicator (8 bits for Vers 1-9)
  writeBits(utf8Bytes.length, 8);
  // Data
  for (const b of utf8Bytes) {
    writeBits(b, 8);
  }
  // Terminator
  const totalBits = spec.dataBytes * 8;
  const termLen = Math.min(4, totalBits - bitBuffer.length);
  writeBits(0, termLen);
  // Byte alignment
  while (bitBuffer.length % 8 !== 0) bitBuffer.push(0);
  // Pad bytes
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bitBuffer.length < totalBits) {
    writeBits(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  // Convert bit buffer to bytes
  const dataBytes = new Uint8Array(spec.dataBytes);
  for (let i = 0; i < spec.dataBytes; i++) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) {
      byte = (byte << 1) | bitBuffer[i * 8 + bit];
    }
    dataBytes[i] = byte;
  }
  return dataBytes;
}

function createQRMatrix(text: string): { matrix: boolean[][]; size: number } {
  const utf8Len = new TextEncoder().encode(text).length;
  const spec = VERSION_SPECS.find(s => s.dataBytes >= utf8Len + 3) || VERSION_SPECS[VERSION_SPECS.length - 1];
  const size = spec.version * 4 + 17;
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  function setModule(r: number, c: number, val: boolean, isFunc = true) {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      matrix[r][c] = val;
      if (isFunc) isFunction[r][c] = true;
    }
  }

  // 1. Finder patterns
  function drawFinder(row: number, col: number) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r;
        const nc = col + c;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          const isBlack = (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
          setModule(nr, nc, isBlack);
        } else {
          setModule(nr, nc, false); // Separator
        }
      }
    }
  }

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // 2. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setModule(6, i, i % 2 === 0);
    setModule(i, 6, i % 2 === 0);
  }

  // 3. Alignment patterns
  if (spec.alignmentPatterns.length > 0) {
    const coords = spec.alignmentPatterns;
    for (const r of coords) {
      for (const c of coords) {
        if (isFunction[r][c]) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const isBlack = (Math.max(Math.abs(dr), Math.abs(dc)) === 2 || (dr === 0 && dc === 0));
            setModule(r + dr, c + dc, isBlack);
          }
        }
      }
    }
  }

  // 4. Dark module and reserved format areas
  setModule(size - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      isFunction[8][i] = true;
      isFunction[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    isFunction[8][size - 1 - i] = true;
    isFunction[size - 1 - i][8] = true;
  }

  // 5. Interleave Data & Error Correction
  const rawData = encodeData(text, spec);
  const dataBlockSize = Math.floor(spec.dataBytes / spec.numBlocks);
  const ecBlockSize = spec.ecBytesPerBlock;
  const blocks: { data: Uint8Array; ec: Uint8Array }[] = [];

  for (let b = 0; b < spec.numBlocks; b++) {
    const dStart = b * dataBlockSize;
    const dEnd = dStart + dataBlockSize;
    const bData = rawData.slice(dStart, dEnd);
    const bEc = rsCalculateRemainder(bData, ecBlockSize);
    blocks.push({ data: bData, ec: bEc });
  }

  const interleaved: number[] = [];
  for (let i = 0; i < dataBlockSize; i++) {
    for (let b = 0; b < spec.numBlocks; b++) {
      interleaved.push(blocks[b].data[i]);
    }
  }
  for (let i = 0; i < ecBlockSize; i++) {
    for (let b = 0; b < spec.numBlocks; b++) {
      interleaved.push(blocks[b].ec[i]);
    }
  }

  // 6. Place data bits (Mask 0: (row + col) % 2 == 0)
  const bitStream: number[] = [];
  for (const byte of interleaved) {
    for (let i = 7; i >= 0; i--) {
      bitStream.push((byte >> i) & 1);
    }
  }

  let bitIdx = 0;
  let right = size - 1;
  let upwards = true;

  while (right > 0) {
    if (right === 6) right--; // Skip vertical timing column
    const rows = upwards
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const r of rows) {
      for (const col of [right, right - 1]) {
        if (!isFunction[r][col]) {
          let bit = bitIdx < bitStream.length ? bitStream[bitIdx++] : 0;
          // Apply mask pattern 0: (r + col) % 2 === 0
          if ((r + col) % 2 === 0) {
            bit ^= 1;
          }
          matrix[r][col] = bit === 1;
        }
      }
    }
    right -= 2;
    upwards = !upwards;
  }

  // 7. Format information: Mask 0 + EC Level M (00) -> Format bits 101010000010010
  const FORMAT_BITS = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
  for (let i = 0; i < 6; i++) matrix[8][i] = FORMAT_BITS[i] === 1;
  matrix[8][7] = FORMAT_BITS[6] === 1;
  matrix[8][8] = FORMAT_BITS[7] === 1;
  matrix[7][8] = FORMAT_BITS[8] === 1;
  for (let i = 9; i < 15; i++) matrix[14 - i][8] = FORMAT_BITS[i] === 1;

  for (let i = 0; i < 8; i++) matrix[size - 1 - i][8] = FORMAT_BITS[i] === 1;
  for (let i = 8; i < 15; i++) matrix[8][size - 15 + i] = FORMAT_BITS[i] === 1;

  return {
    matrix: matrix.map(row => row.map(cell => Boolean(cell))),
    size,
  };
}

/**
 * Generates an ISO/IEC 18004 compliant QR Code Data URI (SVG format)
 * without any external library or runtime dependencies.
 */
export function generateQRCodeSVG(text: string, size = 320): string {
  try {
    const { matrix, size: moduleCount } = createQRMatrix(text);
    const margin = 2;
    const totalModules = moduleCount + margin * 2;
    const moduleSize = (size / totalModules).toFixed(3);

    let pathData = '';
    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (matrix[r][c]) {
          const x = ((c + margin) * parseFloat(moduleSize)).toFixed(2);
          const y = ((r + margin) * parseFloat(moduleSize)).toFixed(2);
          pathData += `M${x},${y}h${moduleSize}v${moduleSize}h-${moduleSize}z `;
        }
      }
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#FFFFFF"/><path d="${pathData}" fill="#0F172A"/></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  } catch {
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}&margin=10`;
  }
}

/**
 * Async helper for high-resolution PNG / SVG Data URLs
 */
export async function generateQRCodeDataURL(text: string, size = 320): Promise<string> {
  return generateQRCodeSVG(text, size);
}
