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

const DAYS = [
  { key: "Mon", label: "Monday" },
  { key: "Tue", label: "Tuesday" },
  { key: "Wed", label: "Wednesday" },
  { key: "Thu", label: "Thursday" },
  { key: "Fri", label: "Friday" },
  { key: "Sat", label: "Saturday" },
];

const state = {
  tab: "all", // "all" | "departments" | "facilities" | "teachers"
  filter: "all",
  query: "",
  teachers: [],
  departments: [],
  facilities: [],
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
  modal: $("teacher-modal"),
  modalBody: $("teacher-modal-body"),
  modalClose: $("teacher-modal-close"),
};

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" });
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

const norm = (s) => (s ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "");

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function format12Hour(hhmm) {
  if (!hhmm || !hhmm.includes(":")) return hhmm || "";
  const [hStr, mStr] = hhmm.split(":");
  let h = parseInt(hStr, 10);
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${mStr} ${suffix}`;
}

function getTodayKey() {
  return weekdayFmt.format(new Date()).slice(0, 3);
}

function getScheduleSummary(schedule) {
  if (!schedule || typeof schedule !== "object") return null;
  const activeDays = DAYS.filter((d) => schedule[d.key]?.start && schedule[d.key]?.end);
  if (!activeDays.length) return null;

  const todayKey = getTodayKey();
  const todaySlot = schedule[todayKey];
  if (todaySlot?.start && todaySlot?.end) {
    return `Today (${todayKey}): ${format12Hour(todaySlot.start)} – ${format12Hour(todaySlot.end)}`;
  }
  const first = activeDays[0];
  const slot = schedule[first.key];
  return `${first.key}: ${format12Hour(slot.start)} – ${format12Hour(slot.end)}`;
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

function updateSummaryStats() {
  const allItems = [...state.departments, ...state.facilities, ...state.teachers];

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

function avatarNode(item, size = 44) {
  const wrap = document.createElement("div");
  wrap.className = "avatar";
  if (size !== 44) {
    wrap.style.width = `${size}px`;
    wrap.style.height = `${size}px`;
    wrap.style.fontSize = size >= 60 ? "1.25rem" : "0.78rem";
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

function monogramNode(label, isFacility = false) {
  const wrap = document.createElement("div");
  wrap.className = `avatar ${isFacility ? "facility-monogram" : "dept-monogram"}`;
  if (isFacility) {
    wrap.innerHTML = getIcon("building", "icon-svg");
  } else {
    wrap.textContent = (label || "DP").slice(0, 3).toUpperCase();
  }
  return wrap;
}

// ---------- Teacher Detail & Schedule Modal ----------
function closeTeacherModal() {
  if (!el.modal) return;
  el.modal.hidden = true;
  document.body.style.overflow = "";
}

function openTeacherModal(teacher) {
  if (!el.modal || !el.modalBody) return;

  const full = state.teachers.find((t) => t.id === teacher.id) || teacher;
  const status = full.display_status || "not_updated";
  const todayKey = getTodayKey();
  const schedule = full.schedule && typeof full.schedule === "object" ? full.schedule : {};

  el.modalBody.replaceChildren();

  const top = document.createElement("div");
  top.className = "tmodal-header";
  top.append(avatarNode(full, 64));

  const headInfo = document.createElement("div");
  headInfo.className = "tmodal-head-info";

  const title = document.createElement("h3");
  title.className = "tmodal-name";
  title.textContent = full.name || full.full_name;

  const subRow = document.createElement("div");
  subRow.className = "tmodal-badges";
  if (full.rank_level) {
    const rk = document.createElement("span");
    rk.className = "meta-tag";
    rk.textContent = full.rank_level;
    subRow.append(rk);
  }
  if (full.department_name) {
    const dp = document.createElement("span");
    dp.className = "entity-tag tag-dept";
    dp.textContent = `${full.department_name} Department`;
    subRow.append(dp);
  }

  const pill = document.createElement("span");
  pill.className = `pill status-${status}`;
  const dot = document.createElement("span");
  dot.className = "dot";
  pill.append(dot, document.createTextNode(LABELS[status] ?? status));

  headInfo.append(title, subRow, pill);
  top.append(headInfo);
  el.modalBody.append(top);

  const timeNote = document.createElement("p");
  timeNote.className = "tmodal-timestamp";
  timeNote.textContent = updatedText(full);
  el.modalBody.append(timeNote);

  if (status === "unavailable" && full.unavailable_reason) {
    const reasonBox = document.createElement("div");
    reasonBox.className = "tmodal-reason-box";
    reasonBox.innerHTML = `<strong>Reason for Unavailability:</strong> <span></span>`;
    reasonBox.querySelector("span").textContent = full.unavailable_reason;
    el.modalBody.append(reasonBox);
  }

  if (full.description || full.handles) {
    const aboutSec = document.createElement("div");
    aboutSec.className = "tmodal-section";
    const h4 = document.createElement("h4");
    h4.textContent = "Faculty Information";
    aboutSec.append(h4);

    if (full.description) {
      const descP = document.createElement("p");
      descP.className = "tmodal-desc";
      descP.textContent = full.description;
      aboutSec.append(descP);
    }
    if (full.handles) {
      const facP = document.createElement("p");
      facP.className = "tmodal-fac";
      facP.innerHTML = `<strong>Assigned Facilities / Rooms:</strong> <span></span>`;
      facP.querySelector("span").textContent = full.handles;
      aboutSec.append(facP);
    }
    el.modalBody.append(aboutSec);
  }

  const schedSec = document.createElement("div");
  schedSec.className = "tmodal-section";
  const schedTitle = document.createElement("h4");
  schedTitle.textContent = "School Schedule (Monday – Saturday)";
  schedSec.append(schedTitle);

  const grid = document.createElement("div");
  grid.className = "tmodal-sched-grid";

  DAYS.forEach((d) => {
    const slot = schedule[d.key];
    const hasHours = Boolean(slot?.start && slot?.end);
    const isToday = d.key === todayKey;

    const row = document.createElement("div");
    row.className = `tmodal-sched-row ${isToday ? "is-today" : ""} ${hasHours ? "has-hours" : ""}`;

    const dayCol = document.createElement("span");
    dayCol.className = "tmodal-sched-day";
    dayCol.textContent = isToday ? `${d.label} (Today)` : d.label;

    const timeCol = document.createElement("span");
    timeCol.className = "tmodal-sched-time";
    timeCol.textContent = hasHours
      ? `${format12Hour(slot.start)} – ${format12Hour(slot.end)}`
      : "No Schedule Set";

    row.append(dayCol, timeCol);
    grid.append(row);
  });

  schedSec.append(grid);
  el.modalBody.append(schedSec);

  el.modal.hidden = false;
  document.body.style.overflow = "hidden";
}

if (el.modalClose) el.modalClose.addEventListener("click", closeTeacherModal);
if (el.modal) {
  el.modal.addEventListener("click", (e) => {
    if (e.target === el.modal) closeTeacherModal();
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && el.modal && !el.modal.hidden) closeTeacherModal();
});

// ---------- Department Roster Drawer ----------
function buildDeptRosterDrawer(dept) {
  const teachers = Array.isArray(dept.assigned_teachers) ? dept.assigned_teachers : [];
  const drawer = document.createElement("div");
  drawer.className = "dept-roster-drawer";

  const header = document.createElement("div");
  header.className = "dept-roster-header";

  const availCount = teachers.filter((t) => t.display_status === "available").length;
  header.innerHTML = `
    <span>Assigned Teachers (${teachers.length}) — Click a teacher to view schedule</span>
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
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.title = `Click to view ${t.name}'s profile and schedule`;

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
    const schedShort = getScheduleSummary(t.schedule);
    tRank.textContent = schedShort ? `${t.rank_level || "Faculty"} • ${schedShort}` : (t.rank_level || "Faculty Member");
    details.append(tName, tRank);

    if (t.display_status === "unavailable" && t.unavailable_reason) {
      const reasonSpan = document.createElement("span");
      reasonSpan.className = "dept-teacher-reason";
      reasonSpan.textContent = `Note: ${t.unavailable_reason}`;
      details.append(reasonSpan);
    }

    left.append(details);

    const miniPill = document.createElement("span");
    miniPill.className = `pill mini status-${t.display_status}`;
    const dot = document.createElement("span");
    dot.className = "dot";
    miniPill.append(dot, document.createTextNode(LABELS[t.display_status] ?? t.display_status));

    row.append(left, miniPill);

    const openProfile = (e) => {
      e.stopPropagation();
      openTeacherModal(t);
    };
    row.addEventListener("click", openProfile);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openProfile(e);
      }
    });

    ul.append(row);
  });

  drawer.append(ul);
  return drawer;
}

