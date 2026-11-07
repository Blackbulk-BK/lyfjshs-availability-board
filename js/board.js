// js/board.js : public availability board (Phase 3). Students only VIEW; no login needed.
//
// index.html must contain these ids:
//   #search   (input)                       #tabs    > button[data-tab="teachers|departments"]
//   #filters  > button[data-filter="all|available|unavailable|not_updated"]
//   #list     (ul)    #message (p)    #retry (button)    #refreshed (span, optional)
//
// The "Status Not Updated" rule lives in the database views (teachers_board and
// departments_board). This file only reads them, so every device shows the same result.
import { supabase } from "./supabaseClient.js";
import { getIcon, refreshLucide } from "./icons.js";

const TZ = "Asia/Manila";
const REFRESH_MS = 5 * 60 * 1000; // safety refresh (also covers a page left open past midnight)
const LABELS = { available: "Available", unavailable: "Unavailable", not_updated: "Status Not Updated" };
const CATEGORIES = {
  clinic: "Clinic", library: "Library", stockroom: "Stockroom",
  computer_lab: "Computer laboratory", other: "Department",
};

const state = {
  tab: "teachers", filter: "all", query: "",
  teachers: [], departments: [],
  hasData: false, loading: false, queued: false, error: false,
};

const $ = (id) => document.getElementById(id);
const el = {
  list: $("list"), search: $("search"), tabs: $("tabs"), filters: $("filters"),
  message: $("message"), retry: $("retry"), refreshed: $("refreshed"),
};

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }); // 2026-11-07
const timeFmt = new Intl.DateTimeFormat("en-PH", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const dateTimeFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

// ---------- helpers ----------
const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function initials(name) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function updatedText(item) {
  if (!item.updated_at) return "No update yet";
  const d = new Date(item.updated_at);
  return dayFmt.format(d) === dayFmt.format(new Date())
    ? `Updated ${timeFmt.format(d)} today`
    : `Last update ${dateTimeFmt.format(d)}`;
}

function showMessage(text, withRetry = false) {
  el.message.textContent = text;
  el.message.hidden = !text;
  el.retry.hidden = !withRetry;
}

// ---------- rendering ----------
function avatarNode(item) {
  const wrap = document.createElement("div");
  wrap.className = "avatar";
  if (item.avatar_path) {
    const { data } = supabase.storage.from("avatars").getPublicUrl(item.avatar_path);
    const img = new Image(44, 44);
    img.loading = "lazy";
    img.alt = "";
    img.src = data.publicUrl;
    img.onerror = () => { img.remove(); wrap.textContent = initials(item.name); };
    wrap.append(img);
  } else {
    wrap.textContent = initials(item.name);
  }
  return wrap;
}

function rowNode(item) {
  const li = document.createElement("li");
  li.className = "row";
  li.dataset.status = item.display_status;
  li.classList.add(`has-status-${item.display_status}`);

  if (state.tab === "teachers") li.append(avatarNode(item));

  const info = document.createElement("div");
  info.className = "info";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = item.name;

  const meta = document.createElement("span");
  meta.className = "meta";
  const kind = state.tab === "departments" ? `${CATEGORIES[item.category] ?? "Department"} \u00b7 ` : "";
  
  // Clean meta with subtle clock icon
  const clockSpan = document.createElement("span");
  clockSpan.innerHTML = getIcon("clock", "icon-svg");
  clockSpan.style.display = "inline-flex";
  clockSpan.style.marginRight = "0.25rem";
  clockSpan.setAttribute("aria-hidden", "true");

  meta.append(clockSpan, document.createTextNode(kind + updatedText(item)));
  info.append(name, meta);

  const pill = document.createElement("span");
  pill.className = `pill status-${item.display_status}`;
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.setAttribute("aria-hidden", "true");
  pill.append(dot, document.createTextNode(LABELS[item.display_status] ?? item.display_status));

  li.append(info, pill);
  return li;
}

function renderSkeleton() {
  const rows = Array.from({ length: 6 }, () => {
    const li = document.createElement("li");
    li.className = "row skeleton";
    li.setAttribute("aria-hidden", "true");
    return li;
  });
  el.list.replaceChildren(...rows);
}

function visibleItems() {
  const q = norm(state.query.trim());
  return state[state.tab].filter(
    (i) => (state.filter === "all" || i.display_status === state.filter) &&
           (!q || norm(i.name).includes(q))
  );
}

function render() {
  const items = visibleItems();
  el.list.replaceChildren(...items.map(rowNode));
  if (!state.error) showMessage(items.length ? "" : "No matches found.");
}

// ---------- loading ----------
async function fetchBoard({ first = false } = {}) {
  if (state.loading) { state.queued = true; return; }
  state.loading = true;
  if (first) renderSkeleton();
  try {
    const [t, d] = await Promise.all([
      supabase.from("teachers_board").select("*").order("name"),
      supabase.from("departments_board").select("*").order("name"),
    ]);
    if (t.error) throw t.error;
    if (d.error) throw d.error;
    state.teachers = t.data ?? [];
    state.departments = d.data ?? [];
    state.hasData = true;
    state.error = false;
    showMessage("");
    render();
    if (el.refreshed) el.refreshed.textContent = `Refreshed ${timeFmt.format(new Date())}`;
  } catch (err) {
    console.error("Board load failed:", err);
    state.error = true;
    if (state.hasData) {
      showMessage("Could not refresh. Showing the last loaded information.", true);
    } else {
      el.list.replaceChildren();
      showMessage("Could not load availability. Check your connection and try again.", true);
    }
  } finally {
    state.loading = false;
    if (state.queued) { state.queued = false; fetchBoard(); }
  }
}

// ---------- live updates ----------
let refreshTimer;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => fetchBoard(), 300);
}

function subscribeToChanges() {
  // On any change, re-read the views (do not trust the event data).
  supabase
    .channel("board")
    .on("postgres_changes", { event: "*", schema: "public", table: "teachers" }, scheduleRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "departments" }, scheduleRefresh)
    .subscribe();
}

// ---------- controls ----------
function setActive(container, attr, value, ariaAttr) {
  container.querySelectorAll("button").forEach((b) => {
    b.setAttribute(ariaAttr, String(b.dataset[attr] === value));
  });
}

function wireControls() {
  el.search.addEventListener("input", () => { state.query = el.search.value; render(); });

  el.tabs.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    state.tab = b.dataset.tab;
    setActive(el.tabs, "tab", state.tab, "aria-selected");
    render();
  });

  el.filters.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-filter]");
    if (!b) return;
    state.filter = b.dataset.filter;
    setActive(el.filters, "filter", state.filter, "aria-pressed");
    render();
  });

  el.retry.addEventListener("click", () => fetchBoard());
}

// ---------- start ----------
wireControls();
setActive(el.tabs, "tab", state.tab, "aria-selected");
setActive(el.filters, "filter", state.filter, "aria-pressed");
fetchBoard({ first: true });
subscribeToChanges();
refreshLucide();
setInterval(() => fetchBoard(), REFRESH_MS);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") fetchBoard();
});
