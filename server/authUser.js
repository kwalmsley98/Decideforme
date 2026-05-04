import { getServiceClient } from "./notifications.js";

/** Resolve Supabase user id from `Authorization: Bearer <access_token>`. */
export async function getBearerUser(req) {
  const header = req.headers?.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  console.log("[auth] Authorization header present:", Boolean(header), "token chars:", token.length);
  if (!token) return { userId: null, email: null, error: "Missing bearer token." };
  const service = getServiceClient();
  if (!service) return { userId: null, email: null, error: "SUPABASE_SERVICE_ROLE_KEY is not configured." };
  const { data, error } = await service.auth.getUser(token);
  if (error || !data?.user?.id) return { userId: null, email: null, error: error?.message || "Invalid token." };
  return { userId: data.user.id, email: data.user.email || null, error: null };
}
