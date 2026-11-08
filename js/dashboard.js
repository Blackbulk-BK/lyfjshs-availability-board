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
const LABELS = {
  available: "Available",
  unavailable: "Unavailable",
  under_maintenance: "Under Maintenance",
  not_updated: "Status Not Updated",
};
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const TZ = "Asia/Manila";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat("en-PH", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const fullDateTimeFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

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
    pill.replaceChildren(h("span", { className: "dot" }), LABELS[it.display_status] ?? it.display_status);
    if (!it.updated_at || it.display_status === "not_updated") {
      meta.textContent = it.updated_at
        ? `Status Not Updated (Last: ${fullDateTimeFmt.format(new Date(it.updated_at))})`
        : "Status Not Updated (No recorded update)";
    } else {
      const d = new Date(it.updated_at);
      const isToday = dayFmt.format(d) === dayFmt.format(new Date());
      meta.textContent = isToday
        ? `Updated today at ${timeFmt.format(d)}`
        : `Last update: ${fullDateTimeFmt.format(d)}`;
    }
  };
  paint();

  const statusOptions = it.kind === "department"
    ? ["available", "unavailable", "under_maintenance"]
    : ["available", "unavailable"];

  const buttons = statusOptions.map((s) =>
    h("button", {
      type: "button",
      className: `btn btn-${s}`,
      textContent: LABELS[s] ?? s,
      onclick: () => save(it, s, buttons, msg, paint),
    })
  );

  const kindLabel = it.kind === "teacher"
    ? "Teacher Status"
    : (it.building ? `${it.building}${it.floor_level ? ", " + it.floor_level : ""}` : "Department");
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
  say(msg, `Saved at ${fullDateTimeFmt.format(new Date(data[0].updated_at))}`);
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

// ---------- helpers ----------
function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function renderPersonAvatar(avatarPath, name, size = 36) {
  const wrap = h("div", { className: "delegate-avatar", style: `width:${size}px;height:${size}px;` });
  if (avatarPath) {
    const { data } = supabase.storage.from("avatars").getPublicUrl(avatarPath);
    const img = new Image(size, size);
    img.loading = "lazy";
    img.alt = "";
    img.src = data.publicUrl;
    img.onerror = () => {
      img.remove();
      wrap.textContent = initials(name);
    };
    wrap.append(img);
  } else {
    wrap.textContent = initials(name);
  }
  return wrap;
}

// ---------- delegates ----------
async function fetchPeople() {
  // Query teachers table to get profile_id, full_name, avatar_path, rank_level
  try {
    const { data, error } = await supabase
      .from("teachers")
      .select("profile_id, full_name, avatar_path, rank_level")
      .not("profile_id", "is", null)
      .eq("is_active", true)
      .order("full_name");
    if (!error && Array.isArray(data) && data.length) {
      return new Map(data.map((p) => [p.profile_id, {
        id: p.profile_id,
        full_name: p.full_name,
        avatar_path: p.avatar_path,
        rank_level: p.rank_level
      }]));
    }
  } catch (err) {
    console.warn("Teachers query notice:", err);
  }

  // Fallback: Query profiles table
  try {
    const { data, error } = await supabase.from("profiles").select("id, full_name").order("full_name");
    if (!error && Array.isArray(data) && data.length) {
      return new Map(data.map((p) => [p.id, {
        id: p.id,
        full_name: p.full_name,
        avatar_path: null,
        rank_level: null
      }]));
    }
  } catch (err) {
    console.warn("Profiles query notice:", err);
  }

  return new Map();
}

