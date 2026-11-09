# Backend integration: importing partner-lab reports

This is the brief for wiring `@mgpl-diagnostics/report-reader` into the `api` repo (GraphQL Yoga on
Fastify), db-kit, auth-kit and report-kit. Read `api/AGENTS.md` and `api/docs/13-adding-a-feature.md`
first. This file covers only what is specific to imported reports.

## Why

MGPL collects samples and sends some of them to partner labs (Hy Patho Lab, Raipur; Clinova Pathlabs,
Secunderabad). Each partner returns a PDF report. Today the results are typed in again by hand. With
this feature, staff upload the partner's PDF, the results fill in automatically, and our report shows
for each test:

- **performed at**: the partner lab, and its city when the report prints it;
- **reported by**: the partner's doctor (name, qualification, registration), with their signature
  taken from that same PDF;
- **NABL**: "Performed at a NABL accredited laboratory (Certificate No. MC-3860)", only on the tests
  the partner marked as accredited.

## What the package gives you

```ts
import { extractReport, labelFor, toPng, UnsupportedReportError, type KnownSignature } from "@mgpl-diagnostics/report-reader";

const { report, images } = await extractReport(pdfBytes, { file: fileName, signatures: knownSignatures });
// report: ExtractedReport (README → "report"); images: Map<signatoryId, { width, height, rgba }>
// labelFor(report, test) → { performedBy, performedAt?, reportedBy[], accreditation?, sourceSha256, text }
```

- Deterministic and fast: about 0.2 s per report, no network, no OCR, no model files.
- Node only (it uses `node:crypto` and `node:zlib`). Add it to `api` like the other kits:
  `"@mgpl-diagnostics/report-reader": "^0.1.0"`, then commit the lockfile.
- Measured on 165 real reports: every printed numeric result was extracted with the right value
  under the right row. See README → "Measured accuracy".

## Non-negotiable rules

1. **NABL belongs to the performing lab, per test.** Show the NABL line only when
   `test.accredited === true`, worded as the partner's accreditation ("performed at a NABL accredited
   laboratory, Certificate No. …"). MGPL is not accredited by this. **Never draw the NABL or ilac
   logo** on our reports: only the lab NABL accredited may use the mark. Hy Patho reports carry no
   marks, so their tests get no NABL line.
2. **A signature only appears with results from its own PDF.** Store each signatory with the
   `sourceSha256` of the PDF it came from. Render a partner signature only on a report whose results
   came from that same PDF. Never let a stored partner signature be picked for another report, and
   never use one as MGPL's own signatory.
3. **"Reported by" means medical signatories only** (`signatory.medical === true`). Lab managers'
   signatures are on the PDF too, but they are not clinical sign-off.
4. **Our staff still verify.** Imported results enter the normal flow (`saveResults` → `verifyReport`),
   unchanged. Import never releases a report on its own.
5. **Patient data.** The original PDF, the extracted JSON and the signature PNGs are patient or
   personal data. Store them privately, tenant-scoped, and never in logs, fixtures or repositories.
   Tests use fictional PDFs; `report-reader`'s `scripts/make-fixtures.ts` shows how to draw one.
6. **Signature registry entries are data, not code.** Doctors' names and signature hashes live in the
   database, entered by an authorised user. Nothing about real partner doctors goes into source.

## Data model (db-kit, both PostgreSQL and MongoDB)

All three are tenant-scoped (`orgId`), audited, and support both adapters (rule 8 of `api/AGENTS.md`).

**`external_reports`**: one row per uploaded PDF.

| field | type | |
| --- | --- | --- |
| id, orgId, branchId | | |
| bookingId | id, nullable | set when matched to a booking |
| lab | `"hypatho" \| "clinova"` | |
| labName, processedAt | string | |
| sourceSha256 | string | **unique per org**: uploading the same PDF twice returns the existing row |
| fileName | string | |
| pdf | bytes, or an object-storage key | original file; private |
| extracted | JSON | the full `ExtractedReport`, stored as is so it can be re-checked later |
| status | `"extracted" \| "matched" \| "applied" \| "rejected"` | |
| warnings | string[] | from the extractor and from booking matching |
| uploadedBy, uploadedAt, appliedBy?, appliedAt? | | |

**`external_signatories`**: the signature registry, one row per partner doctor or signer.

| field | type | |
| --- | --- | --- |
| id, orgId | | |
| lab | LabId | |
| name, qualification, registration, title, role | | as `KnownSignature` |
| sha | string[] | pixel hashes seen for this person |
| dhash | string[] | perceptual hashes |
| createdBy, createdAt, verifiedBy? | | an authorised user names a signature once |

Load the org's rows as `KnownSignature[]` and pass them to `extractReport`. Cache them per org in
Redis through db-kit's cache layer, and clear the cache on write.

**`external_signatures`**: the signature images, one per (sourceSha256, signatory sha).

