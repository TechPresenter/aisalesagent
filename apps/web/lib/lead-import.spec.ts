import { ApiError, leadsApi, type ImportSummary } from "./api-client";
import { CsvFormatError } from "./csv";
import {
  IMPORT_BATCH_ROWS,
  ImportInterruptedError,
  commitOffer,
  commitRequest,
  describeImportError,
  planImportBatches,
  runLeadImport,
  type ImportReport,
  type ImportRequest,
} from "./lead-import";

/**
 * The import screen used to count rows in the browser and announce "Import complete"
 * without sending anything. These pin the replacement: the file goes to the API, a dry
 * run comes before the commit, the commit carries the attestation, and the numbers shown
 * are the server's, mapped back to the user's own rows.
 */

const MAPPING = { name: "Company", phone: "Mobile", city: "City" };

/** A file of `count` distinct, valid rows, numbered from 1 in the company name. */
function csvOf(count: number, extra: string[] = []): string {
  const rows = Array.from(
    { length: count },
    (_, i) => `Company ${i + 1},98${String(i).padStart(8, "0")},Pune`,
  );
  return ["Company,Mobile,City", ...rows, ...extra].join("\r\n");
}

/** Parses a batch the way the server would, enough to answer for it. */
function rowsOf(csv: string): string[][] {
  return csv
    .split("\n")
    .slice(1)
    .map((line) => line.split(","));
}

/**
 * A fake API: rejects nameless rows, reports numbers in `existing` as already in the
 * workspace and repeats within one request as duplicates, and imports the rest.
 */
function fakeServer(existing: Set<string> = new Set()) {
  const calls: ImportRequest[] = [];
  const send = jest.fn(async (input: ImportRequest): Promise<ImportSummary> => {
    calls.push(input);
    const summary: ImportSummary = {
      imported: 0,
      duplicatesInFile: [],
      duplicatesInDatabase: [],
      suppressed: [],
      rejected: [],
      doNotCall: 0,
      dryRun: Boolean(input.dryRun),
    };
    const seen = new Set<string>();
    rowsOf(input.csv).forEach(([name, phone], index) => {
      const sourceRow = index + 1;
      const digits = phone.replace(/\D/g, "").slice(-10);
      if (!name) summary.rejected.push({ sourceRow, reason: "missing name" });
      else if (seen.has(digits)) {
        summary.duplicatesInFile.push({ sourceRow, reason: "duplicate within file" });
      } else if (existing.has(digits)) {
        summary.duplicatesInDatabase.push({ sourceRow, reason: "lead already exists" });
      } else {
        seen.add(digits);
        if (!input.dryRun) summary.imported += 1;
      }
    });
    return summary;
  });
  return { send, calls };
}

describe("planImportBatches", () => {
  it("splits a large file into batches of at most IMPORT_BATCH_ROWS, each with the header", () => {
    const plan = planImportBatches(csvOf(4_500), MAPPING);

    expect(plan.totalRows).toBe(4_500);
    expect(plan.batches.map((batch) => batch.rowNumbers.length)).toEqual([
      IMPORT_BATCH_ROWS,
      IMPORT_BATCH_ROWS,
      500,
    ]);
    for (const batch of plan.batches) {
      expect(batch.csv.split("\n")[0]).toBe("Company,Mobile,City");
    }
    expect(plan.batches[1].rowNumbers[0]).toBe(2_001);
    expect(plan.batches[2].csv.split("\n")[1]).toBe("Company 4001,9800004000,Pune");
  });

  it("re-quotes cells that need it and drops blank lines and the BOM", () => {
    const text =
      '﻿Company,Mobile,City\n"Acme, Inc.",9876543210,"Pune"\n\n,,\n"Say ""hi""\nthere",9876543211,Delhi\n';
    const plan = planImportBatches(text, MAPPING);

    expect(plan.totalRows).toBe(2);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0].csv).toBe(
      'Company,Mobile,City\n"Acme, Inc.",9876543210,Pune\n"Say ""hi""\nthere",9876543211,Delhi',
    );
    expect(plan.batches[0].rowNumbers).toEqual([1, 2]);
  });

  it("sends a later repeat of a number in the batch that holds its first row", () => {
    // Row 4,501 repeats row 10's number, spelled differently.
    const plan = planImportBatches(csvOf(4_500, ["Repeat Co,+91 98000 00009,Pune,yes"]), MAPPING);

    expect(plan.batches.map((batch) => batch.rowNumbers.length)).toEqual([2_001, 2_000, 500]);
    expect(plan.batches[0].rowNumbers[2_000]).toBe(4_501);
    expect(plan.batches[0].csv.split("\n")[2_001]).toBe("Repeat Co,+91 98000 00009,Pune");
  });

  it("keeps every row when one value has a stray quote mark, and sends that value quoted", () => {
    // Row 100's city is `Pune 24" Road`. Read as the start of a quoted value, that quote
    // used to swallow the other 4,900 rows into one cell.
    const lines = csvOf(5_000).split("\r\n");
    lines[100] = 'Company 100,9800000099,Pune 24" Road';
    const plan = planImportBatches(lines.join("\r\n"), MAPPING);

    expect(plan.totalRows).toBe(5_000);
    expect(plan.batches.map((batch) => batch.rowNumbers.length)).toEqual([
      IMPORT_BATCH_ROWS,
      IMPORT_BATCH_ROWS,
      1_000,
    ]);
    expect(plan.batches[0].csv.split("\n")[100]).toBe(
      'Company 100,9800000099,"Pune 24"" Road"',
    );
    expect(plan.batches[0].csv.split("\n")[101]).toBe("Company 101,9800000100,Pune");
  });

  it("refuses a file whose quoting cannot be read one clear way, naming the row", () => {
    const text = 'Company,Mobile,City\nA,9876543210,Pune\nB,9876543211,"Pune\nC,9876543212,Delhi\n';

    expect(() => planImportBatches(text, MAPPING)).toThrow(CsvFormatError);
    const error = (() => {
      try {
        planImportBatches(text, MAPPING);
      } catch (cause) {
        return cause;
      }
    })();
    expect(describeImportError(error)).toMatch(/^Row 2 has a quote mark/);
  });
});

