export const API_KEY_ADMIN_SCOPE = "admin"

export function isAdminScopeSet(scopes: string[]): boolean {
  return scopes.includes(API_KEY_ADMIN_SCOPE)
}

/** Scopes to persist — admin alone grants full access. */
export function scopesForApiKeySubmit(scopes: string[]): string[] {
  if (isAdminScopeSet(scopes)) return [API_KEY_ADMIN_SCOPE]
  return scopes
}

export function summarizeApiKeyScopes(scopes: string[], maxVisible = 3) {
  if (isAdminScopeSet(scopes)) {
    return {
      visible: [API_KEY_ADMIN_SCOPE],
      overflow: 0,
      isAdmin: true as const,
    }
  }

  const unique = [...new Set(scopes.filter(Boolean))]
  const visible = unique.slice(0, maxVisible)
  const overflow = Math.max(0, unique.length - visible.length)

  return {
    visible,
    overflow,
    isAdmin: false as const,
  }
}
