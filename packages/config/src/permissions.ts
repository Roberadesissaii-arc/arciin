export type PermissionRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER"

export function canManageSystem(role: PermissionRole) {
  return role === "OWNER" || role === "ADMIN"
}

export function canManageFiles(role: PermissionRole) {
  return role === "OWNER" || role === "ADMIN" || role === "MEMBER"
}

export function canViewFiles(role: PermissionRole) {
  return role === "OWNER" || role === "ADMIN" || role === "MEMBER" || role === "VIEWER"
}