function delegatesNode(it) {
  const box = h("details", { className: "delegates" });
  const summary = h("summary", {},
    h("span", { style: "display:inline-flex;align-items:center;gap:0.4rem;" },
      h("span", { innerHTML: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>` }),
      "Co-Coordinators & Delegation (Let someone else update this for me)"
    )
  );

  const panel = h("div", { className: "delegates-panel" });
  const activeTitle = h("div", { style: "font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--slate);margin-bottom:0.4rem;", textContent: "Active Co-Coordinators" });
  const assignedList = h("ul", { className: "delegates-list" });

  const addTitle = h("div", { style: "font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--slate);margin:0.85rem 0 0.4rem;", textContent: "Assign Other Faculty" });
  const searchInput = h("input", { type: "search", placeholder: "Search verified teachers by name...", style: "margin-bottom:0.6rem;font-size:0.84rem;height:38px;" });
  const availableList = h("ul", { className: "delegates-list" });
  const msg = h("p", { className: "msg", hidden: true });

  panel.append(activeTitle, assignedList, addTitle, searchInput, availableList, msg);
  box.append(summary, panel);

  let cachedAvailable = [];

  function renderAvailable(filterText = "") {
    const q = filterText.trim().toLowerCase();
    const filtered = cachedAvailable.filter((p) => !q || p.full_name.toLowerCase().includes(q));

    if (!filtered.length) {
      availableList.replaceChildren(h("li", { style: "color:var(--muted);font-size:0.82rem;padding:0.4rem;", textContent: q ? "No teachers match search." : "No other verified teachers found." }));
      return;
    }

    availableList.replaceChildren(...filtered.map((person) => {
      const avatar = renderPersonAvatar(person.avatar_path, person.full_name, 36);
      const name = h("span", { className: "delegate-name", textContent: person.full_name });
      const rank = h("span", { className: "delegate-rank", textContent: person.rank_level || "Faculty Member" });
      const personInfo = h("div", { className: "delegate-info" }, name, rank);
      const personBlock = h("div", { className: "delegate-person" }, avatar, personInfo);

      const assignBtn = h("button", {
        type: "button",
        className: "btn primary",
        style: "padding:0.35rem 0.85rem;font-size:0.8rem;",
        textContent: "Assign",
        onclick: async () => {
          assignBtn.disabled = true;
          say(msg, "Assigning...");
          const { error } = await supabase.from("status_managers").insert({
            entity_type: it.kind, entity_id: it.id, user_id: person.id, assigned_by: profile.id
          });
          assignBtn.disabled = false;
          if (error) {
            say(msg, error.code === "23505" ? "Already assigned." : "Could not assign.", true);
          } else {
            say(msg, "");
            refresh();
          }
        }
      });

      return h("li", { className: "delegate-item" }, personBlock, assignBtn);
    }));
  }

  searchInput.addEventListener("input", () => renderAvailable(searchInput.value));

  async function refresh() {
    try {
      people = await fetchPeople();
      const { data, error } = await supabase.from("status_managers").select("id, user_id")
        .eq("entity_type", it.kind).eq("entity_id", it.id);
      if (error) console.warn("status_managers notice:", error);

      const managers = data ?? [];
      const taken = new Set(managers.map((d) => d.user_id));

      if (!managers.length) {
        assignedList.replaceChildren(h("li", { style: "color:var(--muted);font-size:0.82rem;padding:0.3rem 0;", textContent: "None currently assigned (you are the primary coordinator)." }));
      } else {
        assignedList.replaceChildren(...managers.map((d) => {
          const person = people.get(d.user_id) || { full_name: "Assigned Faculty", avatar_path: null, rank_level: null };
          const avatar = renderPersonAvatar(person.avatar_path, person.full_name, 36);
          const name = h("span", { className: "delegate-name", textContent: person.full_name });
          const rank = h("span", { className: "delegate-rank", textContent: person.rank_level || "Co-Coordinator" });
          const personInfo = h("div", { className: "delegate-info" }, name, rank);
          const personBlock = h("div", { className: "delegate-person" }, avatar, personInfo);

          const removeBtn = h("button", {
            type: "button",
            className: "btn",
            style: "padding:0.3rem 0.65rem;font-size:0.78rem;color:#f87171;",
            textContent: "Remove",
            onclick: async () => {
              removeBtn.disabled = true;
              const r = await supabase.from("status_managers").delete().eq("id", d.id);
              if (r.error) {
                say(msg, "Could not remove delegate.", true);
                removeBtn.disabled = false;
              } else {
                refresh();
              }
            }
          });

          return h("li", { className: "delegate-item" }, personBlock, removeBtn);
        }));
      }

      cachedAvailable = [...people.values()].filter((p) => p.id !== profile.id && !taken.has(p.id));
      renderAvailable(searchInput.value);
    } catch (err) {
      console.error(err);
      say(msg, "Could not load delegates.", true);
    }
  }

  box.addEventListener("toggle", () => { if (box.open) refresh(); });
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