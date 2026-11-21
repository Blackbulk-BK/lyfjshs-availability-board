// js/auth.js : login helpers, the sign-up form, and shared form helpers.
import { supabase } from "./supabaseClient.js";

export const RANKS = {
  "Teacher Track": [
    "Teacher I", "Teacher II", "Teacher III", "Teacher IV",
    "Teacher V", "Teacher VI", "Teacher VII",
    "Master Teacher I", "Master Teacher II", "Master Teacher III",
    "Master Teacher IV", "Master Teacher V",
  ],
  "Special Science Track": [
    "Special Science Teacher I",
    "Special Science Teacher II",
    "Special Science Teacher III",
    "Special Science Teacher IV",
    "Special Science Teacher V",
  ],
  "Administration Track": [
    "School Principal I",
    "School Principal II",
    "School Principal III",
    "School Principal IV",
    "ADMIN",
  ],
};

const FRIENDLY = [
  ["invalid login credentials", "Wrong email or password."],
  ["email not confirmed", "Please confirm your email first. Check your inbox."],
  ["already registered", "That email already has an account. Try logging in."],
  ["rate limit", "Too many emails were sent. Please try again later."],
];

export function friendlyError(err) {
  const msg = (err?.message ?? "").toLowerCase();
  const hit = FRIENDLY.find(([key]) => msg.includes(key));
  return hit ? hit[1] : "Something went wrong. Please try again.";
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getProfile() {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from("profiles").select("id, full_name, role, approved").eq("id", session.user.id).single();
  if (error) throw error;
  return { ...data, email: session.user.email };
}

export async function requireLogin() {
  const profile = await getProfile();
  if (!profile) { location.replace("login.html"); return null; }
  return profile;
}

export async function signOut() {
  await supabase.auth.signOut();
  location.replace("login.html");
}

// ---------- shared form helpers (also used by dashboard.js) ----------
export function fillRankSelect(select, selected = "") {
  if (!select) return;
  const opt = (value, text, sel = false) =>
    Object.assign(document.createElement("option"), { value, textContent: text, selected: sel });
  select.replaceChildren(opt("", "Choose your rank / role"));
  for (const [group, list] of Object.entries(RANKS)) {
    const og = Object.assign(document.createElement("optgroup"), { label: group });
    list.forEach((r) => og.append(opt(r, r, r === selected)));
    select.append(og);
  }
}

export async function fetchDepartments() {
  const { data, error } = await supabase
    .from("departments_board")
    .select("id, name, category")
    .order("name");
  if (error) throw error;
  return data;
}

export function renderDepartmentChecks(container, depts, selected = new Set()) {
  if (!container) return;
  const grid = Object.assign(document.createElement("div"), { className: "dept-pill-grid" });

  depts.forEach((d) => {
    const lab = Object.assign(document.createElement("label"), { className: "dept-pill-option" });
    const cb = Object.assign(document.createElement("input"), {
      type: "checkbox",
      value: d.id,
      checked: selected.has(d.id),
    });
    const badge = Object.assign(document.createElement("span"), {
      className: "dept-pill-label",
      textContent: d.name,
    });
    lab.append(cb, badge);
    grid.append(lab);
  });

  container.replaceChildren(grid);
}

export const checkedIds = (container) =>
  container ? [...container.querySelectorAll("input:checked")].map((i) => i.value) : [];

// ---------- login page ----------
function initLoginPage() {
  const $ = (id) => document.getElementById(id);
  const loginForm = $("login-form"), signupForm = $("signup-form"), msg = $("auth-message");
  const say = (text, bad = false) => {
    msg.textContent = text;
    msg.dataset.state = bad ? "error" : "ok";
    msg.hidden = !text;
  };

  function showTab(which) {
    loginForm.hidden = which !== "login";
    signupForm.hidden = which !== "signup";
    $("tab-login").setAttribute("aria-selected", String(which === "login"));
    $("tab-signup").setAttribute("aria-selected", String(which === "signup"));
    say("");
  }
  $("tab-login").addEventListener("click", () => showTab("login"));
  $("tab-signup").addEventListener("click", () => showTab("signup"));
  showTab("login");

  fillRankSelect($("signup-rank"));
  fetchDepartments()
    .then((d) => renderDepartmentChecks($("signup-departments"), d))
    .catch((err) => {
      console.error(err);
      $("signup-departments").textContent = "Could not load departments. You can choose them later in your profile.";
    });

  getSession().then((s) => { if (s) location.replace("dashboard.html"); });

  async function guarded(form, work) {
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try { await work(); } catch (err) { console.error(err); say(friendlyError(err), true); }
    finally { btn.disabled = false; }
  }

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    guarded(loginForm, async () => {
      const { error } = await supabase.auth.signInWithPassword({
        email: $("login-email").value.trim(),
        password: $("login-password").value,
      });
      if (error) throw error;
      location.replace("dashboard.html");
    });
  });

  signupForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const full_name = $("signup-name").value.trim();
    const rank_level = $("signup-rank").value;
    const password = $("signup-password").value;
    if (!full_name) return say("Please enter your full name.", true);
    if (!rank_level) return say("Please choose your rank.", true);
    if (password.length < 8) return say("Use a password with at least 8 characters.", true);
    guarded(signupForm, async () => {
      const { error } = await supabase.auth.signUp({
        email: $("signup-email").value.trim(),
        password,
        options: {
          data: {
            full_name,
            rank_level,
            description: $("signup-description").value.trim(),
            departments: checkedIds($("signup-departments")),
          },
          emailRedirectTo: new URL("login.html", location.href).href,
        },
      });
      if (error) throw error;
      signupForm.reset();
      say("Account created. Check your email to confirm it, then log in. You can add your photo after you log in.");
    });
  });
}

if (document.getElementById("login-form")) initLoginPage();