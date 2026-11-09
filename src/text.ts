/** Small text helpers shared by the lab parsers: dates, ages, names, signatory lines, header key/values. */
import type { Line } from "./pdf";
import type { ExtractedReport, SignatoryRole } from "./types";

const pad = (n: number | string) => String(n).padStart(2, "0");

/**
 * Printed date-time → ISO local time "YYYY-MM-DDTHH:mm" (reports print Indian time without a zone).
 * Accepts "16-06-2026 06:25 PM", "16/06/2026 18:25", "2026-03-10 18:46". Unparseable → trimmed input.
 */
export function isoDate(raw: string | undefined): string | undefined {
  const s = raw?.replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  let d: string, mo: string, y: string;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(.*)$/);
  if (m) [, y, mo, d] = m as unknown as [string, string, string, string];
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(.*)$/))) [, d, mo, y] = m as unknown as [string, string, string, string];
  else return s;
  const rest = m[4]!.trim();
  const date = `${y}-${pad(mo)}-${pad(d)}`;
  const t = rest.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!t) return rest ? s : date;
  let h = Number(t[1]);
  if (t[3]) h = (h % 12) + (/pm/i.test(t[3]) ? 12 : 0);
  return `${date}T${pad(h)}:${t[2]}`;
}

/** "26 Y", "33 Year(s)", "5 Month(s)", "12 D" → printed text + age in years (2 decimals). */
export function parseAge(raw: string | undefined): { ageText?: string; ageYears?: number } {
  const s = raw?.replace(/\s+/g, " ").trim();
  if (!s) return {};
  let years = 0, found = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(Y(?:ea)?r?s?|Y|M(?:on)?(?:th)?s?|M|D(?:ay)?s?|D|W(?:ee)?k?s?|W)\b(?:\(s\))?/gi)) {
    const n = Number(m[1]), u = m[2]![0]!.toUpperCase();
    years += u === "Y" ? n : u === "M" ? n / 12 : u === "W" ? n / 52 : n / 365;
    found = true;
  }
  return { ageText: s, ageYears: found ? Math.round(years * 100) / 100 : undefined };
}

export function parseSex(raw: string | undefined): "male" | "female" | "other" | undefined {
  const s = raw?.trim().toLowerCase();
  if (!s) return undefined;
  if (/^f/.test(s)) return "female";
  if (/^m/.test(s)) return "male";
  return "other";
}

const TITLES = /^(mrs|mr|ms|miss|master|mast|baby|b\/o|smt|shri|sri|kumari|km|ku|dr)\.?\s+/i;

/** "MRS. DEMO NAME" → { title: "Mrs", name: "DEMO NAME" } */
export function splitTitle(raw: string | undefined): { title?: string; name?: string } {
  const s = raw?.replace(/\s+/g, " ").trim();
  if (!s) return {};
  const m = s.match(TITLES);
  if (!m) return { name: s };
  const t = m[1]!.toLowerCase();
  return { title: t === "b/o" ? "B/O" : t[0]!.toUpperCase() + t.slice(1), name: s.slice(m[0].length).trim() || undefined };
}

/** Medical council registration in a signatory line: "ABMC1234/2020", "XYMC:12345", "DMC Regno:12345". */
export const REGISTRATION = /\(?\b((?:[A-Z]{2,5}MC|[A-Z]MC|RMCR?|MCI|NMC|DMC|KMC|MMC)\b\s*(?:Reg(?:n|d|istration)?\.?\s*(?:No\.?)?)?\s*[:\-.]?\s*-?\s*\d[\d/-]*|(?:[A-Z]{2,5}MC)\d[\d/-]*)\)?/i;

export function roleOf(...texts: (string | undefined)[]): SignatoryRole {
  const t = texts.filter(Boolean).join(" ").toLowerCase();
  if (/patholog|path\b/.test(t)) return "pathologist";
  if (/biochem/.test(t)) return "biochemist";
  if (/microbio/.test(t)) return "microbiologist";
  if (/manager|operations|technical|technologist|incharge|in-charge/.test(t)) return "manager";
  if (/consultant/.test(t)) return "consultant";
  return "unknown";
}

export const isMedical = (name: string | null | undefined, qualification?: string) =>
  /^dr\.?\s/i.test(name ?? "") || /\b(M\.?\s?D|D\.?N\.?B|M\.?B\.?B\.?S|Ph\.?\s?D|DCP|MD\s*PATH)\b/i.test(qualification ?? "");

/**
 * Two printed lines of a signatory ("Dr Demo Name, MD" / "Consultant Pathologist (ABMC1234/2020)")
 * → name, qualification, registration, title.
 */
