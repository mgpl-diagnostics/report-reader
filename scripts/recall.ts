/**
 * npm run recall -- <folder|list.txt> [--signatures known.json]
 * Independent cross-check of the table parser: every numeric value printed in a table's RESULT column
 * (found directly from text positions, without the parser's row logic) must appear as an extracted
 * result of the same report, with the same value and its row's name. Prints aggregate counts only.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { extractReport, readPdf } from "../src/index";
import { headerColumns } from "../src/table";

const input = process.argv[2];
if (!input) throw new Error("usage: recall <folder|list.txt>");
const files = statSync(input).isDirectory()
  ? readdirSync(input).filter((f) => /\.pdf$/i.test(f)).map((f) => join(input, f))
  : readFileSync(input, "utf8").split(/\r?\n/).filter(Boolean).map((f) => join(process.env.REPORTS_DIR ?? dirname(input), f));

let printed = 0, found = 0, wrongName = 0, extracted = 0, unmatchedExtracted = 0;
const missReports = new Set<string>();
for (const f of files) {
  const bytes = new Uint8Array(readFileSync(f));
  const doc = await readPdf(bytes, { images: false });
  const { report } = await extractReport(bytes);
  const params = report.tests.flatMap((t) => t.parameters);
  extracted += params.length;
  const pool = params.map((p) => ({ v: p.value, n: p.name, used: false }));
  for (const page of doc.pages) {
    let cols: ReturnType<typeof headerColumns> = null;
    for (const line of page.lines) {
      const h = headerColumns(line);
      if (h) { cols = h; continue; }
      if (!cols || line.y > page.height * 0.87) continue;
      const res = line.items.filter((i) => Math.abs(i.x - cols!.result) <= 8);
      const name = line.items.filter((i) => i.x < cols!.result - 8).map((i) => i.s).join(" ").trim();
      for (const r of res) {
        if (!/^[<>]?\s*\d+(\.\d+)?\s*[HL*]?$/.test(r.s) || !name || line.items[0]!.x > cols.result) continue;
        printed++;
        const value = r.s.replace(/\s*[HL*]$/, "").trim();
        const hit = pool.find((p) => !p.used && p.v === value && p.n.startsWith(name.slice(0, 12)))
          ?? pool.find((p) => !p.used && p.v === value);
        if (hit) {
          hit.used = true;
          found++;
          if (!hit.n.startsWith(name.slice(0, 12))) wrongName++;
        } else missReports.add(f);
      }
    }
  }
  unmatchedExtracted += pool.filter((p) => !p.used && /^[<>]?\d/.test(p.v)).length;
}
console.log(`printed numeric results: ${printed}`);
console.log(`extracted with same value: ${found} (${((found / printed) * 100).toFixed(2)}%)`);
console.log(`  of which under a different name: ${wrongName}`);
console.log(`reports with a missed value: ${missReports.size} / ${files.length}`);
console.log(`extracted numeric results not seen by the cross-check: ${unmatchedExtracted} (of ${extracted} extracted)`);
