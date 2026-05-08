import { getAnonClient, getNotificationConfig, getServiceClient } from "./notifications.js";

/** Resolve Supabase user id from `Authorization: Bearer <access_token>`. */
export async function getBearerUser(req) {
  const notificationConfig = getNotificationConfig();
  console.log("[auth] Supabase URL in use:", notificationConfig.supabaseUrl || "(missing)");
  const header = req.headers?.authorization || "";
  const bearerMatch = header.match(/^Bearer\s+(.+)$/i);
  const token = bearerMatch?.[1]?.trim() || "";
  console.log("[auth] Authorization header present:", Boolean(header), "token chars:", token.length);
  console.log("[auth] Full bearer token received:", token);
  if (!token) return { userId: null, email: null, error: "Missing bearer token." };

  // Verifying a user JWT should not require the service role key.
  // Prefer anon client auth verification, then fall back to service if needed.
  const authClient = getAnonClient() || getServiceClient();
  if (!authClient) return { userId: null, email: null, error: "Supabase auth client is not configured." };

  const { data, error } = await authClient.auth.getUser(token);
  console.log("[auth] Supabase getUser(token) data:", data);
  console.log("[auth] Supabase getUser(token) error:", error);
  if (error || !data?.user?.id) return { userId: null, email: null, error: error?.message || "Invalid token." };
  return { userId: data.user.id, email: data.user.email || null, error: null };
}
