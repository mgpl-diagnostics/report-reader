/** Output of report-reader: one external lab report, normalised across labs. */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LabId = "hypatho" | "clinova";

export type Flag = "H" | "L" | "";

export interface Parameter {
  name: string;
  /** exactly as printed */
  value: string;
  unit?: string;
  /** reference range as printed, newlines between multi-line ranges */
  range?: string;
  method?: string;
  /** printed flag, else computed from a numeric value and a simple range ("a - b", "< x", "> x") */
  flag: Flag;
}

export interface TestSection {
  /** panel or test name, e.g. "Complete Blood Count (CBC)" */
  name: string;
  department?: string;
  sampleType?: string;
  /** sample / barcode id printed on this section's page (Clinova prints one per sample tube) */
  sampleId?: string;
  /** approval date printed on this section's page, ISO local time (IST) "YYYY-MM-DDTHH:mm" */
  reported?: string;
  /** method printed under the panel name (each parameter also carries its own) */
  method?: string;
  /** symbol printed before the name, e.g. Hy Patho's "*"; its meaning is the lab's */
  mark?: string;
  /** sub-headings seen inside the table, kept in order */
  parameters: (Parameter & { group?: string })[];
  /** narrative under the table (reference notes, interpretation, clinical significance) */
  notes?: string;
  /** pages this section appears on (1-based) */
  pages: number[];
  /** ids of the signatories on those pages */
  signedBy: string[];
  /**
   * Does the page carrying this test show the performing lab's accreditation mark?
   * true: every page of the section carries the NABL mark (logo or legend).
   * false: the report uses NABL marks, but not on this section's pages: do not label it accredited.
   * undefined: the report carries no accreditation marks at all.
   */
  accredited?: boolean;
}

export type SignatoryRole = "pathologist" | "biochemist" | "microbiologist" | "consultant" | "manager" | "unknown";

export interface Signatory {
  /** stable id: the signature's fingerprint */
  id: string;
  name: string | null;
  qualification?: string;
  registration?: string;
  title?: string;
  role: SignatoryRole;
  /** true when a medical consultant (reports are clinically signed by these) */
  medical: boolean;
  signature: {
    /** sha256 of the decoded pixels (16 hex) */
    sha: string;
    /** 64-bit perceptual hash, to recognise re-encoded copies */
    dhash: string;
    width: number;
    height: number;
    /** set by the CLI when it writes the PNG */
    file?: string;
  };
  /** how the name was obtained */
  source: "text" | "registry" | "unknown";
  pages: number[];
}

/**
 * Accreditation of the PERFORMING lab, as evidenced on this report. It describes the lab that ran the
 * tests, never the collection centre; and a certificate covers only the tests in its scope.
 */
export interface Accreditation {
  body: "NABL" | "CAP" | "ISO";
  /** e.g. "MC-3860" */
  certificate?: string;
  /** how we know: the accreditation mark (image) and/or printed text */
  evidence: ("logo" | "text")[];
  /** pages carrying the evidence */
  pages: number[];
}

export interface ExtractedReport {
  source: {
    file?: string;
    /** sha256 of the PDF: a signature may only be shown with results from this exact document */
    sha256: string;
    lab: LabId;
    labName: string;
    processedAt?: string;
    pages: number;
  };
  patient: {
    name?: string;
    title?: string;
    ageText?: string;
    ageYears?: number;
    sex?: "male" | "female" | "other";
    patientId?: string;
  };
  sample: {
    bookingId?: string;
    barcodes: string[];
    sampleIds: string[];
    labCode?: string;
    collectedAt?: string;
    referredBy?: string;
    customer?: string;
    /** what was ordered, as printed (Hy Patho "INV") */
    ordered: string[];
  };
  dates: {
    registered?: string;
    collected?: string;
    received?: string;
    reported?: string;
  };
  tests: TestSection[];
  signatories: Signatory[];
  accreditation: Accreditation[];
  warnings: string[];
}

/**
 * A signature the caller already knows. Hy Patho prints the signer's name only inside the signature
 * image, so naming needs this registry; keep it in your database, not in source control.
 */
export interface KnownSignature {
  /** pixel sha (16 hex) values of this signature */
  sha?: string[];
  /** perceptual hashes; matched within a few bits, so re-encoded copies are recognised */
  dhash?: string[];
  name: string;
  qualification?: string;
  registration?: string;
  title?: string;
  role?: SignatoryRole;
  lab?: LabId;
}

export interface ExtractOptions {
  /** file name, kept in source.file */
  file?: string;
  /** signatures you have named before (see KnownSignature) */
  signatures?: KnownSignature[];
  /** keep signature pixels (RGBA) in the result's `images` map; default true */
  signatureImages?: boolean;
}

/** Signature pixels by signatory id, for rendering or storing as PNG (see toPng). */
export type SignatureImages = Map<string, { width: number; height: number; rgba: Uint8ClampedArray }>;
