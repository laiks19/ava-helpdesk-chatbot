function authError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name ?? row.fullName ?? "",
    department: row.department || "",
    role: row.role || "user",
    approvalStatus: row.approval_status ?? row.approvalStatus ?? "pending",
    isActive: row.is_active ?? row.isActive ?? true,
    mustChangePassword: row.must_change_password ?? row.mustChangePassword ?? false
  };
}

export function createAuthService({ supabase = null, localAdminToken = "" } = {}) {
  async function authenticate(token) {
    const cleanToken = String(token || "").replace(/^Bearer\s+/i, "").trim();
    if (!cleanToken) throw authError("Sign in is required.", 401);
    if (localAdminToken && cleanToken === localAdminToken) {
      return {
        id: "admin-local",
        email: "kokseng.lai@ecoworld.my",
        fullName: "Kok Seng Lai",
        department: "MIS",
        role: "admin",
        approvalStatus: "approved",
        isActive: true,
        mustChangePassword: false
      };
    }
    if (!supabase) throw authError("This login session is not valid.", 401);

    const { data: userData, error: userError } = await supabase.auth.getUser(cleanToken);
    if (userError || !userData?.user) throw authError("This login session has expired.", 401);
    const { data: row, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userData.user.id)
      .single();
    if (profileError || !row) throw authError("Your helpdesk profile is not available.", 403);
    return normalizeProfile(row);
  }

  async function requireRole(token, role = "user") {
    const profile = await authenticate(token);
    if (!profile.isActive) throw authError("This account is inactive.", 403);
    if (profile.approvalStatus !== "approved") {
      throw authError(
        profile.approvalStatus === "rejected"
          ? "This account registration was not approved."
          : "This account is waiting for administrator approval.",
        403
      );
    }
    if (role === "admin" && profile.role !== "admin") {
      throw authError("Administrator access is required.", 403);
    }
    return profile;
  }

  return { authenticate, requireRole };
}

export function bearerToken(req) {
  return String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
}
