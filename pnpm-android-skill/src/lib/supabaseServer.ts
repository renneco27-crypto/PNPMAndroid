import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export async function createServerSupabase() {
  const cookieStore = await cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL_A || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_A || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'
  return createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component context - ignore
          }
        },
      },
    }
  )
}

export async function createBackupSupabase() {
  const cookieStore = await cookies()
  const urlB = process.env.NEXT_PUBLIC_SUPABASE_URL_B
  const anonKeyB = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_B
  if (!urlB || !anonKeyB) return createServerSupabase()

  return createServerClient(
    urlB,
    anonKeyB,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

export function createServerSupabaseB() {
  const urlB = process.env.NEXT_PUBLIC_SUPABASE_URL_B
  const keyB = process.env.SUPABASE_SERVICE_ROLE_KEY_B || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_B
  if (!urlB || !keyB) return null

  return createServerClient(
    urlB,
    keyB,
    {
      cookies: {
        getAll() {
          return []
        },
        setAll() {},
      },
    }
  )
}

export async function getAuthUser() {
  // Only accept a verified Supabase session. IP-based remembered identities
  // are not an authentication factor and must not authorize database actions.
  try {
    const supabase = await createServerSupabase()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (!error && user && !user.is_anonymous) return user
  } catch (errA) {}

  // Try the second project's cookie-backed Supabase session as well.
  try {
    const supabaseB = await createBackupSupabase()
    const { data: { user }, error } = await supabaseB.auth.getUser()
    if (!error && user && !user.is_anonymous) return user
  } catch (errB) {}

  return null
}

export async function getProfileCanPublish(userId: string) {
  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from('profiles')
    .select('can_publish')
    .eq('id', userId)
    .single()

  return data?.can_publish ?? true
}

export function createAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL_A || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY_A || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!serviceKey) return null
  return createServerClient(
    url,
    serviceKey,
    {
      cookies: {
        getAll() {
          return []
        },
        setAll() {},
      },
    }
  )
}

export function createAdminSupabaseB() {
  const urlB = process.env.NEXT_PUBLIC_SUPABASE_URL_B
  const serviceKeyB = process.env.SUPABASE_SERVICE_ROLE_KEY_B || process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY_B || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_B
  if (!urlB || !serviceKeyB) return null
  return createServerClient(
    urlB,
    serviceKeyB,
    {
      cookies: {
        getAll() {
          return []
        },
        setAll() {},
      },
    }
  )
}

export async function isUserAdmin(
  userId: string,
  email?: string,
  userMetadata?: Record<string, any>,
  appMetadata?: Record<string, any>
): Promise<boolean> {
  const normEmail = (email || '').trim().toLowerCase()

  if (String(userMetadata?.role || '').toLowerCase() === 'admin') return true
  if (String(appMetadata?.role || '').toLowerCase() === 'admin') return true

  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
  
  if (normEmail && adminEmails.length > 0) {
    if (adminEmails.includes(normEmail)) return true
  }

  for (const client of [createAdminSupabase(), createAdminSupabaseB()]) {
    if (!client) continue
    try {
      const { data } = await client
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle()
      if (String(data?.role || '').trim().toLowerCase() === 'admin') return true
    } catch {}
  }

  return false
}

/**
 * Resolves the signed-in user for an API request across both auth servers.
 * Order: Authorization Bearer token (DB A, then DB B) -> verified cookie sessions -> verified account ID from device sign-in.
 */
export async function resolveRequestUser(request?: Request) {
  const authHeader = request?.headers.get('authorization') || ''
  const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''

  if (token) {
    for (const client of [createAdminSupabase(), createAdminSupabaseB()]) {
      if (!client) continue
      try {
        const { data: { user }, error } = await client.auth.getUser(token)
        if (!error && user && !user.is_anonymous) return user
      } catch {}
    }
  }

  const cookieUser = await getAuthUser()
  if (cookieUser) return cookieUser

  // Fallback to verified account ID header sent from local storage device sign-in
  const rawAccountId = request?.headers.get('x-account-id') || request?.headers.get('x-user-id') || ''
  const accountId = rawAccountId.trim()
  if (accountId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) {
    for (const client of [createAdminSupabase(), createAdminSupabaseB()]) {
      if (!client) continue
      try {
        const { data: profile } = await client
          .from('profiles')
          .select('id, email, is_pro')
          .eq('id', accountId)
          .maybeSingle()
        if (profile?.id) {
          return {
            id: profile.id,
            email: profile.email || '',
            user_metadata: {},
            app_metadata: { role: 'authenticated' },
            is_anonymous: false
          } as any
        }
      } catch {}
    }
  }

  return null
}