function rowNode(item) {
  const isTeacher = item.entity_type === "teacher";
  const isDepartment = item.entity_type === "department";
  const isFacility = item.entity_type === "facility";
  const isExpanded = isDepartment && state.expandedDepts.has(item.id);

  const li = document.createElement("li");
  li.className = `row ${isDepartment ? "row-department" : ""} ${isExpanded ? "is-expanded" : ""}`;
  li.dataset.status = item.display_status;
  li.classList.add(`has-status-${item.display_status}`);

  const mainLine = document.createElement("div");
  mainLine.className = "row-main";

  if (isTeacher) {
    mainLine.append(avatarNode(item));
  } else {
    mainLine.append(monogramNode(item.name, isFacility));
  }

  const info = document.createElement("div");
  info.className = "info";

  const titleRow = document.createElement("div");
  titleRow.className = "title-row";

  const entityBadge = document.createElement("span");
  entityBadge.className = `entity-tag ${isTeacher ? "tag-teacher" : isFacility ? "tag-facility" : "tag-dept"}`;
  entityBadge.textContent = isTeacher
    ? "Teacher"
    : isFacility
      ? "Facility"
      : (item.name === "ADMIN" ? "Office" : "Department");
  titleRow.append(entityBadge);

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = item.name;
  titleRow.append(name);

  if (isDepartment) {
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

  if (isDepartment) {
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
  } else if (isFacility) {
    if (item.building || item.floor_level) {
      const loc = document.createElement("span");
      loc.className = "meta-tag";
      loc.innerHTML = `${getIcon("mapPin", "icon-svg")} ${[item.building, item.floor_level].filter(Boolean).join(" • ")}`;
      subDetails.append(loc);
    }
    if (item.open_time && item.close_time) {
      const hrs = document.createElement("span");
      hrs.className = "meta-tag";
      hrs.innerHTML = `${getIcon("clock", "icon-svg")} ${item.open_time.slice(0, 5)} - ${item.close_time.slice(0, 5)}`;
      subDetails.append(hrs);
    }
    if (item.handlers) {
      const stf = document.createElement("span");
      stf.className = "meta-tag";
      stf.innerHTML = `${getIcon("userCheck", "icon-svg")} In-Charge: ${item.handlers}`;
      subDetails.append(stf);
    }
  } else if (isTeacher) {
    if (item.display_status === "unavailable" && item.unavailable_reason) {
      const rsn = document.createElement("span");
      rsn.className = "meta-tag reason-tag";
      rsn.textContent = `Reason: ${item.unavailable_reason}`;
      subDetails.append(rsn);
    }
    const schedStr = getScheduleSummary(item.schedule);
    if (schedStr) {
      const sc = document.createElement("span");
      sc.className = "meta-tag sched-tag";
      sc.innerHTML = `${getIcon("clock", "icon-svg")} ${schedStr}`;
      subDetails.append(sc);
    }
    if (item.department_name) {
      const dp = document.createElement("span");
      dp.className = "meta-tag";
      dp.innerHTML = `${getIcon("building", "icon-svg")} Dept: <strong>${item.department_name}</strong>`;
      subDetails.append(dp);
    }
    if (item.rank_level) {
      const rk = document.createElement("span");
      rk.className = "meta-tag";
      rk.innerHTML = `${getIcon("userCheck", "icon-svg")} <strong>${item.rank_level}</strong>`;
      subDetails.append(rk);
    }
    if (item.handles) {
      const hnd = document.createElement("span");
      hnd.className = "meta-tag";
      hnd.textContent = `Facilities: ${item.handles}`;
      subDetails.append(hnd);
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

  if (isDepartment) {
    mainLine.style.cursor = "pointer";
    mainLine.setAttribute("role", "button");
    mainLine.setAttribute("tabindex", "0");
    mainLine.setAttribute("aria-expanded", String(isExpanded));

    const toggleDept = () => {
      if (state.expandedDepts.has(item.id)) state.expandedDepts.delete(item.id);
      else state.expandedDepts.add(item.id);
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
  } else if (isTeacher) {
    mainLine.style.cursor = "pointer";
    mainLine.setAttribute("role", "button");
    mainLine.setAttribute("tabindex", "0");
    mainLine.title = `Click to view ${item.name}'s full schedule & profile`;

    mainLine.addEventListener("click", () => openTeacherModal(item));
    mainLine.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openTeacherModal(item);
      }
    });
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
  const fields = [
    item.name,
    item.full_name,
    item.department_name,
    item.handlers,
    item.handles,
    item.rank_level,
    item.description,
    item.unavailable_reason,
    item.building,
    item.floor_level,
  ];
  return fields.some((f) => norm(f || "").includes(q));
}

function getActiveItems() {
  if (state.tab === "departments") return state.departments;
  if (state.tab === "facilities") return state.facilities;
  if (state.tab === "teachers") return state.teachers;
  return [...state.departments, ...state.facilities, ...state.teachers];
}

function visibleItems() {
  const q = norm(state.query.trim());
  return getActiveItems().filter((item) => {
    const matchesFilter = state.filter === "all" || item.display_status === state.filter;
    return matchesFilter && matchItem(item, q);
  });
}

function render() {
  const items = visibleItems();
  el.list.replaceChildren(...items.map(rowNode));

  if (!state.error) {
    if (items.length === 0) {
      const q = state.query.trim();
      showMessage(
        q
          ? `No matches found for "${q}". Try searching a department (ICT, ABM, SCIENCE), facility (Clinic, Library), or teacher name.`
          : "No records match the selected filter."
      );
    } else {
      showMessage("");
    }
  }

  refreshLucide();
}

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
        .select("id, full_name, status, updated_at, avatar_path, rank_level, description, unavailable_reason, schedule")
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

    let rawDepts = [];
    try {
      const d = await supabase.from("departments_board").select("*").order("name");
      if (d.error) throw d.error;
      rawDepts = d.data ?? [];
    } catch (err) {
      console.warn("departments_board view fallback:", err);
      const fallback = await supabase
        .from("departments")
        .select("id, name, category, status, updated_at, building, floor_level, open_time, close_time")
        .eq("is_active", true)
        .order("name");
      if (fallback.error) throw fallback.error;
      rawDepts = (fallback.data ?? []).map((r) => ({
        ...r,
        display_status: computeFallbackStatus(r.status, r.updated_at),
        assigned_teachers: [],
      }));
    }

    state.departments = rawDepts
      .filter((r) => r.category !== "facility")
      .map((r) => ({ ...r, entity_type: "department" }));

    state.facilities = rawDepts
      .filter((r) => r.category === "facility")
      .map((r) => ({ ...r, entity_type: "facility" }));

    state.teachers = teachersData;
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