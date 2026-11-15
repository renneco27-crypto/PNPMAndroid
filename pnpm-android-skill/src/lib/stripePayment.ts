import { Browser } from '@capacitor/browser'
import { useCreditsStore } from '@/store/creditsStore'
import { useToastStore } from '@/store/toastStore'
import { apiUrl } from '@/lib/apiBase'

/**
 * Stripe Payment Bridge for StudyUp Android & Webapp
 * Opens Stripe Checkout or Customer Portal securely via Capacitor Browser
 * Queries cloud Render backend without baking secrets into standalone APK
 */
export async function openStripePayment(customUrl?: string): Promise<void> {
  let userId = ''
  if (typeof window !== 'undefined') {
    try {
      userId = localStorage.getItem('studyup_user_id') || ''
    } catch {}
  }

  const defaultUrl = apiUrl(`/api/stripe/checkout${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`)
  const paymentUrl = customUrl || process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK || defaultUrl

  try {
    if (typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.()) {
      await Browser.open({ url: paymentUrl })
    } else if (typeof window !== 'undefined') {
      window.open(paymentUrl, '_blank', 'noopener,noreferrer')
    }
  } catch (err) {
    if (typeof window !== 'undefined') {
      window.open(paymentUrl, '_blank', 'noopener,noreferrer')
    }
  }
}

/**
 * Handle incoming Stripe deep links or query parameters (?payment=success)
 */
export function handleStripeDeepLink(urlOrPath: string): boolean {
  if (!urlOrPath) return false

  if (
    urlOrPath.includes('payment=success') ||
    urlOrPath.includes('stripe=success') ||
    urlOrPath.includes('session_id=')
  ) {
    useCreditsStore.getState().setPaidAccount(true)
    useToastStore.getState().addToast('Payment successful! Pro unlocked.', 'success')
    return true
  }

  return false
}
