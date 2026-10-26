# ReShow

A desktop demonstration dashboard for a reusable smart exhibition showcase. Built with HTML, CSS and plain JavaScript ES modules. No build step, framework, runtime dependency, backend, AWS connection, real authentication or hardware communication.

## Run locally

Open PowerShell in this project directory and run:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Open **http://127.0.0.1:8000** in a desktop browser. If port 8000 is occupied, choose another port. Use a static HTTP server rather than opening `index.html` directly: browsers restrict ES modules on `file:` URLs. Press Ctrl+C in the server terminal to stop it.

Use the same origin/port to keep saved demo records. Data is stored in that browser's `localStorage`; it is not shared with a server. If storage is unavailable, an on-screen warning explains that changes are held in memory.

## Explore the six tabs

- **Overview:** confirmed showcase status, environmental readings, assigned exhibit, actual acknowledged label, lighting requests, heatmap, and recent events.
- **Exhibits:** search/filter, create/edit profiles and limits, simulate an exhibit-tag scan, confirm assignment, and inspect illustrative model metadata.
- **Labels:** edit the live monochrome preview, choose a local image, save a draft, and separately request delivery. The previously acknowledged label remains visible until delivery succeeds.
- **Activity:** filter by Hong Kong dates and exhibit, switch heatmap measures, inspect cells with mouse or keyboard, and filter the event log.
- **Reports:** choose sections and filters, generate a stored preview, export its CSV, or use **Print / Save as PDF**. In a regular browser, choose a PDF destination in the print dialog. This is browser printing, not a direct PDF download.
- **Staff access:** edit demo staff/roles, register scanned cards, confirm revoke/restore, and filter historical accepted/denied attempts. Website roles are descriptive demo records, separate from physical card permissions.

There is no Settings tab or remote unlock action. Layouts target desktop widths of 1280, 1440 and 1920 pixels. The small exhibit illustrations are local editable SVG assets; model previews are metadata only.

## Demo controls

The bottom-left **Demo controls** button opens a development dialog:

| Scenario | Behaviour |
| --- | --- |
| Normal | Commands acknowledge after about 1.3 seconds. |
| Loading | Service reads take about 1.8 seconds each; loading feedback remains visible. |
| Empty | No records or readings are displayed; existing stored edits are preserved. |
| Offline | Retained readings are stale. Label sending is disabled; other requested device commands fail without changing confirmed state. |
| Pending | Commands remain pending until **Acknowledge pending** is clicked. Switching back to Normal alone does not settle already held commands. |
| Failed | A command shows pending, then fails while confirmed device state stays unchanged. |

**Reset demo records** restores the seed after confirmation and removes demo edits/reports. Reloading with a pending command marks it failed because delivery cannot be established across reloads.

The fixed demonstration clock starts on **6 October 2026 at 13:20 HKT**, matching the reference exhibition, and advances deterministically during actions. It is deliberately separate from the computer's current date. All displayed timestamps use Hong Kong time. Activity covers exhibition hours 09:00–17:00 on 1–6 October. Incomplete and future hours are excluded from totals; missing observations are never counted as zero. CSV timestamps are explicitly labelled UTC and retain full precision. Duration cards display whole minutes.

## Source map

```text
index.html              App shell and six-tab navigation
css/styles.css          Shared desktop components and print rules
css/exhibits.css         Exhibit and label layouts
css/staff.css            Staff directory and card registration layout
js/app.js               Routing, navigation guards, demo dialog
js/ui.js                Icons, safe text escaping, dates, dialogs, heatmaps
js/data.js              Seed records, demo clock and storage version
js/services.js          Async data access, validation and acknowledgements
js/pages/               One UI module per tab
assets/                 Local SVG illustrations
tests/                  Focused service/export checks and image fixture
BACKEND_HANDOFF.md       Public service contracts and data structures
VERIFICATION.md         Browser checks and known verification limits
```

To connect the teammate's backend, replace service internals while retaining page-facing shapes. See **BACKEND_HANDOFF.md** for fields, units, validation, operation status and acknowledgement semantics. Production authentication, permissions, telemetry, command delivery, durable storage, image storage and hardware integration belong to the backend/device work.

## Focused checks

The app does not need Node.js. Node 22+ can optionally run the development checks:

```powershell
node tests/services.test.mjs
node tests/report-export.test.mjs
```

No package installation is required. The tests run with in-memory fake storage, without altering browser demo records.
