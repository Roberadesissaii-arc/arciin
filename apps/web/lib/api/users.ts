import { fetchApi } from "@/lib/api/client"

export type AdminUser = {
  id: string
  name: string
  email: string
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER"
  status: "ACTIVE" | "DISABLED"
  createdAt: string
  updatedAt: string
}

export function listAdminUsers(signal?: AbortSignal) {
  return fetchApi<AdminUser[]>("/settings/users", { method: "GET", signal })
}

export function createAdminUser(body: {
  name: string
  email: string
  password: string
  role: "ADMIN" | "MEMBER" | "VIEWER"
}) {
  return fetchApi<AdminUser>("/settings/users", { method: "POST", body })
}

export function updateAdminUser(
  userId: string,
  body: { role?: "ADMIN" | "MEMBER" | "VIEWER"; status?: "ACTIVE" | "DISABLED" },
) {
  return fetchApi<AdminUser>(`/settings/users/${userId}`, {
    method: "PATCH",
    body,
  })
}

export function deleteAdminUser(userId: string) {
  return fetchApi<void>(`/settings/users/${userId}`, { method: "DELETE" })
}
