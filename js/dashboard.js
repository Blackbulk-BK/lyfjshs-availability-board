// js/dashboard.js : Teacher panel — update availability, unavailability reason,
// weekly schedule, department/facility assignments, and profile photo.
import { supabase } from "./supabaseClient.js";
import {
  requireLogin,
  signOut,
  fillRankSelect,
  fetchDepartments,
  renderDepartmentChecks,
  checkedIds,
  friendlyError,
} from "./auth.js";

const TZ = "Asia/Manila";
const LABELS = {
  available: "Available",
  unavailable: "Unavailable",
  under_maintenance: "Under Maintenance",
  not_updated: "Status Not Updated",
};

const UNAVAIL_TAGS = [
  "In Class / Teaching",
  "Faculty Meeting",
  "On Official Business",
  "On Leave / Absent",
  "Consultation / Break",
];

const DAYS = [
  { key: "Mon", label: "Monday", idx: 0 },
  { key: "Tue", label: "Tuesday", idx: 1 },
  { key: "Wed", label: "Wednesday", idx: 2 },
  { key: "Thu", label: "Thursday", idx: 3 },
  { key: "Fri", label: "Friday", idx: 4 },
  { key: "Sat", label: "Saturday", idx: 5 },
];

const $ = (id) => document.getElementById(id);
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat("en-PH", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

let me = null;
let myTeacher = null;
let myAvatar = null;

function flash(el, text, bad = false) {
  if (!el) return;
  el.textContent = text;
  el.dataset.state = bad ? "error" : "ok";
  el.hidden = !text;
}

function format12Hour(hhmm) {
  if (!hhmm || !hhmm.includes(":")) return hhmm || "";
  const [hStr, mStr] = hhmm.split(":");
  let h = parseInt(hStr, 10);
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${mStr} ${suffix}`;
}

function groupScheduleBlocks(schedule) {
  const blocks = [];
  for (const d of DAYS) {
    const slot = schedule?.[d.key];
    if (!slot?.start || !slot?.end) continue;
    const prev = blocks[blocks.length - 1];
    if (prev && prev.start === slot.start && prev.end === slot.end && prev.lastIdx === d.idx - 1) {
      prev.endKey = d.key;
      prev.lastIdx = d.idx;
    } else {
      blocks.push({
        startKey: d.key,
        endKey: d.key,
        lastIdx: d.idx,
        start: slot.start,
        end: slot.end,
      });
    }
  }
  return blocks.map((b) => {
    const dayRange = b.startKey === b.endKey ? b.startKey : `${b.startKey}–${b.endKey}`;
    return `${dayRange}: ${format12Hour(b.start)} – ${format12Hour(b.end)}`;
  });
}

function displayStatus(row) {
  if (row.category === "facility" && row.status === "under_maintenance") {
    return "under_maintenance";
  }
  if (!row.status || !row.updated_at) return "not_updated";
  const isToday = dayFmt.format(new Date(row.updated_at)) === dayFmt.format(new Date());
  return isToday ? row.status : "not_updated";
}

function updatedLabel(row) {
  const st = displayStatus(row);
  if (!row.updated_at) return "Never updated";
  const d = new Date(row.updated_at);
  if (st === "not_updated") return `Not updated today (last: ${timeFmt.format(d)})`;
  return `Updated today at ${timeFmt.format(d)}`;
}

// Fetch the teacher row linked via profiles.teacher_id
async function fetchLinkedTeacher() {
  if (!me) return null;

  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("id", me.id)
    .single();

  if (profErr || !prof?.teacher_id) return null;

  let { data: ownT, error: ownErr } = await supabase
    .from("teachers")
    .select("id, full_name, status, updated_at, rank_level, description, avatar_path, unavailable_reason, schedule")
    .eq("id", prof.teacher_id)
    .maybeSingle();

  if (ownErr) {
    console.warn("Full teacher query fallback:", ownErr.message);
    const fb = await supabase
      .from("teachers")
      .select("id, full_name, status, updated_at, rank_level, description, avatar_path")
      .eq("id", prof.teacher_id)
      .maybeSingle();
    ownT = fb.data;
  }

  return ownT || null;
}

// Ensure logged-in user has a linked row in public.teachers via profiles.teacher_id
// Ensure logged-in user has a linked row in public.teachers via profiles.teacher_id
async function ensureTeacherRecord() {
  if (myTeacher) return myTeacher;

  const existing = await fetchLinkedTeacher();
  if (existing) {
    myTeacher = existing;
    return myTeacher;
  }

  const { data: rpcRow, error: rpcErr } = await supabase.rpc("ensure_my_teacher_record");
  if (rpcErr) throw rpcErr;

  myTeacher = rpcRow;
  return myTeacher;
}

  const { data: created, error } = await supabase
    .from("teachers")
    .insert({
      full_name: me.full_name,
      is_active: true,
    })
    .select("id, full_name, status, updated_at, rank_level, description, avatar_path")
    .single();

  if (error) throw error;

  const { error: linkErr } = await supabase
    .from("profiles")
    .update({ teacher_id: created.id })
    .eq("id", me.id);

  if (linkErr) throw linkErr;

  myTeacher = created;
  return myTeacher;
}

// ---------- Teacher Unavailability Reason Editor ----------
function buildUnavailEditor(row, statusBadge, metaLine) {
  const box = document.createElement("div");
  box.className = "unavail-editor";
  box.hidden = row.status !== "unavailable";

  const lbl = document.createElement("label");
  lbl.className = "unavail-label";
  lbl.textContent = "Why are you unavailable? (Shown on the public board)";

  const tagBar = document.createElement("div");
  tagBar.className = "unavail-tags";

  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 200;
  input.placeholder = "Select a tag above or type a short reason (e.g. Teaching ICT-Kotlin until 10:30 AM)";
  input.value = row.unavailable_reason || "";

  UNAVAIL_TAGS.forEach((tag) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "unavail-chip";
    chip.textContent = tag;
    chip.addEventListener("click", () => {
      input.value = tag;
      input.focus();
    });
    tagBar.append(chip);
  });

  const saveRow = document.createElement("div");
  saveRow.className = "unavail-actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn primary";
  saveBtn.style.padding = "0.38rem 0.85rem";
  saveBtn.style.fontSize = "0.82rem";
  saveBtn.textContent = "Save Reason & Set Unavailable";

  const note = document.createElement("span");
  note.className = "hint";

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    note.textContent = "Saving...";
    try {
      const reason = input.value.trim() || null;
      const { error } = await supabase
        .from("teachers")
        .update({ status: "unavailable", unavailable_reason: reason })
        .eq("id", row.id);
      if (error) throw error;

      row.status = "unavailable";
      row.unavailable_reason = reason;
      row.updated_at = new Date().toISOString();

      const st = displayStatus(row);
      statusBadge.className = `pill status-${st}`;
      statusBadge.innerHTML = `<span class="dot"></span>${LABELS[st]}`;
      metaLine.textContent = reason ? `${updatedLabel(row)} • Reason: ${reason}` : updatedLabel(row);
      note.textContent = "Saved!";
      setTimeout(() => { note.textContent = ""; }, 2500);
    } catch (err) {
      console.error(err);
      note.textContent = err?.message || friendlyError(err);
    } finally {
      saveBtn.disabled = false;
    }
  });

  saveRow.append(saveBtn, note);
  box.append(lbl, tagBar, input, saveRow);
  return box;
}

// ---------- Status Cards (Teacher + Assigned Departments/Facilities) ----------
function itemCard(row) {
  const isTeacher = row.kind === "teacher";
  const isFacility = row.kind === "department" && row.category === "facility";

  const li = document.createElement("li");
  li.className = "item";
  const st = displayStatus(row);
  li.dataset.status = st;

  const info = document.createElement("div");
  info.className = "info";

  const titleRow = document.createElement("div");
  titleRow.className = "title-row";

  const badge = document.createElement("span");
  badge.className = `entity-tag ${isTeacher ? "tag-teacher" : isFacility ? "tag-facility" : "tag-dept"}`;
  badge.textContent = isTeacher ? "Teacher" : isFacility ? "Facility" : "Department";

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = row.name;

  titleRow.append(badge, name);

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent =
    isTeacher && st === "unavailable" && row.unavailable_reason
      ? `${updatedLabel(row)} • Reason: ${row.unavailable_reason}`
      : updatedLabel(row);

  info.append(titleRow, meta);

  const pill = document.createElement("span");
  pill.className = `pill status-${st}`;
  pill.innerHTML = `<span class="dot"></span>${LABELS[st]}`;

  const statuses = isFacility
    ? ["available", "unavailable", "under_maintenance"]
    : ["available", "unavailable"];

  const actions = document.createElement("div");
  actions.className = "actions";

  let unavailBox = null;
  if (isTeacher) {
    unavailBox = buildUnavailEditor(row, pill, meta);
  }

  statuses.forEach((target) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn btn-${target}`;
    btn.textContent = LABELS[target];

    btn.addEventListener("click", async () => {
      if (isTeacher && target === "unavailable" && unavailBox) {
        unavailBox.hidden = false;
      }

      actions.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      try {
        const table = isTeacher ? "teachers" : "departments";
        const payload = { status: target };
        if (isTeacher && target === "available") {
          payload.unavailable_reason = null;
        }

        const { error } = await supabase.from(table).update(payload).eq("id", row.id);
        if (error) throw error;

        row.status = target;
        if (isTeacher && target === "available") {
          row.unavailable_reason = null;
          if (unavailBox) {
            unavailBox.hidden = true;
            const inp = unavailBox.querySelector("input");
            if (inp) inp.value = "";
          }
        }
        row.updated_at = new Date().toISOString();

        const nextSt = displayStatus(row);
        li.dataset.status = nextSt;
        pill.className = `pill status-${nextSt}`;
        pill.innerHTML = `<span class="dot"></span>${LABELS[nextSt]}`;
        meta.textContent =
          isTeacher && nextSt === "unavailable" && row.unavailable_reason
            ? `${updatedLabel(row)} • Reason: ${row.unavailable_reason}`
            : updatedLabel(row);
      } catch (err) {
        console.error(err);
        flash($("dash-message"), err?.message || friendlyError(err), true);
      } finally {
        actions.querySelectorAll("button").forEach((b) => { b.disabled = false; });
      }
    });

    actions.append(btn);
  });

  li.append(info, pill, actions);

  if (unavailBox) {
    li.append(unavailBox);
  }

  if (!isTeacher) {
    const hours = document.createElement("div");
    hours.className = "hours";

    const lbl = document.createElement("span");
    lbl.className = "hint";
    lbl.textContent = isFacility ? "Facility Hours:" : "Office Hours:";

    const openIn = document.createElement("input");
    openIn.type = "time";
    openIn.value = row.open_time ? row.open_time.slice(0, 5) : "";

    const closeIn = document.createElement("input");
    closeIn.type = "time";
    closeIn.value = row.close_time ? row.close_time.slice(0, 5) : "";

    const saveHrs = document.createElement("button");
    saveHrs.type = "button";
    saveHrs.className = "btn";
    saveHrs.style.padding = "0.35rem 0.75rem";
    saveHrs.style.fontSize = "0.8rem";
    saveHrs.textContent = "Save Hours";

    saveHrs.addEventListener("click", async () => {
      saveHrs.disabled = true;
      try {
        const { error } = await supabase
          .from("departments")
          .update({
            open_time: openIn.value || null,
            close_time: closeIn.value || null,
          })
          .eq("id", row.id);
        if (error) throw error;
        saveHrs.textContent = "Saved";
        setTimeout(() => { saveHrs.textContent = "Save Hours"; }, 2000);
      } catch (err) {
        console.error(err);
        flash($("dash-message"), err?.message || friendlyError(err), true);
      } finally {
        saveHrs.disabled = false;
      }
    });

    hours.append(lbl, openIn, document.createTextNode("to"), closeIn, saveHrs);
    li.append(hours);
  }

  return li;
}

