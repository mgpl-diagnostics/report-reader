# AGENTS.md — @mgpl-diagnostics/report-reader

Reads partner-lab report PDFs (Hy Patho Lab, Clinova Pathlabs) into typed JSON: results, patient and
sample details, dates, signatories with signature images, and NABL evidence per test. Used by the `api`
to import partner results. The backend plan is in [docs/backend-integration.md](docs/backend-integration.md),
and the layout of each lab in [docs/formats.md](docs/formats.md).

## Map

```
src/index.ts          extractReport, detectLab, UnsupportedReportError; resolves signatories + NABL per test
src/pdf.ts            pdfjs text layer → lines with x/y; images with placement, pixels, sha + dHash; toPng
src/table.ts          column split from the table header row, H/L flags, METHOD_LINE
src/text.ts           dates (→ ISO IST), ages, titles, signatory text, header key/value columns
src/registry.ts       accreditation marks (NABL/ilac artwork), signature lookup (caller's registry)
src/label.ts          labelFor(report, test): "Performed at … · Reported by …" (+ NABL only when marked)
src/labs/hypatho.ts   Hy Patho parser
src/labs/clinova.ts   Clinova parser
src/cli.ts            report-reader <pdf…> → JSON + signature PNGs (default out: private/, git-ignored)
src/types.ts          output model
scripts/make-fixtures.ts  fictional reports in both layouts (test/fixtures/, git-ignored)
scripts/validate.ts   aggregate stats over real reports (local only, prints no patient data)
scripts/recall.ts     value-level cross-check over real reports (local only)
test/extract.test.ts  node:test on the fictional fixtures
```

## Rules

1. **Never commit real reports, extracted JSON, signature images, or anything derived from them.**
   `private/`, `*.pdf` and `test/fixtures/` are git-ignored. Fixtures are fictional and drawn by
   `scripts/make-fixtures.ts`. Validation output must stay aggregate (counts, not names or values).
2. **No real people in source.** Partner doctors' names, registration numbers and signature hashes are
   data the caller passes in (`ExtractOptions.signatures`), kept in the api database. Accreditation
   artwork hashes (`ACCREDITATION_MARKS`) are fine: they are logos, not people.
3. **NABL belongs to the performing lab, per test.** `accredited` is true only when the test's pages
   carry the partner's mark. Never word anything as MGPL's own accreditation. Never suggest printing
   the NABL logo on our reports.
4. **A signature belongs to its source PDF** (`source.sha256`). APIs here must never hand out a
   signature apart from the report it came from.
5. **Values are as printed.** Do not normalise or convert result values or units. Flags are the
   printed ones, else computed only from simple numeric ranges.
6. **Parser changes need real-report checks.** Before merging a change to `src/labs/*` or `src/table.ts`,
   the owner runs `npm run validate` and `npm run recall` on the local real reports. Recall must stay
   at 100%, and the README numbers must be updated if they change. CI runs only the fictional tests.
7. **No OCR.** Supported PDFs have a text layer. A PDF without one is rejected (`UnsupportedReportError`)
   rather than guessed at.
8. Node ≥ 20, ESM, strict TypeScript. The only runtime dependency is `pdfjs-dist`, pinned exactly
   (its legacy build is what runs in Node).

## Commands

```bash
npm install
npm run typecheck && npm test && npm run build
npm run validate -- <folder> [--signatures known.json]
npm run recall -- <folder>
npm run llms          # regenerate llms-full.txt (CI checks it)
```

## Repository rules

`main` takes pull requests only: squash merge, 1 code-owner review (`@BackStacked`), the `ci` check
required. Rules come from `mgpl-diagnostics/.github` (`scripts/protect-repos.mjs`). Releases: bump
`package.json`, tag `vX.Y.Z`, and the publish workflow pushes to GitHub Packages.

## Licence

All rights reserved (see LICENSE).