/** A dry run's report with the given counts and nothing else. */
function dryRun(imported: number, doNotCall = 0): ImportReport {
  return {
    dryRun: true,
    totalRows: imported,
    imported,
    duplicatesInFile: [],
    duplicatesInDatabase: [],
    suppressed: [],
    rejected: [],
    otherSkipped: [],
    doNotCall,
  };
}

describe("commitOffer and commitRequest (the review step's gate)", () => {
  const consent = { attested: true, lawfulBasis: "CONSENT" } as const;

  it("offers no commit before a dry run, and none for a commit's own report", () => {
    expect(commitOffer(null)).toEqual({ kind: "nothing" });
    expect(commitRequest(null, consent)).toBeNull();

    const committed = { ...dryRun(3), dryRun: false };
    expect(commitOffer(committed)).toEqual({ kind: "nothing" });
    expect(commitRequest(committed, consent)).toBeNull();
  });

  it("offers the import, and sends it only with a basis and the box ticked", () => {
    expect(commitOffer(dryRun(1))).toEqual({ kind: "import", label: "Import 1 lead" });
    expect(commitOffer(dryRun(2_500, 4))).toEqual({ kind: "import", label: "Import 2,500 leads" });

    expect(commitRequest(dryRun(3), { attested: false, lawfulBasis: "CONSENT" })).toBeNull();
    expect(commitRequest(dryRun(3), { attested: true, lawfulBasis: "" })).toBeNull();
    expect(commitRequest(dryRun(3), consent)).toEqual({ lawfulBasis: "CONSENT" });
  });

  it("offers to apply a do-not-call file whose leads all exist already", () => {
    // Two existing numbers, both marked DND: nothing to insert, two opt-outs to record.
    const preview = {
      ...dryRun(0, 2),
      totalRows: 2,
      duplicatesInDatabase: [
        { sourceRow: 1, reason: "lead already exists in this workspace" },
        { sourceRow: 2, reason: "lead already exists in this workspace" },
      ],
    };

    expect(commitOffer(preview)).toEqual({
      kind: "do-not-call",
      label: "Apply 2 do-not-call numbers",
    });
    expect(commitOffer(dryRun(0, 1))).toMatchObject({ label: "Apply 1 do-not-call number" });
    expect(commitRequest(preview, consent)).toEqual({ lawfulBasis: "CONSENT" });
  });

  it("offers nothing when the file has neither new leads nor do-not-call numbers", () => {
    expect(commitOffer(dryRun(0))).toEqual({ kind: "nothing" });
    expect(commitRequest(dryRun(0), consent)).toBeNull();
  });

  it("walks the screen's order: no commit until the dry run is back, one commit after it", async () => {
    const { send, calls } = fakeServer();
    const plan = planImportBatches(csvOf(3), MAPPING);

    expect(commitRequest(null, consent)).toBeNull();

    const preview = await runLeadImport(plan, { mapping: MAPPING, dryRun: true }, send);
    const commit = commitRequest(preview, consent);
    expect(commit).not.toBeNull();

    const done = await runLeadImport(
      plan,
      { mapping: MAPPING, dryRun: false, ...(commit as { lawfulBasis: "CONSENT" }) },
      send,
    );

    expect(calls.map((call) => call.dryRun)).toEqual([true, false]);
    expect(calls[1]).toMatchObject({ attestation: true, lawfulBasis: "CONSENT" });
    expect(done.imported).toBe(3);
    expect(commitRequest(done, consent)).toBeNull();
  });
});

