// js/dashboard.js : the teacher's own panel (status, profile, photo, delegates).
//
// dashboard.html needs these ids:
//   #who  #logout  #dash-message  #pending (hidden)  #panel (hidden)  #items (ul)
//   #profile-form: #profile-rank (select) #profile-description (textarea)
//                  #profile-departments (div) #profile-message (p)
//   #avatar-preview (div) #avatar-input (file) #avatar-remove (button) #avatar-message (p)
// Needs migrations 01 to 03 and sql/phase4_delegates.sql.
import { supabase } from "./supabaseClient.js";
import { requireLogin, signOut, fillRankSelect, fetchDepartments, renderDepartmentChecks, checkedIds } from "./auth.js";

const $ = (id) => document.getElementById(id);
const LABELS = { available: "Available", unavailable: "Unavailable", not_updated: "Status Not Updated" };
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const timeFmt = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });

const h = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const say = (node, text, bad = false) => { node.textContent = text; node.dataset.state = bad ? "error" : "ok"; node.hidden = !text; };

let profile, myTeacher = null, people = null;

async function loadMyTeacher() {
  const { data, error } = await supabase.from("teachers")
    .select("id, full_name, avatar_path, rank_level, description").eq("profile_id", profile.id).maybeSingle();
  if (error) throw error;
  myTeacher = data;
}

// ---------- statuses this teacher may update ----------
async function loadItems() {
  const uid = profile.id, admin = profile.role === "admin";
  const owner = new Set();
  let tIds = null, dIds = null;

  if (!admin) {
    const [handled, links] = await Promise.all([
      myTeacher ? supabase.from("department_staff").select("department_id").eq("teacher_id", myTeacher.id) : Promise.resolve({ data: [] }),
      supabase.from("status_managers").select("entity_type, entity_id").eq("user_id", uid),
    ]);
    for (const r of [handled, links]) if (r.error) throw r.error;
    if (myTeacher) owner.add("teacher:" + myTeacher.id);
    handled.data.forEach((r) => owner.add("department:" + r.department_id));
    const linked = (kind) => links.data.filter((l) => l.entity_type === kind).map((l) => l.entity_id);
    tIds = new Set([...(myTeacher ? [myTeacher.id] : []), ...linked("teacher")]);
    dIds = new Set([...handled.data.map((r) => r.department_id), ...linked("department")]);
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
    : [h("li", { className: "row", textContent: myTeacher
        ? "Nothing to update. Your teacher record is hidden from the board, so contact the developer."
        : "Your account has no teacher record. Contact the developer." })]));
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
    h("button", { type: "button", className: `btn btn-${s}`, textContent: LABELS[s], onclick: () => save(it, s, buttons, msg, paint) }));

  const kindLabel = it.kind === "teacher" ? "Your status" : (it.building ? `${it.building}, ${it.floor_level ?? ""}`.replace(/, $/, "") : "Department");
  const head = h("div", { className: "info" }, h("span", { className: "name", textContent: it.name }),
    h("span", { className: "meta", textContent: kindLabel }), meta);
  const li = h("li", { className: "item" }, head, pill, h("div", { className: "actions" }, ...buttons), msg);
  if (it.kind === "department" && it.owner) li.append(hoursNode(it));
  if (it.owner) li.append(delegatesNode(it));
  return li;
}

// "Saved" appears only after the database confirms; zero rows means the rules blocked it.
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

// ---------- opening and closing time (departments the teacher handles) ----------
function hoursNode(it) {
  const trim = (v) => (v ? v.slice(0, 5) : "");
  const open = h("input", { type: "time", id: `open-${it.id}`, value: trim(it.open_time) });
  const close = h("input", { type: "time", id: `close-${it.id}`, value: trim(it.close_time) });
  const msg = h("p", { className: "msg", hidden: true });
  const saveBtn = h("button", { type: "button", className: "btn", textContent: "Save hours" });
  saveBtn.addEventListener("click", async () => {
    if (open.value && close.value && close.value <= open.value)
      return say(msg, "The closing time must be after the opening time.", true);
    saveBtn.disabled = true;
    const { data, error } = await supabase.from("departments")
      .update({ open_time: open.value || null, close_time: close.value || null })
      .eq("id", it.id).select("open_time, close_time");
    saveBtn.disabled = false;
    if (error || !data || data.length !== 1) { console.error(error); return say(msg, "Hours not saved.", true); }
    say(msg, "Hours saved.");
  });
  return h("div", { className: "hours" },
    h("label", { htmlFor: open.id, textContent: "Opens" }), open,
    h("label", { htmlFor: close.id, textContent: "Closes" }), close, saveBtn, msg);
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
    h("summary", { textContent: "Let someone else update this for me" }), list, h("div", { className: "row-form" }, pick, add), msg);

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

// ---------- profile: rank, description, departments handled ----------
async function initProfile() {
  const msg = $("profile-message");
  if (!myTeacher) { $("profile-form").hidden = true; return; }
  fillRankSelect($("profile-rank"), myTeacher.rank_level ?? "");
  $("profile-description").value = myTeacher.description ?? "";

  const [depts, mine] = await Promise.all([
    fetchDepartments(),
    supabase.from("department_staff").select("department_id").eq("teacher_id", myTeacher.id),
  ]);
  if (mine.error) throw mine.error;
  const current = new Set(mine.data.map((r) => r.department_id));
  renderDepartmentChecks($("profile-departments"), depts, current);

  $("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const next = new Set(checkedIds($("profile-departments")));
    const add = [...next].filter((id) => !current.has(id));
    const drop = [...current].filter((id) => !next.has(id));

    const upd = await supabase.from("teachers").update({
      rank_level: $("profile-rank").value || null,
      description: $("profile-description").value.trim() || null,
    }).eq("id", myTeacher.id).select("id");
    if (upd.error || upd.data.length !== 1) return say(msg, "Could not save your profile.", true);

    if (add.length) {
      const r = await supabase.from("department_staff").insert(add.map((department_id) => ({ department_id, teacher_id: myTeacher.id })));
      if (r.error) return say(msg, "Could not save your departments.", true);
    }
    if (drop.length) {
      const r = await supabase.from("department_staff").delete().eq("teacher_id", myTeacher.id).in("department_id", drop);
      if (r.error) return say(msg, "Could not save your departments.", true);
    }
    add.forEach((id) => current.add(id));
    drop.forEach((id) => current.delete(id));
    say(msg, "Profile saved.");
    loadItems().catch(console.error);
  });
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

function initAvatar() {
  const msg = $("avatar-message"), input = $("avatar-input");
  if (!myTeacher) {
    input.disabled = true;
    $("avatar-remove").hidden = true;
    return say(msg, "Your account has no teacher record. Contact the developer.", true);
  }
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
      const res = await supabase.from("teachers").update({ avatar_path: path }).eq("id", myTeacher.id).select("avatar_path");
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
    const { error } = await supabase.from("teachers").update({ avatar_path: null }).eq("id", myTeacher.id);
    if (error) return say(msg, "Could not remove the picture.", true);
    myTeacher.avatar_path = null;
    await removeFile(old);
    paintAvatar();
    say(msg, "Picture removed.");
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
    await loadMyTeacher();
    initAvatar();
    await Promise.all([loadItems(), initProfile()]);
  } catch (err) {
    console.error(err);
    say($("dash-message"), "Could not load your panel. Check your connection and refresh.", true);
  }
}
init();