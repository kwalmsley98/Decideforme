import { getAnonClient } from "./notifications.js";

/** Resolve Supabase user id from `Authorization: Bearer <access_token>`. */
export async function getBearerUser(req) {
  const header = req.headers?.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { userId: null, email: null, error: "Missing bearer token." };
  const anon = getAnonClient();
  if (!anon) return { userId: null, email: null, error: "Auth not configured." };
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data?.user?.id) return { userId: null, email: null, error: error?.message || "Invalid token." };
  return { userId: data.user.id, email: data.user.email || null, error: null };
}
