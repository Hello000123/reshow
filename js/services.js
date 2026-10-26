import {
  createInitialState,
  STORAGE_KEY,
  STORAGE_VERSION,
  DEMO_MODES,
} from "./data.js";

const copy = (value) => JSON.parse(JSON.stringify(value));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const listeners = new Set();
const timers = new Map();
let state = restore();

function validState(s) {
  return (
    s &&
    typeof s.now === "string" &&
    Number.isFinite(Date.parse(s.now)) &&
    s.showcase?.id === "case-01" &&
    Array.isArray(s.exhibits) &&
    Array.isArray(s.staff) &&
    Array.isArray(s.intervals) &&
    Array.isArray(s.events) &&
    Array.isArray(s.assignmentHistory) &&
    Array.isArray(s.operations) &&
    Array.isArray(s.reports) &&
    Array.isArray(s.accessLog) &&
    s.drafts &&
    typeof s.drafts === "object" &&
    Number.isInteger(s.sequence) &&
    Number.isInteger(s.scanSequence) &&
    DEMO_MODES.includes(s.mode) &&
    s.exhibits.every((e) => e.id && e.name && e.tagId) &&
    s.staff.every((p) => p.id && p.name && p.email) &&
    s.operations.every(
      (o) => o.id && ["pending", "failed", "acknowledged"].includes(o.status),
    ) &&
    s.intervals.every(
      (i) =>
        i.start &&
        i.end &&
        ["recorded", "missing", "future"].includes(i.availability),
    )
  );
}
function restore() {
  let result = createInitialState();
  try {
    if (!globalThis.localStorage) throw new Error("Storage unavailable");
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) return result;
    const stored = JSON.parse(raw);
    if (stored.version !== STORAGE_VERSION || !validState(stored.data))
      throw new Error("Invalid demo storage");
    result = stored.data;
    result.storageWarning = null;
    for (const operation of result.operations) {
      if (operation.status === "pending") {
        operation.status = "failed";
        operation.error =
          "Mock delivery interrupted by reload. Confirmed device state was preserved; request the change again.";
        const event = result.events.find(
          (e) => e.id === `event-${operation.id}`,
        );
        if (event) {
          event.status = "failed";
          event.details = operation.error;
        }
      }
    }
    globalThis.localStorage?.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, data: result }),
    );
  } catch {
    result = createInitialState();
    result.storageWarning =
      "Demo storage is unavailable or invalid. This session is using fresh in-memory data; edits may not survive refresh.";
  }
  return result;
}
function persist() {
  try {
    if (!globalThis.localStorage) throw new Error("Storage unavailable");
    globalThis.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, data: state }),
    );
  } catch {
    state.storageWarning =
      "Demo storage is unavailable. Changes remain in memory for this session.";
  }
}
function notify() {
  persist();
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error("ReShow subscriber failed", error);
    }
  }
}
function tick() {
  state.now = new Date(Date.parse(state.now) + 1000).toISOString();
  return state.now;
}
function id(prefix) {
  return `${prefix}-${++state.sequence}`;
}
function error(message, fields) {
  const issue = new Error(message);
  if (fields) issue.fields = fields;
  throw issue;
}
async function read() {
  await delay(state.mode === "loading" ? 1800 : 35);
}
async function write() {
  await delay(65);
}
const isEmpty = () => state.mode === "empty";
const exhibitById = (exhibitId) => {
  const exhibit = state.exhibits.find((e) => e.id === exhibitId);
  if (!exhibit) error("Exhibit not found.");
  return exhibit;
};
const staffById = (staffId) => {
  const person = state.staff.find((p) => p.id === staffId);
  if (!person) error("Staff member not found.");
  return person;
};
function text(value, field, max = 2000, required = true) {
  const result = String(value ?? "").trim();
  if ((required && !result) || result.length > max)
    error(
      `${field} ${!result ? "is required" : `must be ${max} characters or fewer`}.`,
      { [field]: !result ? "Required" : `Maximum ${max} characters` },
    );
  return result;
}
function imageValue(value) {
  const image = text(value, "image", 1600000, false);
  if (
    image &&
    !/^(assets\/[\w./-]+\.(svg|png|jpe?g|webp)|data:image\/(png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+)$/i.test(
      image,
    )
  )
    error("Choose a supported local image.", {
      image: "Use a PNG, JPEG, WebP or GIF image",
    });
  return image;
}
function normaliseLabel(content) {
  if (!content || typeof content !== "object")
    error("Label content is required.");
  return {
    title: text(content.title, "title", 100),
    collection: text(content.collection, "collection", 120, false),
    description: text(content.description, "description", 2000),
    image: imageValue(content.image),
  };
}
function fieldNumber(value, name, min, max, integer = false) {
  const number =
    typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  if (
    !["number", "string"].includes(typeof value) ||
    !Number.isFinite(number) ||
    number < min ||
    number > max ||
    (integer && !Number.isInteger(number))
  )
    error(
      `${name} must be ${integer ? "a whole number " : ""}between ${min} and ${max}.`,
      { [name]: `Enter ${min}–${max}${integer ? " (whole number)" : ""}` },
    );
  return number;
}
function ensureDeviceAvailable() {
  if (isEmpty()) error("No showcase is available in the empty demo.");
}
function eventFor(operation, details) {
  state.events.push({
    id: `event-${operation.id}`,
    at: operation.requestedAt,
    showcaseId: "case-01",
    exhibitId:
      operation.type === "label" || operation.type === "assignment"
        ? operation.targetId
        : state.showcase.exhibitId,
    type: operation.type,
    details,
    status: "pending",
  });
}
function queue(type, targetId, payload) {
  ensureDeviceAvailable();
  const operation = {
    id: id("op"),
    type,
    targetId,
    status: "pending",
    requestedAt: tick(),
    acknowledgedAt: null,
    payload: copy(payload),
    error: null,
  };
  // The requested delivery outcome is fixed at request time, even if demo mode changes.
  operation.delivery =
    state.mode === "offline"
      ? "offline"
      : state.mode === "failed"
        ? "failed"
        : "success";
  state.operations.push(operation);
  eventFor(
    operation,
    `Mock ${type} change requested; waiting for device acknowledgement.`,
  );
  notify();
  if (state.mode !== "pending")
    timers.set(
      operation.id,
      setTimeout(() => {
        timers.delete(operation.id);
        settle(operation.id);
      }, 1300),
    );
  return copy(operation);
}
function cardOwner(cardId, excludingId) {
  return (
    state.staff.find(
      (p) => p.id !== excludingId && p.cardEnabled && p.cardId === cardId,
    ) ||
    state.operations.find(
      (o) =>
        o.type === "card" &&
        o.status === "pending" &&
        o.targetId !== excludingId &&
        o.payload.enabled &&
        o.payload.cardId === cardId,
    )
  );
}
function settle(operationId) {
  const operation = state.operations.find((o) => o.id === operationId);
  if (!operation || operation.status !== "pending") return;
  try {
    if (operation.delivery === "offline" || state.mode === "offline")
      error(
        "Showcase is offline. Mock command was not delivered; confirmed state is unchanged.",
      );
    if (operation.delivery === "failed")
      error("Mock device rejected this command. Confirmed state is unchanged.");
    const at = new Date(Date.parse(state.now) + 1000).toISOString();
    if (operation.type === "assignment") {
      exhibitById(operation.targetId);
      state.assignmentHistory
        .filter((a) => !a.end)
        .forEach((a) => {
          a.end = at;
        });
      state.exhibits.forEach((e) => {
        e.showcaseId = e.id === operation.targetId ? "case-01" : null;
      });
      state.showcase.exhibitId = operation.targetId;
      state.assignmentHistory.push({
        id: id("assignment"),
        exhibitId: operation.targetId,
        showcaseId: "case-01",
        start: at,
        end: null,
      });
      // Project only unrecorded future slots; completed telemetry keeps its original exhibit.
      state.intervals
        .filter((i) => i.availability === "future" && i.start >= at)
        .forEach((i) => {
          i.exhibitId = operation.targetId;
        });
    } else if (operation.type === "label") {
      if (state.showcase.exhibitId !== operation.targetId)
        error(
          "The exhibit assignment changed before acknowledgement. Assign this exhibit and send the label again.",
        );
      state.showcase.label = {
        exhibitId: operation.targetId,
        content: copy(operation.payload.content),
        acknowledgedAt: at,
      };
    } else if (operation.type === "lighting") {
      state.showcase.lightingMode = operation.payload.mode;
      state.showcase.lightingOutput =
        operation.payload.mode === "Off"
          ? "Off"
          : operation.payload.mode === "On"
            ? "On"
            : state.showcase.zone === "Occupied"
              ? "On"
              : "Off";
    } else if (operation.type === "card") {
      const person = staffById(operation.targetId);
      if (
        operation.payload.enabled &&
        cardOwner(operation.payload.cardId, person.id)
      )
        error("This card is already assigned to another active staff member.");
      person.cardId = operation.payload.cardId;
      person.cardEnabled = operation.payload.enabled;
    }
    operation.status = "acknowledged";
    operation.acknowledgedAt = tick();
    state.showcase.lastReceivedAt = operation.acknowledgedAt;
  } catch (issue) {
    operation.status = "failed";
    operation.error = issue.message;
    tick();
  }
  const event = state.events.find((e) => e.id === `event-${operation.id}`);
  if (event) {
    event.status = operation.status;
    event.details =
      operation.error || `Mock device acknowledged ${operation.type} change.`;
    event.at = operation.acknowledgedAt || state.now;
  }
  notify();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getDemoMode() {
  return state.mode;
}
export async function getSnapshot() {
  await read();
  const result = copy(state);
  delete result.intervals;
  delete result.drafts;
  delete result.accessLog;
  delete result.sequence;
  delete result.scanSequence;
  if (state.mode === "offline") result.showcase.online = false;
  if (isEmpty()) {
    result.exhibits = [];
    result.staff = [];
    result.operations = [];
    result.events = [];
    result.assignmentHistory = [];
    result.reports = [];
    result.showcase = {
      ...result.showcase,
      exhibitId: null,
      temperature: null,
      brightness: null,
      zone: null,
      lightingMode: null,
      lightingOutput: null,
      latch: null,
      label: null,
      lastReceivedAt: null,
      online: false,
      localControl: null,
    };
  }
  return result;
}
export async function listExhibits() {
  await read();
  return copy(isEmpty() ? [] : state.exhibits);
}
export async function saveExhibit(profile) {
  await write();
  if (!profile || typeof profile !== "object")
    error("An exhibit profile is required.");
  const existing = profile.id ? exhibitById(profile.id) : null;
  const tagId = text(profile.tagId, "tagId", 40).toUpperCase();
  if (!/^EX-[A-Z0-9-]+$/.test(tagId))
    error(
      "Exhibit tags must start with EX- and contain letters, numbers or hyphens.",
      { tagId: "Use an EX- identifier" },
    );
  if (
    state.exhibits.some(
      (e) => e.id !== existing?.id && e.tagId.toUpperCase() === tagId,
    )
  )
    error("This exhibit tag is already registered.", {
      tagId: "Tag already assigned",
    });
  const record = {
    id: existing?.id || id("ex"),
    name: text(profile.name, "name", 100),
    description: text(profile.description, "description", 2000),
    tagId,
    image: imageValue(profile.image),
    temperatureMin: fieldNumber(
      profile.temperatureMin,
      "temperatureMin",
      -20,
      80,
    ),
    temperatureMax: fieldNumber(
      profile.temperatureMax,
      "temperatureMax",
      -20,
      80,
    ),
    brightnessMin: fieldNumber(profile.brightnessMin, "brightnessMin", 0, 100),
    brightnessMax: fieldNumber(profile.brightnessMax, "brightnessMax", 0, 100),
    warningSeconds: fieldNumber(
      profile.warningSeconds,
      "warningSeconds",
      1,
      3600,
      true,
    ),
    showcaseId: existing?.showcaseId || null,
  };
  if (record.temperatureMin >= record.temperatureMax)
    error("Minimum temperature must be below maximum temperature.", {
      temperatureMin: "Must be below maximum",
    });
  if (record.brightnessMin >= record.brightnessMax)
    error("Minimum brightness must be below maximum brightness.", {
      brightnessMin: "Must be below maximum",
    });
  if (existing) Object.assign(existing, record);
  else state.exhibits.push(record);
  tick();
  notify();
  return copy(record);
}
export async function assignExhibit(exhibitId) {
  await write();
  exhibitById(exhibitId);
  return queue("assignment", exhibitId, { exhibitId });
}
export async function scanExhibitTag() {
  await delay(900);
  if (["failed", "offline"].includes(state.mode))
    error(
      "Mock exhibit tag scan failed. Try again when the showcase is online.",
    );
  if (isEmpty()) error("No exhibit tag detected in the empty demo.");
  const result = { id: `EX-${++state.scanSequence}` };
  persist();
  return result;
}
export async function getLabel(exhibitId) {
  await read();
  exhibitById(exhibitId);
  const draft = state.drafts[exhibitId];
  const history = state.operations.filter(
    (o) => o.type === "label" && o.targetId === exhibitId,
  );
  return copy({
    draft: draft?.content || null,
    savedAt: draft?.savedAt || null,
    confirmed: state.showcase.label || null,
    history,
    operations: history,
  });
}
export async function saveLabelDraft(exhibitId, content) {
  await write();
  exhibitById(exhibitId);
  const value = normaliseLabel(content);
  state.drafts[exhibitId] = { content: value, savedAt: tick() };
  notify();
  return copy({ draft: value, savedAt: state.drafts[exhibitId].savedAt });
}
export async function sendLabel(exhibitId, content) {
  await write();
  exhibitById(exhibitId);
  if (state.showcase.exhibitId !== exhibitId)
    error("Assign this exhibit to Case 01 before sending its label.");
  return queue("label", exhibitId, { content: normaliseLabel(content) });
}
export async function setLighting(mode) {
  await write();
  if (!["Auto", "On", "Off"].includes(mode))
    error("Choose Auto, On or Off lighting.");
  return queue("lighting", "case-01", { mode });
}

function normaliseFilters(filters = {}) {
  const value = {
    showcaseId: filters.showcaseId || "case-01",
    start: filters.start || "2026-10-01",
    end: filters.end || "2026-10-06",
    exhibitId: filters.exhibitId || "",
  };
  for (const key of ["start", "end"]) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value[key]) ||
      !Number.isFinite(Date.parse(value[key] + "T00:00:00+08:00")) ||
      new Date(value[key] + "T00:00:00Z").toISOString().slice(0, 10) !==
        value[key]
    )
      error("Choose valid start and end dates.", { [key]: "Invalid date" });
  }
  if (value.start > value.end)
    error("Start date must be on or before end date.", {
      end: "Must follow start date",
    });
  if (value.showcaseId !== "case-01") error("Showcase not found.");
  if (value.exhibitId) exhibitById(value.exhibitId);
  return value;
}
export function aggregateActivity(intervals, events) {
  const recorded = intervals.filter((i) => i.availability === "recorded"),
    missing = intervals.filter((i) => i.availability === "missing");
  const expected = recorded.length + missing.length;
  return {
    proximityEvents: recorded.reduce((sum, i) => sum + i.events, 0),
    occupiedSeconds: recorded.reduce((sum, i) => sum + i.occupiedSeconds, 0),
    warnings: events.filter(
      (e) =>
        ["temperature", "brightness"].includes(e.type) &&
        e.status === "warning",
    ).length,
    missingIntervals: missing.length,
    recordedIntervals: recorded.length,
    expectedIntervals: expected,
    coveragePercent: expected
      ? Math.round((recorded.length / expected) * 1000) / 10
      : null,
  };
}
function activity(filters) {
  const value = normaliseFilters(filters),
    start = new Date(value.start + "T00:00:00+08:00").toISOString(),
    end = new Date(
      Date.parse(value.end + "T00:00:00+08:00") + 86400000,
    ).toISOString();
  const matches = (item) =>
    item.showcaseId === value.showcaseId &&
    (!value.exhibitId || item.exhibitId === value.exhibitId);
  const intervals = isEmpty()
    ? []
    : state.intervals.filter(
        (i) => matches(i) && i.start >= start && i.start < end,
      );
  const events = isEmpty()
    ? []
    : state.events
        .filter((e) => matches(e) && e.at >= start && e.at < end)
        .sort((a, b) => b.at.localeCompare(a.at));
  const assignmentEnd = end < state.now ? end : state.now;
  const assignments =
    isEmpty() || start >= assignmentEnd
      ? []
      : state.assignmentHistory.filter(
          (a) =>
            matches(a) && a.start < assignmentEnd && (!a.end || a.end > start),
        );
  return copy({
    filters: value,
    intervals,
    events,
    summary: aggregateActivity(intervals, events),
    assignments,
  });
}
export async function getActivity(filters = {}) {
  await read();
  return activity(filters);
}
export async function generateReport(
  filters = {},
  sections = ["history", "activity", "environment", "missing"],
) {
  await write();
  if (
    !Array.isArray(sections) ||
    sections.some(
      (s) => !["history", "activity", "environment", "missing"].includes(s),
    )
  )
    error("Choose valid report sections.");
  const data = activity(filters),
    selected = [...new Set([...sections, "missing"])];
  const report = {
    id: id("report"),
    createdAt: tick(),
    filters: data.filters,
    sections: selected,
    data,
    exhibitNames: Object.fromEntries(state.exhibits.map((e) => [e.id, e.name])),
  };
  state.reports.unshift(copy(report));
  notify();
  return copy(report);
}
export async function listReports() {
  await read();
  return copy(isEmpty() ? [] : state.reports);
}
export async function listStaff() {
  await read();
  return copy(isEmpty() ? [] : state.staff);
}
export async function saveStaff(profile) {
  await write();
  if (!profile || typeof profile !== "object")
    error("A staff profile is required.");
  const existing = profile.id ? staffById(profile.id) : null;
  const email = text(profile.email, "email", 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    error("Enter a valid email address.", { email: "Invalid email" });
  if (
    state.staff.some(
      (p) => p.id !== existing?.id && p.email.toLowerCase() === email,
    )
  )
    error("A staff member already uses this email.", {
      email: "Email already registered",
    });
  if (!["Administrator", "Operator", "Viewer"].includes(profile.role))
    error("Choose a valid role.", { role: "Invalid role" });
  const record = {
    id: existing?.id || id("staff"),
    name: text(profile.name, "name", 100),
    email,
    role: profile.role,
    cardId: existing?.cardId || null,
    cardEnabled: existing?.cardEnabled || false,
  };
  if (existing) Object.assign(existing, record);
  else state.staff.push(record);
  tick();
  notify();
  return copy(record);
}
export async function scanStaffCard() {
  await delay(900);
  if (["failed", "offline"].includes(state.mode))
    error(
      "Mock staff card scan failed. Try again when the showcase is online.",
    );
  if (isEmpty()) error("No staff card detected in the empty demo.");
  const result = { id: `CARD-${++state.scanSequence}` };
  persist();
  return result;
}
function cardCommand(staffId, cardId, enabled) {
  staffById(staffId);
  cardId = text(cardId, "cardId", 40).toUpperCase();
  if (!/^CARD-[A-Z0-9-]+$/.test(cardId))
    error(
      "Staff access cards must use a CARD- identifier; exhibit tags cannot be access cards.",
      { cardId: "Use a CARD- identifier" },
    );
  if (
    state.operations.some(
      (o) =>
        o.type === "card" && o.targetId === staffId && o.status === "pending",
    )
  )
    error(
      "This staff member already has a pending card change. Wait for acknowledgement.",
    );
  if (enabled && cardOwner(cardId, staffId))
    error(
      "This card is already assigned or reserved for another active staff member.",
      { cardId: "Card already assigned or pending" },
    );
  return queue("card", staffId, { cardId, enabled });
}
export async function registerCard(staffId, cardId) {
  await write();
  return cardCommand(staffId, cardId, true);
}
export async function setCardAccess(staffId, enabled) {
  await write();
  if (typeof enabled !== "boolean")
    error("Card access must be enabled or disabled.");
  const person = staffById(staffId);
  if (!person.cardId) error("Register a staff card first.");
  return cardCommand(staffId, person.cardId, enabled);
}
export async function getAccessLog() {
  await read();
  return copy(isEmpty() ? [] : state.accessLog);
}
export async function setDemoMode(mode) {
  await write();
  if (!DEMO_MODES.includes(mode)) error("Unknown demo mode.");
  state.mode = mode;
  notify();
  return mode;
}
export async function settlePending() {
  await write();
  const ids = state.operations
    .filter((o) => o.status === "pending")
    .map((o) => o.id);
  for (const operationId of ids) {
    clearTimeout(timers.get(operationId));
    timers.delete(operationId);
    settle(operationId);
  }
  return copy(state.operations.filter((o) => ids.includes(o.id)));
}
export async function resetDemo() {
  await write();
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  state = createInitialState();
  notify();
  return getSnapshot();
}

export const api = {
  getSnapshot,
  listExhibits,
  saveExhibit,
  assignExhibit,
  scanExhibitTag,
  getLabel,
  saveLabelDraft,
  sendLabel,
  setLighting,
  getActivity,
  generateReport,
  listReports,
  listStaff,
  saveStaff,
  scanStaffCard,
  registerCard,
  setCardAccess,
  getAccessLog,
  setDemoMode,
  resetDemo,
  settlePending,
  subscribe,
  getDemoMode,
};
