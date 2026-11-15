import { sendFcmPush } from '@/lib/firebaseAdmin'

export async function notifyDeckPublished(opts: {
  title: string
  authorName?: string
  deckId?: string
}): Promise<{ success: boolean; deduped?: boolean; error?: string }> {
  const title = String(opts.title || '').trim()
  if (!title) return { success: false, error: 'Missing deck title' }

  const authorName = String(opts.authorName || 'Someone').trim() || 'Someone'
  const deckId = String(opts.deckId || '').trim()
  const deckPath = deckId ? `/feed?deckId=${encodeURIComponent(deckId)}` : '/feed'
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.studyup.cloud-ip.cc'
  const feedUrl = `${appBaseUrl}${deckPath}`
  const message = `"${title}" — Created by ${authorName}`
  const data: Record<string, string> = {
    type: 'deck_published_broadcast',
    route: deckPath,
    url: feedUrl,
    title: 'New Deck Published!',
    body: message,
    timestamp: new Date().toISOString(),
  }
  if (deckId) data.deck_id = deckId

  const fcm = await sendFcmPush({
    title: 'New Deck Published!',
    body: message,
    topic: 'all_devices',
    data,
    channelId: 'studyup_deck_notifications_sound_v6',
  })

  return {
    success: fcm.success,
    ...(!fcm.success ? { error: fcm.error || 'Firebase Cloud Messaging failed' } : {}),
  }
}
