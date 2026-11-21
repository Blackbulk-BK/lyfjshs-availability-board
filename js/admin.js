// js/admin.js : Administrator console — manage users, teachers, departments,
// facilities, and export the status audit log.
import { supabase } from "./supabaseClient.js";
import { requireLogin, signOut, fillRankSelect, friendlyError } from "./auth.js";

const TZ = "Asia/Manila";

const CATEGORIES = {
  academic: "Academic Department",
  admin: "Administrative Office",
  facility: "School Facility / Room",
};

const LABELS = {
  available: "Available",
  unavailable: "Unavailable",
  under_maintenance: "Under Maintenance",
  not_updated: "Status Not Updated",
};

const $ = (id) => document.getElementById(id);
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat("en-PH", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const fullFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

let me = null;
let profileMap = new Map();

function flash(text, bad = false) {
  const el = $("adm-message");
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
  if (!row.updated_at) return "Never updated";
  const d = new Date(row.updated_at);
  const st = displayStatus(row);
  if (st === "not_updated") return `Not updated today (last: ${fullFmt.format(d)})`;
  return `Updated today at ${timeFmt.format(d)}`;
}

// ==========================================================================
// 1. User Accounts & Roles (profiles)
// ==========================================================================
function userRow(u) {
  const li = document.createElement("li");
  li.className = "item";

  const info = document.createElement("div");
  info.className = "info";

  const titleRow = document.createElement("div");
  titleRow.className = "title-row";

  const roleTag = document.createElement("span");
  roleTag.className = `entity-tag ${u.role === "admin" ? "tag-dept" : "tag-teacher"}`;
  roleTag.textContent = u.role === "admin" ? "Admin" : "Teacher";

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = u.full_name || "(Unnamed User)";

  titleRow.append(roleTag, name);

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = u.approved ? "Approved account" : "Pending approval";

  info.append(titleRow, meta);

  const pill = document.createElement("span");
  pill.className = `pill ${u.approved ? "status-available" : "status-unavailable"}`;
  pill.innerHTML = `<span class="dot"></span>${u.approved ? "Approved" : "Pending / Blocked"}`;

  const actions = document.createElement("div");
  actions.className = "actions";

  if (u.id !== me.id) {
    const approveBtn = document.createElement("button");
    approveBtn.type = "button";
    approveBtn.className = `btn ${u.approved ? "btn-unavailable" : "btn-available"}`;
    approveBtn.textContent = u.approved ? "Revoke Approval" : "Approve";
    approveBtn.addEventListener("click", async () => {
      approveBtn.disabled = true;
      try {
        const { error } = await supabase
          .from("profiles")
          .update({ approved: !u.approved })
          .eq("id", u.id);
        if (error) throw error;
        await loadUsers();
        flash(`Updated approval status for ${u.full_name}.`);
      } catch (err) {
        console.error(err);
        flash(friendlyError(err), true);
      } finally {
        approveBtn.disabled = false;
      }
    });

    const roleBtn = document.createElement("button");
    roleBtn.type = "button";
    roleBtn.className = "btn";
    const nextRole = u.role === "admin" ? "teacher" : "admin";
    roleBtn.textContent = nextRole === "admin" ? "Promote to Admin" : "Set as Teacher";
    roleBtn.addEventListener("click", async () => {
      roleBtn.disabled = true;
      try {
        const { error } = await supabase
          .from("profiles")
          .update({ role: nextRole })
          .eq("id", u.id);
        if (error) throw error;
        await loadUsers();
        flash(`${u.full_name} is now ${nextRole}.`);
      } catch (err) {
        console.error(err);
        flash(friendlyError(err), true);
      } finally {
        roleBtn.disabled = false;
      }
    });

    actions.append(approveBtn, roleBtn);
  } else {
    const selfNote = document.createElement("span");
    selfNote.className = "hint";
    selfNote.textContent = "Current session";
    actions.append(selfNote);
  }

  li.append(info, pill, actions);
  return li;
}

async function loadUsers() {
  const list = $("adm-users");
  if (!list) return;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, approved")
    .order("full_name");
  if (error) throw error;

  profileMap = new Map((data ?? []).map((p) => [p.id, p.full_name]));
  list.replaceChildren(...(data ?? []).map(userRow));
}

// ==========================================================================
// 2. Teachers Management (teachers)
// ==========================================================================
function teacherRow(t) {
  const li = document.createElement("li");
  li.className = "item";
  const st = displayStatus(t);
  li.dataset.status = st;

  const info = document.createElement("div");
  info.className = "info";

  const titleRow = document.createElement("div");
  titleRow.className = "title-row";

  const badge = document.createElement("span");
  badge.className = "entity-tag tag-teacher";
  badge.textContent = "Teacher";

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = t.full_name;

  titleRow.append(badge, name);

  if (!t.is_active) {
    const hid = document.createElement("span");
    hid.className = "meta-tag";
    hid.textContent = "Hidden from board";
    titleRow.append(hid);
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = [t.rank_level, updatedLabel(t)].filter(Boolean).join(" • ");

  info.append(titleRow, meta);

  const pill = document.createElement("span");
  pill.className = `pill status-${st}`;
  pill.innerHTML = `<span class="dot"></span>${LABELS[st]}`;

  const actions = document.createElement("div");
  actions.className = "actions";

  ["available", "unavailable"].forEach((s) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn btn-${s}`;
    btn.textContent = LABELS[s];
    btn.addEventListener("click", async () => {
      actions.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      try {
        const payload = { status: s };
        if (s === "available") payload.unavailable_reason = null;
        const { error } = await supabase.from("teachers").update(payload).eq("id", t.id);
        if (error) throw error;
        await loadTeachers();
      } catch (err) {
        console.error(err);
        flash(friendlyError(err), true);
      } finally {
        actions.querySelectorAll("button").forEach((b) => { b.disabled = false; });
      }
    });
    actions.append(btn);
  });

  const activeBtn = document.createElement("button");
  activeBtn.type = "button";
  activeBtn.className = "btn";
  activeBtn.textContent = t.is_active ? "Hide" : "Show";
  activeBtn.addEventListener("click", async () => {
    activeBtn.disabled = true;
    try {
      const { error } = await supabase
        .from("teachers")
        .update({ is_active: !t.is_active })
        .eq("id", t.id);
      if (error) throw error;
      await loadTeachers();
    } catch (err) {
      console.error(err);
      flash(friendlyError(err), true);
    } finally {
      activeBtn.disabled = false;
    }
  });

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "btn btn-unavailable";
  delBtn.textContent = "Delete";
  delBtn.addEventListener("click", async () => {
    if (!confirm(`Delete teacher "${t.full_name}"? This cannot be undone.`)) return;
    delBtn.disabled = true;
    try {
      const { error } = await supabase.from("teachers").delete().eq("id", t.id);
      if (error) throw error;
      await loadTeachers();
      flash(`Removed ${t.full_name}.`);
    } catch (err) {
      console.error(err);
      flash(friendlyError(err), true);
    } finally {
      delBtn.disabled = false;
    }
  });

  actions.append(activeBtn, delBtn);
  li.append(info, pill, actions);
  return li;
}

async function loadTeachers() {
  const list = $("adm-teachers");
  if (!list) return;

  const { data, error } = await supabase
    .from("teachers")
    .select("id, full_name, rank_level, status, updated_at, is_active")
    .order("full_name");
  if (error) throw error;

  list.replaceChildren(...(data ?? []).map(teacherRow));
}

function wireTeacherForm() {
  const form = $("adm-teacher-form");
  if (!form) return;

  fillRankSelect($("adm-teacher-rank"));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = $("adm-teacher-name");
    const rankInput = $("adm-teacher-rank");
    const full_name = nameInput?.value.trim();
    if (!full_name) return;

    const btn = form.querySelector("button[type=submit]");
    if (btn) btn.disabled = true;
    try {
      const { error } = await supabase.from("teachers").insert({
        full_name,
        rank_level: rankInput?.value || null,
        is_active: true,
      });
      if (error) throw error;
      form.reset();
      await loadTeachers();
      flash(`Added teacher "${full_name}".`);
    } catch (err) {
      console.error(err);
      flash(friendlyError(err), true);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

// ==========================================================================
// 3. Departments & Facilities Management (departments)
// ==========================================================================
function deptRow(d) {
  const isFacility = d.category === "facility";
  const li = document.createElement("li");
  li.className = "item";
  const st = displayStatus(d);
  li.dataset.status = st;

  const info = document.createElement("div");
  info.className = "info";

  const titleRow = document.createElement("div");
  titleRow.className = "title-row";

  const badge = document.createElement("span");
  badge.className = `entity-tag ${isFacility ? "tag-facility" : "tag-dept"}`;
  badge.textContent = CATEGORIES[d.category] || (isFacility ? "Facility" : "Department");

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = d.name;

  titleRow.append(badge, name);

  if (!d.is_active) {
    const hid = document.createElement("span");
    hid.className = "meta-tag";
    hid.textContent = "Hidden from board";
    titleRow.append(hid);
  }

  const loc = [d.building, d.floor_level].filter(Boolean).join(" • ");
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = [loc, updatedLabel(d)].filter(Boolean).join(" • ");

  info.append(titleRow, meta);

  const pill = document.createElement("span");
  pill.className = `pill status-${st}`;
  pill.innerHTML = `<span class="dot"></span>${LABELS[st]}`;

  const actions = document.createElement("div");
  actions.className = "actions";

  // Academic/Admin departments only use Available & Unavailable;
  // Physical facilities also allow Under Maintenance.
  const statuses = isFacility
    ? ["available", "unavailable", "under_maintenance"]
    : ["available", "unavailable"];

  statuses.forEach((s) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn btn-${s}`;
    btn.textContent = LABELS[s];
    btn.addEventListener("click", async () => {
      actions.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      try {
        const { error } = await supabase
          .from("departments")
          .update({ status: s })
          .eq("id", d.id);
        if (error) throw error;
        await loadDepartments();
      } catch (err) {
        console.error(err);
        flash(friendlyError(err), true);
      } finally {
        actions.querySelectorAll("button").forEach((b) => { b.disabled = false; });
      }
    });
    actions.append(btn);
  });

  const activeBtn = document.createElement("button");
  activeBtn.type = "button";
  activeBtn.className = "btn";
  activeBtn.textContent = d.is_active ? "Hide" : "Show";
  activeBtn.addEventListener("click", async () => {
    activeBtn.disabled = true;
    try {
      const { error } = await supabase
        .from("departments")
        .update({ is_active: !d.is_active })
        .eq("id", d.id);
      if (error) throw error;
      await loadDepartments();
    } catch (err) {
      console.error(err);
      flash(friendlyError(err), true);
    } finally {
      activeBtn.disabled = false;
    }
  });

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "btn btn-unavailable";
  delBtn.textContent = "Delete";
  delBtn.addEventListener("click", async () => {
    if (!confirm(`Delete "${d.name}"? This will remove all staff assignments to it.`)) return;
    delBtn.disabled = true;
    try {
      const { error } = await supabase.from("departments").delete().eq("id", d.id);
      if (error) throw error;
      await loadDepartments();
      flash(`Deleted "${d.name}".`);
    } catch (err) {
      console.error(err);
      flash(friendlyError(err), true);
    } finally {
      delBtn.disabled = false;
    }
  });

  actions.append(activeBtn, delBtn);
  li.append(info, pill, actions);
  return li;
}

async function loadDepartments() {
  const list = $("adm-depts");
  if (!list) return;

  const { data, error } = await supabase
    .from("departments")
    .select("id, name, category, building, floor_level, status, updated_at, is_active")
    .order("category")
    .order("name");
  if (error) throw error;

  list.replaceChildren(...(data ?? []).map(deptRow));
}

function wireDeptForm() {
  const form = $("adm-dept-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("adm-dept-name")?.value.trim();
    const category = $("adm-dept-category")?.value || "academic";
    const building = $("adm-dept-building")?.value.trim() || null;
    const floor_level = $("adm-dept-floor")?.value.trim() || null;
    if (!name) return;

    const btn = form.querySelector("button[type=submit]");
    if (btn) btn.disabled = true;
    try {
      const { error } = await supabase.from("departments").insert({
        name,
        category,
        building,
        floor_level,
        is_active: true,
      });
      if (error) throw error;
      form.reset();
      await loadDepartments();
      flash(`Added "${name}".`);
    } catch (err) {
      console.error(err);
      flash(friendlyError(err), true);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

// ==========================================================================
// 4. Audit Trail & CSV Export (status_log)
// ==========================================================================
function formatLogEntry(row) {
  const target = row.target_name || row.entity_name || "Record";
  const kind = row.target_type || row.entity_type || "";
  const oldSt = LABELS[row.old_status] || row.old_status || "None";
  const newSt = LABELS[row.new_status] || row.new_status || "";
  const who = profileMap.get(row.changed_by) || row.changed_by_name || "System";
  const ts = row.changed_at || row.created_at;
  const when = ts ? fullFmt.format(new Date(ts)) : "";

  const li = document.createElement("li");
  li.className = "item";

  const info = document.createElement("div");
  info.className = "info";

  const title = document.createElement("div");
  title.className = "name";
  title.textContent = `${target}${kind ? ` (${kind})` : ""}: ${oldSt} → ${newSt}`;

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `By ${who}${when ? ` • ${when}` : ""}`;

  info.append(title, meta);
  li.append(info);
  return li;
}

async function loadLogs() {
  const list = $("adm-log");
  if (!list) return;

  const { data, error } = await supabase
    .from("status_log")
    .select("*")
    .order("id", { ascending: false })
    .limit(50);
  if (error) {
    console.warn("Could not load status_log:", error);
    return;
  }

  list.replaceChildren(...(data ?? []).map(formatLogEntry));
}

function wireCsvExport() {
  const btn = $("adm-export-csv");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const { data, error } = await supabase
        .from("status_log")
        .select("*")
        .order("id", { ascending: false });
      if (error) throw error;

      const rows = data ?? [];
      if (!rows.length) {
        flash("No audit log entries to export yet.");
        return;
      }

      const headers = ["id", "type", "name", "old_status", "new_status", "changed_by", "timestamp"];
      const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

      const lines = [
        headers.join(","),
        ...rows.map((r) =>
          [
            r.id,
            r.target_type || r.entity_type || "",
            r.target_name || r.entity_name || "",
            r.old_status || "",
            r.new_status || "",
            profileMap.get(r.changed_by) || r.changed_by || "",
            r.changed_at || r.created_at || "",
          ]
            .map(esc)
            .join(",")
        ),
      ];

      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lyfjshs_status_log_${dayFmt.format(new Date())}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      flash(`Exported ${rows.length} audit log records.`);
    } catch (err) {
      console.error(err);
      flash(friendlyError(err), true);
    } finally {
      btn.disabled = false;
    }
  });
}

// ==========================================================================
// 5. Boot
// ==========================================================================
async function init() {
  try {
    me = await requireLogin();
    if (!me) return;

    if (me.role !== "admin") {
      location.replace("dashboard.html");
      return;
    }

    if ($("who")) $("who").textContent = me.full_name;
    if ($("logout")) $("logout").addEventListener("click", () => signOut());

    wireTeacherForm();
    wireDeptForm();
    wireCsvExport();

    await loadUsers();
    await Promise.all([loadTeachers(), loadDepartments(), loadLogs()]);
  } catch (err) {
    console.error(err);
    flash("Could not load admin console. Check your connection and refresh.", true);
  }
}

init();