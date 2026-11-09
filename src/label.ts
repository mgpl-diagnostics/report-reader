/**
 * Provenance label for one test, for printing on our own report design: which lab performed it, which
 * doctor reported it, and whether the performing lab's NABL mark applies to it.
 *
 * Rules this function enforces (see AGENTS.md):
 * - Accreditation belongs to the PERFORMING lab and only to tests its report marks; never to MGPL.
 * - Only medical signatories (pathologist / biochemist / microbiologist consultants) are "reported by".
 * - A signature image may only be shown next to results from the same source PDF (sourceSha256).
 */
import type { ExtractedReport, Signatory, TestSection } from "./types";

export interface ProvenanceLabel {
  performedBy: string;
  performedAt?: string;
  reportedBy: Pick<Signatory, "id" | "name" | "qualification" | "registration" | "title" | "role">[];
  /** present only when the report marks this test with the performing lab's NABL mark */
  accreditation?: { body: "NABL"; certificate?: string; text: string };
  /** the PDF these results and signatures came from */
  sourceSha256: string;
  /** one line, e.g. "Performed at Clinova Pathlabs (NABL accredited, MC-3860) · Reported by Dr X, MD" */
  text: string;
}

export function labelFor(report: ExtractedReport, test: TestSection): ProvenanceLabel {
  const signers = report.signatories.filter((s) => test.signedBy.includes(s.id));
  const medical = signers.filter((s) => s.medical);
  const reportedBy = medical.map(({ id, name, qualification, registration, title, role }) => ({ id, name, qualification, registration, title, role }));
  const cert = test.accredited ? report.accreditation.find((a) => a.pages.some((p) => test.pages.includes(p))) : undefined;
  const accreditation = test.accredited
    ? {
        body: "NABL" as const,
        certificate: cert?.certificate,
        text: `Performed at a NABL accredited laboratory${cert?.certificate ? ` (Certificate No. ${cert.certificate})` : ""}`,
      }
    : undefined;
  const who = reportedBy
    .filter((r) => r.name)
    .map((r) => [r.name, r.qualification].filter(Boolean).join(", ") + (r.registration ? ` (${r.registration})` : ""))
    .join("; ");
  const text = [
    `Performed at ${report.source.labName}${accreditation ? ` (NABL accredited${cert?.certificate ? `, ${cert.certificate}` : ""})` : ""}`,
    who && `Reported by ${who}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    performedBy: report.source.labName,
    ...(report.source.processedAt ? { performedAt: report.source.processedAt } : {}),
    reportedBy,
    ...(accreditation ? { accreditation } : {}),
    sourceSha256: report.source.sha256,
    text,
  };
}
