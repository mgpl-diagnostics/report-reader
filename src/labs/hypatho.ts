/**
 * Hy Patho Lab (lab.hypatholab.in) reports.
 *
 * Page: "PROCESSED AT: HY PATHO LAB / RAIPUR" top right; a three-column header (x≈20 / 240 / 426);
 * a centred test title; a table "TEST DESCRIPTION | RESULT | UNITS | BIO. REF. RANGES [| METHOD]";
 * "Method: X" under each row; narrative notes; "~~End of report~~"; the signature image bottom right on
 * the page where a test ends. A test continues on the next page when no title is printed there.
 * The signer's name is only inside the signature image, so naming needs a KnownSignature registry.
 */
import type { Line, PdfDoc } from "../pdf";
import { cells, headerColumns, makeParameter, METHOD_LINE, type Columns } from "../table";
import { isSquare } from "../registry";
import { emptyReport, field, headerFields, isoDate, parseAge, parseSex, splitTitle, uniq } from "../text";
import type { Parameter, TestSection } from "../types";
import { FOOTER_PAGE, joinWrapped, type LabParse } from "./common";

export const isHypatho = (doc: PdfDoc) =>
  doc.pages.slice(0, 2).some((p) => p.lines.some((l) => /HY\s*PATHO\s*LAB|hypatholab/i.test(l.text)));

const LABELS = [
  /^PT\.?\s*Name\b\s*:?/i,
  /^Patient\s*Name\b\s*:?/i,
  /^Age\b\s*:?/i,
  /^Ref(?:\.|erred)?\s*By(?:\s*Dr\.?)?\s*:?/i,
  /^Registered\s*on\s*:?/i,
  /^Booking\s*Id\s*:?/i,
  /^Received\s*on\s*:?/i,
  /^Barcode\s*Id\s*:?/i,
  /^Reported\s*on\s*:?/i,
  /^SAMPLE\s*COLLECTED\s*AT\s*:?/i,
  /^SAMPLE(?:\s*TYPE)?\s*:?/i,
  /^INV\b\s*:?/i,
];

const END = /~~\s*End\s*of\s*report\s*~~/i;
const NAME_TOL = 3;

