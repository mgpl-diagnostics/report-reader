// Tests run on synthetic reports from scripts/make-fixtures.ts (fictional data only).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { extractReport, labelFor, UnsupportedReportError, type KnownSignature } from "../src/index";
import { computeFlag } from "../src/table";
import { isoDate, parseAge, parseSignatoryText, splitTitle } from "../src/text";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

test("Hy Patho layout: header, panels across pages, wrapped names, groups, notes, mark", async () => {
  const { report: r, images } = await extractReport(fixture("hypatho-demo.pdf"), { file: "hypatho-demo.pdf" });
  assert.equal(r.source.lab, "hypatho");
  assert.equal(r.source.processedAt, "HY PATHO LAB, RAIPUR");
  assert.deepEqual(r.patient, { name: "TEST PATIENT", title: "Mr", ageText: "40 Y", ageYears: 40, sex: "male" });
  assert.equal(r.sample.bookingId, "100001 DEMO - 1");
  assert.deepEqual(r.sample.barcodes, ["BC0001"]);
  assert.deepEqual(r.sample.ordered, ["DEMO PANEL"]);
  assert.equal(r.sample.collectedAt, "DEMO COLLECTION CENTRE");
  assert.deepEqual(r.dates, { registered: "2026-01-01T09:00", received: "2026-01-01T10:00", reported: "2026-01-01T17:30" });

  assert.equal(r.tests.length, 2);
  const [cbc, thyroid] = r.tests;
  assert.equal(cbc!.name, "COMPLETE BLOOD COUNT");
  assert.deepEqual(cbc!.pages, [1, 2]);
  assert.equal(cbc!.sampleType, "SERUM");
  const by = (n: string) => cbc!.parameters.find((p) => p.name.startsWith(n))!;
  assert.deepEqual(by("Hemoglobin"), { name: "Hemoglobin", value: "9.50", unit: "g/dL", range: "13 - 17", method: "SLS-Hemoglobin", flag: "L" });
  assert.equal(by("Mean Corpuscular").name, "Mean Corpuscular Hemoglobin Concentration (MCHC)");
  assert.equal(by("Mean Corpuscular").flag, "H");
  assert.equal(by("Neutrophils").group, "DIFFERENTIAL COUNT");
  assert.equal(by("Platelet").method, "Electrical Impedance", "method printed at the top of the next page");
  assert.equal(by("Erythrocyte").unit, "mm at end of Ist hr");

  assert.equal(thyroid!.name, "THYROID PROFILE");
  assert.equal(thyroid!.mark, "*");
  assert.match(thyroid!.notes ?? "", /^Interpretation:/);

  // the name is only inside the signature image: unnamed until registered
  assert.equal(r.signatories.length, 1);
  const sig = r.signatories[0]!;
  assert.equal(sig.name, null);
  assert.deepEqual(sig.pages, [2, 3]);
  assert.deepEqual(cbc!.signedBy, [sig.id]);
  assert.ok(images.get(sig.id)?.rgba.length);
  assert.match(r.warnings.join("\n"), /unnamed signature/);
  assert.equal(cbc!.accredited, undefined, "no accreditation marks in this report");
});

test("signature registry names Hy Patho signers (exact and perceptual match)", async () => {
  const { report: first } = await extractReport(fixture("hypatho-demo.pdf"));
  const s = first.signatories[0]!.signature;
  const known: KnownSignature = { name: "Dr Demo Signer", qualification: "MD Path", registration: "XYMC 0001", role: "pathologist" };
  for (const registry of [[{ ...known, sha: [s.sha] }], [{ ...known, dhash: [s.dhash.replace(/.$/, (c) => ((parseInt(c, 16) ^ 1).toString(16)))] }]]) {
    const { report: r } = await extractReport(fixture("hypatho-demo.pdf"), { signatures: registry });
    const sig = r.signatories[0]!;
    assert.equal(sig.name, "Dr Demo Signer");
    assert.equal(sig.source, "registry");
    assert.equal(sig.role, "pathologist");
    assert.equal(sig.medical, true);
    assert.equal(r.warnings.length, 0);
  }
});

