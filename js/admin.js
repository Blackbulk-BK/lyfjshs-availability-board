// js/admin.js : admin tools. The page check is only for convenience; the real
// protection is Row Level Security in the database.
//
// admin.html needs these ids:
//   #logout (button)  #admin-who (span)  #admin-message (p)
//   #denied (section, hidden)   #admin (section, hidden)
//   #pending-list (ul)  #account-list (ul)
//   #teacher-form: #teacher-name (input)      #teacher-list (ul)
//   #adm-dept-form: #adm-dept-name (input) #adm-dept-category (select)   #dept-list (ul)
//   #log-list (ul)
import { supabase } from "./supabaseClient.js";
import { requireLogin, signOut } from "./auth.js";
import { ICONS, refreshLucide } from "./icons.js";

const $ = (id) => document.getElementById(id);
const CATEGORIES = { clinic: "Clinic", library: "Library", stockroom: "Stockroom", computer_lab: "Computer laboratory", other: "Other" };
const dtFmt = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const h = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const say = (text, bad = false) => { const m = $("admin-message"); m.textContent = text; m.dataset.state = bad ? "error" : "ok"; m.hidden = !text; };
const options = (map, selected) => Object.entries(map).map(([v, t]) => h("option", { value: v, textContent: t, selected: v === selected }));

let me, teachers = [], depts = [], profiles = [], logs = [];

async function loadAll() {
  try {
    const [t, d, p, l] = await Promise.all([
      supabase.from("teachers").select("*").order("full_name"),
      supabase.from("departments").select("*").order("name"),
      supabase.from("profiles").select("*").order("full_name"),
      supabase.from("status_log").select("*").order("changed_at", { ascending: false }).limit(50),
    ]);
    for (const r of [t, d, p, l]) if (r.error) throw r.error;
    [teachers, depts, profiles, logs] = [t.data, d.data, p.data, l.data];
    renderAll();
    refreshLucide();
  } catch (err) { console.error(err); say("Could not load data. Check your connection.", true); }
}

// Run one change, reload, and report. Returns true on success.
async function act(query, failText = "Could not save.") {
  const { error } = await query;
  if (error) { console.error(error); say(error.code === "23505" ? "That name already exists." : failText, true); return false; }
  await loadAll();
  say("Saved.");
  return true;
}

const btn = (text, onclick, cls = "btn", iconHtml = "") => {
  const b = h("button", { type: "button", className: cls, onclick });
  if (iconHtml) {
    b.innerHTML = `${iconHtml} ${text}`;
  } else {
    b.textContent = text;
  }
  return b;
};

const nameOfProfile = (id) => profiles.find((p) => p.id === id)?.full_name ?? "System";

function renderAll() {
  renderPending(); renderAccounts(); renderTeachers(); renderDepts(); renderLog();
}

// ---------- accounts ----------
function renderPending() {
  const waiting = profiles.filter((p) => !p.approved);
  const free = teachers.filter((t) => !t.profile_id);
  $("pending-list").replaceChildren(...(waiting.length ? waiting.map((p) => {
    const sel = h("select", {}, h("option", { value: "", textContent: "Link to a teacher (optional)" }),
      ...free.map((t) => h("option", { value: t.id, textContent: t.full_name })));
    return h("li", { className: "item" }, h("span", { className: "name", textContent: p.full_name }), sel,
      btn("Approve", async () => {
        const link = sel.value;
        if (await act(supabase.from("profiles").update({ approved: true }).eq("id", p.id)) && link)
          await act(supabase.from("teachers").update({ profile_id: p.id }).eq("id", link));
      }, "btn primary", ICONS.check));
  }) : [h("li", { className: "row", textContent: "No accounts are waiting for approval." })]));
}

function renderAccounts() {
  $("account-list").replaceChildren(...profiles.filter((p) => p.approved).map((p) => {
    const linked = teachers.find((t) => t.profile_id === p.id);
    const role = h("select", { disabled: p.id === me.id }, ...options({ teacher: "Teacher", admin: "Admin" }, p.role));
    role.addEventListener("change", () => act(supabase.from("profiles").update({ role: role.value }).eq("id", p.id)));
    return h("li", { className: "item" }, h("span", { className: "name", textContent: p.full_name }),
      h("span", { className: "meta", textContent: linked ? `Linked to ${linked.full_name}` : "Not linked to a teacher" }), role);
  }));
}

