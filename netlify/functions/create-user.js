import { createClient } from "@supabase/supabase-js";

const json = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(body)
});

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    return json(500, { error: "Missing Supabase environment variables" });
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Missing login token" });

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const adminClient = createClient(url, serviceKey);

  const { data: requester, error: requesterError } = await userClient.auth.getUser(token);
  if (requesterError || !requester.user) return json(401, { error: "Invalid login token" });

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", requester.user.id)
    .maybeSingle();
  if (profileError) return json(500, { error: profileError.message });
  if (profile?.role !== "admin") return json(403, { error: "Admin only" });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const email = String(payload.email || "").trim();
  const password = String(payload.password || "");
  const name = String(payload.name || "").trim();
  const role = payload.role === "admin" ? "admin" : "t1";
  if (!email || !password || !name) {
    return json(400, { error: "Email, password and name are required" });
  }
  if (password.length < 6) {
    return json(400, { error: "Password must be at least 6 characters" });
  }

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role }
  });
  if (createError) return json(400, { error: createError.message });

  const { error: profileUpsertError } = await adminClient
    .from("profiles")
    .upsert({ id: created.user.id, name, role });
  if (profileUpsertError) return json(500, { error: profileUpsertError.message });

  return json(200, { userId: created.user.id, name, role });
};
