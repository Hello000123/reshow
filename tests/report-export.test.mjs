import test from "node:test";
import assert from "node:assert/strict";
import { buildCsv } from "../js/pages/reports.js";

test("CSV preserves missing values, selected sections, dates, and safe user content", () => {
  const report = {
    id: "report-test",
    createdAt: "2026-10-06T05:20:00.000Z",
    filters: {
      showcaseId: "case-01",
      start: "2026-10-02",
      end: "2026-10-02",
      exhibitId: "ex-1",
    },
    sections: ["activity", "history", "missing"],
    exhibitNames: { "ex-1": '=SUM(1,2) "example"' },
    data: {
      summary: {
        proximityEvents: 0,
        occupiedSeconds: 0,
        missingIntervals: 1,
        recordedIntervals: 1,
        expectedIntervals: 2,
        coveragePercent: 50,
      },
      intervals: [
        {
          start: "2026-10-02T01:00:00.000Z",
          end: "2026-10-02T02:00:00.000Z",
          exhibitId: "ex-1",
          availability: "recorded",
          events: 0,
          occupiedSeconds: 0,
        },
        {
          start: "2026-10-02T02:00:00.000Z",
          end: "2026-10-02T03:00:00.000Z",
          exhibitId: "ex-1",
          availability: "missing",
          events: null,
          occupiedSeconds: null,
        },
      ],
      events: [],
      assignments: [
        { exhibitId: "ex-1", start: "2026-10-01T01:00:00.000Z", end: null },
      ],
    },
  };
  const csv = buildCsv(report);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"recorded","0","0"'));
  assert.ok(csv.includes('"missing","",""'));
  assert.ok(csv.includes('"\'=SUM(1,2) ""example"""'));
  assert.ok(
    csv.includes('"2026-10-01T16:00:00.000Z","2026-10-02T16:00:00.000Z","Yes"'),
  );
  assert.ok(!csv.includes("Environmental warnings"));
  report.sections = ["missing"];
  const missingOnly = buildCsv(report);
  assert.ok(missingOnly.includes("Data completeness"));
  assert.ok(missingOnly.includes("Missing intervals"));
  assert.ok(!missingOnly.includes("Activity intervals"));
  assert.ok(!missingOnly.includes("Exhibit display history"));
});
