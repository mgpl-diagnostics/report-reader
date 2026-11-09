# @mgpl-diagnostics/report-reader

Reads report PDFs from our partner labs (**Hy Patho Lab** and **Clinova Pathlabs**) and turns them into
typed JSON:

- every result: the value as printed, unit, reference range (multi-line ranges kept), method, and an H/L flag;
- patient, sample and booking details, plus registered, collected, received and reported dates;
- the signatories: name, qualification, registration number, role, and the **signature image** with its fingerprint;
- **NABL accreditation evidence** per page, so each test knows whether the performing lab marked it accredited.

From this our own report design can say, for every test, **who performed it** (Clinova or Hy Patho),
**who reported it** (which pathologist), and whether it was **done in a NABL-accredited lab**.

```ts
import { extractReport, labelFor } from "@mgpl-diagnostics/report-reader";

const { report, images } = await extractReport(pdfBytes, { signatures: knownSignaturesFromDb });
for (const test of report.tests) {
  console.log(test.name, test.parameters.length, labelFor(report, test).text);
  // "LIPID PROFILE 7 Performed at Clinova Pathlabs (NABL accredited, MC-…) · Reported by Dr …, MD (…)"
}
```

## No OCR needed, so values are exact

These PDFs come out of the labs' software with a real text layer. The reader takes each character from
the PDF itself, at its position, so values are never misread as they can be with OCR (`0` vs `O`,
`1` vs `l`, a dropped decimal point). The work is in the layout: matching each value to the right row
and column. Signatures are images; they are identified by fingerprint, not read.

A scanned paper report (a photo, with no text layer) is **not** supported and is rejected as unsupported.

### Measured accuracy

Run on 165 real reports (136 Hy Patho Lab, 29 Clinova; 576 pages). The reports stay on the lab's own
machine; the numbers come from `npm run validate` and `npm run recall`:

| Check | Hy Patho | Clinova |
| --- | --- | --- |
| reports read without error | 136 / 136 | 29 / 29 |
| numeric results printed in the result column and extracted with the same value and row name | 3,389 / 3,389 | 499 / 499 |
| reports with patient name, age, sex and all dates | 136 / 136 | 29 / 29 |
| reports with a named medical signatory | 136 / 136 ¹ | 29 / 29 |
| time per report (average) | ~0.17 s | ~0.25 s |

¹ Hy Patho prints the doctor's name only inside the signature image, so each new signature has to be
named once in the signature registry (see below). Until then it comes back as `name: null` with its
image and a warning.

The recall check finds result values directly from text positions, without the parser's row logic, and
confirms each one appears among the extracted results. Units, ranges, methods and test grouping were
reviewed by hand on a sample. If a lab changes its report template, run both scripts again.

## Install

GitHub Packages, scope `@mgpl-diagnostics`:

```bash
npm install @mgpl-diagnostics/report-reader
```

Node 20 or newer. The only runtime dependency is `pdfjs-dist`.

## API

### `extractReport(pdf: Uint8Array, options?) → { report, images }`

| option | |
| --- | --- |
| `file` | file name, kept in `report.source.file` |
| `signatures` | `KnownSignature[]`: signatures you have named before (see below) |
| `signatureImages` | keep signature pixels in `images` (default `true`) |

Throws `UnsupportedReportError` for any PDF that is not from a supported lab.

`images` maps a signatory id to `{ width, height, rgba }`; `toPng(image)` turns it into PNG bytes.

### `report` (`ExtractedReport`)

```
source        { file?, sha256, lab: "hypatho" | "clinova", labName, processedAt?, pages }
patient       { name?, title?, ageText?, ageYears?, sex?, patientId? }
sample        { bookingId?, barcodes[], sampleIds[], labCode?, collectedAt?, referredBy?, customer?, ordered[] }
dates         { registered?, collected?, received?, reported? }   ISO local time (IST) "YYYY-MM-DDTHH:mm"
tests[]       { name, department?, sampleType?, sampleId?, reported?, method?, mark?,
                parameters[]: { name, value, unit?, range?, method?, flag: "H" | "L" | "", group? },
                notes?, pages[], signedBy[] (signatory ids), accredited? }
signatories[] { id, name | null, qualification?, registration?, title?, role, medical,
                signature { sha, dhash, width, height }, source: "text" | "registry" | "unknown", pages[] }
accreditation[] { body: "NABL", certificate?, evidence: ("logo" | "text")[], pages[] }
warnings[]    things a person should look at (an unnamed signature, a test without results…)
```

- `value` is exactly as printed (`"7.3"`, `">2000.00"`, `"Negative"`). `flag` is the lab's printed flag,
  or else computed from a numeric value and a simple range (`a - b`, `< x`, `<= x`, `> x`, `Up to x`).
  Interpretive ranges such as "<200 Desirable" get no computed flag.
- `accredited`: `true` when every page of the test carries the performing lab's NABL mark or legend;
  `false` when the report uses NABL marks but not on this test's pages; absent when the report has no
  NABL marks at all (Hy Patho reports carry none).
- `role` is one of `pathologist | biochemist | microbiologist | consultant | manager | unknown`, and
  `medical` is true for doctors (`Dr …`, MD, DNB…). Only medical signatories count as "reported by".

### `labelFor(report, test) → ProvenanceLabel`

The line to print beside a test on our own report, plus its parts:
`{ performedBy, performedAt?, reportedBy[], accreditation?, sourceSha256, text }`.

### Signature registry (`KnownSignature`)

```ts
{ name, qualification?, registration?, title?, role?, lab?, sha?: string[], dhash?: string[] }
```

Matched by exact pixel hash first, then by perceptual hash (a few bits apart), so re-encoded copies
still match. **Keep the registry in your database, not in source control.** This package ships no
names or signatures of real people.

Clinova prints names and titles under each signature, so Clinova signatories are named from the text.
If a registered signature appears beside a different printed name, a warning is added.

## Rules for using the output

1. **Accreditation belongs to the performing lab, and only to tests it marks.** Say "performed at a NABL
   accredited laboratory (Certificate No. …)" next to those tests only. Never present it as our own
   accreditation, and never print the NABL logo on our reports. NABL does not allow its mark to be
   used by a lab it has not accredited.
2. **A signature belongs to its source PDF.** Show a partner doctor's signature only next to results
   extracted from the same PDF (`source.sha256`), never on other reports.
3. **Patient data.** Extracted reports and signature images are patient and personal data. Store them
   privately, never in a repository, never in logs.

## CLI

```bash
npx report-reader report.pdf [more.pdf …] [--out private/extracted] [--signatures known.json]
```

Writes `<name>.json` and `signatures/<id>.png`. The default output folder is git-ignored.

## Development

```bash
npm install
npm run typecheck
npm test            # generates fictional fixtures (scripts/make-fixtures.ts), then runs test/
npm run build
npm run validate -- <folder-of-real-pdfs> [--signatures known.json]   # aggregate stats only
npm run recall -- <folder-of-real-pdfs>                               # value-level cross-check
npm run llms        # refresh llms-full.txt
```

Real reports never enter this repository. Tests use fictional reports drawn in the same layouts.
Layout notes for each lab are in [docs/formats.md](docs/formats.md), and the backend plan is in
[docs/backend-integration.md](docs/backend-integration.md).

## Licence

All rights reserved. See [LICENSE](LICENSE).
