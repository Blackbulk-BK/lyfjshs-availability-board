// js/board.js : Centralized public availability board (Luis Y. Ferrer Jr. Senior High School).
import { supabase } from "./supabaseClient.js";
import { getIcon, refreshLucide } from "./icons.js";

const TZ = "Asia/Manila";
const REFRESH_MS = 5 * 60 * 1000;

export const LABELS = {
  available: "Available",
  unavailable: "Unavailable",
  under_maintenance: "Under Maintenance",
  not_updated: "Status Not Updated",
};

export const CATEGORIES = {
  academic: "Academic Department",
  admin: "Administrative Office",
  other: "Department",
};

const state = {
  tab: "all", // "all" | "teachers" | "departments"
  filter: "all", // "all" | "available" | "unavailable" | "under_maintenance" | "not_updated"
  query: "",
  teachers: [],
  departments: [],
  expandedDepts: new Set(),
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

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
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

  if (el.latestUpdateTime) {
    el.latestUpdateTime.textContent = latestTimestamp > 0
      ? fullDateTimeFmt.format(new Date(latestTimestamp))
      : "No recent records";
  }

  if (el.systemSync) {
    el.systemSync.textContent = `${fullDateTimeFmt.format(new Date())} (Live)`;
  }
}

// ---------- Rendering ----------
function avatarNode(item, size = 44) {
  const wrap = document.createElement("div");
  wrap.className = "avatar";
  if (size !== 44) {
    wrap.style.width = `${size}px`;
    wrap.style.height = `${size}px`;
    wrap.style.fontSize = "0.78rem";
  }
  const personName = item.name || item.full_name;
  if (item.avatar_path) {
    const { data } = supabase.storage.from("avatars").getPublicUrl(item.avatar_path);
    const img = new Image(size, size);
    img.loading = "lazy";
    img.alt = "";
    img.src = data.publicUrl;
    img.onerror = () => { img.remove(); wrap.textContent = initials(personName); };
    wrap.append(img);
  } else {
    wrap.textContent = initials(personName);
  }
  return wrap;
}

function departmentIconNode(deptName) {
  const wrap = document.createElement("div");
  wrap.className = "avatar dept-monogram";
  wrap.textContent = (deptName || "DP").slice(0, 3).toUpperCase();
  return wrap;
}

function buildDeptRosterDrawer(dept) {
  const teachers = Array.isArray(dept.assigned_teachers) ? dept.assigned_teachers : [];
  const drawer = document.createElement("div");
  drawer.className = "dept-roster-drawer";

  const header = document.createElement("div");
  header.className = "dept-roster-header";

  const availCount = teachers.filter((t) => t.display_status === "available").length;
  header.innerHTML = `
    <span>Assigned Faculty (${teachers.length})</span>
    <span class="dept-avail-summary">${availCount} Available Now</span>
  `;
  drawer.append(header);

  if (!teachers.length) {
    const empty = document.createElement("p");
    empty.className = "dept-roster-empty";
    empty.textContent = "No teachers are currently assigned to this department.";
    drawer.append(empty);
    return drawer;
  }

  const ul = document.createElement("ul");
  ul.className = "dept-roster-list";

  teachers.forEach((t) => {
    const row = document.createElement("li");
    row.className = `dept-teacher-item is-${t.display_status}`;

    const left = document.createElement("div");
    left.className = "dept-teacher-person";
    left.append(avatarNode(t, 34));

    const details = document.createElement("div");
    details.className = "dept-teacher-details";
    const tName = document.createElement("span");
    tName.className = "dept-teacher-name";
    tName.textContent = t.name;
    const tRank = document.createElement("span");
    tRank.className = "dept-teacher-rank";
    tRank.textContent = t.rank_level || "Faculty Member";
    details.append(tName, tRank);
    left.append(details);

    const miniPill = document.createElement("span");
    miniPill.className = `pill mini status-${t.display_status}`;
    const dot = document.createElement("span");
    dot.className = "dot";
    miniPill.append(dot, document.createTextNode(LABELS[t.display_status] ?? t.display_status));

    row.append(left, miniPill);
    ul.append(row);
  });

  drawer.append(ul);
  return drawer;
}

