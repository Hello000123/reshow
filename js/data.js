// All demo dates are absolute instants; the interface displays Asia/Hong_Kong.
export const STORAGE_KEY = "reshow-demo-v1";
export const STORAGE_VERSION = 1;
export const DEMO_NOW = "2026-10-06T05:20:00.000Z";
export const DEMO_MODES = [
  "normal",
  "loading",
  "empty",
  "offline",
  "pending",
  "failed",
];

const instant = (day, hour, minute = 0) =>
  new Date(
    `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`,
  ).toISOString();

export function createInitialState() {
  const exhibits = [
    {
      id: "ex-014",
      name: "Blue ceramic vase",
      description:
        "A hand-glazed ceramic vase with a deep blue finish. Its curved silhouette and subtle surface detail explore the relationship between traditional craft, light, and form.",
      tagId: "EX-014",
      image: "assets/vase.svg",
      temperatureMin: 20,
      temperatureMax: 26,
      brightnessMin: 30,
      brightnessMax: 70,
      warningSeconds: 120,
      showcaseId: "case-01",
    },
    {
      id: "ex-015",
      name: "Mechanical clock",
      description:
        "A mechanical clock with an exposed movement, demonstrating the precision of gears, escapements, and the passage of time.",
      tagId: "EX-015",
      image: "assets/clock.svg",
      temperatureMin: 16,
      temperatureMax: 28,
      brightnessMin: 25,
      brightnessMax: 80,
      warningSeconds: 45,
      showcaseId: null,
    },
    {
      id: "ex-016",
      name: "Mineral sample",
      description:
        "A crystalline mineral specimen selected for its striking facets and natural colour, showing the structures formed over geological time.",
      tagId: "EX-016",
      image: "assets/mineral.svg",
      temperatureMin: 18,
      temperatureMax: 24,
      brightnessMin: 10,
      brightnessMax: 55,
      warningSeconds: 20,
      showcaseId: null,
    },
  ];
  const staff = [
    {
      id: "staff-001",
      name: "Sarah Chen",
      email: "sarah.chen@reshow.demo",
      role: "Administrator",
      cardId: "CARD-1001",
      cardEnabled: true,
    },
    {
      id: "staff-002",
      name: "James Wong",
      email: "james.wong@reshow.demo",
      role: "Operator",
      cardId: "CARD-1002",
      cardEnabled: true,
    },
    {
      id: "staff-003",
      name: "Emily Lau",
      email: "emily.lau@reshow.demo",
      role: "Viewer",
      cardId: null,
      cardEnabled: false,
    },
  ];
  const assignmentHistory = [
    {
      id: "assignment-001",
      exhibitId: "ex-015",
      showcaseId: "case-01",
      start: instant(1, 9),
      end: instant(3, 12),
    },
    {
      id: "assignment-002",
      exhibitId: "ex-016",
      showcaseId: "case-01",
      start: instant(3, 12),
      end: instant(5, 10),
    },
    {
      id: "assignment-003",
      exhibitId: "ex-014",
      showcaseId: "case-01",
      start: instant(5, 10),
      end: null,
    },
  ];
  const intervals = [];
  const events = [];
  for (let day = 1; day <= 6; day++) {
    for (let hour = 9; hour < 17; hour++) {
      const start = instant(day, hour),
        end = instant(day, hour + 1);
      const assignment = assignmentHistory.find(
        (a) => start >= a.start && (!a.end || start < a.end),
      );
      const future = end > DEMO_NOW;
      const missing = ["2-14", "4-11", "5-15", "6-10"].includes(
        `${day}-${hour}`,
      );
      const zero = ["1-9", "3-16", "6-9"].includes(`${day}-${hour}`);
      const count = zero ? 0 : 7 + ((day * 7 + hour * 3) % 19);
      const availability = future ? "future" : missing ? "missing" : "recorded";
      const interval = {
        id: `interval-${day}-${hour}`,
        start,
        end,
        showcaseId: "case-01",
        exhibitId: assignment.exhibitId,
        availability,
        events: availability === "recorded" ? count : null,
        occupiedSeconds: availability === "recorded" ? count * 39 : null,
      };
      intervals.push(interval);
      if (availability === "recorded") {
        for (let index = 0; index < count; index++)
          events.push({
            id: `proximity-${day}-${hour}-${index}`,
            at: new Date(
              Date.parse(start) +
                (index + 1) * Math.floor(3600000 / (count + 1)),
            ).toISOString(),
            showcaseId: "case-01",
            exhibitId: assignment.exhibitId,
            type: "proximity",
            details: "Mock proximity event detected in front of the showcase.",
            status: "recorded",
          });
      } else if (availability === "missing") {
        events.push({
          id: `missing-${day}-${hour}`,
          at: start,
          showcaseId: "case-01",
          exhibitId: assignment.exhibitId,
          type: "missing",
          details:
            "No telemetry received for this hourly interval. Occupancy and event counts are unavailable.",
          status: "warning",
        });
      }
    }
  }
  const warning = (id, day, hour, type, details) => {
    const at = instant(day, hour, 35);
    const a = assignmentHistory.find(
      (a) => at >= a.start && (!a.end || at < a.end),
    );
    return {
      id,
      at,
      showcaseId: "case-01",
      exhibitId: a.exhibitId,
      type,
      details,
      status: "warning",
    };
  };
  events.push(
    warning(
      "warning-001",
      2,
      11,
      "temperature",
      "Temperature reached 28.4 °C for 52 seconds; configured maximum was 28 °C.",
    ),
    warning(
      "warning-002",
      4,
      14,
      "brightness",
      "Relative brightness reached 62 / 100 for 38 seconds; configured maximum was 55 / 100.",
    ),
    warning(
      "warning-003",
      5,
      12,
      "temperature",
      "Temperature reached 26.7 °C for 144 seconds; configured maximum was 26 °C.",
    ),
  );
  events.push({
    id: "warning-004",
    at: instant(6, 13, 15),
    showcaseId: "case-01",
    exhibitId: "ex-014",
    type: "brightness",
    details:
      "Relative brightness remained at 78 / 100 for 120 seconds; configured maximum was 70 / 100.",
    status: "warning",
  });
  const content = {
    title: "Blue ceramic vase",
    collection: "Student collection",
    description: exhibits[0].description,
    image: exhibits[0].image,
  };
  const labelOperation = {
    id: "op-090",
    type: "label",
    targetId: "ex-014",
    status: "acknowledged",
    requestedAt: instant(6, 13, 11),
    acknowledgedAt: instant(6, 13, 12),
    payload: { content: { ...content } },
    error: null,
    delivery: "success",
  };
  events.push({
    id: "event-op-090",
    at: labelOperation.acknowledgedAt,
    showcaseId: "case-01",
    exhibitId: "ex-014",
    type: "label",
    details: "Mock device acknowledged label change.",
    status: "acknowledged",
  });
  events.push({
    id: "event-access-003",
    at: instant(6, 12, 58),
    showcaseId: "case-01",
    exhibitId: "ex-014",
    type: "card",
    details: "Mock staff-card access accepted for James Wong (CARD-1002).",
    status: "Accepted",
  });
  return {
    now: DEMO_NOW,
    mode: "normal",
    sequence: 100,
    scanSequence: 2000,
    showcase: {
      id: "case-01",
      name: "Case 01",
      exhibition: "School exhibition",
      exhibitId: "ex-014",
      online: true,
      lastReceivedAt: instant(6, 13, 18),
      localControl: true,
      temperature: 23.6,
      brightness: 78,
      zone: "Occupied",
      lightingMode: "Auto",
      lightingOutput: "On",
      latch: "Locked",
      label: {
        exhibitId: "ex-014",
        content,
        acknowledgedAt: labelOperation.acknowledgedAt,
      },
    },
    exhibits,
    staff,
    intervals,
    events,
    assignmentHistory,
    operations: [labelOperation],
    reports: [],
    drafts: {
      "ex-014": { content: { ...content }, savedAt: instant(6, 13, 10) },
    },
    accessLog: [
      {
        id: "access-003",
        at: instant(6, 12, 58),
        staffId: "staff-002",
        cardId: "CARD-1002",
        result: "Accepted",
        details: "Mock card acknowledgement: authorised staff access.",
      },
      {
        id: "access-002",
        at: instant(6, 9, 8),
        staffId: null,
        cardId: "CARD-1099",
        result: "Denied",
        details: "Mock card acknowledgement: card is not registered.",
      },
      {
        id: "access-001",
        at: instant(5, 10, 3),
        staffId: "staff-001",
        cardId: "CARD-1001",
        result: "Accepted",
        details: "Mock card acknowledgement: authorised staff access.",
      },
    ],
    storageWarning: null,
  };
}
