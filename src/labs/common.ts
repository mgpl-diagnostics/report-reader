/** What a lab parser hands back before signatories and accreditation are resolved (see index.ts). */
import type { PdfImage } from "../pdf";
import type { ExtractedReport, LabId } from "../types";

export interface SignatureSighting {
  page: number;
  image?: PdfImage;
  /** printed name / title lines beside the signature (Clinova); Hy Patho prints none */
  nameLine?: string;
  titleLine?: string;
}

export interface LabParse extends Pick<ExtractedReport, "patient" | "sample" | "dates" | "tests" | "warnings"> {
  lab: LabId;
  labName: string;
  processedAt?: string;
  signatures: SignatureSighting[];
}

export const FOOTER_PAGE = /^(?:page\s*)?\d+\s*of\s*\d+$/i;

/**
 * Join a wrapped cell. Comma lists are wrapped mid-word ("Cotrimoxazol" + "e,Nitrofurantoin"), so glue
 * when the continuation starts lower-case and its first token runs into a comma or slash; else a space.
 */
export const joinWrapped = (a: string, b: string) => (/[A-Za-z]$/.test(a) && /^[a-z][^\s,/]*[,/]/.test(b) ? a + b : `${a} ${b}`);