| field | type | |
| --- | --- | --- |
| orgId, externalReportId, sourceSha256 | | ties the image to its PDF (rule 2) |
| sha, dhash, width, height | | |
| png | bytes | from `toPng(images.get(id))`; private |

## Results provenance

Each `Report` (one per test, in our schema) created from an import also gets a provenance record.
Use a nullable JSON column on the report, or a separate `report_provenance` table:

```ts
interface ResultProvenance {
  externalReportId: string;
  sourceSha256: string;
  lab: "hypatho" | "clinova";
  performedBy: string;          // labelFor(...).performedBy
  performedAt?: string;
  reportedBy: { signatoryId: string; name: string | null; qualification?: string; registration?: string; title?: string; role: string }[];
  accreditation?: { body: "NABL"; certificate?: string; text: string };
  sourceTestName: string;       // the partner's own test name, for audit
  sourceSampleId?: string;
  sourceReportedAt?: string;    // ISO local (IST)
}
```

If staff edit a value after import, keep the provenance and audit the change. The report then shows
"performed at …" as before, and our verifier signs as usual.

## Permissions (auth-kit)

Add these to auth-kit's `PERMISSIONS`. Every permission the api uses must exist there.

- `reports.import`: upload a partner PDF, match it to a booking, and apply it.
- `signatories.manage`: name a partner signature, and edit or remove one.

Both are checked per branch (`authorize(ctx, perm, branchId)`), as everywhere else.

## GraphQL (module `lab` or a new `imports` module)

One endpoint, no REST routes (api rule 1). Files travel as base64, the same way `Document` does.
Cap the input at 15 MB (`limits.ts`).

```graphql
enum ExternalLab { hypatho clinova }
enum ExternalReportStatus { extracted matched applied rejected }

type ExternalReport {
  id: ID!
  lab: ExternalLab!
  labName: String!
  processedAt: String
  sourceSha256: String!
  fileName: String
  status: ExternalReportStatus!
  booking: Booking
  patient: ExternalPatient!          # name, title, ageText, ageYears, sex, patientId
  sample: JSON!                      # bookingId, barcodes, sampleIds, labCode, collectedAt, referredBy, customer, ordered
  dates: JSON!
  tests: [ExternalTest!]!
  signatories: [ExternalSignatory!]!
  accreditation: [ExternalAccreditation!]!
  warnings: [String!]!
  uploadedAt: DateTime!
}

type ExternalTest {
  index: Int!                        # position in extracted.tests
  name: String!
  department: String
  sampleType: String
  sampleId: String
  reported: String
  method: String
  mark: String
  accredited: Boolean
  parameters: [ExternalParameter!]!  # name value unit range method flag group
  notes: String
  signedBy: [ExternalSignatory!]!
  label: String!                     # labelFor(report, test).text
  suggestedTestCode: String          # catalog-kit search(name) top hit, for staff to confirm
}

type ExternalSignatory {
  id: ID!                            # signature sha
  name: String
  qualification: String
  registration: String
  title: String
  role: String!
  medical: Boolean!
  source: String!                    # text | registry | unknown
  signature: Document                # PNG as base64, only for users with reports.import, only for this PDF
}

type ExternalAccreditation { body: String!, certificate: String, evidence: [String!]!, pages: [Int!]! }

extend type Query {
  externalReport(id: ID!): ExternalReport!
  externalReports(bookingId: ID, status: ExternalReportStatus, first: Int = 50, after: String): ExternalReportConnection!
  externalSignatories(lab: ExternalLab): [ExternalSignatoryRecord!]!
}

extend type Mutation {
  # upload → extract → store; returns the existing row if this PDF was uploaded before (sourceSha256)
  importExternalReport(pdfBase64: String!, fileName: String, bookingId: ID): ExternalReport!
  # tie it to a booking when it was not given at upload or was wrong; checks patient name/age/sex and adds warnings on mismatch
  matchExternalReport(id: ID!, bookingId: ID!): ExternalReport!
  # write results into our Reports: one mapping per external test → our catalog test code
  applyExternalReport(id: ID!, mappings: [ExternalTestMapping!]!): [Report!]!
  rejectExternalReport(id: ID!, reason: String!): ExternalReport!
  # name a Hy Patho signature once; re-extracts the org's unnamed imports in the background
  nameExternalSignature(input: ExternalSignatoryInput!): ExternalSignatoryRecord!
}

input ExternalTestMapping { testIndex: Int!, testCode: String!, include: Boolean = true }
input ExternalSignatoryInput { sha: String!, lab: ExternalLab!, name: String!, qualification: String, registration: String, title: String, role: String }
```

Error codes (add, never rename): `UNSUPPORTED_REPORT` (from `UnsupportedReportError`),
`REPORT_ALREADY_APPLIED`, `BOOKING_PATIENT_MISMATCH` (a warning unless staff confirm),
`FILE_TOO_LARGE`.

## Flow

