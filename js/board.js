// js/dashboard.js : Teacher panel — update availability, unavailability reason,
// weekly schedule, department/facility assignments, delegates, and profile photo.
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
  { key: "Mon", label: "Monday" },
  { key: "Tue", label: "Tuesday" },
  { key: "Wed", label: "Wednesday" },
  { key: "Thu", label: "Thursday" },
  { key: "Fri", label: "Friday" },
  { key: "Sat", label: "Saturday" },
];

const $ = (id) => document.getElementById(id);
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat("en-PH", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

let me = null;
let myTeacher = null;
let myAvatar = null;
let myRole = "teacher";
let assignablePool = [];

function flash(el, text, bad = false) {
  if (!el) return;
  el.textContent = text;
  el.dataset.state = bad ? "error" : "ok";
  el.hidden = !text;
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
      note.textContent = friendlyError(err);
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
  const isDept = row.kind === "department" && !isFacility;

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

  // Status Buttons:
  // - Teachers: Available, Unavailable (opens reason box)
  // - Departments: Available, Unavailable (NO Under Maintenance!)
  // - Facilities: Available, Unavailable, Under Maintenance
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
        flash($("dash-message"), friendlyError(err), true);
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

  // Operating Hours editor for Facilities & Departments
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
        flash($("dash-message"), friendlyError(err), true);
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

  // 1) Own teacher record
  const { data: ownT } = await supabase
    .from("teachers")
    .select("id, full_name, status, updated_at, rank_level, description, avatar_path, unavailable_reason, schedule")
    .eq("user_id", me.id)
    .maybeSingle();

  if (ownT) {
    myTeacher = ownT;
    myAvatar = ownT.avatar_path;
    rows.push({ ...ownT, name: ownT.full_name, kind: "teacher" });
  }

  // 2) Delegated teachers
  const { data: delT } = await supabase
    .from("status_managers")
    .select("teachers(id, full_name, status, updated_at, unavailable_reason)")
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

// ---------- Weekly School Schedule Editor ----------
function initScheduleEditor() {
  const container = $("schedule-days");
  const form = $("schedule-form");
  const msgEl = $("schedule-message");
  const applyWeekdaysBtn = $("apply-weekdays");
  if (!container || !form || !myTeacher) return;

  const saved = myTeacher.schedule && typeof myTeacher.schedule === "object" ? myTeacher.schedule : {};
  const controls = {};

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

    cb.addEventListener("change", () => {
      startIn.disabled = !cb.checked;
      endIn.disabled = !cb.checked;
    });

    times.append(startIn, toTxt, endIn);
    row.append(dayLabel, times);
    container.append(row);

    controls[d.key] = { cb, startIn, endIn };
  });

  if (applyWeekdaysBtn) {
    applyWeekdaysBtn.addEventListener("click", () => {
      const sVal = $("quick-start")?.value || "06:00";
      const eVal = $("quick-end")?.value || "15:00";
      ["Mon", "Tue", "Wed", "Thu", "Fri"].forEach((k) => {
        if (controls[k]) {
          controls[k].cb.checked = true;
          controls[k].startIn.disabled = false;
          controls[k].endIn.disabled = false;
          controls[k].startIn.value = sVal;
          controls[k].endIn.value = eVal;
        }
      });
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    msgEl.hidden = true;

    try {
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
        .eq("id", myTeacher.id);
      if (error) throw error;

      myTeacher.schedule = nextSchedule;
      flash(msgEl, "School schedule updated! Students can now view your hours on the board.");
    } catch (err) {
      console.error(err);
      flash(msgEl, err?.message || friendlyError(err), true);
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- Profile, Single Department & Assigned Facilities ----------
async function initProfile() {
  const form = $("profile-form");
  const msgEl = $("profile-message");
  if (!form || !myTeacher) return;

  fillRankSelect($("profile-rank"), myTeacher.rank_level || "");
  $("profile-description").value = myTeacher.description || "";

  const [allDepts, { data: myLinks }] = await Promise.all([
    fetchDepartments(),
    supabase.from("department_staff").select("department_id").eq("teacher_id", myTeacher.id),
  ]);

  const selectedSet = new Set((myLinks ?? []).map((r) => r.department_id));
  renderDepartmentChecks($("profile-departments"), allDepts, selectedSet);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    msgEl.hidden = true;

    try {
      const rank_level = $("profile-rank").value || null;
      const description = $("profile-description").value.trim() || null;
      const chosenIds = checkedIds($("profile-departments"));

      const { error: upErr } = await supabase
        .from("teachers")
        .update({ rank_level, description })
        .eq("id", myTeacher.id);
      if (upErr) throw upErr;

      // Sync department_staff
      await supabase.from("department_staff").delete().eq("teacher_id", myTeacher.id);
      if (chosenIds.length) {
        const rows = chosenIds.map((department_id) => ({ teacher_id: myTeacher.id, department_id }));
        const { error: insErr } = await supabase.from("department_staff").insert(rows);
        if (insErr) throw insErr;
      }

      myTeacher.rank_level = rank_level;
      myTeacher.description = description;
      await loadItems();
      flash(msgEl, "Profile, department, and facility assignments saved.");
    } catch (err) {
      console.error(err);
      flash(msgEl, friendlyError(err), true);
    } finally {
      btn.disabled = false;
    }
  };
}

// ---------- Add a Missing Facility ----------
function initAddFacility() {
  const form = $("add-facility-form");
  const msgEl = $("add-facility-message");
  if (!form || !myTeacher) return;

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
      const { data: created, error: insErr } = await supabase
        .from("departments")
        .insert({ name, category: "facility", building, floor_level, is_active: true })
        .select("id")
        .single();
      if (insErr) throw insErr;

      const { error: linkErr } = await supabase
        .from("department_staff")
        .insert({ teacher_id: myTeacher.id, department_id: created.id });
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
          : "Could not add facility. Make sure your account is approved.",
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
  if (!input || !myTeacher) return;

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
      const blob = await resizeToJpeg(file);
      const path = `${me.id}/avatar.jpg`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (upErr) throw upErr;

      const { error: dbErr } = await supabase
        .from("teachers")
        .update({ avatar_path: path })
        .eq("id", myTeacher.id);
      if (dbErr) throw dbErr;

      myAvatar = path;
      renderAvatarPreview();
      flash(msgEl, "Profile picture updated!");
    } catch (err) {
      console.error(err);
      flash(msgEl, friendlyError(err), true);
    } finally {
      input.value = "";
    }
  });

  if (remBtn) {
    remBtn.addEventListener("click", async () => {
      remBtn.disabled = true;
      try {
        if (myAvatar) await supabase.storage.from("avatars").remove([myAvatar]);
        await supabase.from("teachers").update({ avatar_path: null }).eq("id", myTeacher.id);
        myAvatar = null;
        renderAvatarPreview();
        flash(msgEl, "Profile picture removed.");
      } catch (err) {
        console.error(err);
        flash(msgEl, friendlyError(err), true);
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

    myRole = me.role;
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