# ReShow verification

Verified locally on 25 October 2026 using the Codex in-app desktop browser and a Python static server. The application itself uses its fixed 6 October 2026 demonstration clock.

## Browser review

All six tabs were visually compared against the supplied reference images at **1280×1000**, **1440×1000**, and **1920×1080** desktop viewports. The layouts retain the sidebar, navy/teal palette, white cards, exhibit/profile columns, label editor/preview, activity heatmap/log, report settings/preview, and staff/card panels. DOM measurements at each width found no page or card horizontal overflow. Vertical scrolling is intentional. Local SVG exhibit illustrations replace the reference photographs.

Final full-page screenshots are in `verification/`:

- `overview-1440.jpg`
- `exhibits-1440.jpg`
- `labels-1440.jpg`
- `activity-1440.jpg`
- `reports-1440.jpg`
- `staff-1440.jpg`

Browser warning/error log query returned **no console warnings or errors** during the final six-tab review.

## Exercised interactions

| Area | Checks performed |
| --- | --- |
| Navigation | All tabs, Overview edit-profile shortcut, warning-to-filtered-Activity link, current exhibit/label context, Activity-to-Reports filters. |
| Exhibits | Search by tag, no-match results, add profile, duplicate-tag rejection, minimum/maximum validation, explicit assignment confirmation, assignment reflected in Overview, scanned `EX-` tag prefilled in registration form. |
| Labels | Live title preview, navigation discard guard/cancel, save draft, reload persistence, actual device label unchanged by draft save, pending delivery, acknowledgement, failed delivery, valid local PNG upload and image preview. Empty-state regression verified after fixing an absent-label guard. |
| Lighting | Held pending command and manual acknowledgement; offline command failure preserves confirmed mode/output and marks retained state stale. |
| Activity | Date and exhibit filters, switch to event frequency, zero/missing/future distinction, event log filtering, interval details opened with keyboard Enter. |
| Reports | Generate stored previews; selected section exclusion; completeness always included; open stored report; filtered totals agree with Activity; actual CSV downloaded and contents inspected. |
| Staff | Confirm registration disabled before detection; choose staff, scan `CARD-` identifier, confirm registration, observe pending then enabled state; confirmed revoke and restore; add staff/role; search; denied-log filtering; duplicate-email rejection with field error. |
| Demo controls | Normal, Loading, Empty, Offline, Pending, Failed; reset with confirmation. Empty readings show unavailable values rather than zero. |
| Persistence | Saved label remains after reload while acknowledged label stays separate; service tests also cover profile/report persistence, malformed/unavailable storage, and interrupted pending commands. |

The Mechanical clock selection for 1–3 October produced **285 events, 11,115 occupied seconds, one environmental warning and 18/19 recorded intervals (94.7%)** in shared data. Activity and report cards showed the same 285 events and 3 h 5 min; the downloaded CSV retained 11,115 seconds. The full sample period produces **590 events, 23,010 occupied seconds, four environmental warnings and 40/44 recorded intervals (90.9%)**. Missing and future CSV cells remain blank, while recorded zeros export as zero.

Temporary test profiles, drafts, card changes and scenarios were reset after testing. The browser is left with the original sample exhibition and one newly generated full-period demo report.

## Automated checks

```powershell
node tests/services.test.mjs
node tests/report-export.test.mjs
```

**13/13 service tests and 1/1 CSV test passed.** Every JavaScript source file also passed `node --check`. Checks cover requested versus confirmed state, offline/failure outcomes, drafts, acknowledgement/assignment races, duplicate active and reserved cards, limits/tags, coherent HKT aggregation, future-only report ranges, immutable reports, reload recovery, storage failure, CSV sections, missing values, CSV quoting/formula safety, and clipping display periods to report dates.

## Verification limits and backend work

The **Print / Save as PDF** control is wired to `window.print()` and has a dedicated print stylesheet that removes dashboard navigation, controls and report history. Clicking it in the in-app browser produced a browser-control timeout, and the native print dialog was not exposed for visual inspection. The final OS print dialog and saved PDF pagination therefore remain unverified; use a regular desktop browser to perform that final check. The UI correctly describes browser printing rather than a direct PDF download.

No Settings tab, mobile-specific layout, framework, backend, AWS endpoint, credential, real authentication or hardware command was added. Production authentication/authorization, telemetry, device acknowledgement transport, durable data/image storage and actual e-paper rendering remain backend/device integration work, as scoped in `BACKEND_HANDOFF.md`.
