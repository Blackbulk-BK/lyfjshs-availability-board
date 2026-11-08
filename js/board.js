// js/board.js : Centralized public availability board (Luis Y. Ferrer Jr. Senior High School).
// Students and staff can search and view real-time availability for both teachers and departments.
import { supabase } from "./supabaseClient.js";
import { getIcon, refreshLucide } from "./icons.js";

const TZ = "Asia/Manila";
const REFRESH_MS = 5 * 60 * 1000; // 5-minute safety refresh

export const LABELS = {
  available: "Available",
  unavailable: "Unavailable",
  under_maintenance: "Under Maintenance",
  not_updated: "Status Not Updated",
};

export const CATEGORIES = {
  clinic: "Clinic",
  library: "Library",
  stockroom: "Stockroom / Supply",
  computer_lab: "Computer Laboratory",
  laboratory: "Laboratory",
  office: "School Office",
  other: "Department",
};

const state = {
  tab: "all", // "all" | "teachers" | "departments"
  filter: "all", // "all" | "available" | "unavailable" | "under_maintenance" | "not_updated"
  query: "",
  teachers: [],
  departments: [],
  hasData: false,
  loading: false,
  queued: false,
  error: false,
};

const $ = (id) => document.getElementById(id);
const el = {
  list: $("list"),
  search: $("search"),
  tabs: $("tabs"),
  filters: $("filters"),
  message: $("message"),
  retry: $("retry"),
  refreshed: $("refreshed"),
  latestUpdateTime: $("latest-update-time"),
  systemSync: $("system-sync"),
  countAvailable: $("count-available"),
  countUnavailable: $("count-unavailable"),
  countMaintenance: $("count-maintenance"),
  countNotUpdated: $("count-not-updated"),
  boardSummary: $("board-summary"),
};