export function parseSignatoryText(nameLine: string | undefined, titleLine: string | undefined) {
  let name: string | null = nameLine?.trim() || null;
  let qualification: string | undefined;
  let title = titleLine?.trim() || undefined;
  let registration: string | undefined;
  for (const part of [title, name]) {
    const m = part?.match(REGISTRATION);
    if (m) {
      registration = m[1]!.replace(/\s+/g, " ").trim();
      if (part === title) title = title!.replace(m[0], "").replace(/[\s,()]+$/, "").trim() || undefined;
      else name = name!.replace(m[0], "").replace(/[\s,]+$/, "").trim() || null;
      break;
    }
  }
  if (name) {
    const m = name.match(/^(.*?)[,\s]+((?:M\.?\s?D|D\.?N\.?B|M\.?B\.?B\.?S|Ph\.?\s?D|M\.?Sc|B\.?Sc|DCP)\b.*)$/i);
    if (m && m[1]) [name, qualification] = [m[1].trim(), m[2]!.trim()];
  }
  // a title line that is really a qualification ("M.D.,DNB,PATHOLOGY", "MD, Pathology")
  if (title && /^(M\.?\s?D|D\.?N\.?B|M\.?B\.?B\.?S|Ph\.?\s?D)\b/i.test(title)) {
    qualification = qualification ? `${qualification}, ${title}` : title;
    title = undefined;
  }
  if (qualification) qualification = qualification.replace(/\s*,\s*/g, ", ").replace(/,\s*$/, "");
  return { name, qualification, registration, title };
}

export interface HeaderField {
  label: string;
  value: string;
  y: number;
}

/**
 * Key/value pairs from a report header laid out in columns ("PT Name : X   Age : Y   SAMPLE : Z").
 * `splits` are the x positions where a new column starts. A label whose value is not on its own line
 * takes an orphan ": value" printed a few points away in the same column, else the next plain line below.
 */
export function headerFields(lines: Line[], splits: number[], labels: RegExp[]): HeaderField[] {
  type Cell = { col: number; y: number; text: string };
  const cellsOut: Cell[] = [];
  for (const l of lines) {
    const byCol = new Map<number, string[]>();
    for (const it of l.items) {
      const col = splits.filter((s) => it.x >= s - 2).length;
      byCol.set(col, [...(byCol.get(col) ?? []), it.s]);
    }
    for (const [col, parts] of byCol) cellsOut.push({ col, y: l.y, text: parts.join(" ").replace(/\s+/g, " ").trim() });
  }
  const fields: (HeaderField & { col: number })[] = [];
  const orphans: Cell[] = [], plain: Cell[] = [];
  for (const c of cellsOut) {
    const re = labels.find((r) => r.test(c.text));
    if (re) {
      const m = c.text.match(re)!;
      fields.push({ col: c.col, label: m[0].replace(/[\s:]+$/, "").replace(/\s+/g, " "), value: c.text.slice(m[0].length).replace(/^\s*:?\s*/, "").trim(), y: c.y });
    } else if (/^:/.test(c.text)) orphans.push(c);
    else plain.push(c);
  }
  for (const f of fields) {
    if (f.value) continue;
    const near = orphans.filter((o) => o.col === f.col && Math.abs(o.y - f.y) <= 6).sort((a, b) => Math.abs(a.y - f.y) - Math.abs(b.y - f.y))[0];
    if (near) {
      f.value = near.text.replace(/^:\s*/, "");
      orphans.splice(orphans.indexOf(near), 1);
      continue;
    }
    const below = plain.filter((p) => p.col === f.col && p.y > f.y && p.y - f.y <= 13).sort((a, b) => a.y - b.y)[0];
    if (below) {
      f.value = below.text;
      plain.splice(plain.indexOf(below), 1);
    }
  }
  return fields.map(({ label, value, y }) => ({ label, value, y }));
}

/** First value of the field whose label matches. */
export const field = (fields: HeaderField[], re: RegExp) => fields.find((f) => re.test(f.label))?.value || undefined;

export const uniq = <T>(xs: (T | undefined | null | "")[]) => [...new Set(xs.filter((x): x is T => !!x))];

export function emptyReport(): Pick<ExtractedReport, "patient" | "sample" | "dates" | "tests" | "signatories" | "accreditation" | "warnings"> {
  return { patient: {}, sample: { barcodes: [], sampleIds: [], ordered: [] }, dates: {}, tests: [], signatories: [], accreditation: [], warnings: [] };
}
