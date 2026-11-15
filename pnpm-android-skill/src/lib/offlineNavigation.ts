'use client'

/**
 * Safe navigation that works seamlessly both online and offline.
 * Always prefers Next.js client-side router transition so React maintains state,
 * active CSS bundles, and memory cache without triggering a destructive hard browser reload.
 */
export function safeNavigate(
  router: { push: (url: string) => void } | null | undefined,
  href: string
) {
  if (typeof window === 'undefined') return
  try {
    if (router?.push) {
      router.push(href)
    } else {
      window.location.href = href
    }
  } catch (err) {
    console.warn('router.push navigation failed, falling back to window.location:', err)
    window.location.href = href
  }
}