// ---------- teachers ----------
function renderTeachers() {
  $("teacher-list").replaceChildren(...teachers.map((t) => {
    const name = h("input", { value: t.full_name, "aria-label": "Teacher name" });
    const active = h("input", { type: "checkbox", checked: t.is_active, "aria-label": "Shown on the board" });
    const row = h("li", { className: "item" }, name, h("label", {}, active, " Shown"),
      btn("Save", () => act(supabase.from("teachers").update({ full_name: name.value.trim(), is_active: active.checked }).eq("id", t.id)), "btn", ICONS.check));
    if (t.avatar_path) row.append(btn("Remove picture", async () => {
      if (await act(supabase.from("teachers").update({ avatar_path: null }).eq("id", t.id)))
        await supabase.storage.from("avatars").remove([t.avatar_path]);
    }, "link", ICONS.x));
    row.append(btn("Delete", () => { if (confirm(`Delete ${t.full_name}? This cannot be undone.`)) act(supabase.from("teachers").delete().eq("id", t.id)); }, "link", ICONS.x));
    return row;
  }));
}

// ---------- departments ----------
function renderDepts() {
  $("dept-list").replaceChildren(...depts.map((d) => {
    const name = h("input", { value: d.name, "aria-label": "Department name" });
    const cat = h("select", {}, ...options(CATEGORIES, d.category));
    const active = h("input", { type: "checkbox", checked: d.is_active, "aria-label": "Shown on the board" });
    return h("li", { className: "item" }, name, cat, h("label", {}, active, " Shown"),
      btn("Save", () => act(supabase.from("departments").update({ name: name.value.trim(), category: cat.value, is_active: active.checked }).eq("id", d.id)), "btn", ICONS.check),
      btn("Delete", () => { if (confirm(`Delete ${d.name}? This cannot be undone.`)) act(supabase.from("departments").delete().eq("id", d.id)); }, "link", ICONS.x));
  }));
}

// ---------- history ----------
function renderLog() {
  const label = (l) => (l.entity_type === "teacher"
    ? teachers.find((t) => t.id === l.entity_id)?.full_name
    : depts.find((d) => d.id === l.entity_id)?.name) ?? "(deleted)";
  $("log-list").replaceChildren(...(logs.length ? logs.map((l) => {
    const li = h("li", { className: "row" });
    const clock = h("span", { className: "icon", style: "margin-right:0.35rem;color:var(--muted)" });
    clock.innerHTML = ICONS.clock;
    li.append(clock, document.createTextNode(`${dtFmt.format(new Date(l.changed_at))} | ${label(l)}: ${l.old_status ?? "none"} to ${l.new_status} | by ${nameOfProfile(l.changed_by)}`));
    return li;
  }) : [h("li", { className: "row", textContent: "No status changes yet." })]));
}

// ---------- add forms & export ----------
function downloadCsvFile(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function wireExportButtons() {
  const btnLogs = $("admin-export-logs");
  const msg = $("admin-export-msg");

  if (btnLogs) {
    btnLogs.addEventListener("click", async () => {
      msg.textContent = "Fetching system audit trail logs...";
      try {
        const { data, error } = await supabase
          .from("status_log")
          .select("*")
          .order("changed_at", { ascending: false });

        if (error) throw error;
        const rows = data ?? [];
        if (!rows.length) {
          msg.textContent = "No status logs recorded yet.";
          return;
        }

        const lines = ["timestamp_pht,entity_type,entity_name,old_status,new_status,changed_by"];
        rows.forEach((l) => {
          const entityName = (l.entity_type === "teacher"
            ? teachers.find((t) => t.id === l.entity_id)?.full_name
            : depts.find((d) => d.id === l.entity_id)?.name) ?? l.entity_id;
          const author = nameOfProfile(l.changed_by);
          const dt = dtFmt.format(new Date(l.changed_at));
          lines.push(`"${dt}","${l.entity_type}","${entityName}","${l.old_status ?? 'none'}","${l.new_status}","${author}"`);
        });

        downloadCsvFile("sop3_system_audit_log.csv", lines.join("\n"));
        msg.textContent = `Downloaded ${rows.length} system audit log record(s).`;
      } catch (err) {
        console.error(err);
        msg.textContent = "Could not fetch audit logs. Check your connection.";
      }
    });
  }
}

function wireForms() {
  $("teacher-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const full_name = $("teacher-name").value.trim();
    if (!full_name) return say("Enter the teacher's full name.", true);
    if (await act(supabase.from("teachers").insert({ full_name }))) $("teacher-form").reset();
  });
  $("adm-dept-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("adm-dept-name").value.trim();
    if (!name) return say("Enter a department name.", true);
    if (await act(supabase.from("departments").insert({ name, category: $("adm-dept-category").value }))) $("adm-dept-form").reset();
  });
}

// ---------- start ----------
async function init() {
  try {
    me = await requireLogin();
    if (!me) return;
    $("logout").addEventListener("click", signOut);
    if (me.role !== "admin" || !me.approved) { $("denied").hidden = false; return; }
    $("admin").hidden = false;
    $("admin-who").textContent = me.full_name;
    wireForms();
    wireExportButtons();
    await loadAll();
  } catch (err) { console.error(err); say("Could not open the admin page. Refresh and try again.", true); }
}
init();
