/**
 * @mgpl-diagnostics/report-reader — read a partner lab's report PDF into typed JSON.
 *
 *   const { report, images } = await extractReport(pdfBytes, { signatures: knownFromDb });
 *
 * Supported: Hy Patho Lab, Clinova Pathlabs. Uses the PDF's text layer (exact); no OCR.
 */
import { readPdf, type PdfDoc } from "./pdf";
import { accreditationMark, knownSignature } from "./registry";
import { isClinova, parseClinova } from "./labs/clinova";
import { isHypatho, parseHypatho } from "./labs/hypatho";
import type { LabParse } from "./labs/common";
import { isMedical, parseSignatoryText, roleOf } from "./text";
import type { Accreditation, ExtractedReport, ExtractOptions, LabId, Signatory, SignatureImages } from "./types";

export * from "./types";
export { readPdf, toPng, dhash, hamming } from "./pdf";
export type { PdfDoc, PdfPage, PdfImage, Line, TextItem } from "./pdf";
export { ACCREDITATION_MARKS } from "./registry";
export { labelFor, type ProvenanceLabel } from "./label";

export class UnsupportedReportError extends Error {
  constructor(message = "Not a Hy Patho Lab or Clinova Pathlabs report") {
    super(message);
    this.name = "UnsupportedReportError";
  }
}

/** Which lab printed this PDF, or null. */
export function detectLab(doc: PdfDoc): LabId | null {
  if (isHypatho(doc)) return "hypatho";
  if (isClinova(doc)) return "clinova";
  return null;
}

const NABL_TEXT = /\bNABL\b/i;
const CERT = /\b(MC|TC|CC)\s*-\s*?(\d{3,6})\b/;

export async function extractReport(
  data: Uint8Array,
  opts: ExtractOptions = {},
): Promise<{ report: ExtractedReport; images: SignatureImages }> {
  const doc = await readPdf(data, { images: true });
  const lab = detectLab(doc);
  if (!lab) throw new UnsupportedReportError();
  const parsed: LabParse = lab === "hypatho" ? parseHypatho(doc) : parseClinova(doc);
  const warnings = [...parsed.warnings];
  const images: SignatureImages = new Map();

  // signatories, merged across pages by signature fingerprint (or by printed name when there is no image)
  const byId = new Map<string, Signatory>();
  for (const s of parsed.signatures) {
    const known = s.image ? knownSignature(s.image, opts.signatures) : undefined;
    const text = parseSignatoryText(s.nameLine, s.titleLine);
    const id = s.image?.sha ?? `text:${(text.name ?? text.title ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    let sig = byId.get(id);
    if (!sig) {
      const name = text.name ?? known?.name ?? null;
      if (known && text.name && !sameName(known.name, text.name))
        warnings.push(`signature ${id} is registered to "${known.name}" but printed beside "${text.name}"`);
      sig = {
        id,
        name,
        qualification: text.qualification ?? known?.qualification,
        registration: text.registration ?? known?.registration,
        title: text.title ?? known?.title,
        role: known?.role ?? roleOf(text.title, text.qualification, name ?? undefined),
        medical: false,
        signature: s.image
          ? { sha: s.image.sha, dhash: s.image.dhash, width: s.image.width, height: s.image.height }
          : { sha: "", dhash: "", width: 0, height: 0 },
        source: text.name ? "text" : known ? "registry" : "unknown",
        pages: [],
      };
      if (sig.role === "unknown") sig.role = roleOf(sig.title, sig.qualification, sig.name ?? undefined);
      sig.medical = isMedical(sig.name, sig.qualification);
      for (const k of Object.keys(sig) as (keyof Signatory)[]) if (sig[k] === undefined) delete sig[k];
      byId.set(id, sig);
      if (s.image && opts.signatureImages !== false) images.set(id, { width: s.image.width, height: s.image.height, rgba: s.image.rgba });
      if (!sig.name) warnings.push(`unnamed signature ${id} on page ${s.page}: add it to your signature registry`);
    }
    if (!sig.pages.includes(s.page)) sig.pages.push(s.page);
  }
  const signatories = [...byId.values()];

  // accreditation evidence per page: the mark (image) and/or the legend (text)
  const accreditation: Accreditation[] = [];
  const nablPages = new Set<number>();
  for (const page of doc.pages) {
    const evidence: ("logo" | "text")[] = [];
    let certificate: string | undefined;
    const mark = page.images.map(accreditationMark).find(Boolean);
    if (mark) {
      evidence.push("logo");
      certificate = mark.certificate;
    }
    const legend = page.lines.find((l) => NABL_TEXT.test(l.text));
    if (legend) {
      evidence.push("text");
      const c = legend.text.match(CERT);
      if (c) certificate = `${c[1]}-${c[2]}`;
    }
    if (!evidence.length) continue;
    nablPages.add(page.number);
    const a = accreditation.find((x) => x.certificate === certificate);
    if (a) {
      a.pages.push(page.number);
      for (const e of evidence) if (!a.evidence.includes(e)) a.evidence.push(e);
    } else accreditation.push({ body: "NABL", ...(certificate ? { certificate } : {}), evidence, pages: [page.number] });
  }

  for (const t of parsed.tests) {
    t.signedBy = signatories.filter((s) => s.pages.some((p) => t.pages.includes(p))).map((s) => s.id);
    if (nablPages.size) t.accredited = t.pages.length > 0 && t.pages.every((p) => nablPages.has(p));
    if (!t.parameters.length && !t.notes) warnings.push(`test "${t.name}" has no results`);
  }
  if (!parsed.tests.length) warnings.push("no tests found");

  const report: ExtractedReport = {
    source: {
      ...(opts.file ? { file: opts.file } : {}),
      sha256: doc.sha256,
      lab,
      labName: parsed.labName,
      ...(parsed.processedAt ? { processedAt: parsed.processedAt } : {}),
      pages: doc.pages.length,
    },
    patient: clean(parsed.patient),
    sample: clean(parsed.sample),
    dates: clean(parsed.dates),
    tests: parsed.tests,
    signatories,
    accreditation,
    warnings,
  };
  return { report, images };
}

const norm = (s: string) => s.toLowerCase().replace(/^dr\.?\s*/, "").replace(/[^a-z]+/g, " ").trim();
const sameName = (a: string, b: string) => norm(a) === norm(b) || norm(a).includes(norm(b)) || norm(b).includes(norm(a));

function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined || o[k] === "") delete o[k];
  return o;
}
