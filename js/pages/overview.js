import {
  esc,
  icon,
  formatTime,
  formatDate,
  dateKey,
  badge,
  toast,
  reportError,
  statusStrip,
  metric,
  heatmap,
  bindHeatmap,
} from "../ui.js";

export async function render(container, ctx) {
  let disposed = false,
    sequence = 0,
    period = "today";
  async function draw() {
    const run = ++sequence;
    const snapshot = await ctx.api.getSnapshot();
    const s = snapshot.showcase,
      e = snapshot.exhibits.find((e) => e.id === s.exhibitId);
    const today = dateKey(snapshot.now);
    const data = await ctx.api.getActivity({
      showcaseId: "case-01",
      start: period === "today" ? today : "2026-10-01",
      end: today,
      exhibitId: "",
    });
    const todayData =
      period === "today"
        ? data
        : await ctx.api.getActivity({ start: today, end: today });
    if (disposed || run !== sequence) return;
    const pending = snapshot.operations.filter(
      (o) => o.type === "lighting" && o.status === "pending",
    );
    const lastLighting = snapshot.operations
      .filter((o) => o.type === "lighting")
      .at(-1);
    const latestLabel = snapshot.operations
      .filter((o) => o.type === "label")
      .at(-1);
    const label = s.label;
    const outBrightness =
        e &&
        s.brightness != null &&
        (s.brightness < e.brightnessMin || s.brightness > e.brightnessMax),
      outTemperature =
        e &&
        s.temperature != null &&
        (s.temperature < e.temperatureMin || s.temperature > e.temperatureMax);
    const stale = s.online ? "" : " · stale";
    const status = (value) =>
      value == null ? "No reading" : String(value) + stale;
    container.innerHTML = `<div class="stack">${statusStrip(snapshot)}
      ${outBrightness || outTemperature ? `<div class="notice warning">${icon("warning")}<strong>${outBrightness ? "Brightness" : "Temperature"} outside profile limits${stale}</strong><span>Warning persistence: ${esc(e.warningSeconds)} s</span><button class="text-button" data-alert>View alert ${icon("arrow")}</button></div>` : ""}
      <div class="metrics">${metric("Temperature", s.temperature == null ? "—" : `${s.temperature} °C`, e ? `${s.online ? "" : "Stale · "}${outTemperature ? "Outside" : "Within"} range · ${e.temperatureMin}–${e.temperatureMax} °C` : "No reading available", "temperature", outTemperature ? "amber" : "")}${metric("Relative brightness", s.brightness == null ? "—" : `${s.brightness} / 100`, e ? `${s.online ? "" : "Stale · "}${outBrightness ? "Outside" : "Within"} range · ${e.brightnessMin}–${e.brightnessMax}` : "No reading available", "sun", outBrightness ? "amber" : "")}${metric("Detection zone", s.zone || "—", s.zone ? `Last received state${stale}` : "No reading available", "users")}${metric("Proximity events today", todayData.summary.expectedIntervals ? todayData.summary.proximityEvents : "—", "Recorded events, not unique visitors", "activity")}</div>
      <div class="overview-middle">
        <section class="card"><h2 class="section-title">${icon("cube")}Current exhibit</h2>${e ? `<div class="exhibit-summary"><img src="${esc(e.image || "assets/vase.svg")}" alt="Illustration of ${esc(e.name)}"><div><h3>${esc(e.name)}</h3><p>Tag: ${esc(e.tagId)}</p>${badge("Profile assigned", "success")}</div></div><div class="actions"><button class="button" data-edit>${icon("edit")}Edit profile</button><button class="button" data-change>${icon("arrow")}Change exhibit</button></div>` : '<div class="empty">No exhibit assigned.</div><button class="button" data-change>Open exhibit library</button>'}</section>
        <section class="card"><h2 class="section-title">${icon("display")}Electronic label</h2>${label ? `<div class="epaper"><div class="epaper-inner">${label.content.image ? `<img src="${esc(label.content.image)}" alt="Label image">` : ""}<div><h3>${esc(label.content.title)}</h3><p>${esc(label.content.collection)}</p></div></div></div><div class="label-status">${icon("check")} Last update acknowledged<br><span class="muted">${esc(formatTime(label.acknowledgedAt))}</span></div>${label.exhibitId !== s.exhibitId ? '<p class="notice warning">The displayed label belongs to the previous exhibit. Send the new label when ready.</p>' : ""}` : '<div class="empty">No acknowledged label.</div>'}${latestLabel && latestLabel.status !== "acknowledged" ? `<p class="small-text" style="margin-bottom:10px">${badge(latestLabel.status === "pending" ? "Pending delivery" : "Failed update", latestLabel.status)} ${esc(latestLabel.error || "Waiting for the showcase")}</p>` : ""}<button class="button full" data-label ${e ? "" : "disabled"}>${icon("edit")}Edit label</button><p class="muted small-text" style="margin-top:7px">Illustrative e-paper layout</p></section>
        <section class="card"><h2 class="section-title">${icon("sun")}Lighting & access</h2><div class="segmented" role="group" aria-label="Lighting mode">${["Auto", "On", "Off"].map((mode) => `<button type="button" data-mode="${mode}" aria-pressed="${s.lightingMode === mode}" class="${s.lightingMode === mode ? "active" : ""}" ${pending.length || !e ? "disabled" : ""}>${mode}</button>`).join("")}</div><p class="device-detail">Confirmed mode: <strong>${esc(status(s.lightingMode))}</strong></p><p class="device-detail">Light output: <strong>${esc(status(s.lightingOutput))}</strong></p><p class="muted small-text">Clear-zone delay: 30 s</p>${pending.length ? `<p class="notice warning" style="margin-top:10px">Requested ${esc(pending.at(-1).payload.mode)} · Pending acknowledgement</p>` : lastLighting?.status === "failed" ? `<p class="notice error" style="margin-top:10px">Previous lighting request failed: ${esc(lastLighting.error)}</p>` : ""}<div class="latch">${icon("lock")}<div>Latch: <strong>${esc(status(s.latch))}</strong><p class="muted">Staff card required</p></div></div></section>
      </div>
      <div class="overview-bottom"><section class="card"><div class="card-head"><h2>${icon("activity")}Activity over time</h2><select class="compact-range" aria-label="Overview activity period" data-period><option value="today" ${period === "today" ? "selected" : ""}>Today</option><option value="all" ${period === "all" ? "selected" : ""}>1–6 Oct</option></select></div><p class="small-text">Occupied duration per completed hour</p>${heatmap(data.intervals, "occupiedSeconds", period === "today")}<p class="footnote">Anonymous proximity activity; no visitor identification. Open and future hours are not yet counted.</p></section><section class="card"><div class="card-head"><h2>${icon("clock")}Recent activity</h2></div>${
        data.events.length
          ? data.events
              .slice(0, 4)
              .map(
                (event) =>
                  `<div class="recent-event"><time>${esc(formatTime(event.at).replace(" HKT", ""))}</time><i class="status-dot ${event.status === "warning" || event.status === "failed" ? "offline" : ""}"></i><span>${esc(event.type === "proximity" ? "Proximity event" : event.type.charAt(0).toUpperCase() + event.type.slice(1) + " · " + event.status)}</span></div>`,
              )
              .join("")
          : '<p class="empty">No events recorded.</p>'
      }<div class="recent-footer"><button class="text-button" data-events>View all events ${icon("arrow")}</button></div></section></div></div>`;
    container
      .querySelector("[data-edit]")
      ?.addEventListener("click", () =>
        ctx.navigate("exhibits", { exhibitId: e.id, edit: true }),
      );
    container.querySelector("[data-change]").onclick = () =>
      ctx.navigate("exhibits");
    container.querySelector("[data-label]").onclick = () =>
      ctx.navigate("labels", { exhibitId: e?.id });
    container.querySelector("[data-events]").onclick = () =>
      ctx.navigate("activity", {
        start: period === "today" ? today : "2026-10-01",
        end: today,
      });
    container.querySelector("[data-alert]")?.addEventListener("click", () =>
      ctx.navigate("activity", {
        start: today,
        end: today,
        eventType: outBrightness ? "brightness" : "temperature",
      }),
    );
    container.querySelector("[data-period]").onchange = (event) => {
      period = event.target.value;
      draw().catch(reportError);
    };
    container.querySelectorAll("[data-mode]").forEach(
      (button) =>
        (button.onclick = async () => {
          container
            .querySelectorAll("[data-mode]")
            .forEach((b) => (b.disabled = true));
          try {
            await ctx.api.setLighting(button.dataset.mode);
            toast("Demo lighting request queued. Waiting for acknowledgement.");
            await draw();
          } catch (error) {
            toast(error.message, "error");
            await draw();
          }
        }),
    );
    bindHeatmap(container);
  }
  await draw();
  const unsubscribe = ctx.api.subscribe(() => {
    draw().catch((error) => {
      if (!disposed) toast(error.message, "error");
    });
  });
  return () => {
    disposed = true;
    unsubscribe();
  };
}