```mermaid
sequenceDiagram
  participant S as Staff (client)
  participant A as api
  participant R as report-reader
  participant D as db-kit
  S->>A: importExternalReport(pdfBase64, bookingId?)
  A->>A: authorize reports.import; size cap; sha256
  A->>D: find external_reports by (orgId, sha256)
  alt new PDF
    A->>D: load external_signatories → KnownSignature[]
    A->>R: extractReport(bytes, { signatures })
    A->>D: store PDF, extracted JSON, signature PNGs (with sourceSha256)
  end
  A-->>S: ExternalReport (tests, labels, warnings, suggested test codes)
  S->>A: matchExternalReport / applyExternalReport(mappings)
  A->>D: createReport + saveResults per mapping, with ResultProvenance
  S->>A: verifyReport (unchanged flow)
```

- **Where extraction runs.** Run it inline for files up to about 5 MB. Larger files go to a job
  (`src/jobs/`, BullMQ or in-process, api rule 12): the payload carries the `externalReportId` and the
  actor, never the file or a token. CPU work stays off the request path for large files.
- **Booking match.** Compare the booking patient with `report.patient` (name case-insensitively and
  without titles, sex, age within ±1 year). Hy Patho's `sample.collectedAt` and Clinova's
  `sample.customer` name our collection centre, which is a useful check. A mismatch is a warning that
  staff must confirm. Never a silent apply.
- **Test mapping.** Suggest `catalog-kit` `search(test.name, { limit: 1 })` and let staff confirm.
  Map each `parameters[].name` to our catalog parameter by search within the chosen test. Keep
  unmatched parameters as entered (`ResultInput` takes a free `parameter` string).
- **Values.** Copy `value`, `unit`, `range`, `flag` as extracted (`ResultInput` matches). Do not
  recompute ranges from our catalog for imported results: the partner's range applies to the
  partner's method.
- **Unnamed signatures.** Hy Patho signatures come back with `name: null` until named.
  `nameExternalSignature` adds the sha and dhash to `external_signatories`. Then re-run extraction
  (from the stored PDF) on that org's imports in status `extracted` or `matched` that contain that sha.

## report-kit: printing provenance

report-kit currently prints one in-house signatory. Add, without breaking existing callers:

```ts
interface ReportTestProvenance {
  performedBy: string;                 // "Clinova Pathlabs"
  performedAt?: string;
  accreditationText?: string;          // only when accredited; text only, no logo
  reportedBy?: { name: string; qualification?: string; registration?: string; title?: string; signatureSrc?: string }[];
}
// on each test in the report request:
provenance?: ReportTestProvenance;
```

- Under each test with provenance, print one small line:
  "Performed at Clinova Pathlabs, Secunderabad · NABL accredited laboratory (MC-3860) · Reported by
  Dr …, MD (…)". Use `labelFor().text`, or build it from the parts.
- Signature block: when every test on a page comes from the same external PDF, print that PDF's
  medical signatory (name, qualification, registration, and the signature image from
  `external_signatures`) next to or instead of the in-house block, as the owner decides. Our own QC
  stamp and verifier stay. When a page mixes sources, print the per-test lines only.
- `signatureSrc` is a data URI the api builds from `external_signatures.png`, after checking rule 2:
  the report's `ResultProvenance.sourceSha256` must equal the signature row's `sourceSha256`.
- Keep the public package free of real signatures, as now: the images come from the api at render time.

## client (`@mgpl-diagnostics/client`)

Mirror the new operations and types (api rule 10): `importExternalReport`, `matchExternalReport`,
`applyExternalReport`, `rejectExternalReport`, `nameExternalSignature`, `externalReport(s)`,
`externalSignatories`. Then bump the client and its ref in `kits.json`.

## Tests (api `test/run.ts`, both databases)

Draw fictional partner PDFs with pdf-lib, using the same coordinates as `report-reader`'s
`scripts/make-fixtures.ts`. Do not copy real reports. Cover:

- import, then re-import (the second returns the same row);
- an unsupported PDF → `UNSUPPORTED_REPORT`;
- a booking mismatch → a warning;
- apply → `Report`s created with provenance, results equal to the extracted ones, and status unchanged
  until `verifyReport`;
- an accredited test gets the NABL label and an unmarked one does not;
- a signature is served only for its own PDF, and another report cannot get it;
- `nameExternalSignature` → re-extraction names the signer;
- permissions: no `reports.import` → forbidden; another org's ids → not found.

## Done when

- [ ] db-kit: the three collections or tables on both adapters, with migrations, released.
- [ ] auth-kit: `reports.import`, `signatories.manage` in `PERMISSIONS`, released.
- [ ] api: schema, controllers, services, job, limits, error codes; `npm run schema`,
      `npm run docs:reference`, `npm run llms`; tests green on PG + Mongo.
- [ ] report-kit: `provenance` on tests, per-test line, external signatory block; smoke-rendered with
      fictional data.
- [ ] client: operations and types; `kits.json` bumped.
- [ ] Docs: a new `api/docs` page for imports, linked from `docs/README.md`.
