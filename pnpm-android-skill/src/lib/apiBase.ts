import { Capacitor } from '@capacitor/core'

/**
 * Resolves the appropriate base URL for backend API requests.
 * In Android Capacitor (where assets are loaded from http://localhost),
 * relative API routes (/api/...) do not exist locally and must target
 * the live server (https://www.studyup.cloud-ip.cc).
 * On the web, relative paths are preserved.
 */
export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  const isNative =
    Capacitor.isNativePlatform() ||
    Boolean((window as any).Capacitor?.isNative) ||
    (window as any).Capacitor?.getPlatform?.() === 'android' ||
    window.location.hostname === 'localhost' ||
    window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'ionic:'

  if (isNative) {
    return (process.env.NEXT_PUBLIC_APP_URL || 'https://www.studyup.cloud-ip.cc').replace(/\/$/, '')
  }

  return ''
}

export function apiUrl(path: string): string {
  const base = getApiBaseUrl()
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return base ? `${base}${cleanPath}` : cleanPath
}
