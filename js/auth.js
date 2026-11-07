// js/auth.js : shared login helpers + the login / teacher sign-up page.
//
// login.html needs these ids:
//   #login-form  (#login-email, #login-password, submit button)
//   #signup-form (#signup-name, #signup-email, #signup-password, submit button)
//   #tab-login, #tab-signup (buttons)    #auth-message (p)
// Load with: <script type="module" src="js/auth.js"></script>
import { supabase } from "./supabaseClient.js";

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

// Returns { id, full_name, role, approved, email } or null when logged out.
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

// ---------- login page ----------
function initLoginPage() {
  const $ = (id) => document.getElementById(id);
  const loginForm = $("login-form"), signupForm = $("signup-form"), msg = $("auth-message");
  const say = (text, bad = false) => { msg.textContent = text; msg.dataset.state = bad ? "error" : "ok"; msg.hidden = !text; };

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
        email: $("login-email").value.trim(), password: $("login-password").value,
      });
      if (error) throw error;
      location.replace("dashboard.html");
    });
  });

  signupForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const full_name = $("signup-name").value.trim();
    const password = $("signup-password").value;
    if (!full_name) return say("Please enter your full name.", true);
    if (password.length < 8) return say("Use a password with at least 8 characters.", true);
    guarded(signupForm, async () => {
      const { error } = await supabase.auth.signUp({
        email: $("signup-email").value.trim(), password,
        options: { data: { full_name }, emailRedirectTo: new URL("login.html", location.href).href },
      });
      if (error) throw error;
      signupForm.reset();
      say("Check your email to confirm your account. An administrator must approve it before you can update statuses.");
    });
  });
}

if (document.getElementById("login-form")) initLoginPage();