export function parseHypatho(doc: PdfDoc): LabParse {
  const out: LabParse = { lab: "hypatho", labName: "Hy Patho Lab", ...emptyReport(), signatures: [] };
  const regs: string[] = [], recs: string[] = [], reps: string[] = [];
  let cur: TestSection | null = null;
  let cols: Columns | null = null;
  let mode: "table" | "notes" = "table";
  let last: (Parameter & { group?: string }) | null = null;
  let group: string | undefined;

  const note = (s: string) => {
    if (cur) cur.notes = cur.notes ? `${cur.notes}\n${s}` : s;
  };

  for (const page of doc.pages) {
    const lines = page.lines.filter((l) => l.y < page.height - 30 && !FOOTER_PAGE.test(l.text));
    const thIdx = lines.findIndex((l) => headerColumns(l));
    const titleIdx = thIdx > 0 && lines[thIdx - 1]!.items[0]!.x > 120 && lines[thIdx - 1]!.y > 195 ? thIdx - 1 : -1;
    const headEnd = titleIdx >= 0 ? titleIdx : thIdx >= 0 ? thIdx : lines.findIndex((l) => l.y > 200);
    const head = lines.slice(0, headEnd < 0 ? lines.length : headEnd);

    // processed-at block, top right
    const pa = head.findIndex((l) => /PROCESSED\s*AT/i.test(l.text));
    if (pa >= 0 && !out.processedAt && lines[pa]!.y < 100) {
      const rest = [lines[pa]!.text.replace(/.*PROCESSED\s*AT\s*:?/i, ""), lines[pa + 1]?.text, lines[pa + 2]?.text];
      out.processedAt = rest.filter((s) => s?.trim() && lines[pa]!.y < 100).map((s) => s!.trim()).filter((s) => !/:\s*$/.test(s)).slice(0, 2).join(", ") || undefined;
    }

    const f = headerFields(head.filter((l) => l.y > 100), [230, 420], LABELS);
    if (!out.patient.name) {
      const { title, name } = splitTitle(field(f, /name/i));
      const ageRaw = field(f, /^age/i);
      const [ageText, sex] = (ageRaw ?? "").split(/\|?\s*Gender\s*:?\s*/i);
      Object.assign(out.patient, { name, title, ...parseAge(ageText), sex: parseSex(sex) });
      out.sample.referredBy = field(f, /^ref/i);
      out.sample.bookingId = field(f, /booking/i);
      out.sample.collectedAt = field(f, /collected/i);
    }
    out.sample.barcodes.push(...(field(f, /barcode/i)?.split(/[,\s]+/) ?? []));
    out.sample.ordered.push(field(f, /^inv/i) ?? "");
    regs.push(isoDate(field(f, /registered/i)) ?? "");
    recs.push(isoDate(field(f, /received/i)) ?? "");
    reps.push(isoDate(field(f, /reported/i)) ?? "");
    const sampleType = f.find((x) => /^sample(\s*type)?$/i.test(x.label))?.value || undefined;

    if (titleIdx >= 0) {
      const raw = lines[titleIdx]!.text;
      const mark = raw.match(/^([*#†]+)\s*/);
      cur = { name: raw.slice(mark?.[0].length ?? 0).trim(), sampleType, parameters: [], pages: [], signedBy: [], ...(mark ? { mark: mark[1] } : {}) };
      out.tests.push(cur);
      mode = "table";
      last = null;
      group = undefined;
    }
    if (thIdx >= 0) cols = headerColumns(lines[thIdx]!);
    const body = thIdx >= 0 ? lines.slice(thIdx + 1) : lines.slice(head.length);
    if (cur && body.length && !cur.pages.includes(page.number)) cur.pages.push(page.number);

    for (let i = 0; i < body.length; i++) {
      const line = body[i]!;
      if (END.test(line.text)) {
        cur = null;
        continue;
      }
      if (!cur) continue;
      if (mode === "notes" || !cols) {
        note(line.text);
        continue;
      }
      const c = cells(line, cols);
      const atName = Math.abs(line.items[0]!.x - cols.name) <= NAME_TOL;
      const onlyName = !c.result && !c.unit && !c.range && !c.method;
      const isRow = (l: Line | undefined) => !!l && Math.abs(l.items[0]!.x - cols!.name) <= NAME_TOL && !!cells(l, cols!).result && !METHOD_LINE.test(cells(l, cols!).name);
      const method = c.name.match(METHOD_LINE);

      if (atName && method) {
        // a method line; may also carry a range continuation in the range column
        if (last) last.method ??= method[1]!.trim();
        if (last && c.range) last.range = last.range ? `${last.range}\n${c.range}` : c.range;
      } else if (atName && c.result) {
        last = { ...makeParameter(c.name, c), ...(group ? { group } : {}) };
        cur.parameters.push(last);
      } else if (!c.name && c.result && !c.unit && !c.range && last && body[i - 1] && line.y - body[i - 1]!.y < 14) {
        last.value = joinWrapped(last.value, c.result); // long text result wrapped onto the next line
      } else if (!c.name && !c.result && (c.range || c.method) && last) {
        if (c.range) last.range = last.range ? `${last.range}\n${c.range}` : c.range;
        if (c.method) last.method = last.method ? `${last.method} ${c.method}` : c.method;
      } else if (atName && onlyName && last && body[i - 1] && line.y - body[i - 1]!.y < 14 && isRow(body[i - 1])) {
        last.name = `${last.name} ${c.name}`; // wrapped name, e.g. "(MCHC)"
      } else if (atName && onlyName && isRow(body.slice(i + 1).find((l) => !METHOD_LINE.test(l.text)))) {
        group = c.name; // sub-heading inside the table
      } else {
        mode = "notes";
        note(line.text);
      }
    }
    for (const img of page.images) {
      const { x, y, w, h } = img.box;
      if (y > page.height * 0.75 && x > page.width * 0.6 && w <= 220 && w / Math.max(h, 1) >= 1.3 && !isSquare(img))
        out.signatures.push({ page: page.number, image: img });
    }
  }

  for (const t of out.tests) if (!t.notes) delete t.notes;
  out.sample.barcodes = uniq(out.sample.barcodes);
  out.sample.ordered = uniq(out.sample.ordered);
  out.sample.sampleIds = [];
  const first = (xs: string[]) => xs.find(Boolean);
  const latest = (xs: string[]) => xs.filter(Boolean).sort().pop();
  out.dates = { registered: first(regs), received: first(recs), reported: latest(reps) };
  return out;
}
