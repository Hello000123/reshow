# ReShow frontend / backend handoff

The application is a static HTML/CSS/JavaScript frontend. All device traffic, scanning, authentication, staff roles and access log entries are explicitly simulated. There is no AWS integration or hardware communication.

## Service boundary

`js/services.js` exports each function by name and an `api` object. Pages call these asynchronous functions; they never access browser storage. Replace these functions with backend requests while preserving the public data structures documented below.

| Functions | Behaviour |
| --- | --- |
| `getSnapshot`, `listExhibits`, `listStaff`, `getAccessLog` | Return cloned confirmed state. Offline mode preserves stale readings. |
| `saveExhibit`, `saveStaff` | Validate and save profiles locally; these cannot alter confirmed assignment/card fields. |
| `assignExhibit(id)` | Queue assignment; acknowledgement updates both exhibit/showcase relations and assignment history. |
| `scanExhibitTag`, `scanStaffCard` | 900 ms mock scan; distinct `EX-` and `CARD-` namespaces. |
| `getLabel(id)` | Return saved draft, actual confirmed device label, and this exhibit's label operations/history. Confirmed content may belong to another exhibit. |
| `saveLabelDraft(id, content)` | Save local draft without touching the confirmed label. |
| `sendLabel(id, content)` | Queue immutable content; require assigned exhibit at request and acknowledgement. |
| `setLighting(mode)` | Queue `Auto`, `On` or `Off`; confirmed mode/output change on acknowledgement. |
| `registerCard(staffId, cardId)`, `setCardAccess(staffId, enabled)` | Queue card changes; preserve confirmed staff records until acknowledgement. |
| `getActivity(filters)` | Filter shared hourly records, events and overlapping assignments; derive summary once. |
| `generateReport(filters, sections)`, `listReports` | Persist and return immutable data snapshots, selected sections, and exhibit names at generation time. |
| `subscribe(fn)` | Notify after local saves, queued commands, acknowledgements/failures and mode changes; returns unsubscribe. |
| `getDemoMode`, `setDemoMode`, `settlePending`, `resetDemo` | Demo controls only; `getDemoMode` is synchronous. |

## Data and time

IDs are stable strings. Use server-generated IDs for production. The single showcase is `case-01`; initial assignment is `ex-014`. Seed data includes three exhibit profiles, three staff members and historical assignments from 1–6 October 2026. Mock clock starts at **6 October 2026, 13:20 HKT** (`2026-10-06T05:20:00.000Z`) and advances deterministically on record mutations. UI formatting must use `Asia/Hong_Kong`; ISO timestamps are UTC instants.

The reference state is Blue ceramic vase (`EX-014`), Mechanical clock (`EX-015`), and Mineral sample (`EX-016`). The assigned vase has limits 20–26 °C and relative brightness 30–70 on the 0–100 scale, with 120-second warning persistence. The brightness reading of 78 has a matching 13:15 HKT warning. The confirmed label is “Blue ceramic vase” / “Student collection”, acknowledged at 13:12 HKT with a corresponding acknowledged operation/event. The latest accepted staff-card access has matching Activity and access-log entries at 12:58 HKT. The full seed period has four environmental warnings.

Activity filters use **inclusive Hong Kong calendar dates**, converting the end to the next day's exclusive midnight. Hourly intervals cover exhibition hours **09:00–17:00 HKT**. A current, incomplete hour and later hours are `future`. Future slots do not count toward expected coverage. Recorded zero events/zero occupied seconds are valid; `missing` and `future` use `null`, never a fabricated zero. Coverage is recorded / (recorded + missing), rounded to one decimal, or `null` when no expected intervals exist. Occupancy units are seconds; temperature is °C. Brightness is a **relative sensor value from 0 to 100**, not a calibrated percentage or a measurement in lux. Any `%` appearing in mock event prose is shorthand for that relative scale. Proximity events are detections, not unique people. Warning summary counts temperature/brightness warnings; missing completeness is reported separately.

Assignment history is filtered by overlap with the selected range up to the current mock instant: the effective end is the earlier of range end and `now`. Entirely future ranges contain no assignment history. Returned records retain their original start/end timestamps; reports clip their displayed periods to the selected range and report creation time.

