/**
 * Clinova Pathlabs reports ("LABORATORY TEST REPORT", lab code CPL-…).
 *
 * Page: header with patient fields left (x≈30) and dates right (x≈347, ":" at 461); a centred department
 * ("CLINICAL BIOCHEMISTRY"); a table "Test Description | Result | Units | Biological Reference Ranges";
 * panels ("LIPID PROFILE") or single-test rows; "(Method: X)" under rows and panel names; multi-line
 * ranges in the range column; interpretation images between tests; "--End of Report--".
 * Bottom: signatories, left (x≈30) and right (x≈404), each a signature image above a name line and a
 * title line. Accredited pages carry the ilac-MRA/NABL mark and the legend
 * "Tests marked with NABL symbol are accredited by NABL vide Certificate No.MC-3860".
 * Each page header prints its own Sample ID, Sample Type and Approved Date.
 */
import type { Line, PdfDoc, PdfImage } from "../pdf";
import { accreditationMark, isSquare } from "../registry";
import { cells, headerColumns, makeParameter, METHOD_LINE, type Columns } from "../table";
import { emptyReport, field, headerFields, isoDate, parseAge, parseSex, splitTitle, uniq } from "../text";
import type { Parameter, TestSection } from "../types";
import { FOOTER_PAGE, joinWrapped, type LabParse } from "./common";

export const isClinova = (doc: PdfDoc) =>
  doc.pages.slice(0, 2).some((p) => p.lines.some((l) => /clinova|\bCPL-[A-Z]{2}-\d+/i.test(l.text)));

const LABELS = [
  /^Patient\s*Name\b\s*:?/i,
  /^Age\b\s*:?/i,
  /^Sample\s*ID\b\s*:?/i,
  /^Sample\s*Type\b\s*:?/i,
  /^Patient\s*ID\b\s*:?/i,
  /^Ref\.?\s*Doctor\b\s*:?/i,
  /^Ref\.?\s*Customer\b\s*:?/i,
  /^Lab\s*Code\b\s*:?/i,
  /^Sample\s*Collection\s*Date\b\s*:?/i,
  /^Registration\s*Date\b\s*:?/i,
  /^(?:Approved|Reported|Authori[sz]ed)\s*Date\b\s*:?/i,
];

const END = /-{2,}\s*End\s*of\s*Report\s*-{2,}/i;
const BOILERPLATE = /^(this is an electronically|note\s*:|tests marked with|processed at|page \d+ of)/i;

