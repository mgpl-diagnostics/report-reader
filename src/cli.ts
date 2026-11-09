#!/usr/bin/env node
/**
 * report-reader <report.pdf …> [--out dir] [--signatures known.json]
 * Writes <out>/<name>.json and <out>/signatures/<id>.png for each report. Default out: ./private/extracted
 * (git-ignored: extracted reports contain patient data and real signatures).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { extractReport, toPng, type KnownSignature } from "./index";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const out = opt("--out") ?? "private/extracted";
const sigFile = opt("--signatures");
const signatures: KnownSignature[] = sigFile ? JSON.parse(readFileSync(sigFile, "utf8")) : [];
if (!args.length || args.includes("--help")) {
  console.log("usage: report-reader <report.pdf …> [--out dir] [--signatures known.json]");
  process.exit(args.length ? 0 : 1);
}

mkdirSync(join(out, "signatures"), { recursive: true });
let failed = 0;
for (const file of args) {
  try {
    const { report, images } = await extractReport(new Uint8Array(readFileSync(file)), { file: basename(file), signatures });
    for (const s of report.signatories) {
      const img = images.get(s.id);
      if (!img) continue;
      s.signature.file = join("signatures", `${s.id}.png`).split("\\").join("/");
      writeFileSync(join(out, s.signature.file), toPng(img));
    }
    const name = basename(file).replace(/\.pdf$/i, "");
    writeFileSync(join(out, `${name}.json`), JSON.stringify(report, null, 2));
    const params = report.tests.reduce((n, t) => n + t.parameters.length, 0);
    console.log(`${basename(file)}: ${report.source.lab}, ${report.tests.length} tests, ${params} results, ${report.signatories.length} signatories${report.warnings.length ? `, ${report.warnings.length} warnings` : ""}`);
  } catch (e) {
    failed++;
    console.error(`${basename(file)}: ${(e as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