// Date & Time formatters set to Philippine standard time (Asia/Manila)
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }); // YYYY-MM-DD
const timeFmt = new Intl.DateTimeFormat("en-PH", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const shortDateFmt = new Intl.DateTimeFormat("en-PH", { timeZone: TZ, month: "short", day: "numeric" });
const fullDateTimeFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// ---------- Helpers ----------
const norm = (s) => (s ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "");

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/**
 * Returns clear, explicit date AND time for each availability record
 */
function updatedText(item) {
  if (!item.updated_at) {
    return item.display_status === "not_updated"
      ? "Status Not Updated (No recorded update)"
      : "No update timestamp recorded";
  }

  const d = new Date(item.updated_at);
  const isToday = dayFmt.format(d) === dayFmt.format(new Date());

  if (item.display_status === "under_maintenance") {
    return isToday
      ? `Under Maintenance • Updated today at ${timeFmt.format(d)}`
      : `Under Maintenance • Recorded ${fullDateTimeFmt.format(d)}`;
  }

  if (item.display_status === "not_updated") {
    return `Status Not Updated • Last active: ${fullDateTimeFmt.format(d)}`;
  }

  return isToday
    ? `Updated today at ${timeFmt.format(d)} (${shortDateFmt.format(d)})`
    : `Last updated: ${fullDateTimeFmt.format(d)}`;
}

function showMessage(text, withRetry = false) {
  if (!el.message) return;
  el.message.textContent = text;
  el.message.hidden = !text;
  if (el.retry) el.retry.hidden = !withRetry;
}

// Compute client-side fallback status if database view is unavailable
function computeFallbackStatus(status, updatedAt) {
  if (status === "under_maintenance") return "under_maintenance";
  if (!status || !updatedAt) return "not_updated";
  const isToday = dayFmt.format(new Date(updatedAt)) === dayFmt.format(new Date());
  return isToday ? status : "not_updated";
}

// ---------- Summary Counters & Timestamps ----------
function updateSummaryStats() {
  const allItems = [...state.teachers, ...state.departments];
  
  let available = 0, unavailable = 0, maintenance = 0, notUpdated = 0;
  let latestTimestamp = 0;

  for (const item of allItems) {
    if (item.display_status === "available") available++;
    else if (item.display_status === "unavailable") unavailable++;
    else if (item.display_status === "under_maintenance") maintenance++;
    else notUpdated++;

    if (item.updated_at) {
      const ts = new Date(item.updated_at).getTime();
      if (!isNaN(ts) && ts > latestTimestamp) latestTimestamp = ts;
    }
  }

  if (el.countAvailable) el.countAvailable.textContent = String(available);
  if (el.countUnavailable) el.countUnavailable.textContent = String(unavailable);
  if (el.countMaintenance) el.countMaintenance.textContent = String(maintenance);
  if (el.countNotUpdated) el.countNotUpdated.textContent = String(notUpdated);

  // Update latest update timestamp banner
  if (el.latestUpdateTime) {
    if (latestTimestamp > 0) {
      el.latestUpdateTime.textContent = fullDateTimeFmt.format(new Date(latestTimestamp));
    } else {
      el.latestUpdateTime.textContent = "No recent records";
    }
  }

  // Update system sync banner
  if (el.systemSync) {
    el.systemSync.textContent = `${fullDateTimeFmt.format(new Date())} (Live)`;
  }
}

// ---------- Rendering ----------
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

function departmentIconNode(category) {
  const wrap = document.createElement("div");
  wrap.className = "avatar";
  wrap.style.background = "linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%)";
  wrap.style.color = "#7e22ce";
  wrap.innerHTML = getIcon("building", "icon-svg");
  return wrap;
}

function rowNode(item) {
  const li = document.createElement("li");
  li.className = "row";
  li.dataset.status = item.display_status;
  li.classList.add(`has-status-${item.display_status}`);

  const isTeacher = item.entity_type === "teacher";

  // Visual Avatar / Icon
  if (isTeacher) {
    li.append(avatarNode(item));
  } else {
    li.append(departmentIconNode(item.category));
  }

  // Main Info
  const info = document.createElement("div");
  info.className = "info";

  const titleRow = document.createElement("div");
  titleRow.style.display = "flex";
  titleRow.style.alignItems = "center";
  titleRow.style.flexWrap = "wrap";
  titleRow.style.gap = "0.35rem";

  // Entity Badge (Teacher vs Department)
  const entityBadge = document.createElement("span");
  entityBadge.className = `entity-tag ${isTeacher ? "tag-teacher" : "tag-dept"}`;
  entityBadge.textContent = isTeacher ? "Teacher" : (CATEGORIES[item.category] ?? "Department");
  titleRow.append(entityBadge);

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = item.name;
  titleRow.append(name);

  // Secondary details (rank, handles, room location)
  const meta = document.createElement("div");
  meta.className = "meta";

  // Clock icon for update timestamp
  const clockSpan = document.createElement("span");
  clockSpan.innerHTML = getIcon("clock", "icon-svg");
  clockSpan.style.display = "inline-flex";
  clockSpan.style.marginRight = "0.2rem";
  clockSpan.setAttribute("aria-hidden", "true");

  const timeTextNode = document.createElement("span");
  timeTextNode.className = "time-stamp";
  timeTextNode.textContent = updatedText(item);

  meta.append(clockSpan, timeTextNode);

  // Sub-details (Building / Handlers / Subjects)
  const subDetails = document.createElement("div");
  subDetails.style.display = "flex";
  subDetails.style.flexWrap = "wrap";
  subDetails.style.gap = "0.35rem";
  subDetails.style.marginTop = "0.2rem";

  if (!isTeacher) {
    if (item.building) {
      const loc = document.createElement("span");
      loc.className = "meta-tag";
      loc.innerHTML = `${getIcon("mapPin", "icon-svg")} <strong>${item.building.toUpperCase()}</strong>${item.floor_level ? " &bull; " + item.floor_level : ""}`;
      subDetails.append(loc);
    }
    if (item.handlers) {
      const hnd = document.createElement("span");
      hnd.className = "meta-tag";
      hnd.innerHTML = `${getIcon("user", "icon-svg")} Coordinator: <strong>${item.handlers}</strong>`;
      subDetails.append(hnd);
    }
    if (item.open_time && item.close_time) {
      const hrs = document.createElement("span");
      hrs.className = "meta-tag";
      hrs.innerHTML = `${getIcon("clock", "icon-svg")} ${item.open_time.slice(0, 5)} - ${item.close_time.slice(0, 5)}`;
      subDetails.append(hrs);
    }
  } else {
    if (item.rank_level) {
      const rk = document.createElement("span");
      rk.className = "meta-tag";
      rk.innerHTML = `${getIcon("userCheck", "icon-svg")} <strong>${item.rank_level}</strong>`;
      subDetails.append(rk);
    }
    if (item.handles) {
      const hnd = document.createElement("span");
      hnd.className = "meta-tag";
      hnd.innerHTML = `${getIcon("building", "icon-svg")} Handles: ${item.handles}`;
      subDetails.append(hnd);
    }
  }

  info.append(titleRow, meta);
  if (subDetails.children.length > 0) info.append(subDetails);

  // Status Pill Badge
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

// Match search query against multiple fields: name, category, building, floor, handlers, rank
function matchItem(item, q) {
  if (!q) return true;
  const name = norm(item.name || item.full_name || "");
  const cat = norm(CATEGORIES[item.category] || item.category || "");
  const building = norm(item.building || "");
  const floor = norm(item.floor_level || "");
  const handlers = norm(item.handlers || "");
  const handles = norm(item.handles || "");
  const rank = norm(item.rank_level || "");
  const desc = norm(item.description || "");

  return name.includes(q) ||
         cat.includes(q) ||
         building.includes(q) ||
         floor.includes(q) ||
         handlers.includes(q) ||
         handles.includes(q) ||
         rank.includes(q) ||
         desc.includes(q);
}

function getActiveItems() {
  if (state.tab === "teachers") return state.teachers;
  if (state.tab === "departments") return state.departments;
  // Centralized "all": combine teachers and departments
  return [...state.departments, ...state.teachers];
}

function visibleItems() {
  const q = norm(state.query.trim());
  const pool = getActiveItems();

  return pool.filter((item) => {
    const matchesFilter = state.filter === "all" || item.display_status === state.filter;
    const matchesQuery = matchItem(item, q);
    return matchesFilter && matchesQuery;
  });
}

function render() {
  const items = visibleItems();
  el.list.replaceChildren(...items.map(rowNode));

  if (!state.error) {
    if (items.length === 0) {
      const q = state.query.trim();
      if (q) {
        showMessage(`No matches found for "${q}". Try searching by department name, teacher name, or room location.`);
      } else {
        showMessage("No records match the selected filter.");
      }
    } else {
      showMessage("");
    }
  }

  refreshLucide();
}

// ---------- Loading & Backend Query Resilience ----------
async function fetchBoard({ first = false } = {}) {
  if (state.loading) { state.queued = true; return; }
  state.loading = true;
  if (first) renderSkeleton();

  try {
    // 1) Fetch teachers from view or fallback to base table
    let teachersData = [];
    try {
      const t = await supabase.from("teachers_board").select("*").order("name");
      if (t.error) throw t.error;
      teachersData = (t.data ?? []).map((r) => ({ ...r, entity_type: "teacher" }));
    } catch (err) {
      console.warn("teachers_board view fallback, querying base table:", err);
      const fallback = await supabase
        .from("teachers")
        .select("id, full_name, status, updated_at, avatar_path, rank_level, description")
        .eq("is_active", true)
        .order("full_name");
      if (fallback.error) throw fallback.error;
      teachersData = (fallback.data ?? []).map((r) => ({
        ...r,
        name: r.full_name,
        display_status: computeFallbackStatus(r.status, r.updated_at),
        entity_type: "teacher",
      }));
    }

    // 2) Fetch departments from view or fallback to base table
    let departmentsData = [];
    try {
      const d = await supabase.from("departments_board").select("*").order("name");
      if (d.error) throw d.error;
      departmentsData = (d.data ?? []).map((r) => ({ ...r, entity_type: "department" }));
    } catch (err) {
      console.warn("departments_board view fallback, querying base table:", err);
      const fallback = await supabase
        .from("departments")
        .select("id, name, category, status, updated_at, building, floor_level, open_time, close_time")
        .eq("is_active", true)
        .order("name");
      if (fallback.error) throw fallback.error;
      departmentsData = (fallback.data ?? []).map((r) => ({
        ...r,
        display_status: computeFallbackStatus(r.status, r.updated_at),
        entity_type: "department",
      }));
    }

    state.teachers = teachersData;
    state.departments = departmentsData;
    state.hasData = true;
    state.error = false;

    updateSummaryStats();
    showMessage("");
    render();

    if (el.refreshed) {
      el.refreshed.textContent = `Refreshed ${timeFmt.format(new Date())}`;
    }
  } catch (err) {
    console.error("Board load failed:", err);
    state.error = true;
    if (state.hasData) {
      showMessage("Could not refresh live data. Showing last recorded availability.", true);
    } else {
      el.list.replaceChildren();
      showMessage("Could not connect to availability database. Check connection or verify Supabase setup.", true);
    }
  } finally {
    state.loading = false;
    if (state.queued) {
      state.queued = false;
      fetchBoard();
    }
  }
}

// ---------- Real-time Updates ----------
let refreshTimer;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => fetchBoard(), 300);
}