function rowNode(item) {
  const isTeacher = item.entity_type === "teacher";
  const isExpanded = !isTeacher && (state.expandedDepts.has(item.id) || state.tab === "departments");

  const li = document.createElement("li");
  li.className = `row ${!isTeacher ? "row-department" : ""} ${isExpanded ? "is-expanded" : ""}`;
  li.dataset.status = item.display_status;
  li.classList.add(`has-status-${item.display_status}`);

  const mainLine = document.createElement("div");
  mainLine.className = "row-main";

  if (isTeacher) {
    mainLine.append(avatarNode(item));
  } else {
    mainLine.append(departmentIconNode(item.name));
  }

  const info = document.createElement("div");
  info.className = "info";

  const titleRow = document.createElement("div");
  titleRow.className = "title-row";

  const entityBadge = document.createElement("span");
  entityBadge.className = `entity-tag ${isTeacher ? "tag-teacher" : "tag-dept"}`;
  entityBadge.textContent = isTeacher ? "Faculty" : (item.name === "ADMIN" ? "Office" : "Department");
  titleRow.append(entityBadge);

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = item.name;
  titleRow.append(name);

  if (!isTeacher) {
    const assigned = Array.isArray(item.assigned_teachers) ? item.assigned_teachers : [];
    const availCount = assigned.filter((t) => t.display_status === "available").length;
    const countChip = document.createElement("span");
    countChip.className = `dept-count-chip ${availCount > 0 ? "has-available" : ""}`;
    countChip.textContent = assigned.length
      ? `${availCount}/${assigned.length} Teachers Available`
      : "0 Teachers Assigned";
    titleRow.append(countChip);
  }

  const meta = document.createElement("div");
  meta.className = "meta";

  const clockSpan = document.createElement("span");
  clockSpan.innerHTML = getIcon("clock", "icon-svg");
  clockSpan.style.display = "inline-flex";
  clockSpan.style.marginRight = "0.2rem";
  clockSpan.setAttribute("aria-hidden", "true");

  const timeTextNode = document.createElement("span");
  timeTextNode.className = "time-stamp";
  timeTextNode.textContent = updatedText(item);

  meta.append(clockSpan, timeTextNode);

  const subDetails = document.createElement("div");
  subDetails.className = "sub-details";

  if (!isTeacher) {
    if (item.open_time && item.close_time) {
      const hrs = document.createElement("span");
      hrs.className = "meta-tag";
      hrs.innerHTML = `${getIcon("clock", "icon-svg")} ${item.open_time.slice(0, 5)} - ${item.close_time.slice(0, 5)}`;
      subDetails.append(hrs);
    }
    const hintTag = document.createElement("span");
    hintTag.className = "meta-tag dept-toggle-hint";
    hintTag.textContent = isExpanded ? "Hide assigned teachers" : "Click to view assigned teachers";
    subDetails.append(hintTag);
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
      hnd.innerHTML = `${getIcon("building", "icon-svg")} Dept: <strong>${item.handles}</strong>`;
      subDetails.append(hnd);
    }
    if (item.description) {
      const desc = document.createElement("span");
      desc.className = "meta-tag";
      desc.textContent = item.description;
      subDetails.append(desc);
    }
  }

  info.append(titleRow, meta);
  if (subDetails.children.length > 0) info.append(subDetails);

  const pill = document.createElement("span");
  pill.className = `pill status-${item.display_status}`;
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.setAttribute("aria-hidden", "true");
  pill.append(dot, document.createTextNode(LABELS[item.display_status] ?? item.display_status));

  mainLine.append(info, pill);
  li.append(mainLine);

  // Interactive click on department card to toggle assigned teachers roster
  if (!isTeacher) {
    mainLine.style.cursor = "pointer";
    mainLine.setAttribute("role", "button");
    mainLine.setAttribute("tabindex", "0");
    mainLine.setAttribute("aria-expanded", String(isExpanded));

    const toggleDept = () => {
      if (state.expandedDepts.has(item.id)) {
        state.expandedDepts.delete(item.id);
      } else {
        state.expandedDepts.add(item.id);
      }
      render();
    };

    mainLine.addEventListener("click", toggleDept);
    mainLine.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleDept();
      }
    });

    if (isExpanded) {
      li.append(buildDeptRosterDrawer(item));
    }
  }

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

function matchItem(item, q) {
  if (!q) return true;
  const name = norm(item.name || item.full_name || "");
  const handlers = norm(item.handlers || "");
  const handles = norm(item.handles || "");
  const rank = norm(item.rank_level || "");
  const desc = norm(item.description || "");

  return (
    name.includes(q) ||
    handlers.includes(q) ||
    handles.includes(q) ||
    rank.includes(q) ||
    desc.includes(q)
  );
}

function getActiveItems() {
  if (state.tab === "teachers") return state.teachers;
  if (state.tab === "departments") return state.departments;
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
        showMessage(`No matches found for "${q}". Try searching by department (e.g. ICT, STEM/SCIENCE, ABM) or teacher name.`);
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
    let teachersData = [];
    try {
      const t = await supabase.from("teachers_board").select("*").order("name");
      if (t.error) throw t.error;
      teachersData = (t.data ?? []).map((r) => ({ ...r, entity_type: "teacher" }));
    } catch (err) {
      console.warn("teachers_board view fallback:", err);
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

    let departmentsData = [];
    try {
      const d = await supabase.from("departments_board").select("*").order("name");
      if (d.error) throw d.error;
      departmentsData = (d.data ?? []).map((r) => ({ ...r, entity_type: "department" }));
    } catch (err) {
      console.warn("departments_board view fallback:", err);
      const fallback = await supabase
        .from("departments")
        .select("id, name, category, status, updated_at, open_time, close_time")
        .eq("is_active", true)
        .order("name");
      if (fallback.error) throw fallback.error;
      departmentsData = (fallback.data ?? []).map((r) => ({
        ...r,
        display_status: computeFallbackStatus(r.status, r.updated_at),
        assigned_teachers: [],
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
    .on("postgres_changes", { event: "*", schema: "public", table: "department_staff" }, scheduleRefresh)
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
  if (el.search) {
    el.search.addEventListener("input", () => {
      state.query = el.search.value;
      render();
    });
  }

  if (el.tabs) {
    el.tabs.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-tab]");
      if (!b) return;
      state.tab = b.dataset.tab;
      // Auto-expand all departments when switching directly to the Departments tab
      if (state.tab === "departments") {
        state.departments.forEach((d) => state.expandedDepts.add(d.id));
      }
      setActive(el.tabs, "tab", state.tab, "aria-selected");
      render();
    });
  }

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

  if (el.boardSummary) {
    el.boardSummary.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-stat-filter]");
      if (!chip) return;
      const targetFilter = chip.dataset.statFilter;
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