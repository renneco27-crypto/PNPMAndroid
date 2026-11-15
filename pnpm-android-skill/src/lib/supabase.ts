import { createBrowserClient } from '@supabase/ssr'

export function isSupabaseConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')
  )
}

export function createBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL_A || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_A || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'
  return createBrowserClient(url, anonKey)
}

export function isSupabaseBConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL_B &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_B &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL_B.includes('placeholder')
  )
}

export function createBrowserSupabaseB() {
  const urlB = process.env.NEXT_PUBLIC_SUPABASE_URL_B
  const anonKeyB = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_B
  if (!urlB || !anonKeyB) return null
  return createBrowserClient(urlB, anonKeyB)
}

/**
 * Synchronizes the verified user ID from Supabase to localStorage.
 */
export function syncUserToLocalStorage(userId: string, email?: string): void {
  if (typeof window === 'undefined' || !userId) return
  try {
    localStorage.setItem('studyup_user_id', userId)
    localStorage.setItem(
      'studyup_cached_session',
      JSON.stringify({
        userId,
        email: email || '',
        savedAt: Date.now(),
      })
    )
  } catch {}
}

/**
 * Queries Supabase database for the active user session and triggers auto-saving the ID into localStorage.
 */
export async function syncUserSessionToLocalStorage(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  for (const factory of [createBrowserSupabase, createBrowserSupabaseB]) {
    try {
      const client = factory()
      if (!client) continue
      const { data } = await client.auth.getSession()
      const user = data?.session?.user
      if (user?.id) {
        syncUserToLocalStorage(user.id, user.email)
        return user.id
      }
    } catch {}
  }
  return null
}

/**
 * Returns the account ID from localStorage saved upon device ID sign-in.
 */
export function getStoredAccountId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const directUserId = localStorage.getItem('studyup_user_id')
    if (directUserId) return directUserId
    const cached = localStorage.getItem('studyup_cached_session')
    if (cached) {
      const parsed = JSON.parse(cached)
      if (parsed.userId) return String(parsed.userId)
    }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const val = localStorage.getItem(k)
        if (val) {
          const parsed = JSON.parse(val)
          if (parsed?.user?.id) return String(parsed.user.id)
        }
      }
    }
  } catch {}
  return null
}

/**
 * Builds request headers carrying the current session's access token and the account ID
 * from device sign-in, allowing backend API routes to verify callers and drop spam attacks.
 */
export async function getAuthHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...extra }
  let accountId: string | undefined

  for (const factory of [createBrowserSupabase, createBrowserSupabaseB]) {
    try {
      const client = factory()
      if (!client) continue
      const { data } = await client.auth.getSession()
      const token = data?.session?.access_token
      if (token) {
        headers.Authorization = `Bearer ${token}`
      }
      if (data?.session?.user?.id) {
        accountId = data.session.user.id
        syncUserToLocalStorage(accountId, data.session.user.email)
      }
      if (token && accountId) break
    } catch {}
  }

  if (!accountId) {
    accountId = getStoredAccountId() || undefined
  }

  if (accountId) {
    headers['x-account-id'] = accountId
    headers['x-user-id'] = accountId
  }

  return headers
}
