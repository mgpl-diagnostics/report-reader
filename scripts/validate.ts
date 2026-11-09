/**
 * npm run validate -- <folder-or-list.txt> [--signatures known.json] [--dump dir]
 * Runs the extractor over real reports and prints AGGREGATE quality stats only (no patient data), so the
 * output can be shared. --dump writes each JSON to a local folder for inspection (keep it git-ignored).
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { extractReport, type KnownSignature } from "../src/index";

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const sigFile = opt("--signatures");
const dump = opt("--dump");
const signatures: KnownSignature[] = sigFile ? JSON.parse(readFileSync(sigFile, "utf8")) : [];
const input = args[0];
if (!input) throw new Error("usage: validate <folder|list.txt> [--signatures f] [--dump dir]");
const files = statSync(input).isDirectory()
  ? readdirSync(input).filter((f) => /\.pdf$/i.test(f)).map((f) => join(input, f))
  : readFileSync(input, "utf8").split(/\r?\n/).filter(Boolean).map((f) => join(process.env.REPORTS_DIR ?? dirname(input), f));
if (dump) mkdirSync(dump, { recursive: true });

const count = new Map<string, number>();
const inc = (k: string, n = 1) => count.set(k, (count.get(k) ?? 0) + n);
const t0 = performance.now();
for (const f of files) {
  try {
    const { report: r } = await extractReport(new Uint8Array(readFileSync(f)), { signatures });
    const L = r.source.lab;
    inc(`${L} reports`);
    inc(`${L} pages`, r.source.pages);
    inc(`${L} tests`, r.tests.length);
    inc(`${L} results`, r.tests.reduce((n, t) => n + t.parameters.length, 0));
    for (const k of ["name", "ageYears", "sex"] as const) if (r.patient[k] !== undefined) inc(`${L} has patient.${k}`);
    for (const k of ["registered", "collected", "received", "reported"] as const) if (r.dates[k]) inc(`${L} has dates.${k}`);
    if (r.dates.reported && !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(r.dates.reported)) inc(`${L} unparsed reported date`);
    if (r.tests.some((t) => t.signedBy.some((id) => r.signatories.find((s) => s.id === id)?.medical))) inc(`${L} has medical signer`);
    if (r.tests.some((t) => !t.signedBy.length)) inc(`${L} reports with an unsigned test`);
    if (r.accreditation.length) inc(`${L} with NABL evidence`);
    for (const t of r.tests) {
      if (!t.parameters.length) inc(`${L} tests without results`);
      if (t.accredited === true) inc(`${L} tests accredited`);
      if (t.accredited === false) inc(`${L} tests not marked`);
      for (const p of t.parameters) {
        if (p.flag) inc(`${L} flagged results`);
        if (!p.unit && /^-?\d/.test(p.value)) inc(`${L} numeric results without unit`);
        if (!p.range) inc(`${L} results without range`);
        if (p.method) inc(`${L} results with method`);
      }
    }
    for (const s of r.signatories) inc(`${L} signer: ${s.name ?? `UNNAMED ${s.id}`} [${s.role}${s.medical ? ", medical" : ""}]`);
    for (const w of r.warnings) inc(`${L} warning: ${w.replace(/\d+/g, "#").replace(/"[^"]*"/g, '"…"').slice(0, 90)}`);
    if (dump) writeFileSync(join(dump, basename(f).replace(/\.pdf$/i, ".json")), JSON.stringify(r, null, 2));
  } catch (e) {
    inc(`FAILED: ${(e as Error).message.slice(0, 80)}`);
  }
}
for (const [k, v] of [...count].sort((a, b) => (a[0] < b[0] ? -1 : 1))) console.log(String(v).padStart(6), k);
console.log(`${files.length} files in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
