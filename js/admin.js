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

const btn = (text, onclick, cls = "btn") => h("button", { type: "button", className: cls, textContent: text, onclick });
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
      }));
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
      btn("Save", () => act(supabase.from("teachers").update({ full_name: name.value.trim(), is_active: active.checked }).eq("id", t.id))));
    if (t.avatar_path) row.append(btn("Remove picture", async () => {
      if (await act(supabase.from("teachers").update({ avatar_path: null }).eq("id", t.id)))
        await supabase.storage.from("avatars").remove([t.avatar_path]);
    }, "link"));
    row.append(btn("Delete", () => { if (confirm(`Delete ${t.full_name}? This cannot be undone.`)) act(supabase.from("teachers").delete().eq("id", t.id)); }, "link"));
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
      btn("Save", () => act(supabase.from("departments").update({ name: name.value.trim(), category: cat.value, is_active: active.checked }).eq("id", d.id))),
      btn("Delete", () => { if (confirm(`Delete ${d.name}? This cannot be undone.`)) act(supabase.from("departments").delete().eq("id", d.id)); }, "link"));
  }));
}

// ---------- history ----------
function renderLog() {
  const label = (l) => (l.entity_type === "teacher"
    ? teachers.find((t) => t.id === l.entity_id)?.full_name
    : depts.find((d) => d.id === l.entity_id)?.name) ?? "(deleted)";
  $("log-list").replaceChildren(...(logs.length ? logs.map((l) => h("li", { className: "row",
    textContent: `${dtFmt.format(new Date(l.changed_at))} | ${label(l)}: ${l.old_status ?? "none"} to ${l.new_status} | by ${nameOfProfile(l.changed_by)}` }))
    : [h("li", { className: "row", textContent: "No status changes yet." })]));
}

// ---------- add forms ----------
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
    await loadAll();
  } catch (err) { console.error(err); say("Could not open the admin page. Refresh and try again.", true); }
}
init();