function subscribeToChanges() {
  supabase
    .channel("board-centralized")
    .on("postgres_changes", { event: "*", schema: "public", table: "teachers" }, scheduleRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "departments" }, scheduleRefresh)
    .subscribe();
}

// ---------- Controls & Event Wiring ----------
function setActive(container, attr, value, ariaAttr) {
  if (!container) return;
  container.querySelectorAll("button").forEach((b) => {
    b.setAttribute(ariaAttr, String(b.dataset[attr] === value));
  });
}

function wireControls() {
  // Live search input
  if (el.search) {
    el.search.addEventListener("input", () => {
      state.query = el.search.value;
      render();
    });
  }

  // Centralized Tabs (All, Teachers, Departments)
  if (el.tabs) {
    el.tabs.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-tab]");
      if (!b) return;
      state.tab = b.dataset.tab;
      setActive(el.tabs, "tab", state.tab, "aria-selected");
      render();
    });
  }

  // Status Filter Buttons
  if (el.filters) {
    el.filters.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-filter]");
      if (!b) return;
      state.filter = b.dataset.filter;
      setActive(el.filters, "filter", state.filter, "aria-pressed");
      updateStatChipHighlight();
      render();
    });
  }

  // Clickable Summary Stat Chips
  if (el.boardSummary) {
    el.boardSummary.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-stat-filter]");
      if (!chip) return;
      const targetFilter = chip.dataset.statFilter;
      // Toggle or set filter
      state.filter = state.filter === targetFilter ? "all" : targetFilter;
      setActive(el.filters, "filter", state.filter, "aria-pressed");
      updateStatChipHighlight();
      render();
    });
  }

  if (el.retry) {
    el.retry.addEventListener("click", () => fetchBoard());
  }
}

function updateStatChipHighlight() {
  if (!el.boardSummary) return;
  el.boardSummary.querySelectorAll("[data-stat-filter]").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.statFilter === state.filter);
  });
}

// ---------- Start Initialization ----------
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
