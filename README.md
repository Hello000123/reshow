# ReShow

A desktop demonstration dashboard for a reusable smart exhibition showcase. Built with HTML, CSS, plain JavaScript ES modules, and a standard-library Python server. No build step, framework, package installation, AWS connection, real authentication or hardware communication. The 3D studio loads Three.js from a CDN.

## Run locally

Open PowerShell in this project directory and run:

```powershell
python server.py
```

Stop any previously running local web server first, then open **http://127.0.0.1:8000** in a desktop browser. If port 8000 is occupied by another application, use `python server.py --port 8001` and open **http://127.0.0.1:8001**. The server hosts the dashboard and its local showcase API together; do not open `index.html` directly because browsers restrict ES modules on `file:` URLs. Press Ctrl+C in the server terminal to stop it.

Use the same origin/port to keep saved demo records. Data is stored in that browser's `localStorage`; it is not shared with a server. If storage is unavailable, an on-screen warning explains that changes are held in memory.

## Explore the seven tabs

- **Overview:** confirmed showcase status, environmental readings, assigned exhibit, actual acknowledged label, lighting requests, heatmap, and recent events.
- **Exhibits:** search/filter, create/edit profiles and limits, simulate an exhibit-tag scan, confirm assignment, and inspect illustrative model metadata.
- **Labels:** edit the live monochrome preview, choose a local image, save a draft, and separately request delivery. The previously acknowledged label remains visible until delivery succeeds.
- **Activity:** filter by Hong Kong dates and exhibit, switch heatmap measures, inspect cells with mouse or keyboard, and filter the event log.
- **Reports:** choose sections and filters, generate a stored preview, export its CSV, or use **Print / Save as PDF**. In a regular browser, choose a PDF destination in the print dialog. This is browser printing, not a direct PDF download.
- **Staff access:** edit demo staff/roles, register scanned cards, confirm revoke/restore, and filter historical accepted/denied attempts. Website roles are descriptive demo records, separate from physical card permissions.
- **3D & AI studio:** explore and adjust the 3D model, import a `.glb`, export four hologram views, and generate exhibit JSON from the included `assets/helmet.jpg` photo or another selected image. This tab uses the same Python server as the rest of the site.

Image-to-JSON generation requires Cloudflare Workers AI access. Enter your 32-character Cloudflare Account ID and API token in the **3D & AI studio** tab when generating. Credentials are sent to the local Python server for that request only; they are not stored in browser storage or written to disk. The app sends the model agreement request on the first generation. Review the [model license](https://github.com/meta-llama/llama-models/blob/main/models/llama3_2/LICENSE) and [acceptable use policy](https://github.com/meta-llama/llama-models/blob/main/models/llama3_2/USE_POLICY.md) before using it. The image is processed in memory and is not saved.

There is no Settings tab or remote unlock action. Layouts target desktop widths of 1280, 1440 and 1920 pixels. Exhibit illustrations are local editable SVG assets; model metadata in the Exhibits tab is illustrative.

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
index.html              App shell and seven-tab navigation
server.py               One Python 3 server for static files and showcase API
BACKEND_ASSET_UPLOAD.md  Backend contract proposal for exhibit .glb and .jpg assets
css/styles.css          Shared desktop components and print rules
css/exhibits.css         Exhibit and label layouts
css/staff.css            Staff directory and card registration layout
js/app.js               Routing, navigation guards, demo dialog
js/ui.js                Icons, safe text escaping, dates, dialogs, heatmaps
js/data.js              Seed records, demo clock and storage version
js/services.js          Async data access, validation and acknowledgements
js/pages/               One UI module per tab
js/pages/technology-showcase.js  3D studio and image-to-JSON generator
css/technology-showcase.css      Showcase-tab components
assets/                 Local SVG illustrations
```

The original project under `C:\Coding\EE3070\php` is not modified or removed.

## Files needed to run

Run `server.py` together with the complete `css/`, `js/` and `assets/` folders, preserving their relative paths. Python 3 standard library only; no package installation is required.

The README and `.gitignore` support repository use but are not runtime dependencies. Design references, agent instructions, implementation notes, backend handoff notes, tests and verification screenshots are local development material and are excluded from this repository's current files.

## GitHub automation

`.github/workflows/ci-deploy.yml` runs on pull requests, `master` pushes and manual dispatch. Node 22 checks JavaScript syntax and runs behavior tests, then packages only `index.html`, `css/`, `js/`, `assets/` and a commit-stamped `release.json`. Run the same checks locally with `npm run check`, `npm test`, and `npm run build`; no dependencies need installing.

Each run starts a disposable SonarQube Community container on the GitHub runner, generates a temporary masked token, scans the website, waits for analysis, and uploads quality-gate conditions, issues and measures as `sonar-report` before enforcing the gate. There is no permanent Sonar dashboard, historical/new-code baseline, PR decoration, or invented coverage. Each PR is scanned as a standalone project because Community does not provide paid branch analysis. A custom overall-code gate requires zero bugs, zero vulnerabilities and zero code smells; the workflow rejects missing, ignored or changed conditions, including an empty default gate. This strict policy evaluates existing code on every run. Original code findings remain visible in the artifact; a failing gate prevents deployment. Artifacts expire after 30 days.

Trusted `master` runs then request an advisory AI review of at most 100 sanitized Sonar rule identifiers, severities, types and line numbers plus the explicitly allowlisted public `.github/workflows/ci-deploy.yml` and `deploy/reshow-deploy.py` sources through `https://18.163.201.242/ica/harry/v1`. Each source is limited to 12,000 characters with truncation flagged. Application source, other files, issue messages, diffs and environment/secret values are not sent. The API key is decrypted from AWS SSM `/ee3070/reshow/ci/ai-api-key` using GitHub OIDC and masked immediately. `AI_MODEL` is an optional repository variable (default `claude-sonnet-5-5`). AI output is saved as the `ai-review` artifact and never executed. The review requests low reasoning effort with a completion budget bounded at 8,192 tokens; only nonempty responses with `finish_reason=stop` are accepted. Empty or truncated completions fail with sanitized finish-reason/token-budget diagnostics. A missing key or API error fails the job and blocks deployment; pull requests never receive AWS or AI credentials. The website itself makes no AI requests and holds no API key.

After checks, Sonar and AI review succeed, deployment assumes `ee3070-reshow-github-actions` in AWS account `835822826851` using OIDC. The constrained SSM document `EE3070-ReShow-DeployFrontend` deploys the exact commit to existing instance `i-00301bb65c9133a63` in `us-east-1`. CloudFront distribution `E1P2W5YKS25NPQ` is invalidated, then the workflow verifies the public `release.json` commit at **https://dkbznu9f5nh9n.cloudfront.net**. Manual dispatch from other branches runs checks only. The AI gateway is separate from website hosting.

Infrastructure prerequisites are the OIDC trust restricted to this repository's immutable-ID `master` subject (the account uses GitHub's repository-ID subject format), least-privilege SSM/parameter/CloudFront permissions, the custom SSM document and installed deployment helper. A missing prerequisite causes an explicit failed run. Browser demo records remain local to each origin; automated deployment does not add a backend or real authentication.