test("Clinova layout: per-page samples, panels, multi-line ranges, signatories, NABL per test", async () => {
  const { report: r } = await extractReport(fixture("clinova-demo.pdf"));
  assert.equal(r.source.lab, "clinova");
  assert.equal(r.source.processedAt, "Clinova Pathlabs, Demo Central Lab, Demo City - 000000");
  assert.deepEqual(r.patient, { name: "DEMO PERSON", title: "Mr", ageText: "35 Year(s)", ageYears: 35, sex: "male", patientId: "900001" });
  assert.equal(r.sample.labCode, "CPL-XX-001");
  assert.deepEqual(r.sample.sampleIds, ["S-001", "S-002"]);
  assert.deepEqual(r.dates, { collected: "2026-01-02T08:15", registered: "2026-01-02T10:00", reported: "2026-01-02T12:30" });

  const [lipid, esr] = r.tests;
  assert.equal(lipid!.name, "LIPID PROFILE");
  assert.equal(lipid!.department, "CLINICAL BIOCHEMISTRY");
  assert.equal(lipid!.sampleId, "S-001");
  assert.equal(lipid!.parameters[0]!.range, "<200 - Desirable\n200-239 - Borderline risk\n>240 - High risk");
  assert.equal(lipid!.parameters[0]!.method, "CHOD-PAP");
  assert.equal(lipid!.parameters[1]!.flag, "L");
  assert.match(lipid!.notes ?? "", /cardiovascular risk/);
  assert.equal(esr!.name, "Erythrocyte Sedimentation Rate (ESR)");
  assert.equal(esr!.department, "HEMATOLOGY");
  assert.equal(esr!.parameters[0]!.flag, "H", "<= 20 with 30");

  const doctor = r.signatories.find((s) => s.medical)!;
  assert.deepEqual(
    { name: doctor.name, q: doctor.qualification, reg: doctor.registration, title: doctor.title, role: doctor.role, source: doctor.source },
    { name: "Dr Demo Pathologist", q: "MD", reg: "XYMC1234/2020", title: "Consultant Pathologist", role: "pathologist", source: "text" },
  );
  const manager = r.signatories.find((s) => !s.medical)!;
  assert.equal(manager.role, "manager");
  assert.ok(doctor.signature.sha && manager.signature.sha && doctor.signature.sha !== manager.signature.sha);

  // the NABL legend is on page 1 only: lipid is marked, ESR is not
  assert.deepEqual(r.accreditation, [{ body: "NABL", certificate: "MC-9999", evidence: ["text"], pages: [1] }]);
  assert.equal(lipid!.accredited, true);
  assert.equal(esr!.accredited, false);

  const l1 = labelFor(r, lipid!), l2 = labelFor(r, esr!);
  assert.equal(l1.text, "Performed at Clinova Pathlabs (NABL accredited, MC-9999) · Reported by Dr Demo Pathologist, MD (XYMC1234/2020)");
  assert.equal(l1.accreditation?.certificate, "MC-9999");
  assert.equal(l2.accreditation, undefined);
  assert.equal(l2.text, "Performed at Clinova Pathlabs · Reported by Dr Demo Pathologist, MD (XYMC1234/2020)");
  assert.deepEqual(l1.reportedBy.map((x) => x.name), ["Dr Demo Pathologist"], "managers are not 'reported by'");
  assert.equal(l1.sourceSha256, r.source.sha256);
});

test("other PDFs are rejected", async () => {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.addPage().drawText("Some other lab", { x: 50, y: 700, font: await doc.embedFont(StandardFonts.Helvetica) });
  await assert.rejects(extractReport(await doc.save()), UnsupportedReportError);
});

test("text helpers", () => {
  assert.equal(isoDate("16-06-2026 06:25 PM"), "2026-06-16T18:25");
  assert.equal(isoDate("16-06-2026 12:05 AM"), "2026-06-16T00:05");
  assert.equal(isoDate("2026-03-10 18:46"), "2026-03-10T18:46");
  assert.equal(isoDate("2026-03-10"), "2026-03-10");
  assert.deepEqual(parseAge("5 Month(s)"), { ageText: "5 Month(s)", ageYears: 0.42 });
  assert.deepEqual(parseAge("1 Y 6 M"), { ageText: "1 Y 6 M", ageYears: 1.5 });
  assert.deepEqual(splitTitle("MRS. DEMO NAME"), { title: "Mrs", name: "DEMO NAME" });
  assert.deepEqual(splitTitle("B/O DEMO"), { title: "B/O", name: "DEMO" });
  assert.deepEqual(parseSignatoryText("Dr Demo One", "M.D.,DNB,PATHOLOGY ABMC:12345"), { name: "Dr Demo One", qualification: "M.D., DNB, PATHOLOGY", registration: "ABMC:12345", title: undefined });
  assert.deepEqual(parseSignatoryText("Dr. Demo Two MD", "Consultant Biochemist"), { name: "Dr. Demo Two", qualification: "MD", registration: undefined, title: "Consultant Biochemist" });
  assert.deepEqual(parseSignatoryText(undefined, "Consultant Microbiologist (DMC Regno:12345)"), { name: null, qualification: undefined, registration: "DMC Regno:12345", title: "Consultant Microbiologist" });
  assert.equal(computeFlag("5.2", "2.4 - 5.7"), "");
  assert.equal(computeFlag("19.6", "< 15.00"), "H");
  assert.equal(computeFlag("12", "Up to 10"), "H");
  assert.equal(computeFlag("8", "> 10"), "L");
  assert.equal(computeFlag("Negative", "Negative"), "");
});
