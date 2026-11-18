/**
 * Lightweight, zero-dependency QR Code generator (Byte mode, ECC Level L, Versions 1-4).
 * Produces a boolean module matrix suitable for rendering an inline SVG QR code.
 */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly: Uint8Array = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsComputeEcc(data: Uint8Array, eccCount: number): Uint8Array {
  const gen = rsGeneratorPoly(eccCount);
  const res = new Uint8Array(eccCount);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ res[0];
    res.copyWithin(0, 1);
    res[eccCount - 1] = 0;
    for (let j = 0; j < eccCount; j++) {
      res[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return res;
}

interface VersionSpec {
  version: number;
  size: number;
  dataCodewords: number;
  eccCodewords: number;
  alignPos: number[];
}

// Level L single-block versions 1..4
const VERSION_SPECS: VersionSpec[] = [
  { version: 1, size: 21, dataCodewords: 19, eccCodewords: 7, alignPos: [] },
  { version: 2, size: 25, dataCodewords: 34, eccCodewords: 10, alignPos: [6, 18] },
  { version: 3, size: 29, dataCodewords: 55, eccCodewords: 15, alignPos: [6, 22] },
  { version: 4, size: 33, dataCodewords: 80, eccCodewords: 20, alignPos: [6, 26] },
];

function selectVersion(byteLen: number): VersionSpec {
  for (const spec of VERSION_SPECS) {
    // 4-bit mode + 8-bit length + 8*byteLen + 4-bit terminator
    const neededBits = 4 + 8 + byteLen * 8;
    if (neededBits <= spec.dataCodewords * 8) {
      return spec;
    }
  }
  throw new Error('Payload too long for compact QR encoder (max 78 bytes).');
}

function encodeDataCodewords(bytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  };

  // Byte mode indicator 0100
  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (const b of bytes) pushBits(b, 8);

  const maxBits = spec.dataCodewords * 8;
  const termLen = Math.min(4, maxBits - bits.length);
  pushBits(0, termLen);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = new Uint8Array(spec.dataCodewords);
  for (let i = 0; i < bits.length / 8; i++) {
    let val = 0;
    for (let b = 0; b < 8; b++) {
      val = (val << 1) | bits[i * 8 + b];
    }
    codewords[i] = val;
  }

  const pads = [0xec, 0x11];
  let padIdx = 0;
  for (let i = bits.length / 8; i < spec.dataCodewords; i++) {
    codewords[i] = pads[padIdx % 2];
    padIdx++;
  }
  return codewords;
}

export function generateQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const spec = selectVersion(bytes.length);
  const size = spec.size;

  const data = encodeDataCodewords(bytes, spec);
  const ecc = rsComputeEcc(data, spec.eccCodewords);
  const allCodewords = new Uint8Array(data.length + ecc.length);
  allCodewords.set(data, 0);
  allCodewords.set(ecc, data.length);

  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunc: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunc = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      modules[r][c] = dark;
      isFunc[r][c] = true;
    }
  };

  const drawFinder = (top: number, left: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = top + r;
        const cc = left + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const inBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setFunc(rr, cc, inOuter && (inBorder || inCore));
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    setFunc(6, i, dark);
    setFunc(i, 6, dark);
  }

  // Alignment patterns
  for (const rCenter of spec.alignPos) {
    for (const cCenter of spec.alignPos) {
      if (
        (rCenter === 6 && cCenter === 6) ||
        (rCenter === 6 && cCenter === size - 7) ||
        (rCenter === size - 7 && cCenter === 6)
      ) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunc(rCenter + dr, cCenter + dc, dark);
        }
      }
    }
  }

  // Reserve format info & dark module
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      setFunc(8, i, false);
      setFunc(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFunc(8, size - 1 - i, false);
    setFunc(size - 1 - i, 8, false);
  }
  setFunc(size - 8, 8, true);

  // Place data bits (zigzag) with mask pattern 0: (r + c) % 2 === 0
  let bitIndex = 0;
  const totalBits = allCodewords.length * 8;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const c = right - dx;
        if (isFunc[r][c]) continue;
        let bit = false;
        if (bitIndex < totalBits) {
          const byte = allCodewords[bitIndex >> 3];
          bit = ((byte >> (7 - (bitIndex & 7))) & 1) === 1;
          bitIndex++;
        }
        const masked = (r + c) % 2 === 0 ? !bit : bit;
        modules[r][c] = masked;
      }
    }
    upward = !upward;
  }

  // Format bits for ECC L (01) + Mask 0 (000) -> BCH + XOR 0x5412 = 0x77c4 (111011111000100)
  const formatBits = 0b111011111000100;
  for (let i = 0; i < 15; i++) {
    const bit = ((formatBits >> i) & 1) === 1;
    // Vertical
    if (i < 6) setFunc(i, 8, bit);
    else if (i < 8) setFunc(i + 1, 8, bit);
    else setFunc(size - 15 + i, 8, bit);

    // Horizontal
    if (i < 8) setFunc(8, size - 1 - i, bit);
    else if (i < 9) setFunc(8, 15 - i, bit);
    else setFunc(8, 14 - i, bit);
  }

  return modules;
}
