// js/dashboard.js : update panel for teachers, delegates, and admins.
//
// dashboard.html needs these ids:
//   #who (span)  #logout (button)  #dash-message (p)
//   #pending (section, hidden)  = "waiting for approval" notice
//   #panel (section, hidden)    = the whole working panel
//   #items (ul)                 = items this user may update
//   #avatar-section: #avatar-preview (div) #avatar-input (input type=file) #avatar-remove (button) #avatar-message (p)
//   #dept-form: #dept-name (input) #dept-category (select) #dept-message (p)
// Needs sql/phase4_delegates.sql (assignable_users) and migration_02 (pictures).
import { supabase } from "./supabaseClient.js";
import { requireLogin, signOut } from "./auth.js";

const $ = (id) => document.getElementById(id);
const LABELS = { available: "Available", unavailable: "Unavailable", not_updated: "Status Not Updated" };
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const timeFmt = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });

const h = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const say = (node, text, bad = false) => { node.textContent = text; node.dataset.state = bad ? "error" : "ok"; node.hidden = !text; };

let profile, myTeacher = null, people = null;

// ---------- items this user may update ----------
async function loadItems() {
  const uid = profile.id, admin = profile.role === "admin";
  const owner = new Set();
  let tIds = null, dIds = null;

  if (!admin) {
    const [mine, made, links] = await Promise.all([
      supabase.from("teachers").select("id").eq("profile_id", uid),
      supabase.from("departments").select("id").eq("created_by", uid),
      supabase.from("status_managers").select("entity_type, entity_id").eq("user_id", uid),
    ]);
    for (const r of [mine, made, links]) if (r.error) throw r.error;
    mine.data.forEach((r) => owner.add("teacher:" + r.id));
    made.data.forEach((r) => owner.add("department:" + r.id));
    const ids = (kind, own) => new Set([...own.map((r) => r.id),
      ...links.data.filter((l) => l.entity_type === kind).map((l) => l.entity_id)]);
    tIds = ids("teacher", mine.data);
    dIds = ids("department", made.data);
  }

  const read = (view, ids) => {
    if (ids && ids.size === 0) return Promise.resolve({ data: [] });
    let q = supabase.from(view).select("*");
    if (ids) q = q.in("id", [...ids]);
    return q.order("name");
  };
  const [t, d] = await Promise.all([read("teachers_board", tIds), read("departments_board", dIds)]);
  if (t.error) throw t.error;
  if (d.error) throw d.error;

  const items = [
    ...t.data.map((r) => ({ ...r, kind: "teacher", owner: admin || owner.has("teacher:" + r.id) })),
    ...d.data.map((r) => ({ ...r, kind: "department", owner: admin || owner.has("department:" + r.id) })),
  ];
  $("items").replaceChildren(...(items.length
    ? items.map(itemNode)
    : [h("li", { className: "row", textContent: "You have nothing to update yet." })]));
}

function itemNode(it) {
  const pill = h("span"), meta = h("span", { className: "meta" });
  const msg = h("p", { className: "msg", hidden: true });
  const paint = () => {
    pill.className = `pill status-${it.display_status}`;
    pill.replaceChildren(h("span", { className: "dot" }), LABELS[it.display_status]);
    meta.textContent = it.display_status === "not_updated"
      ? "Not updated today" : `Updated ${timeFmt.format(new Date(it.updated_at))} today`;
  };
  paint();

  const buttons = ["available", "unavailable"].map((s) =>
    h("button", { type: "button", className: "btn", textContent: LABELS[s], onclick: () => save(it, s, buttons, msg, paint) }));

  const kindLabel = it.kind === "teacher" ? "Teacher" : "Department";
  const head = h("div", { className: "info" }, h("span", { className: "name", textContent: it.name }),
    h("span", { className: "meta", textContent: kindLabel }), meta);
  const li = h("li", { className: "item" }, head, pill, h("div", { className: "actions" }, ...buttons), msg);
  if (it.owner) li.append(delegatesNode(it));
  return li;
}

// Show "Saved" only after the database confirms; zero rows means the rules blocked it.
async function save(it, status, buttons, msg, paint) {
  buttons.forEach((b) => (b.disabled = true));
  say(msg, "Saving...");
  const table = it.kind === "teacher" ? "teachers" : "departments";
  const { data, error } = await supabase.from(table).update({ status }).eq("id", it.id).select("status, updated_at");
  buttons.forEach((b) => (b.disabled = false));
  if (error || !data || data.length !== 1) {
    console.error(error);
    return say(msg, "Not saved. You may not have permission, or the connection failed.", true);
  }
  it.display_status = data[0].status;
  it.updated_at = data[0].updated_at;
  paint();
  say(msg, `Saved at ${timeFmt.format(new Date(data[0].updated_at))}`);
}

// ---------- delegates ----------
async function fetchPeople() {
  const { data, error } = await supabase.rpc("assignable_users");
  if (error) throw error;
  return new Map(data.map((p) => [p.id, p.full_name]));
}

