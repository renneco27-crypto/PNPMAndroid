// src/lib/rateLimiter.ts
// SQL-based rate limiting using Supabase

import { createAdminSupabase } from './supabaseServer'

interface RateLimitConfig {
  maxRequests: number
  windowHours: number
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
  error?: string
}

/**
 * Check rate limit for an IP using SQL
 * Automatically checks if IP is blocked and applies rate limiting
 */
export async function checkRateLimit(
  ip: string,
  endpoint: string,
  config: RateLimitConfig = { maxRequests: 3, windowHours: 5 }
): Promise<RateLimitResult> {
  try {
    const supabase = createAdminSupabase()
    if (!supabase) {
      console.warn('[rateLimiter] Supabase admin client not available, bypassing rate limit')
      return { allowed: true, remaining: config.maxRequests, resetAt: Date.now() + config.windowHours * 60 * 60 * 1000 }
    }

    const { data, error } = await supabase
      .rpc('check_rate_limit', {
        p_ip: ip,
        p_endpoint: endpoint,
        p_max_requests: config.maxRequests,
        p_window_hours: config.windowHours
      })

    if (error) {
      console.error('[rateLimiter] SQL rate limit check failed:', error)
      // Fail open - allow request if rate limit check fails
      return { allowed: true, remaining: config.maxRequests, resetAt: Date.now() + config.windowHours * 60 * 60 * 1000 }
    }

    if (!data || data.length === 0) {
      return { allowed: true, remaining: config.maxRequests, resetAt: Date.now() + config.windowHours * 60 * 60 * 1000 }
    }

    const result = data[0]
    const resetAt = result.reset_at ? new Date(result.reset_at).getTime() : Date.now() + config.windowHours * 60 * 60 * 1000

    if (!result.allowed) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        error: `Rate limit exceeded. Maximum ${config.maxRequests} requests per ${config.windowHours} hours.`
      }
    }

    return {
      allowed: true,
      remaining: result.remaining || 0,
      resetAt
    }
  } catch (error) {
    console.error('[rateLimiter] Rate limit check error:', error)
    // Fail open - allow request if rate limit check fails
    return { allowed: true, remaining: config.maxRequests, resetAt: Date.now() + config.windowHours * 60 * 60 * 1000 }
  }
}

/**
 * Get rate limit status without incrementing counter
 */
export async function getRateLimitStatus(
  ip: string,
  endpoint: string,
  config: RateLimitConfig = { maxRequests: 3, windowHours: 5 }
): Promise<{ remaining: number; resetAt: number }> {
  try {
    const supabase = createAdminSupabase()
    if (!supabase) {
      return { remaining: config.maxRequests, resetAt: Date.now() + config.windowHours * 60 * 60 * 1000 }
    }

    const { data, error } = await supabase
      .rpc('get_rate_limit_status', {
        p_ip: ip,
        p_endpoint: endpoint,
        p_max_requests: config.maxRequests
      })

    if (error || !data || data.length === 0) {
      return { remaining: config.maxRequests, resetAt: Date.now() + config.windowHours * 60 * 60 * 1000 }
    }

    const result = data[0]
    const resetAt = result.reset_at ? new Date(result.reset_at).getTime() : Date.now() + config.windowHours * 60 * 60 * 1000

    return {
      remaining: result.remaining || config.maxRequests,
      resetAt
    }
  } catch (error) {
    console.error('[rateLimiter] Get status error:', error)
    return { remaining: config.maxRequests, resetAt: Date.now() + config.windowHours * 60 * 60 * 1000 }
  }
}

/**
 * Reset rate limit for an IP (admin function)
 */
export async function resetRateLimit(ip: string, endpoint?: string): Promise<boolean> {
  try {
    const supabase = createAdminSupabase()
    if (!supabase) return false

    const { error } = await supabase
      .rpc('reset_rate_limit', {
        p_ip: ip,
        p_endpoint: endpoint || null
      })

    return !error
  } catch (error) {
    console.error('[rateLimiter] Reset error:', error)
    return false
  }
}

/**
 * Block an IP (uses existing Supabase function)
 */
export async function blockIp(ip: string, userAgent?: string, note?: string): Promise<boolean> {
  try {
    const supabase = createAdminSupabase()
    if (!supabase) return false

    const { error } = await supabase
      .rpc('block_ip', {
        p_ip: ip,
        p_user_agent: userAgent || null,
        p_note: note || null
      })

    return !error
  } catch (error) {
    console.error('[rateLimiter] Block IP error:', error)
    return false
  }
}

/**
 * Unblock an IP (uses existing Supabase function)
 */
export async function unblockIp(ip: string): Promise<boolean> {
  try {
    const supabase = createAdminSupabase()
    if (!supabase) return false

    const { error } = await supabase.rpc('unblock_ip', { p_ip: ip })
    return !error
  } catch (error) {
    console.error('[rateLimiter] Unblock IP error:', error)
    return false
  }
}
