// src/lib/aiCharRateLimiter.ts
// Character-based rate limiter: 20,000 AI characters generated every 5 hours

import { NextRequest } from 'next/server'

interface UserCharQuota {
  usedChars: number
  windowStart: number
}

// 5 hours in milliseconds
const WINDOW_MS = 5 * 60 * 60 * 1000
export const MAX_CHARS_PER_5_HOURS = 20_000

// In-memory sliding window store keyed by client identifier
const quotaStore = new Map<string, UserCharQuota>()

/**
 * Extracts a robust client IP/identifier from the incoming request.
 */
export function getClientIdentifier(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const firstIp = forwarded.split(',')[0].trim()
    if (firstIp) return firstIp
  }

  const realIp = req.headers.get('x-real-ip')
  if (realIp && realIp.trim()) return realIp.trim()

  const cfConnectingIp = req.headers.get('cf-connecting-ip')
  if (cfConnectingIp && cfConnectingIp.trim()) return cfConnectingIp.trim()

  return 'client-default-ip'
}

/**
 * Checks if the user is within the 20k characters / 5-hour limit.
 */
export function checkCharLimit(identifier: string): {
  allowed: boolean
  remainingChars: number
  usedChars: number
  resetAt: number
  resetInSeconds: number
} {
  const now = Date.now()
  let record = quotaStore.get(identifier)

  // Initialize or reset if 5 hours have passed
  if (!record || (now - record.windowStart >= WINDOW_MS)) {
    record = { usedChars: 0, windowStart: now }
    quotaStore.set(identifier, record)
  }

  const resetAt = record.windowStart + WINDOW_MS
  const resetInSeconds = Math.max(0, Math.ceil((resetAt - now) / 1000))
  const remainingChars = Math.max(0, MAX_CHARS_PER_5_HOURS - record.usedChars)
  const allowed = remainingChars > 0

  return {
    allowed,
    remainingChars,
    usedChars: record.usedChars,
    resetAt,
    resetInSeconds,
  }
}

/**
 * Consumes generated characters after successful AI completion.
 */
export function consumeChars(identifier: string, count: number): {
  remainingChars: number
  usedChars: number
  resetAt: number
} {
  const now = Date.now()
  let record = quotaStore.get(identifier)

  if (!record || (now - record.windowStart >= WINDOW_MS)) {
    record = { usedChars: 0, windowStart: now }
    quotaStore.set(identifier, record)
  }

  record.usedChars += Math.max(0, count)
  quotaStore.set(identifier, record)

  const resetAt = record.windowStart + WINDOW_MS
  const remainingChars = Math.max(0, MAX_CHARS_PER_5_HOURS - record.usedChars)

  return {
    remainingChars,
    usedChars: record.usedChars,
    resetAt,
  }
}