function delegatesNode(it) {
  const list = h("ul"), pick = h("select"), msg = h("p", { className: "msg", hidden: true });
  const add = h("button", { type: "button", className: "btn", textContent: "Assign" });
  const box = h("details", { className: "delegates" },
    h("summary", { textContent: "Who can update this for me?" }), list, h("div", { className: "row-form" }, pick, add), msg);

  async function refresh() {
    try {
      people ??= await fetchPeople();
      const { data, error } = await supabase.from("status_managers").select("id, user_id")
        .eq("entity_type", it.kind).eq("entity_id", it.id);
      if (error) throw error;
      const taken = new Set(data.map((d) => d.user_id));
      list.replaceChildren(...data.map((d) => h("li", {}, people.get(d.user_id) ?? "Unknown account",
        h("button", {
          type: "button", className: "link", textContent: "Remove",
          onclick: async () => {
            const r = await supabase.from("status_managers").delete().eq("id", d.id);
            r.error ? say(msg, "Could not remove.", true) : refresh();
          },
        }))));
      pick.replaceChildren(h("option", { value: "", textContent: "Choose a person" }),
        ...[...people].filter(([id]) => id !== profile.id && !taken.has(id))
          .map(([id, name]) => h("option", { value: id, textContent: name })));
    } catch (err) { console.error(err); say(msg, "Could not load delegates.", true); }
  }

  box.addEventListener("toggle", () => { if (box.open) refresh(); });
  add.addEventListener("click", async () => {
    if (!pick.value) return;
    add.disabled = true;
    const { error } = await supabase.from("status_managers").insert({
      entity_type: it.kind, entity_id: it.id, user_id: pick.value, assigned_by: profile.id });
    add.disabled = false;
    if (error) return say(msg, error.code === "23505" ? "Already assigned." : "Could not assign.", true);
    say(msg, ""); refresh();
  });
  return box;
}

// ---------- profile picture (2 MB max, resized to 256 px) ----------
function paintAvatar() {
  const box = $("avatar-preview");
  if (myTeacher.avatar_path) {
    const url = supabase.storage.from("avatars").getPublicUrl(myTeacher.avatar_path).data.publicUrl;
    box.replaceChildren(Object.assign(new Image(96, 96), { src: url, alt: "Your profile picture" }));
  } else {
    box.textContent = myTeacher.full_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  }
  $("avatar-remove").hidden = !myTeacher.avatar_path;
}

async function resizeToSquare(file, size = 256) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = Object.assign(document.createElement("canvas"), { width: size, height: size });
  canvas.getContext("2d").drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error("resize failed"))), "image/jpeg", 0.85));
}

async function removeFile(path) { if (path) await supabase.storage.from("avatars").remove([path]); }

async function initAvatar() {
  const msg = $("avatar-message"), input = $("avatar-input");
  const { data, error } = await supabase.from("teachers").select("id, full_name, avatar_path")
    .eq("profile_id", profile.id).maybeSingle();
  if (error) { console.error(error); return say(msg, "Could not load your profile picture.", true); }
  if (!data) {
    input.disabled = true;
    $("avatar-remove").hidden = true;
    return say(msg, "Your account is not linked to a teacher record yet. Ask an admin.", true);
  }
  myTeacher = data;
  paintAvatar();

  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    if (!TYPES.includes(file.type) || file.size > MAX_BYTES)
      return say(msg, "Pick a JPG, PNG, or WebP picture of 2 MB or less.", true);
    try {
      say(msg, "Uploading...");
      const blob = await resizeToSquare(file);
      const path = `${profile.id}/avatar-${Date.now()}.jpg`;
      const up = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg" });
      if (up.error) throw up.error;
      const res = await supabase.from("teachers").update({ avatar_path: path }).eq("profile_id", profile.id).select("avatar_path");
      if (res.error || res.data.length !== 1) { await removeFile(path); throw res.error ?? new Error("not saved"); }
      const old = myTeacher.avatar_path;
      myTeacher.avatar_path = path;
      await removeFile(old);
      paintAvatar();
      say(msg, "Picture saved.");
    } catch (err) { console.error(err); say(msg, "Could not save the picture. Please try again.", true); }
  });

  $("avatar-remove").addEventListener("click", async () => {
    const old = myTeacher.avatar_path;
    const { error: e } = await supabase.from("teachers").update({ avatar_path: null }).eq("profile_id", profile.id);
    if (e) return say(msg, "Could not remove the picture.", true);
    myTeacher.avatar_path = null;
    await removeFile(old);
    paintAvatar();
    say(msg, "Picture removed.");
  });
}

// ---------- add a department ----------
function initDeptForm() {
  const msg = $("dept-message");
  $("dept-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("dept-name").value.trim();
    if (!name) return say(msg, "Enter a department name.", true);
    const { error } = await supabase.from("departments").insert({ name, category: $("dept-category").value });
    if (error) return say(msg, error.code === "23505" ? "That department already exists." : "Could not add the department.", true);
    $("dept-form").reset();
    say(msg, "Department added. You can now update its status.");
    loadItems().catch(console.error);
  });
}

// ---------- start ----------
async function init() {
  try {
    profile = await requireLogin();
    if (!profile) return;
    $("who").textContent = profile.full_name;
    $("logout").addEventListener("click", signOut);
    if (!profile.approved) { $("pending").hidden = false; return; }
    $("panel").hidden = false;
    initDeptForm();
    await Promise.all([loadItems(), initAvatar()]);
  } catch (err) {
    console.error(err);
    say($("dash-message"), "Could not load your panel. Check your connection and refresh.", true);
  }
}
init();