async function loadItems() {
  const list = $("items");
  if (!list || !me) return;

  const rows = [];

  // 1) Own teacher record linked via profiles.teacher_id
  const ownT = await fetchLinkedTeacher();
  if (ownT) {
    myTeacher = ownT;
    myAvatar = ownT.avatar_path;
    rows.push({ ...ownT, name: ownT.full_name, kind: "teacher" });
  }

  // 2) Delegated teachers
  const { data: delT } = await supabase
    .from("status_managers")
    .select("teachers(id, full_name, status, updated_at)")
    .eq("manager_id", me.id)
    .not("teacher_id", "is", null);

  (delT ?? []).forEach((r) => {
    if (r.teachers && r.teachers.id !== myTeacher?.id) {
      rows.push({ ...r.teachers, name: r.teachers.full_name, kind: "teacher" });
    }
  });

  // 3) Assigned departments & facilities (via department_staff)
  const deptMap = new Map();
  if (myTeacher) {
    const { data: staffRows } = await supabase
      .from("department_staff")
      .select("departments(id, name, category, status, updated_at, open_time, close_time)")
      .eq("teacher_id", myTeacher.id);
    (staffRows ?? []).forEach((r) => {
      if (r.departments) deptMap.set(r.departments.id, { ...r.departments, kind: "department" });
    });
  }

  // 4) Delegated departments & facilities (via status_managers)
  const { data: delD } = await supabase
    .from("status_managers")
    .select("departments(id, name, category, status, updated_at, open_time, close_time)")
    .eq("manager_id", me.id)
    .not("department_id", "is", null);

  (delD ?? []).forEach((r) => {
    if (r.departments) deptMap.set(r.departments.id, { ...r.departments, kind: "department" });
  });

  deptMap.forEach((d) => rows.push(d));
  list.replaceChildren(...rows.map(itemCard));
}

