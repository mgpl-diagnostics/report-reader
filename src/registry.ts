/**
 * Image registry: accreditation marks we recognise, and lookup of caller-supplied signatures.
 * Signatures of real people are NOT shipped in this package; pass them in (ExtractOptions.signatures).
 */
import { hamming, type PdfImage } from "./pdf";
import type { KnownSignature } from "./types";

/** dHash distance that still counts as the same picture (re-encoded / rescaled copies). */
export const NEAR = 6;

interface Mark {
  sha: string[];
  dhash: string[];
  body: "NABL";
  /** certificate printed inside the mark, when it is part of the artwork */
  certificate?: string;
}

/** NABL + ilac-MRA marks as printed by partner labs (logo artwork, not personal data). */
export const ACCREDITATION_MARKS: Mark[] = [
  // Clinova Pathlabs: ilac-MRA + NABL "MC-3860", printed at the top of accredited pages and in the footer
  { body: "NABL", certificate: "MC-3860", sha: ["8b61adacec186d92", "fc45707177fc87ef"], dhash: ["cece4ea48ec6acce"] },
];

const near = (d: string, list: string[] | undefined) => !!list?.some((x) => hamming(x, d) <= NEAR);

export function accreditationMark(img: PdfImage): Mark | undefined {
  return ACCREDITATION_MARKS.find((m) => m.sha.includes(img.sha) || near(img.dhash, m.dhash));
}

/** The registered signature this image is, if any (exact pixels first, then perceptual match). */
export function knownSignature(img: Pick<PdfImage, "sha" | "dhash">, registry: KnownSignature[] = []): KnownSignature | undefined {
  return registry.find((k) => k.sha?.includes(img.sha)) ?? registry.find((k) => near(img.dhash, k.dhash));
}

/** Square, QR-like images (one per report, never a signature). */
export const isSquare = (img: PdfImage) => Math.abs(img.width - img.height) <= Math.max(img.width, img.height) * 0.08;