describe("runLeadImport", () => {
  it("checks the file with a dry run, then commits it with the attestation, through leadsApi.import", async () => {
    const spy = jest.spyOn(leadsApi, "import").mockImplementation(fakeServer().send);
    try {
      const plan = planImportBatches(csvOf(3), MAPPING);

      const preview = await runLeadImport(plan, {
        mapping: MAPPING,
        source: "UPLOAD",
        dryRun: true,
      });
      const done = await runLeadImport(plan, {
        mapping: MAPPING,
        source: "UPLOAD",
        dryRun: false,
        lawfulBasis: "EXISTING_RELATIONSHIP",
      });

      const [[check], [commit]] = spy.mock.calls;
      expect(check).toEqual({
        csv: plan.batches[0].csv,
        mapping: MAPPING,
        source: "UPLOAD",
        dryRun: true,
      });
      expect(commit).toEqual({
        csv: plan.batches[0].csv,
        mapping: MAPPING,
        source: "UPLOAD",
        dryRun: false,
        attestation: true,
        lawfulBasis: "EXISTING_RELATIONSHIP",
      });
      expect(preview).toMatchObject({ dryRun: true, imported: 3 });
      expect(done).toMatchObject({ dryRun: false, imported: 3 });
    } finally {
      spy.mockRestore();
    }
  });

  it("adds the batches up and reports rows by their number in the file", async () => {
    const { send, calls } = fakeServer(new Set(["9800002500"]));
    const plan = planImportBatches(
      csvOf(4_000, [",9811111111,Pune", "Again,9800000000,Pune"]),
      MAPPING,
    );

    const progress: [number, number][] = [];
    const preview = await runLeadImport(
      plan,
      { mapping: MAPPING, dryRun: true, onProgress: (done, total) => progress.push([done, total]) },
      send,
    );

    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.dryRun === true && call.attestation === undefined)).toBe(
      true,
    );
    expect(progress).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(preview.totalRows).toBe(4_002);
    expect(preview.imported).toBe(3_999);
    // Row 2,501 of the file is row 501 of the second batch.
    expect(preview.duplicatesInDatabase.map((issue) => issue.sourceRow)).toEqual([2_501]);
    expect(preview.rejected).toEqual([{ sourceRow: 4_001, reason: "missing name" }]);
    // The repeat of row 1's number travelled with row 1, so the server caught it.
    expect(preview.duplicatesInFile.map((issue) => issue.sourceRow)).toEqual([4_002]);
  });

  it("counts do-not-call rows, and any skip list it has no name for, instead of losing them", async () => {
    const send = jest.fn(
      async (): Promise<ImportSummary> =>
        ({
          imported: 0,
          duplicatesInFile: [],
          duplicatesInDatabase: [],
          suppressed: [{ sourceRow: 1, reason: "number is on this workspace's do-not-call list" }],
          rejected: [],
          quarantined: [{ sourceRow: 2, reason: "held for review" }],
          doNotCall: 1,
          dryRun: true,
        }) as ImportSummary,
    );
    const report = await runLeadImport(
      planImportBatches(csvOf(3), MAPPING),
      { mapping: MAPPING, dryRun: true },
      send,
    );

    expect(report.imported).toBe(1);
    expect(report.suppressed.map((issue) => issue.sourceRow)).toEqual([1]);
    expect(report.otherSkipped).toEqual([{ sourceRow: 2, reason: "held for review" }]);
    expect(report.doNotCall).toBe(1);
  });

  it("never reports success when the first request fails", async () => {
    const send = jest.fn(async () => {
      throw new ApiError("Forbidden resource", 403);
    });
    await expect(
      runLeadImport(
        planImportBatches(csvOf(3), MAPPING),
        { mapping: MAPPING, dryRun: false, lawfulBasis: "CONSENT" },
        send,
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("says how far a commit got when a later batch fails", async () => {
    const { send: server } = fakeServer();
    let call = 0;
    const send = jest.fn(async (input: ImportRequest) => {
      call += 1;
      if (call === 2) throw new TypeError("Failed to fetch");
      return server(input);
    });

    const error = await runLeadImport(
      planImportBatches(csvOf(4_500), MAPPING),
      { mapping: MAPPING, dryRun: false, lawfulBasis: "CONSENT" },
      send,
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ImportInterruptedError);
    const interrupted = error as ImportInterruptedError;
    expect(interrupted.batchesDone).toBe(1);
    expect(interrupted.batchesTotal).toBe(3);
    expect(interrupted.partial.imported).toBe(IMPORT_BATCH_ROWS);
    expect(interrupted.message).toMatch(/could not reach the server/i);
  });
});

describe("describeImportError", () => {
  it.each([
    [new ApiError("Forbidden resource", 403), /role does not allow importing/],
    [new ApiError("Payload Too Large", 413), /too large/],
    [new ApiError("The file has more than 10,000 rows.", 400), /more than 10,000 rows/],
    [new TypeError("Failed to fetch"), /could not reach the server/],
  ])("explains %p", (cause, expected) => {
    expect(describeImportError(cause)).toMatch(expected);
  });
});