export function parseClinova(doc: PdfDoc): LabParse {
  const out: LabParse = { lab: "clinova", labName: "Clinova Pathlabs", ...emptyReport(), signatures: [] };
  const colls: string[] = [], regs: string[] = [], apprs: string[] = [];
  let panel: TestSection | null = null; // open panel: later rows join it
  let cur: TestSection | null = null; // last section, for methods / ranges / notes
  let last: (Parameter & { group?: string }) | null = null;
  let group: string | undefined, groupMethod: string | undefined;
  const inherited = new WeakSet<Parameter>(); // method taken from the group / panel, replaced by the row's own
  let prevSampleId: string | undefined;

  for (const page of doc.pages) {
    const sigTop = page.height * 0.88;
    const all = page.lines.filter((l) => !FOOTER_PAGE.test(l.text));
    for (const l of all) {
      const m = l.text.match(/Processed\s*at\s*:\s*(.+)$/i);
      if (m && !out.processedAt) out.processedAt = m[1]!.trim();
    }
    let thIdx = all.findIndex((l) => l.y < sigTop && headerColumns(l));
    let cols: Columns | null = thIdx >= 0 ? headerColumns(all[thIdx]!) : null;
    let deptLine = thIdx > 0 && all[thIdx - 1]!.items[0]!.x > 150 ? all[thIdx - 1] : undefined;
    if (thIdx < 0) {
      // no column header (e.g. culture reports): the centred department line starts the body
      const d = all.findIndex((l) => l.y > 200 && l.y < sigTop && l.items.length === 1 && l.items[0]!.x > 150 && !/[a-z]/.test(l.text));
      if (d >= 0) {
        deptLine = all[d];
        thIdx = d; // body starts after it
        cols = { name: 32, result: 300 };
      }
    }
    const headLines = all.slice(0, deptLine ? all.indexOf(deptLine) : thIdx >= 0 ? thIdx : 0).filter((l) => l.y > 100);

    const f = headerFields(headLines, [340], LABELS);
    if (!out.patient.name) {
      const { title, name } = splitTitle(field(f, /patient\s*name/i));
      const ageRaw = field(f, /^age/i);
      const [ageText, sex] = (ageRaw ?? "").split(/\s*Gender\s*:?\s*/i);
      Object.assign(out.patient, { name, title, ...parseAge(ageText), sex: parseSex(sex), patientId: field(f, /patient\s*id/i) });
      out.sample.labCode = field(f, /lab\s*code/i);
      out.sample.referredBy = field(f, /doctor/i);
      out.sample.customer = field(f, /customer/i);
    }
    const sampleId = field(f, /sample\s*id/i);
    const sampleType = field(f, /sample\s*type/i);
    const reported = isoDate(field(f, /approved|reported|authori/i));
    out.sample.sampleIds.push(sampleId ?? "");
    colls.push(isoDate(field(f, /collection/i)) ?? "");
    regs.push(isoDate(field(f, /registration/i)) ?? "");
    apprs.push(reported ?? "");
    const department = deptLine?.text;

    // signatories: name + title lines per column, the signature image just above
    const sigLines = all.filter((l) => l.y >= sigTop && l.y < page.height - 45 && !BOILERPLATE.test(l.text));
    const columns = new Map<"left" | "right", Line["items"]>();
    for (const l of sigLines) for (const it of l.items) {
      const k = it.x < page.width / 2 ? "left" : "right";
      columns.set(k, [...(columns.get(k) ?? []), it]);
    }
    const sigImages = page.images.filter(
      (im) => im.box.y > page.height * 0.82 && im.box.w <= 200 && !isSquare(im) && !accreditationMark(im),
    );
    const used = new Set<PdfImage>();
    for (const items of columns.values()) {
      const rows: { y: number; s: string }[] = [];
      for (const it of items.sort((a, b) => a.y - b.y || a.x - b.x)) {
        const row = rows[rows.length - 1];
        if (row && Math.abs(row.y - it.y) <= 2.5) row.s += ` ${it.s}`;
        else rows.push({ y: it.y, s: it.s });
      }
      const x0 = Math.min(...items.map((i) => i.x));
      const image = sigImages.find((im) => !used.has(im) && Math.abs(im.box.x - x0) <= 40);
      if (image) used.add(image);
      const [a, b] = rows.map((r) => r.s.replace(/\s+/g, " ").trim());
      out.signatures.push(
        b !== undefined
          ? { page: page.number, image, nameLine: a, titleLine: b }
          : /^dr\.?\s/i.test(a ?? "") ? { page: page.number, image, nameLine: a } : { page: page.number, image, titleLine: a },
      );
    }

    if (!cols) continue;
    const bodyEnd = all.findIndex((l, i) => i > thIdx && l.y >= sigTop);
    const body = all.slice(thIdx + 1, bodyEnd < 0 ? undefined : bodyEnd).filter((l) => !BOILERPLATE.test(l.text));
    const breaks = page.images.filter((im) => im.box.w > 250 && im.box.y > all[thIdx]!.y && im.box.y < sigTop).map((im) => im.box.y);
    const paramX = cols.name + 4;
    const cellOf = (l: Line) => cells(l, cols);
    const isRow = (l: Line | undefined) => {
      if (!l || l.items[0]!.x < paramX) return false;
      const c = cellOf(l);
      return !!c.result && !!c.name && !METHOD_LINE.test(c.name);
    };
    const isMethod = (l: Line) => {
      const c = cellOf(l);
      return !c.result && METHOD_LINE.test(c.name);
    };
    const sameSample = !!sampleId && sampleId === prevSampleId;
    if (!sameSample) panel = null;
    prevSampleId = sampleId;

    let prevKind: "row" | "heading" | "group" | "other" = "other";
    let prevY = all[thIdx]!.y;
    let firstRow = true;
    const touch = (s: TestSection) => {
      if (!s.pages.includes(page.number)) s.pages.push(page.number);
    };
    const newSection = (name: string): TestSection => {
      const s: TestSection = { name, department, sampleType, sampleId, reported, parameters: [], pages: [page.number], signedBy: [] };
      Object.keys(s).forEach((k) => (s as unknown as Record<string, unknown>)[k] === undefined && delete (s as unknown as Record<string, unknown>)[k]);
      out.tests.push(s);
      return s;
    };

    for (let i = 0; i < body.length; i++) {
      const line = body[i]!;
      if (breaks.some((y) => y > prevY && y < line.y)) panel = null; // interpretation image ends a panel
      const lastY = prevY;
      prevY = line.y;
      if (END.test(line.text)) {
        panel = cur = null;
        last = null;
        continue;
      }
      const c = cellOf(line);
      if (isMethod(line)) {
        const m = c.name.match(METHOD_LINE)![1]!.trim();
        if (prevKind === "row" && last && (!last.method || inherited.has(last))) {
          last.method = m;
          inherited.delete(last);
        }
        else if (prevKind === "group") groupMethod = m;
        else if (prevKind === "heading" && panel) panel.method = m;
        if (c.range && last) last.range = last.range ? `${last.range}\n${c.range}` : c.range;
        continue;
      }
      if (isRow(line)) {
        if (!panel) group = groupMethod = undefined; // a standalone test row is never in a group
        const p: Parameter & { group?: string } = { ...makeParameter(c.name, c), ...(group ? { group } : {}) };
        const fallback = groupMethod ?? (panel ? panel.method : undefined);
        if (!p.method && fallback) {
          p.method = fallback;
          inherited.add(p);
        }
        if (panel) {
          panel.parameters.push(p);
          touch(panel);
          cur = panel;
        } else {
          cur = newSection(c.name);
          cur.parameters.push(p);
        }
        last = p;
        prevKind = "row";
        firstRow = false;
        continue;
      }
      if (!c.name && !c.result && c.range && last) {
        last.range = last.range ? `${last.range}\n${c.range}` : c.range;
        continue;
      }
      if (!c.name && c.result && !c.unit && !c.range && last && prevKind === "row") {
        last.value = joinWrapped(last.value, c.result); // a long text result wrapped onto the next line
        continue;
      }
      const next = body.slice(i + 1).find((l) => !isMethod(l));
      // a heading is short, does not end a sentence, and is not the tail of a paragraph just above
      const paragraphTail = prevKind === "other" && line.y - lastY <= 13.5 && line.items[0]!.x < paramX;
      const onlyName = !c.result && !c.unit && !c.range && line.text.length <= 80 && !/[.:;]$/.test(c.name) && !paragraphTail;
      if (onlyName && !isRow(next)) {
        // stacked headings: panel title (maybe wrapped) [+ method], then a group heading, then rows
        const chain: Line[] = [line];
        let j = i + 1;
        for (; j < body.length; j++) {
          const l = body[j]!;
          if (isMethod(l)) continue;
          const lc = cellOf(l);
          if (lc.result || lc.unit || lc.range || l.text.length > 80) break;
          chain.push(l);
        }
        if (chain.length >= 2 && isRow(body[j])) {
          const titleLines = chain.slice(0, -1);
          const opened = newSection(titleLines.map((l) => cellOf(l).name).join(" ").replace(/\s+/g, " ").trim());
          panel = cur = opened;
          group = groupMethod = undefined;
          for (let k = i + 1; k < body.indexOf(chain[chain.length - 1]!); k++)
            if (isMethod(body[k]!)) opened.method = cellOf(body[k]!).name.match(METHOD_LINE)![1]!.trim();
          i = body.indexOf(chain[chain.length - 1]!) - 1; // the group heading is handled next
          prevKind = "heading";
          firstRow = false;
          continue;
        }
      }
      if (onlyName && isRow(next)) {
        // a heading opens a new panel, except right under a panel title or mid-page inside a panel (a group)
        const justOpened = !!panel && !panel.parameters.length && prevKind === "heading";
        if (panel && (justOpened || (panel.parameters.length && !firstRow))) {
          group = c.name;
          groupMethod = undefined;
          prevKind = "group";
          touch(panel);
        } else {
          panel = cur = newSection(c.name);
          group = groupMethod = undefined;
          prevKind = "heading";
        }
        firstRow = false;
        continue;
      }
      // narrative: belongs to the last test, and ends an open panel
      panel = null;
      group = groupMethod = undefined;
      if (cur) {
        cur.notes = cur.notes ? `${cur.notes}\n${line.text}` : line.text;
        touch(cur);
      }
      prevKind = "other";
    }
    if (breaks.some((y) => y > prevY)) panel = null; // an interpretation image after the last row ends the panel too
  }

  out.sample.sampleIds = uniq(out.sample.sampleIds);
  const first = (xs: string[]) => xs.find(Boolean);
  out.dates = { collected: first(colls), registered: first(regs), reported: apprs.filter(Boolean).sort().pop() };
  return out;
}
