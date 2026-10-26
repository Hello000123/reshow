import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
const { api } = await import("../js/services.js");
const loadFresh = () =>
  import(`../js/services.js?reload=${Date.now()}-${Math.random()}`);
const content = {
  title: "A new label",
  collection: "Ceramics",
  description: "A carefully edited mock label.",
  image: "assets/vase.svg",
};

test("shared mock services preserve device acknowledgement, data completeness and persistence", async (t) => {
  await t.test(
    "hourly aggregation distinguishes recorded zero, missing and future; dates are HKT inclusive",
    async () => {
      await api.resetDemo();
      const all = await api.getActivity();
      assert.equal(all.intervals.length, 48);
      assert.equal(all.summary.expectedIntervals, 44);
      assert.equal(all.summary.missingIntervals, 4);
      assert.equal(all.summary.recordedIntervals, 40);
      assert.equal(all.summary.coveragePercent, 90.9);
      assert.ok(
        all.intervals.some(
          (i) =>
            i.availability === "recorded" &&
            i.events === 0 &&
            i.occupiedSeconds === 0,
        ),
      );
      assert.ok(
        all.intervals
          .filter((i) => i.availability !== "recorded")
          .every((i) => i.events === null && i.occupiedSeconds === null),
      );
      assert.equal(
        all.events.filter((e) => e.type === "proximity").length,
        all.summary.proximityEvents,
      );
      assert.equal(all.summary.warnings, 4);
      const snapshot = await api.getSnapshot(),
        vase = snapshot.exhibits.find((e) => e.id === "ex-014");
      assert.deepEqual(
        [
          vase.temperatureMin,
          vase.temperatureMax,
          vase.brightnessMin,
          vase.brightnessMax,
          vase.warningSeconds,
        ],
        [20, 26, 30, 70, 120],
      );
      assert.equal(
        snapshot.showcase.label.content.collection,
        "Student collection",
      );
      assert.equal(
        snapshot.showcase.label.acknowledgedAt,
        "2026-10-06T05:12:00.000Z",
      );
      const seededLabel = snapshot.operations.find(
        (o) => o.type === "label" && o.status === "acknowledged",
      );
      assert.equal(
        seededLabel.acknowledgedAt,
        snapshot.showcase.label.acknowledgedAt,
      );
      assert.deepEqual(
        seededLabel.payload.content,
        snapshot.showcase.label.content,
      );
      const cardEvent = all.events.find((e) => e.id === "event-access-003"),
        cardLog = (await api.getAccessLog()).find((e) => e.id === "access-003");
      assert.equal(cardEvent.at, "2026-10-06T04:58:00.000Z");
      assert.equal(cardEvent.at, cardLog.at);
      assert.equal(cardEvent.status, cardLog.result);
      const currentWarning = all.events.find((e) => e.id === "warning-004");
      assert.equal(currentWarning.at, "2026-10-06T05:15:00.000Z");
      assert.match(currentWarning.details, /78 \/ 100 for 120 seconds/);
      const day = await api.getActivity({
        start: "2026-10-01",
        end: "2026-10-01",
      });
      assert.equal(day.intervals.length, 8);
      assert.equal(day.intervals[0].start, "2026-10-01T01:00:00.000Z");
      assert.equal(day.summary.expectedIntervals, 8);
      const selected = await api.getActivity({ exhibitId: "ex-014" });
      assert.ok(selected.intervals.every((i) => i.exhibitId === "ex-014"));
      assert.ok(selected.events.every((e) => e.exhibitId === "ex-014"));
      assert.equal(selected.assignments.length, 1);
      await assert.rejects(
        api.getActivity({ start: "2026-10-07", end: "2026-10-01" }),
        /Start date/,
      );
      await assert.rejects(api.getActivity({ start: "2026-02-30" }), /valid/);
    },
  );
  await t.test(
    "assignment history excludes future-only ranges and reports never invent future history",
    async () => {
      await api.resetDemo();
      const futureFilters = { start: "2026-10-07", end: "2026-10-08" };
      const future = await api.getActivity(futureFilters);
      assert.deepEqual(future.assignments, []);
      const report = await api.generateReport(futureFilters, ["history"]);
      assert.deepEqual(report.data.assignments, []);
      const today = await api.getActivity({
        start: "2026-10-06",
        end: "2026-10-08",
      });
      assert.equal(today.assignments.length, 1);
      const snapshot = await api.getSnapshot();
      assert.ok(today.assignments.every((a) => a.start < snapshot.now));
      const historical = await api.getActivity({
        start: "2026-10-01",
        end: "2026-10-02",
      });
      assert.deepEqual(
        historical.assignments.map((a) => a.exhibitId),
        ["ex-015"],
      );
    },
  );
  await t.test(
    "drafts and pending commands never replace confirmed state; acknowledgement applies later",
    async () => {
      await api.resetDemo();
      await api.setDemoMode("pending");
      const before = await api.getSnapshot();
      await api.saveLabelDraft("ex-014", content);
      let label = await api.getLabel("ex-014");
      assert.equal(label.draft.title, content.title);
      assert.equal(
        label.confirmed.content.title,
        before.showcase.label.content.title,
      );
      const op = await api.sendLabel("ex-014", content);
      assert.equal(op.status, "pending");
      assert.equal(
        (await api.getSnapshot()).showcase.label.content.title,
        before.showcase.label.content.title,
      );
      await api.settlePending();
      label = await api.getLabel("ex-014");
      assert.equal(label.confirmed.content.title, content.title);
      assert.equal(
        label.history.find((o) => o.id === op.id).status,
        "acknowledged",
      );
      assert.ok(label.history.find((o) => o.id === op.id).acknowledgedAt);
      const light = await api.setLighting("Off");
      assert.equal(light.status, "pending");
      assert.equal((await api.getSnapshot()).showcase.lightingMode, "Auto");
      await api.settlePending();
      assert.equal((await api.getSnapshot()).showcase.lightingOutput, "Off");
    },
  );
  await t.test(
    "failed and offline commands visibly pend, fail and preserve readings and confirmed state",
    async () => {
      await api.resetDemo();
      await api.setDemoMode("failed");
      const op = await api.setLighting("Off");
      assert.equal(op.status, "pending");
      await api.setDemoMode("normal");
      await api.settlePending();
      let snapshot = await api.getSnapshot();
      assert.equal(
        snapshot.operations.find((o) => o.id === op.id).status,
        "failed",
      );
      assert.equal(snapshot.showcase.lightingMode, "Auto");
      await api.setDemoMode("offline");
      snapshot = await api.getSnapshot();
      assert.equal(snapshot.showcase.online, false);
      assert.equal(snapshot.showcase.temperature, 23.6);
      assert.equal(
        snapshot.showcase.lastReceivedAt,
        "2026-10-06T05:18:00.000Z",
      );
      const offline = await api.assignExhibit("ex-015");
      assert.equal(offline.status, "pending");
      await api.settlePending();
      snapshot = await api.getSnapshot();
      assert.equal(
        snapshot.operations.find((o) => o.id === offline.id).status,
        "failed",
      );
      assert.equal(snapshot.showcase.exhibitId, "ex-014");
      await assert.rejects(api.scanStaffCard(), /scan failed/);
    },
  );
  await t.test(
    "assignment keeps actual label and validates label ownership again on acknowledgement",
    async () => {
      await api.resetDemo();
      await api.setDemoMode("pending");
      await api.assignExhibit("ex-015");
      const requestedLabel = await api.sendLabel("ex-014", content);
      await api.settlePending();
      const snapshot = await api.getSnapshot();
      assert.equal(snapshot.showcase.exhibitId, "ex-015");
      assert.equal(snapshot.showcase.label.exhibitId, "ex-014");
      assert.equal(
        snapshot.operations.find((o) => o.id === requestedLabel.id).status,
        "failed",
      );
      assert.equal(
        snapshot.exhibits.find((e) => e.id === "ex-015").showcaseId,
        "case-01",
      );
      assert.equal(
        snapshot.exhibits.find((e) => e.id === "ex-014").showcaseId,
        null,
      );
      assert.equal(snapshot.assignmentHistory.filter((a) => !a.end).length, 1);
      const projected = await api.getActivity();
      assert.ok(
        projected.intervals
          .filter((i) => i.availability === "recorded")
          .every(
            (i) =>
              i.exhibitId !== "ex-015" || i.start < "2026-10-03T04:00:00.000Z",
          ),
      );
      assert.equal(
        projected.intervals.find((i) => i.id === "interval-6-13").exhibitId,
        "ex-014",
      );
      assert.ok(
        projected.intervals
          .filter((i) => i.start > snapshot.now)
          .every((i) => i.exhibitId === "ex-015"),
      );
      await assert.rejects(
        api.sendLabel("ex-014", content),
        /Assign this exhibit/,
      );
    },
  );
  await t.test(
    "duplicate tags, invalid limits and direct assignment edits are guarded",
    async () => {
      await api.resetDemo();
      const profile = (await api.listExhibits())[0];
      await assert.rejects(
        api.saveExhibit({ ...profile, id: undefined, tagId: "ex-015" }),
        /already registered/,
      );
      await assert.rejects(
        api.saveExhibit({ ...profile, temperatureMin: 26, temperatureMax: 20 }),
        /Minimum temperature/,
      );
      await assert.rejects(
        api.saveExhibit({ ...profile, brightnessMax: 101 }),
        /brightnessMax/,
      );
      await assert.rejects(
        api.saveExhibit({ ...profile, warningSeconds: 0 }),
        /warningSeconds/,
      );
      await assert.rejects(
        api.saveExhibit({ ...profile, warningSeconds: 2.5 }),
        /whole number/,
      );
      await assert.rejects(
        api.saveExhibit({ ...profile, tagId: "CARD-1030" }),
        /Exhibit tags/,
      );
      const updated = await api.saveExhibit({
        ...profile,
        name: "Edited vase",
        showcaseId: null,
      });
      assert.equal(updated.showcaseId, "case-01");
    },
  );
  await t.test(
    "enabled and pending card reservations prevent duplicate ownership; access changes wait for ack",
    async () => {
      await api.resetDemo();
      await api.setDemoMode("pending");
      await assert.rejects(
        api.registerCard("staff-003", "CARD-1001"),
        /already assigned/,
      );
      await assert.rejects(
        api.registerCard("staff-003", "EX-1001"),
        /Staff access cards/,
      );
      await api.registerCard("staff-003", "CARD-8000");
      await assert.rejects(
        api.registerCard("staff-002", "CARD-8000"),
        /reserved/,
      );
      assert.equal(
        (await api.listStaff()).find((p) => p.id === "staff-003").cardId,
        null,
      );
      await api.settlePending();
      assert.equal(
        (await api.listStaff()).find((p) => p.id === "staff-003").cardEnabled,
        true,
      );
      await api.setCardAccess("staff-003", false);
      assert.equal(
        (await api.listStaff()).find((p) => p.id === "staff-003").cardEnabled,
        true,
      );
      await api.settlePending();
      assert.equal(
        (await api.listStaff()).find((p) => p.id === "staff-003").cardEnabled,
        false,
      );
      await api.registerCard("staff-002", "CARD-8000");
      await api.settlePending();
      assert.equal(
        (await api.listStaff()).filter(
          (p) => p.cardEnabled && p.cardId === "CARD-8000",
        ).length,
        1,
      );
      await assert.rejects(
        api.setCardAccess("staff-003", true),
        /already assigned/,
      );
    },
  );
  await t.test(
    "concurrent card reservations are exclusive and assignments settle in request order",
    async () => {
      await api.resetDemo();
      await api.setDemoMode("pending");
      const requests = await Promise.allSettled([
        api.registerCard("staff-002", "CARD-9000"),
        api.registerCard("staff-003", "CARD-9000"),
      ]);
      assert.equal(requests.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(requests.filter((r) => r.status === "rejected").length, 1);
      assert.equal(
        (await api.getSnapshot()).operations.filter(
          (o) => o.type === "card" && o.status === "pending",
        ).length,
        1,
      );
      await api.settlePending();
      assert.equal(
        (await api.listStaff()).filter(
          (p) => p.cardEnabled && p.cardId === "CARD-9000",
        ).length,
        1,
      );
      const assignments = await Promise.all([
        api.assignExhibit("ex-015"),
        api.assignExhibit("ex-016"),
      ]);
      await api.settlePending();
      const snapshot = await api.getSnapshot();
      assert.ok(
        assignments.every(
          (request) =>
            snapshot.operations.find((o) => o.id === request.id).status ===
            "acknowledged",
        ),
      );
      assert.equal(snapshot.showcase.exhibitId, "ex-016");
      assert.equal(snapshot.assignmentHistory.filter((a) => !a.end).length, 1);
      assert.equal(
        snapshot.assignmentHistory.filter((a) => !a.end)[0].exhibitId,
        "ex-016",
      );
      const activity = await api.getActivity();
      assert.ok(
        activity.intervals
          .filter((i) => i.start > snapshot.now)
          .every((i) => i.exhibitId === "ex-016"),
      );
      for (let i = 1; i < snapshot.assignmentHistory.length; i++)
        assert.equal(
          snapshot.assignmentHistory[i - 1].end,
          snapshot.assignmentHistory[i].start,
        );
    },
  );
  await t.test(
    "report snapshots are immutable and completeness is always included",
    async () => {
      await api.resetDemo();
      const filters = {
        start: "2026-10-02",
        end: "2026-10-04",
        exhibitId: "ex-016",
      };
      const report = await api.generateReport(filters, ["activity"]);
      assert.deepEqual(report.data, await api.getActivity(filters));
      assert.deepEqual(report.sections, ["activity", "missing"]);
      report.data.summary.proximityEvents = -1;
      report.exhibitNames["ex-016"] = "Changed";
      const profile = (await api.listExhibits()).find((e) => e.id === "ex-016");
      await api.saveExhibit({ ...profile, name: "New profile name" });
      const saved = (await api.listReports())[0];
      assert.notEqual(saved.data.summary.proximityEvents, -1);
      assert.equal(saved.exhibitNames["ex-016"], "Mineral sample");
      await api.setDemoMode("empty");
      const empty = await api.getActivity();
      assert.equal(empty.summary.coveragePercent, null);
      assert.equal(empty.intervals.length, 0);
      const snapshot = await api.getSnapshot();
      assert.equal(snapshot.showcase.exhibitId, null);
      assert.equal(snapshot.showcase.temperature, null);
      assert.deepEqual(snapshot.staff, []);
    },
  );
  await t.test(
    "normal mode delivers acknowledgement automatically and subscriptions unsubscribe",
    async () => {
      await api.resetDemo();
      let changes = 0;
      const unsubscribe = api.subscribe(() => changes++);
      const op = await api.setLighting("On");
      assert.equal(op.status, "pending");
      await new Promise((resolve) => setTimeout(resolve, 1400));
      const snapshot = await api.getSnapshot();
      assert.equal(
        snapshot.operations.find((o) => o.id === op.id).status,
        "acknowledged",
      );
      assert.equal(snapshot.showcase.lightingMode, "On");
      assert.ok(changes >= 2);
      unsubscribe();
      const last = changes;
      await api.saveLabelDraft("ex-014", content);
      assert.equal(changes, last);
    },
  );
  await t.test(
    "refresh persists local edits and recovers in-flight commands as failed",
    async () => {
      await api.resetDemo();
      await api.setDemoMode("pending");
      const person = (await api.listStaff())[2];
      await api.saveStaff({ ...person, name: "Persisted operator" });
      const op = await api.setLighting("Off");
      const fresh = (await loadFresh()).api;
      const snapshot = await fresh.getSnapshot();
      assert.equal(
        snapshot.staff.find((p) => p.id === person.id).name,
        "Persisted operator",
      );
      assert.equal(
        snapshot.operations.find((o) => o.id === op.id).status,
        "failed",
      );
      assert.match(
        snapshot.operations.find((o) => o.id === op.id).error,
        /interrupted by reload/,
      );
      assert.equal(snapshot.showcase.lightingMode, "Auto");
      await api.resetDemo();
    },
  );
  await t.test(
    "malformed or unavailable storage gracefully falls back",
    async () => {
      storage.set("reshow-demo-v1", "{broken json");
      let fresh = (await loadFresh()).api;
      assert.match(
        (await fresh.getSnapshot()).storageWarning,
        /unavailable or invalid/,
      );
      const original = globalThis.localStorage;
      globalThis.localStorage = {
        getItem() {
          throw new Error("Blocked");
        },
        setItem() {
          throw new Error("Blocked");
        },
      };
      fresh = (await loadFresh()).api;
      assert.match(
        (await fresh.getSnapshot()).storageWarning,
        /unavailable or invalid/,
      );
      const person = (await fresh.listStaff())[0];
      await fresh.saveStaff({ ...person, name: "Memory only" });
      assert.equal((await fresh.listStaff())[0].name, "Memory only");
      assert.match((await fresh.getSnapshot()).storageWarning, /in memory/);
      globalThis.localStorage = original;
      await api.resetDemo();
    },
  );
});
