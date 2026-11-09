# Report formats

How each supported lab lays out its PDF, as the parsers rely on it. Coordinates are PDF points on an A4
page (595 × 842), `y` measured from the top. Everything was observed on real reports; read this before
changing a parser, and re-run `npm run validate` and `npm run recall` on real reports after.

## Hy Patho Lab (`src/labs/hypatho.ts`)

Detected by "HY PATHO LAB" or "hypatholab" in the text.

| Region | Where | Content |
| --- | --- | --- |
| Processed-at block | top right, x≈472, y 39–61 | "PROCESSED AT:" / "HY PATHO LAB" / city |
| Header | y 148–187, three columns starting x≈20 / 240 / 426 | `PT Name`, `Age : 26 Y \| Gender : FEMALE`, `Ref By Dr`, `Registered on`, `Booking Id`, `Received on`, `Barcode Id`, `Reported on`, `SAMPLE COLLECTED AT :`, `SAMPLE`, `INV` |
| Test title | centred, y≈216, only on the page where a test starts | e.g. "LIVER FUNCTION TESTS"; may start with "*" (kept as `mark`) |
| Table header | y≈243 (≈211 on continuation pages) | `TEST DESCRIPTION \| RESULT \| UNITS \| BIO. REF. RANGES [\| METHOD]` |
| Rows | name x≈20, result ≈246, unit ≈290–330, range ≈346–415 | one row per parameter, then `Method: X` at x≈20 |
| Notes | x≈25 | reference tables, interpretation, clinical significance |
| End | centred | `~~End of report~~` closes the test |
| Signature | image bottom right, x≈430, y≈720–750, about 120 × 74 | on the page where a test ends |
| Footer | y≈815 | `1 of 8` |

Quirks:

- `Reported on` prints its value on a separate text line about 3 pt **above** the label. The header
  parser attaches such an orphan `: value` to the label without a value in the same column.
- `SAMPLE COLLECTED AT :` has its value on the next line in the same column.
- Long names wrap onto a second line about 11 pt below (e.g. "(MCHC)"). A row normally comes about
  27 pt after the previous one.
- A test that continues on the next page has no title there. A `Method:` line at the top of the new page
  belongs to the last row of the previous page.
- Each page header has its own `SAMPLE` (EDTA, SERUM…), which becomes the test's `sampleType`.
- **The signer's name is only inside the signature image.** Naming needs the signature registry.
- No accreditation marks are printed.

## Clinova Pathlabs (`src/labs/clinova.ts`)

Detected by "Clinova" or a lab code like `CPL-XX-000`.

| Region | Where | Content |
| --- | --- | --- |
| Title | centred, y≈96 (newer reports) | "LABORATORY TEST REPORT" |
| Header, left | labels x≈30, values x≈94–128 | `Patient Name`, `Age : 33 Year(s) Gender : Female`, `Sample ID`, `Sample Type`, `Patient ID`, `Ref. Doctor`, `Ref. Customer` |
| Header, right | labels x≈344, ":" x≈461, values x≈470 | `Lab Code`, `Sample Collection Date`, `Registration Date`, `Approved Date` (printed as two items) |
| Department | centred, just above the table header | "CLINICAL BIOCHEMISTRY", "HEMATOLOGY", "CLINICAL MICROBIOLOGY"… |
| Table header | | `Test Description \| Result \| Units \| Biological Reference Ranges` (x 32 / 310 / 372 / 414) |
| Rows | names x≈38–43, result 310, unit 369, range 426 | `(Method: X)` under a row or under a panel title |
| Interpretation | images x≈36, wide | between tests; they also end a panel |
| Notes | x≈33 | paragraphs, word-spaced across the width |
| End | centred | `--End of Report--` |
| Signatories | name y≈769, title y≈784; left x≈30, right x≈404 | signature image just above each (y≈727–736, about 116–134 × 21–22) |
| Accreditation | top centre (x≈286) or footer centre (x≈191) | ilac-MRA + NABL mark with the certificate number; legend "Tests marked with NABL symbol are accredited by NABL vide Certificate No.MC-3860" |
| Footer | | "Processed at : Clinova Pathlabs, Central Lab, …" (newer reports) |

Quirks:

- Each page prints **its own Sample ID, Sample Type and Approved Date**. They are kept per test
  (`sampleId`, `sampleType`, `reported`).
- Structure is told apart by layout, not by x position:
  - a short line with no result, followed by rows, is a panel title ("LIPID PROFILE");
  - inside an open panel, the same kind of line in the middle of a page is a group ("Erythrocyte Indices");
  - stacked headings (panel title, possibly wrapped, then a group, then rows) open the panel with the
    first group, as in "Complete Urine Examination (CUE)" followed by "PHYSICAL EXAMINATION";
  - a row with no panel open is a single-test section named after the row;
  - a paragraph or an interpretation image ends the panel.
- A panel continues across a page break only if the new page has the same Sample ID and starts with
  a row, not a heading.
- Culture reports have **no table header**: the department line starts the body, and default columns
  are used.
- Long text results wrap in the result column (antibiotic lists). Words broken in the middle of a comma
  list are joined back together.
- "." in the unit column means no unit.
- **NABL is marked per page**, not per row. In one 9-page report, only the 6 biochemistry pages carry
  the mark and legend; HbA1c, ESR and CBC do not. A test is `accredited: true` only when all its pages
  carry the mark. Clinova is the lab that holds the certificate: the mark says nothing about MGPL.

## Images seen

| What | How recognised |
| --- | --- |
| NABL / ilac-MRA mark (Clinova) | `ACCREDITATION_MARKS` in `src/registry.ts`, by pixel sha or perceptual hash |
| QR codes (both labs, one per report) | square images; never signatures |
| Logos, banners, interpretation charts | position and size; never signatures |
| Signatures | position (bottom band), size and aspect ratio; Clinova also pairs them with the name and title text below |

## Adding a lab

1. Collect a handful of its reports locally (never commit them).
2. Map the layout as in this file. The scratch tools in `scripts/` print aggregate stats only.
3. Add `src/labs/<lab>.ts` with `is<Lab>(doc)` and `parse<Lab>(doc) → LabParse`, add the lab to `LabId`,
   and wire it into `detectLab` and `extractReport`.
4. Draw a fictional report in the same layout in `scripts/make-fixtures.ts`, and add tests.
5. Run `npm run validate` and `npm run recall` on the real reports, and record the numbers in the README.