## Public data structures

All timestamps below are ISO 8601 UTC strings. IDs, names, descriptions and enum values are strings unless stated otherwise. Nullable readings and counts represent unavailable data. Arrays and objects returned by services are independent copies.

| Structure | Fields and meaning |
| --- | --- |
| Snapshot | `now` (mock instant), `showcase` (confirmed device state), arrays `exhibits`, `staff`, `operations`, `events`, `assignmentHistory`, `reports`; `storageWarning` (string or null). The mock additionally includes `mode`. |
| Showcase | `id`, `name`, `exhibition`, `exhibitId` (nullable assigned exhibit ID); `online`, `localControl` (booleans); `lastReceivedAt` (nullable instant); `temperature` (nullable °C), `brightness` (nullable relative 0–100), `zone` (nullable received detection-zone text); `lightingMode` (`Auto`, `On`, `Off`, or null), `lightingOutput` (`On`, `Off`, or null), `latch` (received latch text or null); `label` (ConfirmedLabel or null). |
| Exhibit | `id`, `name`, `description`, `tagId` (`EX-` namespace), `image` (asset path or image data URL), `temperatureMin`, `temperatureMax` (°C), `brightnessMin`, `brightnessMax` (relative 0–100), `warningSeconds` (integer seconds), `showcaseId` (null or `case-01`). |
| LabelContent / ConfirmedLabel | Content has `title`, `collection`, `description`, `image`. ConfirmedLabel has `exhibitId`, `content` (LabelContent), `acknowledgedAt` (instant). It describes the actual displayed label independently of current assignment. |
| Label state (`getLabel`) | `draft` (LabelContent or null), `savedAt` (instant or null), `confirmed` (actual ConfirmedLabel or null), `history` and `operations` (this exhibit's label-operation arrays). `saveLabelDraft` returns `{draft, savedAt}`. |
| Operation | `id`, `type` (`lighting`, `label`, `assignment`, `card`), `targetId`, `status` (`pending`, `acknowledged`, `failed`), `requestedAt`, `acknowledgedAt` (instant or null), `payload` (respectively `{mode}`, `{content}`, `{exhibitId}`, or `{cardId, enabled}`), `error` (string or null). Mock-only `delivery` is `success`, `offline`, or `failed`. |
| Staff | `id`, `name`, `email`, `role` (`Administrator`, `Operator`, `Viewer`), `cardId` (`CARD-` namespace or null), `cardEnabled` (confirmed boolean). Roles provide no real authorization in this frontend. |
| Access log entry | `id`, `at`, `staffId` (nullable), `cardId`, `result` (`Accepted` or `Denied`), `details`. Access logs describe simulated physical card use; card-permission commands do not create access attempts. |
| Filters | `showcaseId` (`case-01`), `start`, `end` (inclusive `YYYY-MM-DD` Hong Kong dates), `exhibitId` (ID or empty string for all exhibits). Defaults cover 1–6 October 2026. |
| Interval | `id`, `start`, `end` (hourly instants), `showcaseId`, `exhibitId`, `availability` (`recorded`, `missing`, `future`), `events` (nonnegative proximity-event count or null), `occupiedSeconds` (seconds from 0–3600 or null). |
| Event | `id`, `at`, `showcaseId`, `exhibitId`, `type` (`proximity`, `temperature`, `brightness`, `missing`, `label`, `lighting`, `assignment`, `card`), `details`, `status` (`recorded`, `warning`, command status, or card result). Environmental warning values/durations are descriptive mock prose, not additional numeric telemetry fields. |
| Assignment | `id`, `exhibitId`, `showcaseId`, `start`, `end` (nullable end instant; null means the current assignment). Periods are half-open: start inclusive, end exclusive. |
| Summary | `proximityEvents` (count), `occupiedSeconds` (seconds), `warnings` (environmental-warning count), `missingIntervals`, `recordedIntervals`, `expectedIntervals` (hourly-slot counts), `coveragePercent` (0–100 coverage percentage, one decimal, or null). |
| Activity result | `filters` (normalized Filters), `intervals`, `events` (newest first), `summary`, `assignments` (overlapping past/current assignment history). |
| Report | `id`, `createdAt`, `filters`, `sections` (array containing any of `history`, `activity`, `environment`, always `missing`), `data` (immutable Activity result snapshot), `exhibitNames` (object mapping exhibit IDs to names at report creation). |

Both scan functions return `{id}`. Validation failures reject with an `Error` carrying `message` and optional `fields` (object mapping field names to readable errors). `setDemoMode` returns the selected mode, `settlePending` returns the settled Operation array, and `resetDemo` returns a fresh Snapshot.

All Overview, Activity, Reports and CSV outputs must consume the same filtered data. Reports always include `missing` completeness regardless of selected sections. Returned objects are cloned; mutating a returned report cannot alter the stored snapshot. Profile edits after report generation do not rename its historical exhibit names.

## Requested and confirmed state

Device commands resolve immediately with a `pending` operation. Normal acknowledgement occurs after approximately 1300 ms and emits a subscription update. `payload` contains the requested values; confirmed showcase/staff records remain unchanged while pending. Success sets `status: acknowledged` and `acknowledgedAt`; failure sets `status: failed` and `error`. An internal `delivery` field preserves request-time mock delivery outcome.

An assignment does not send a label. The actual device label retains its own `exhibitId` and content until a label command succeeds. A label request whose exhibit is no longer assigned at acknowledgement fails. No command remotely unlocks the showcase. Staff card updates never create synthetic access attempts.

Acknowledged assignments project onto future hourly slots that start at or after acknowledgement; recorded intervals and a currently open hour retain the exhibit assigned at their start. Concurrent assignment requests settle in request order and keep contiguous assignment history with one open assignment. Offline mode flags retained readings as stale while preserving their real last-received timestamp.

Production should use backend authorization, idempotent commands, request IDs, expected revisions, device acknowledgements, and persisted device state. Reserve enabled card IDs across both confirmed assignments and pending requests. This frontend checks both and rejects concurrent card commands for the same staff member. Revocation reserves the existing active card until acknowledgement. A disabled historic card may be reassigned, but cannot be re-enabled while another staff member owns it.

## Validation and storage

Profiles validate required names, email shape/uniqueness, roles, tag/card namespaces and duplicate IDs. Exhibit temperatures allow −20..80 °C; relative brightness allows 0..100; each minimum must be lower than its maximum. Warning duration is a whole number from 1..3600 seconds. Label titles/collections/descriptions have maximum lengths 100/120/2000. Images are local assets or supported image data URLs. Errors expose a readable `message` and optional `fields` mapping. The backend must revalidate all inputs.

Storage key is `reshow-demo-v1`, with envelope `{version:1, data:...}`. It contains profiles, drafts, commands, reports and seed records. Missing/blocked/malformed storage falls back to in-memory state and exposes `storageWarning`; malformed data is replaced only on a subsequent save. Pending requests recovered after page reload become failed because mock delivery cannot be proven. Confirmed state is preserved. Reset cancels timers and restores the seed. A real backend should recover request state from durable command records.

## Demo modes and verification

Normal reads delay 35 ms; loading reads delay 1800 ms; local writes delay 65 ms. Empty mode supplies no lists, activity or current readings/assignment. Offline mode returns stale readings and fails commands after showing pending. Failed mode rejects device commands after pending. Pending mode waits for `settlePending()`; switching to normal alone does not settle previously held requests. Scans fail in offline/failed modes. These modes affect the shared service, so all tabs remain coherent.

Run focused checks with `node tests/services.test.mjs` on Node 22+ (automatic ES module detection), or `node --test tests/services.test.mjs` where child-process execution is permitted. Tests cover aggregation, Hong Kong date boundaries, zeros/missing/future, drafts, assignment/label races, pending/failed/offline delivery, card reservations/revocation, invalid limits/tags, reports, automatic acknowledgement, subscription cleanup, persistence and storage failures. Verified on Node 24.16.0; the direct invocation works in a sandbox that blocks the test runner's child-process spawning.
