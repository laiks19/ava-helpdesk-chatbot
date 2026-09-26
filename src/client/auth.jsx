import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { classifySignUpResult, getEmailRedirectTo, getSupabaseBrowserClient } from "./supabase-client.js";

const AuthContext = createContext(null);

export function AuthProvider({ api, children }) {
  const supabase = useMemo(getSupabaseBrowserClient, []);
  const [session, setSession] = useState(null);
  const [legacyToken, setLegacyToken] = useState("");
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  const token = legacyToken || session?.access_token || "";

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session || null);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!token) {
      setProfile(null);
      return;
    }
    api.me(token)
      .then((data) => setProfile(data.profile || null))
      .catch((error) => {
        if (error.status === 401) {
          setSession(null);
          setLegacyToken("");
        }
        setProfile(error.profile || null);
      });
  }, [api, token]);

  async function signIn(email, password) {
    if (supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setSession(data.session);
      const response = await api.me(data.session.access_token);
      setProfile(response.profile);
      return response.profile;
    }
    const response = await api.adminLogin(email, password);
    setLegacyToken(response.token);
    const me = await api.me(response.token);
    setProfile(me.profile);
    return me.profile;
  }

  async function register({ fullName, email, password, department }) {
    if (!supabase) {
      throw new Error("User registration becomes available after Supabase environment variables are configured.");
    }
    const emailRedirectTo = getEmailRedirectTo();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, department },
        ...(emailRedirectTo ? { emailRedirectTo } : {})
      }
    });
    if (error) throw error;
    const outcome = classifySignUpResult(data);
    if (outcome.kind === "existing-account") {
      const existingAccountError = new Error("This account already exists. Log in using your original password.");
      existingAccountError.code = "ACCOUNT_EXISTS";
      throw existingAccountError;
    }
    if (outcome.kind === "authenticated") {
      await api.registerProfile(data.session.access_token, { fullName, department });
      setSession(data.session);
      const response = await api.me(data.session.access_token);
      setProfile(response.profile);
      return response.profile;
    }
    const pendingProfile = {
      fullName,
      email,
      department,
      role: "user",
      approvalStatus: "pending",
      isActive: true
    };
    return pendingProfile;
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setLegacyToken("");
    setProfile(null);
  }

  async function changePassword(currentPassword, newPassword) {
    if (supabase) {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: profile.email,
        password: currentPassword
      });
      if (verifyError) throw new Error("Current password is incorrect.");
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
    }
    const response = await api.completePasswordChange(token, { currentPassword, newPassword });
    setProfile(response.profile);
    return response.profile;
  }

  const value = {
    supabaseConfigured: Boolean(supabase),
    loading,
    profile,
    token,
    approvalStatus: profile?.approvalStatus || "",
    signIn,
    register,
    signOut,
    changePassword
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}

export function AuthDialog({ onClose }) {
  const auth = useAuth();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ fullName: "", email: "", password: "", department: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const profile = mode === "login"
        ? await auth.signIn(form.email, form.password)
        : await auth.register(form);
      if (profile?.approvalStatus === "approved") onClose();
      else setNotice("Account created. Confirm your email, then log in.");
    } catch (error) {
      if (error.code === "ACCOUNT_EXISTS") setMode("login");
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="contact-dialog auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div className="dialog-title-row">
          <div>
            <h2 id="auth-title">{mode === "login" ? "Log in" : "Create account"}</h2>
            <p>{mode === "login" ? "Access your tickets or the admin console." : "Create an account for your helpdesk requests."}</p>
          </div>
          <button className="icon-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="auth-mode" role="tablist">
          <button className={mode === "login" ? "active" : ""} type="button" onClick={() => setMode("login")}>Log in</button>
          <button className={mode === "register" ? "active" : ""} type="button" onClick={() => setMode("register")}>Create account</button>
        </div>
        <form onSubmit={submit}>
          {mode === "register" ? (
            <>
              <label className="field"><span>Name</span><input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required /></label>
              <label className="field"><span>Department</span><input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} /></label>
            </>
          ) : null}
          <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>
          <label className="field"><span>Password</span><input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required minLength="8" /></label>
          {notice ? <p className="notice compact">{notice}</p> : null}
          <div className="dialog-actions">
            <button className="secondary-button pressable" type="button" onClick={onClose}>Cancel</button>
            <button className="primary-button pressable" type="submit" disabled={busy}>{busy ? "Please wait..." : mode === "login" ? "Log in" : "Create account"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