// ---------- Multi-Shift Weekly School Schedule Editor ----------
function initScheduleEditor() {
  const container = $("schedule-days");
  const form = $("schedule-form");
  const msgEl = $("schedule-message");
  const batchPills = $("batch-day-pills");
  const applyBtn = $("apply-selected-days");
  const clearBtn = $("clear-selected-days");
  const batchFeedback = $("batch-feedback");
  const summaryBar = $("schedule-summary-preview");
  if (!container || !form) return;

  const saved = myTeacher?.schedule && typeof myTeacher.schedule === "object" ? myTeacher.schedule : {};
  const controls = {};

  function collectDraftSchedule() {
    const draft = {};
    for (const d of DAYS) {
      const { cb, startIn, endIn } = controls[d.key];
      if (cb.checked && startIn.value && endIn.value && endIn.value > startIn.value) {
        draft[d.key] = { start: startIn.value, end: endIn.value };
      }
    }
    return draft;
  }

  function refreshRowAndSummary() {
    for (const d of DAYS) {
      const { cb, startIn, endIn, badge } = controls[d.key];
      if (!cb.checked) {
        badge.textContent = "Off / No Schedule";
        badge.className = "sched-live-badge is-off";
      } else if (startIn.value && endIn.value && endIn.value > startIn.value) {
        badge.textContent = `${format12Hour(startIn.value)} – ${format12Hour(endIn.value)}`;
        badge.className = "sched-live-badge is-on";
      } else {
        badge.textContent = "Invalid time range";
        badge.className = "sched-live-badge is-err";
      }
    }

    if (summaryBar) {
      const groups = groupScheduleBlocks(collectDraftSchedule());
      if (groups.length) {
        summaryBar.innerHTML = `<strong>Schedule Preview:</strong> <span>${groups.join(" &bull; ")}</span>`;
        summaryBar.hidden = false;
      } else {
        summaryBar.hidden = true;
      }
    }
  }

  container.replaceChildren();
  DAYS.forEach((d) => {
    const slot = saved[d.key] || {};
    const isActive = Boolean(slot.start && slot.end);

    const row = document.createElement("div");
    row.className = "sched-edit-row";

    const dayLabel = document.createElement("label");
    dayLabel.className = "sched-day-check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = isActive;
    const span = document.createElement("span");
    span.textContent = d.label;
    dayLabel.append(cb, span);

    const times = document.createElement("div");
    times.className = "sched-time-inputs";

    const startIn = document.createElement("input");
    startIn.type = "time";
    startIn.value = slot.start || "06:00";
    startIn.disabled = !isActive;

    const toTxt = document.createElement("span");
    toTxt.className = "hint";
    toTxt.textContent = "to";

    const endIn = document.createElement("input");
    endIn.type = "time";
    endIn.value = slot.end || "15:00";
    endIn.disabled = !isActive;

    const badge = document.createElement("span");
    badge.className = "sched-live-badge";

    cb.addEventListener("change", () => {
      startIn.disabled = !cb.checked;
      endIn.disabled = !cb.checked;
      refreshRowAndSummary();
    });
    startIn.addEventListener("input", refreshRowAndSummary);
    endIn.addEventListener("input", refreshRowAndSummary);

    times.append(startIn, toTxt, endIn, badge);
    row.append(dayLabel, times);
    container.append(row);

    controls[d.key] = { cb, startIn, endIn, row, badge };
  });

  form.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wanted = new Set(btn.dataset.preset.split(",").filter(Boolean));
      batchPills?.querySelectorAll("input[type=checkbox]").forEach((box) => {
        box.checked = wanted.has(box.value);
      });
    });
  });

  const getBatchSelectedDays = () =>
    batchPills
      ? [...batchPills.querySelectorAll("input[type=checkbox]:checked")].map((i) => i.value)
      : [];

  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      const selectedDays = getBatchSelectedDays();
      const sVal = $("quick-start")?.value;
      const eVal = $("quick-end")?.value;

      if (!selectedDays.length) {
        batchFeedback.textContent = "Select at least one day pill above first (e.g. Mon, Tue, Wed).";
        batchFeedback.hidden = false;
        return;
      }
      if (!sVal || !eVal || eVal <= sVal) {
        batchFeedback.textContent = "Choose a valid start and end time (end time must be after start time).";
        batchFeedback.hidden = false;
        return;
      }

      selectedDays.forEach((key) => {
        const c = controls[key];
        if (!c) return;
        c.cb.checked = true;
        c.startIn.disabled = false;
        c.endIn.disabled = false;
        c.startIn.value = sVal;
        c.endIn.value = eVal;
        c.row.classList.remove("sched-flash");
        void c.row.offsetWidth;
        c.row.classList.add("sched-flash");
      });

      batchPills.querySelectorAll("input[type=checkbox]").forEach((box) => { box.checked = false; });

      refreshRowAndSummary();
      batchFeedback.textContent = `Applied ${format12Hour(sVal)} – ${format12Hour(eVal)} to ${selectedDays.join(", ")}. Select more days for another shift or click "Save School Schedule".`;
      batchFeedback.hidden = false;
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      const selectedDays = getBatchSelectedDays();
      if (!selectedDays.length) {
        batchFeedback.textContent = "Select the days you want to mark as Off first.";
        batchFeedback.hidden = false;
        return;
      }

      selectedDays.forEach((key) => {
        const c = controls[key];
        if (!c) return;
        c.cb.checked = false;
        c.startIn.disabled = true;
        c.endIn.disabled = true;
      });

      batchPills.querySelectorAll("input[type=checkbox]").forEach((box) => { box.checked = false; });
      refreshRowAndSummary();
      batchFeedback.textContent = `Marked ${selectedDays.join(", ")} as Off. Click "Save School Schedule" to publish.`;
      batchFeedback.hidden = false;
    });
  }

  refreshRowAndSummary();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    msgEl.hidden = true;

    try {
      const teacher = await ensureTeacherRecord();
      const nextSchedule = {};
      for (const d of DAYS) {
        const { cb, startIn, endIn } = controls[d.key];
        if (cb.checked) {
          if (!startIn.value || !endIn.value) {
            throw new Error(`Please set both start and end times for ${d.label}.`);
          }
          if (endIn.value <= startIn.value) {
            throw new Error(`End time must be after start time on ${d.label}.`);
          }
          nextSchedule[d.key] = { start: startIn.value, end: endIn.value };
        }
      }

      const { error } = await supabase
        .from("teachers")
        .update({ schedule: nextSchedule })
        .eq("id", teacher.id);
      if (error) throw error;

      teacher.schedule = nextSchedule;
      await loadItems();
      flash(msgEl, "School schedule saved! Students can now view all your shift hours on the board.");
    } catch (err) {
      console.error(err);
      const raw = err?.message || "";
      if (raw.includes("schedule") && raw.includes("schema cache")) {
        flash(msgEl, "Database column 'schedule' is missing—run sql/migration_08_schedules_unavail_reason_and_fixes.sql in Supabase first.", true);
      } else {
        flash(msgEl, raw || friendlyError(err), true);
      }
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- Profile, Single Department & Assigned Facilities ----------
async function initProfile() {
  const form = $("profile-form");
  const msgEl = $("profile-message");
  const deptContainer = $("profile-departments");
  if (!form) return;

  fillRankSelect($("profile-rank"), myTeacher?.rank_level || "");
  if ($("profile-description")) {
    $("profile-description").value = myTeacher?.description || "";
  }

  try {
    const allDepts = await fetchDepartments();
    let selectedSet = new Set();

    if (myTeacher?.id) {
      const { data: myLinks } = await supabase
        .from("department_staff")
        .select("department_id")
        .eq("teacher_id", myTeacher.id);
      selectedSet = new Set((myLinks ?? []).map((r) => r.department_id));
    }

    renderDepartmentChecks(deptContainer, allDepts, selectedSet);
  } catch (err) {
    console.error("Failed to load departments/facilities:", err);
    if (deptContainer) {
      deptContainer.textContent = "Could not load departments and facilities. Check your database connection.";
    }
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    msgEl.hidden = true;

    try {
      const teacher = await ensureTeacherRecord();
      const rank_level = $("profile-rank").value || null;
      const description = $("profile-description").value.trim() || null;
      const chosenIds = checkedIds(deptContainer);

      const { error: upErr } = await supabase
        .from("teachers")
        .update({ rank_level, description })
        .eq("id", teacher.id);
      if (upErr) throw upErr;

      await supabase.from("department_staff").delete().eq("teacher_id", teacher.id);
      if (chosenIds.length) {
        const rows = chosenIds.map((department_id) => ({ teacher_id: teacher.id, department_id }));
        const { error: insErr } = await supabase.from("department_staff").insert(rows);
        if (insErr) throw insErr;
      }

      teacher.rank_level = rank_level;
      teacher.description = description;
      await loadItems();
      flash(msgEl, "Profile, department, and facility assignments saved.");
    } catch (err) {
      console.error(err);
      flash(msgEl, err?.message || friendlyError(err), true);
    } finally {
      btn.disabled = false;
    }
  };
}

// ---------- Add a Missing Facility ----------
function initAddFacility() {
  const form = $("add-facility-form");
  const msgEl = $("add-facility-message");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("new-facility-name").value.trim();
    const building = $("new-facility-building").value.trim() || null;
    const floor_level = $("new-facility-floor").value.trim() || null;
    if (!name) return;

    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    msgEl.hidden = true;

    try {
      const teacher = await ensureTeacherRecord();
      const { data: created, error: insErr } = await supabase
        .from("departments")
        .insert({ name, category: "facility", building, floor_level, is_active: true })
        .select("id")
        .single();
      if (insErr) throw insErr;

      const { error: linkErr } = await supabase
        .from("department_staff")
        .insert({ teacher_id: teacher.id, department_id: created.id });
      if (linkErr) throw linkErr;

      form.reset();
      await initProfile();
      await loadItems();
      flash(msgEl, `"${name}" was added and assigned to you.`);
    } catch (err) {
      console.error(err);
      flash(
        msgEl,
        err?.message?.includes("duplicate")
          ? "That facility already exists—select it from the checklist above."
          : err?.message || "Could not add facility. Make sure your account is approved.",
        true
      );
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- Profile Picture Upload ----------
function renderAvatarPreview() {
  const box = $("avatar-preview");
  const remBtn = $("avatar-remove");
  if (!box) return;

  if (myAvatar) {
    const { data } = supabase.storage.from("avatars").getPublicUrl(myAvatar);
    const img = new Image(84, 84);
    img.src = `${data.publicUrl}?t=${Date.now()}`;
    img.alt = "Your profile picture";
    box.replaceChildren(img);
    if (remBtn) remBtn.hidden = false;
  } else {
    const parts = (me?.full_name || "?").trim().split(/\s+/);
    box.textContent = ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
    if (remBtn) remBtn.hidden = true;
  }
}

async function resizeToJpeg(file) {
  const bmp = await createImageBitmap(file);
  const size = 256;
  const canvas = Object.assign(document.createElement("canvas"), { width: size, height: size });
  const ctx = canvas.getContext("2d");
  const min = Math.min(bmp.width, bmp.height);
  const sx = (bmp.width - min) / 2;
  const sy = (bmp.height - min) / 2;
  ctx.drawImage(bmp, sx, sy, min, min, 0, 0, size, size);
  bmp.close();
  return new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
}

function initAvatar() {
  const input = $("avatar-input");
  const remBtn = $("avatar-remove");
  const msgEl = $("avatar-message");
  if (!input) return;

  renderAvatarPreview();

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      flash(msgEl, "Please choose an image smaller than 2 MB.", true);
      return;
    }
    msgEl.hidden = true;
    try {
      const teacher = await ensureTeacherRecord();
      const blob = await resizeToJpeg(file);
      const path = `${me.id}/avatar.jpg`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (upErr) throw upErr;

      const { error: dbErr } = await supabase
        .from("teachers")
        .update({ avatar_path: path })
        .eq("id", teacher.id);
      if (dbErr) throw dbErr;

      myAvatar = path;
      renderAvatarPreview();
      flash(msgEl, "Profile picture updated!");
    } catch (err) {
      console.error(err);
      flash(msgEl, err?.message || friendlyError(err), true);
    } finally {
      input.value = "";
    }
  });

  if (remBtn) {
    remBtn.addEventListener("click", async () => {
      remBtn.disabled = true;
      try {
        const teacher = await ensureTeacherRecord();
        if (myAvatar) await supabase.storage.from("avatars").remove([myAvatar]);
        await supabase.from("teachers").update({ avatar_path: null }).eq("id", teacher.id);
        myAvatar = null;
        renderAvatarPreview();
        flash(msgEl, "Profile picture removed.");
      } catch (err) {
        console.error(err);
        flash(msgEl, err?.message || friendlyError(err), true);
      } finally {
        remBtn.disabled = false;
      }
    });
  }
}

// ---------- Boot ----------
async function init() {
  try {
    me = await requireLogin();
    if (!me) return;

    $("who").textContent = me.full_name;
    $("logout").addEventListener("click", () => signOut());

    if (!me.approved) {
      $("pending").hidden = false;
      return;
    }

    $("panel").hidden = false;
    await loadItems();
    initScheduleEditor();
    await initProfile();
    initAddFacility();
    initAvatar();
  } catch (err) {
    console.error(err);
    flash($("dash-message"), "Could not load your panel. Check your connection and refresh.", true);
  }
}

init();

async function init() {
  try {
    me = await requireLogin();
    if (!me) return;

    $("who").textContent = me.full_name;
    $("logout").addEventListener("click", () => signOut());

    if (!me.approved) {
      $("pending").hidden = false;
      return;
    }

    $("panel").hidden = false;
    await loadItems();
    if (!myTeacher) {
      await ensureTeacherRecord();
      await loadItems();
    }
    initScheduleEditor();
    await initProfile();
    initAddFacility();
    initAvatar();
  } catch (err) {
    console.error(err);
    flash($("dash-message"), err?.message || "Could not load your panel. Check your connection and refresh.", true);
  }
}