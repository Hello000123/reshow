import {
  esc,
  icon,
  formatTime,
  formatDate,
  badge,
  toast,
  reportError,
  confirmAction,
  showDialog,
} from "../ui.js";

export async function render(container, ctx) {
  const { api } = ctx;
  let [staff, access, snapshot] = await Promise.all([
    api.listStaff(),
    api.getAccessLog(),
    api.getSnapshot(),
  ]);
  let disposed = false,
    refreshSequence = 0,
    scanning = false,
    registering = false,
    detected = null;
  let search = "",
    filter = "",
    resultFilter = "";
  let activeProfile = null;
  const cardOperations = () =>
    (snapshot.operations || []).filter((op) => op.type === "card");
  const pendingFor = (id) =>
    cardOperations().find(
      (op) => op.targetId === id && op.status === "pending",
    );
  const initials = (name) =>
    name
      .trim()
      .split(/\s+/)
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  container.innerHTML = `<div class="staff-page stack">
    <div class="staff-status"><span class="staff-connection"></span><span>Case 01</span><span class="muted">Staff cards and exhibit tags are separate</span></div>
    <div class="staff-columns">
      <section class="card staff-directory"><div class="card-head"><h2>${icon("users")} Staff directory</h2><div class="actions"><span class="muted staff-count"></span><button class="button primary small" data-add>${icon("plus")} Add staff</button></div></div>
        <div class="staff-filters"><label class="staff-search">${icon("search")}<input type="search" aria-label="Search staff or card" placeholder="Search staff or card…"></label><select aria-label="Filter staff"><option value="">All staff</option><option>Administrator</option><option>Operator</option><option>Viewer</option><option value="enabled">Card enabled</option><option value="revoked">Card revoked</option><option value="unassigned">No card assigned</option></select></div>
        <div class="table-wrap"><table class="staff-table"><thead><tr><th>Staff</th><th>Website role</th><th>Access card</th><th>Card access</th><th>Action</th></tr></thead><tbody data-directory></tbody></table></div>
        <p class="staff-footnote">${icon("info")} Card changes take effect after a simulated showcase acknowledgement.</p>
        <div class="staff-roles"><h3>Website roles</h3><dl><div><dt>Administrator</dt><dd>Manage staff, cards and dashboard controls</dd></div><div><dt>Operator</dt><dd>Manage exhibits, labels and lighting</dd></div><div><dt>Viewer</dt><dd>View readings, activity and reports</dd></div></dl><p class="muted">Demonstration only: website roles are descriptive and do not enforce security. Physical card access is managed separately.</p></div>
      </section>
      <section class="card staff-register"><div class="card-head"><h2>${icon("card")} Register access card</h2></div>
        <label class="staff-register-field"><span>Assign to staff</span><select data-assignee aria-label="Assign card to staff"></select></label>
        <label class="staff-register-field"><span>Showcase</span><select aria-label="Showcase"><option>Case 01</option></select></label>
        <div class="staff-scan"><div class="staff-scan-art" aria-hidden="true">${icon("scan")}${icon("card")}</div><h3 data-scan-title>Ready to scan</h3><p class="muted" data-scan-detail>No new card detected</p><div class="staff-detected" data-detected hidden></div><button class="button" data-scan>${icon("scan")} Start simulated scan</button><button class="button primary" data-register disabled>Confirm registration</button><p class="muted staff-scan-help">Scan a staff card, check its ID, then confirm.</p></div>
        <div class="notice info">${icon("info")} Mock scans and acknowledgements only. Exhibit tags cannot grant access.</div><div data-card-status aria-live="polite"></div>
      </section>
    </div>
    <section class="card staff-access-log"><div class="card-head"><h2>${icon("report")} Access log</h2><select aria-label="Filter access log"><option value="">All results</option><option>Accepted</option><option>Denied</option></select></div><div class="table-wrap"><table><thead><tr><th>Time (HKT)</th><th>Card / staff</th><th>Result</th><th>Details</th></tr></thead><tbody data-log></tbody></table></div><p class="muted staff-log-note">Sample historical access records. This dashboard has no remote unlock control.</p></section>
  </div>`;
  const $ = (selector) => container.querySelector(selector);
  const assignee = $("[data-assignee]"),
    scanButton = $("[data-scan]"),
    registerButton = $("[data-register]");
  function message(error) {
    return (
      error?.message ||
      "The operation could not be completed. Please try again."
    );
  }
  function drawDirectory() {
    $(".staff-count").textContent = `${staff.length} staff`;
    const visible = staff.filter((person) => {
      const matchesText = [
        person.name,
        person.email,
        person.cardId,
        person.role,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
      const matchesFilter =
        !filter ||
        person.role === filter ||
        (filter === "enabled" && person.cardId && person.cardEnabled) ||
        (filter === "revoked" && person.cardId && !person.cardEnabled) ||
        (filter === "unassigned" && !person.cardId);
      return matchesText && matchesFilter;
    });
    $("[data-directory]").innerHTML = visible.length
      ? visible
          .map(
            (person) =>
              `<tr><td><div class="staff-person"><span class="staff-avatar">${esc(initials(person.name))}</span><span><strong>${esc(person.name)}</strong><small>${esc(person.email || "")}</small></span></div></td><td>${esc(person.role)}</td><td class="staff-card-id">${esc(person.cardId || "Not assigned")}</td><td>${pendingFor(person.id) ? badge("Pending confirmation", "warning") : person.cardId ? badge(person.cardEnabled ? "Enabled" : "Revoked", person.cardEnabled ? "success" : "neutral") : badge("No card", "neutral")}</td><td><button class="button small" data-manage="${esc(person.id)}">Manage</button></td></tr>`,
          )
          .join("")
      : '<tr><td colspan="5" class="empty">No staff match your filters.</td></tr>';
    const selected = assignee.value;
    assignee.innerHTML = staff.length
      ? '<option value="">Select staff…</option>' +
        staff
          .map(
            (person) =>
              `<option value="${esc(person.id)}">${esc(person.name)}</option>`,
          )
          .join("")
      : '<option value="">No staff available</option>';
    if (staff.some((person) => person.id === selected))
      assignee.value = selected;
    const latest = cardOperations()
      .slice()
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .slice(0, 3);
    $("[data-card-status]").innerHTML = latest
      .map(
        (op) =>
          `<div class="staff-operation">${badge(op.status === "acknowledged" ? "Acknowledged" : op.status === "failed" ? "Failed" : "Pending", op.status === "acknowledged" ? "success" : op.status === "failed" ? "danger" : "warning")}<span>${esc(staff.find((person) => person.id === op.targetId)?.name || "Card change")} · ${esc(formatTime(op.requestedAt))}${op.error ? `<br>${esc(op.error)}` : ""}</span></div>`,
      )
      .join("");
    $(".staff-connection").innerHTML = badge(
      snapshot.showcase.online ? "Online · demo" : "Offline · demo",
      snapshot.showcase.online ? "success" : "warning",
    );
    updateScan();
  }
  function drawLog() {
    const rows = access
      .filter((record) => !resultFilter || record.result === resultFilter)
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at));
    $("[data-log]").innerHTML = rows.length
      ? rows
          .map(
            (record) =>
              `<tr><td><span>${esc(formatTime(record.at))}</span><small class="staff-log-date">${esc(formatDate(record.at))}</small></td><td>${esc(record.cardId || "Unregistered card")}${record.staffId ? ` · ${esc(staff.find((person) => person.id === record.staffId)?.name || "Unknown staff")}` : ""}</td><td>${badge(record.result, record.result === "Accepted" ? "success" : "danger")}</td><td>${esc(record.details)}</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="4" class="empty">No access records match this filter.</td></tr>';
  }
  function updateScan() {
    const person = staff.find((row) => row.id === assignee.value);
    registerButton.disabled =
      !detected ||
      !person ||
      scanning ||
      registering ||
      !!pendingFor(person.id);
    registerButton.textContent = registering
      ? "Requesting registration…"
      : "Confirm registration";
    scanButton.disabled = scanning || registering;
    scanButton.innerHTML = `${icon("scan")} ${scanning ? "Scanning…" : detected ? "Scan another card" : "Start simulated scan"}`;
    $("[data-detected]").hidden = !detected;
    $("[data-detected]").textContent = detected || "";
  }
  async function reload() {
    const sequence = ++refreshSequence;
    try {
      const values = await Promise.all([
        api.listStaff(),
        api.getAccessLog(),
        api.getSnapshot(),
      ]);
      if (disposed || sequence !== refreshSequence) return;
      [staff, access, snapshot] = values;
      drawDirectory();
      drawLog();
    } catch (error) {
      if (!disposed) toast(message(error), "danger");
    }
  }
  function openProfile(person = null) {
    showDialog(
      person ? "Manage staff" : "Add staff",
      `<form class="staff-profile-form"><div class="form-grid"><label class="field">Full name<input name="name" value="${esc(person?.name || "")}" maxlength="80" required></label><label class="field">Email<input type="email" name="email" value="${esc(person?.email || "")}" maxlength="150" required></label><label class="field">Website role<select name="role">${["Administrator", "Operator", "Viewer"].map((role) => `<option${role === (person?.role || "Viewer") ? " selected" : ""}>${role}</option>`).join("")}</select></label></div><p class="notice info">Roles are descriptive in this demo; real authorization must be enforced by the backend.</p><p class="staff-form-error" role="alert"></p><div class="actions"><button class="button" type="button" data-cancel>Cancel</button><button class="button primary" type="submit">${person ? "Save profile" : "Add staff"}</button></div></form>${person ? `<div class="staff-manage-card"><h3>Physical access card</h3><p>${esc(person.cardId || "No card assigned")} · ${esc(person.cardId ? (person.cardEnabled ? "Enabled" : "Revoked") : "Use the registration panel to assign a card.")}</p>${person.cardId ? `<button class="button ${person.cardEnabled ? "danger" : ""}" data-access ${pendingFor(person.id) ? "disabled" : ""}>${person.cardEnabled ? "Revoke card access" : "Restore card access"}</button>` : ""}${pendingFor(person.id) ? '<p class="muted">A card change is awaiting acknowledgement.</p>' : ""}</div>` : ""}`,
      (dialog) => {
        const form = dialog.querySelector("form");
        const originalClose = dialog.close.bind(dialog);
        const profileValues = () => JSON.stringify([...new FormData(form)]);
        const initialValues = profileValues();
        let profileDirty = false,
          confirmingClose = false,
          saving = false;
        const updateDirty = () => {
          profileDirty = profileValues() !== initialValues;
          ctx.setDirty(profileDirty);
        };
        form.addEventListener("input", updateDirty);
        form.addEventListener("input", (event) => {
          event.target.removeAttribute("aria-invalid");
          event.target.removeAttribute("aria-describedby");
          event.target
            .closest(".field")
            ?.querySelector(".field-error")
            ?.remove();
        });
        form.addEventListener("change", updateDirty);
        async function requestClose() {
          if (saving || confirmingClose) return false;
          confirmingClose = true;
          const discard =
            !profileDirty ||
            (await confirmAction(
              "Discard profile changes?",
              "Your unsaved staff profile changes will be lost.",
              "Discard changes",
            ));
          confirmingClose = false;
          if (!discard || disposed) return false;
          originalClose();
          return true;
        }
        // Shared dialog chrome and backdrop use close(); intercept all dismiss paths.
        dialog.close = requestClose;
        dialog.addEventListener("cancel", (event) => {
          event.preventDefault();
          requestClose().catch(reportError);
        });
        dialog.addEventListener(
          "close",
          () => {
            ctx.setDirty(false);
            if (activeProfile?.dialog === dialog) activeProfile = null;
          },
          { once: true },
        );
        activeProfile = { dialog, forceClose: originalClose };
        dialog
          .querySelector("[data-cancel]")
          .addEventListener("click", () => dialog.close());
        dialog
          .querySelector("form")
          .addEventListener("submit", async (event) => {
            event.preventDefault();
            const form = event.currentTarget,
              button = form.querySelector('[type="submit"]');
            const values = new FormData(form),
              name = String(values.get("name")).trim(),
              email = String(values.get("email")).trim();
            if (!name) {
              form.querySelector('[role="alert"]').textContent =
                "Enter a staff name.";
              return;
            }
            button.disabled = true;
            saving = true;
            try {
              await api.saveStaff({
                ...(person || {}),
                name,
                email,
                role: values.get("role"),
              });
              originalClose();
              if (!disposed) {
                toast("Staff profile saved locally.");
                await reload();
              }
            } catch (error) {
              if (!disposed) {
                form.querySelector('[role="alert"]').textContent =
                  message(error);
                for (const [name, detail] of Object.entries(
                  error.fields || {},
                )) {
                  const input = form.elements[name];
                  if (!input) continue;
                  input
                    .closest(".field")
                    .querySelector(".field-error")
                    ?.remove();
                  const help = document.createElement("small");
                  help.className = "field-error";
                  help.id = `staff-error-${name}`;
                  help.textContent = detail;
                  input.closest(".field").append(help);
                  input.setAttribute("aria-invalid", "true");
                  input.setAttribute("aria-describedby", help.id);
                  input.focus();
                }
                button.disabled = false;
              }
            } finally {
              saving = false;
            }
          });
        dialog
          .querySelector("[data-access]")
          ?.addEventListener("click", async (event) => {
            const enabled = !person.cardEnabled;
            // Close this modal before opening a separate confirmation modal.
            if (!(await requestClose())) return;
            if (
              !(await confirmAction(
                enabled ? "Restore card access?" : "Revoke card access?",
                `${person.name} · ${person.cardId}. This simulated change takes effect only after showcase acknowledgement.`,
                enabled ? "Restore access" : "Revoke access",
              ))
            )
              return;
            try {
              await api.setCardAccess(person.id, enabled);
              toast(
                "Card access change requested; awaiting mock acknowledgement.",
                "info",
              );
              await reload();
            } catch (error) {
              toast(message(error), "danger");
            }
          });
      },
    );
  }
  $(".staff-search input").addEventListener("input", (event) => {
    search = event.target.value.trim().toLowerCase();
    drawDirectory();
  });
  $(".staff-filters select").addEventListener("change", (event) => {
    filter = event.target.value;
    drawDirectory();
  });
  $(".staff-access-log select").addEventListener("change", (event) => {
    resultFilter = event.target.value;
    drawLog();
  });
  $("[data-add]").addEventListener("click", () => openProfile());
  $("[data-directory]").addEventListener("click", (event) => {
    const button = event.target.closest("[data-manage]");
    if (button)
      openProfile(staff.find((person) => person.id === button.dataset.manage));
  });
  assignee.addEventListener("change", updateScan);
  scanButton.addEventListener("click", async () => {
    scanning = true;
    detected = null;
    updateScan();
    $("[data-scan-title]").textContent = "Simulated scan in progress";
    $("[data-scan-detail]").textContent = "Waiting for a mock staff card…";
    try {
      const scan = await api.scanStaffCard();
      if (disposed) return;
      if (!scan || !/^CARD-[A-Z0-9-]+$/i.test(scan.id || ""))
        throw new Error(
          "Invalid staff card ID detected. Please scan a staff access card.",
        );
      const duplicate = staff.find(
        (person) => person.cardEnabled && person.cardId === scan.id,
      );
      if (duplicate)
        throw new Error(
          `This card is already enabled for ${duplicate.name}. Revoke it before assigning it again.`,
        );
      detected = scan.id;
      $("[data-scan-title]").textContent = "Staff card detected";
      $("[data-scan-detail]").textContent =
        "Check the ID below and choose a staff member.";
    } catch (error) {
      if (!disposed) {
        $("[data-scan-title]").textContent = "Scan unsuccessful";
        $("[data-scan-detail]").textContent = message(error);
      }
    } finally {
      scanning = false;
      if (!disposed) updateScan();
    }
  });
  registerButton.addEventListener("click", async () => {
    const person = staff.find((row) => row.id === assignee.value);
    if (!person || !detected || pendingFor(person.id) || registering) return;
    const cardId = detected;
    if (
      person.cardId &&
      !(await confirmAction(
        "Replace assigned card?",
        `Register ${cardId} for ${person.name}? The previous card ${person.cardId} will be replaced after mock acknowledgement.`,
        "Register card",
      ))
    )
      return;
    registering = true;
    updateScan();
    try {
      await api.registerCard(person.id, cardId);
      detected = null;
      $("[data-scan-title]").textContent = "Registration requested";
      $("[data-scan-detail]").textContent =
        "Awaiting simulated showcase acknowledgement.";
      toast("Registration pending mock acknowledgement.", "info");
      await reload();
    } catch (error) {
      $("[data-scan-title]").textContent = "Registration unsuccessful";
      $("[data-scan-detail]").textContent = message(error);
    } finally {
      registering = false;
      if (!disposed) updateScan();
    }
  });
  drawDirectory();
  drawLog();
  const unsubscribe = api.subscribe(reload);
  return () => {
    disposed = true;
    refreshSequence++;
    unsubscribe();
    activeProfile?.forceClose();
    activeProfile = null;
    ctx.setDirty(false);
  };
}
