import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSupabaseAdminClient } from "../src/server/supabase-admin.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(projectRoot, ".env") });
dotenv.config({ path: path.join(projectRoot, ".env.local"), override: true });

const email = "kokseng.lai@ecoworld.my";
const password = "admin123";
const supabase = createSupabaseAdminClient();

if (!supabase) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before bootstrapping the administrator.");
}

const { data: listed, error: listError } = await supabase.auth.admin.listUsers({
  page: 1,
  perPage: 1000
});
if (listError) throw listError;

let user = listed.users.find((item) => item.email?.toLowerCase() === email);
if (!user) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Kok Seng Lai" }
  });
  if (error) throw error;
  user = data.user;
}

const { error: profileError } = await supabase
  .from("profiles")
  .upsert({
    id: user.id,
    email,
    full_name: "Kok Seng Lai",
    role: "admin",
    approval_status: "approved",
    is_active: true,
    must_change_password: true,
    approved_at: new Date().toISOString()
  });
if (profileError) throw profileError;

console.log(`Administrator account is ready for ${email}. Change the bootstrap password at first login.`);
