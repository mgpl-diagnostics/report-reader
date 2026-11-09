/**
 * PDF layer: text lines with coordinates, and embedded images with placement, pixels and fingerprints.
 * Uses the PDF's own text layer (exact) — lab reports from LIS software are digital, not scans.
 */
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import type { Box } from "./types";

// pdfjs-dist is ESM; the legacy build runs in Node without a canvas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pdfjs = any;
let pdfjsP: Promise<Pdfjs> | undefined;
const loadPdfjs = () => (pdfjsP ??= import("pdfjs-dist/legacy/build/pdf.mjs" as string));

export interface TextItem {
  x: number;
  /** distance from the top of the page (baseline) */
  y: number;
  w: number;
  s: string;
}

export interface Line {
  y: number;
  items: TextItem[];
  /** items joined with single spaces */
  text: string;
}

export interface PdfImage {
  page: number;
  box: Box;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  /** sha256 of the decoded pixels (first 16 hex chars): identical image → identical id */
  sha: string;
  /** 64-bit difference hash: near-identical images differ by a few bits */
  dhash: string;
}

export interface PdfPage {
  number: number;
  width: number;
  height: number;
  lines: Line[];
  images: PdfImage[];
}

export interface PdfDoc {
  pages: PdfPage[];
  sha256: string;
}

const mul = (m: number[], n: number[]) => [
  m[0]! * n[0]! + m[2]! * n[1]!, m[1]! * n[0]! + m[3]! * n[1]!, m[0]! * n[2]! + m[2]! * n[3]!,
  m[1]! * n[2]! + m[3]! * n[3]!, m[0]! * n[4]! + m[2]! * n[5]! + m[4]!, m[1]! * n[4]! + m[3]! * n[5]! + m[5]!,
];

function toRGBA(img: { width: number; height: number; kind: number; data: Uint8ClampedArray }): Uint8ClampedArray {
  const { width: w, height: h, kind, data } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  if (kind === 3) out.set(data.subarray(0, w * h * 4));
  else if (kind === 2) for (let i = 0, j = 0; i < w * h; i++) { out[j++] = data[i * 3]!; out[j++] = data[i * 3 + 1]!; out[j++] = data[i * 3 + 2]!; out[j++] = 255; }
  else {
    const rb = (w + 7) >> 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = (data[y * rb + (x >> 3)]! >> (7 - (x & 7))) & 1 ? 255 : 0;
      const j = (y * w + x) * 4; out[j] = out[j + 1] = out[j + 2] = v; out[j + 3] = 255;
    }
  }
  return out;
}

/** 9×8 grey thumbnail → 64 bits (is each pixel brighter than its right neighbour). */
export function dhash(rgba: Uint8ClampedArray, w: number, h: number): string {
  const grey = (x: number, y: number) => {
    // average a block, compositing transparent pixels onto white
    const x0 = Math.floor((x * w) / 9), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / 9));
    const y0 = Math.floor((y * h) / 8), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / 8));
    let s = 0, n = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const j = (yy * w + xx) * 4; const a = rgba[j + 3]! / 255;
      s += (0.299 * rgba[j]! + 0.587 * rgba[j + 1]! + 0.114 * rgba[j + 2]!) * a + 255 * (1 - a); n++;
    }
    return s / n;
  };
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (grey(x, y) > grey(x + 1, y) ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}

export const hamming = (a: string, b: string) => {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b), n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
};

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** RGBA → PNG bytes (no dependencies). */
export function toPng(img: Pick<PdfImage, "width" | "height" | "rgba">): Buffer {
  const { width: w, height: h, rgba } = img;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Group text items into lines (same baseline ± tolerance), left to right. */
function toLines(items: TextItem[], tol = 2.5): Line[] {
  const sorted = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= tol) last.items.push(it);
    else lines.push({ y: it.y, items: [it], text: "" });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = l.items.map((i) => i.s).join(" ").replace(/\s+/g, " ").trim();
  }
  return lines;
}

export async function readPdf(data: Uint8Array, opts: { images?: boolean } = {}): Promise<PdfDoc> {
  const pdfjs = await loadPdfjs();
  const sha256 = createHash("sha256").update(data).digest("hex");
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0, isOffscreenCanvasSupported: false });
  const doc = await task.promise;
  const pages: PdfPage[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items: TextItem[] = [];
      for (const it of tc.items as { str: string; transform: number[]; width: number }[]) {
        const s = it.str.replace(/ /g, " ").trim();
        if (!s || /^[█▌▐ ]+$/.test(s)) continue; // barcodes drawn as block glyphs
        items.push({ x: it.transform[4]!, y: vp.height - it.transform[5]!, w: it.width, s });
      }
      const images: PdfImage[] = [];
      if (opts.images !== false) {
        const ops = await page.getOperatorList();
        const O = pdfjs.OPS;
        let ctm = [1, 0, 0, 1, 0, 0];
        const stack: number[][] = [];
        for (let i = 0; i < ops.fnArray.length; i++) {
          const fn = ops.fnArray[i], a = ops.argsArray[i];
          if (fn === O.save) stack.push(ctm);
          else if (fn === O.restore) ctm = stack.pop() ?? ctm;
          else if (fn === O.transform) ctm = mul(ctm, a);
          else if (fn === O.paintImageXObject) {
            const img = await new Promise<any>((res) => (String(a[0]).startsWith("g_") ? page.commonObjs : page.objs).get(a[0], res));
            if (!img?.data) continue;
            const rgba = toRGBA(img);
            images.push({
              page: p,
              box: { x: ctm[4]!, y: vp.height - (ctm[5]! + ctm[3]!), w: ctm[0]!, h: ctm[3]! },
              width: img.width, height: img.height, rgba,
              sha: createHash("sha256").update(rgba).digest("hex").slice(0, 16),
              dhash: dhash(rgba, img.width, img.height),
            });
          }
        }
      }
      pages.push({ number: p, width: vp.width, height: vp.height, lines: toLines(items), images });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return { pages, sha256 };
}
