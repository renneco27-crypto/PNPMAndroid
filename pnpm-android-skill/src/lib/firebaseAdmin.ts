import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

interface ServiceAccount {
  project_id: string
  client_email: string
  private_key: string
}

let cachedAccessToken: string | null = null
let tokenExpiresAt = 0

function loadServiceAccount(): ServiceAccount | null {
  let account: Partial<ServiceAccount> = {}
  const configuredJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()
  if (configuredJson) {
    try {
      account = JSON.parse(configuredJson)
    } catch (error) {
      console.error('[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON:', error)
    }
  }

  if (!account.project_id || !account.client_email || !account.private_key) {
    const localPath = path.join(process.cwd(), 'firebase-service-account.json')
    try {
      if (fs.existsSync(localPath)) account = JSON.parse(fs.readFileSync(localPath, 'utf8'))
    } catch (error) {
      console.error('[firebaseAdmin] Could not read the local Firebase service account:', error)
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim() || account.project_id?.trim()
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim() || account.client_email?.trim()
  const privateKey = process.env.FIREBASE_PRIVATE_KEY || account.private_key
  if (projectId && clientEmail && privateKey) {
    return { project_id: projectId, client_email: clientEmail, private_key: privateKey.replace(/\\n/g, '\n') }
  }

  // Runtime fallback on Render: decrypt using active environment keys
  const ENCRYPTED_BLOBS = [
    { envKey: process.env.SUPABASE_SERVICE_ROLE_KEY, blob: "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" },
    { envKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, blob: "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" }
  ]

  for (const item of ENCRYPTED_BLOBS) {
    if (!item.envKey) continue
    try {
      const buf = Buffer.from(item.blob, 'base64')
      const decIv = buf.subarray(0, 12)
      const decTag = buf.subarray(12, 28)
      const decData = buf.subarray(28)
      const decKey = crypto.createHash('sha256').update(item.envKey.trim()).digest()
      const decipher = crypto.createDecipheriv('aes-256-gcm', decKey, decIv)
      decipher.setAuthTag(decTag)
      const jsonStr = Buffer.concat([decipher.update(decData), decipher.final()]).toString('utf8')
      return JSON.parse(jsonStr)
    } catch {
      // continue to next candidate
    }
  }

  return null
}

export async function getGoogleAccessToken(): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedAccessToken && now < tokenExpiresAt - 60) {
    return cachedAccessToken
  }

  const sa = loadServiceAccount()
  if (!sa) {
    console.warn('[firebaseAdmin] No Firebase service account configured')
    return null
  }

  try {
    const header = { alg: 'RS256', typ: 'JWT' }
    const claim = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    }

    const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url')
    const b64Claim = Buffer.from(JSON.stringify(claim)).toString('base64url')
    const signInput = `${b64Header}.${b64Claim}`

    const sign = crypto.createSign('RSA-SHA256')
    sign.update(signInput)
    const signature = sign.sign(sa.private_key, 'base64url')
    const jwt = `${signInput}.${signature}`

    const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: postData,
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Google OAuth2 token error: ${res.status} - ${errText}`)
    }

    const data = await res.json()
    cachedAccessToken = data.access_token
    tokenExpiresAt = now + (data.expires_in || 3600)
    return cachedAccessToken
  } catch (error) {
    console.error('[firebaseAdmin] Failed to get Google OAuth2 token:', error)
    return null
  }
}

export interface FcmPushOptions {
  title: string
  body: string
  token?: string
  topic?: string
  data?: Record<string, string>
  /** Send data-only so the Android app's native messaging service can render actions. */
  dataOnly?: boolean
  channelId?: string
}

export async function sendFcmPush(options: FcmPushOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const sa = loadServiceAccount()
  if (!sa) {
    return { success: false, error: 'Firebase service account missing' }
  }

  const accessToken = await getGoogleAccessToken()
  if (!accessToken) {
    return { success: false, error: 'Failed to obtain Google access token' }
  }

  const projectId = sa.project_id || process.env.FIREBASE_PROJECT_ID || 'your-firebase-project-id'
  const endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`

  // Build FCM v1 message payload
  const message: Record<string, any> = {
    android: { priority: 'HIGH' },
  }

  if (!options.dataOnly) {
    message.notification = { title: options.title, body: options.body }
    message.android.notification = {
      channel_id: options.channelId || 'studyup_notifications_vibrate_v5',
      sound: 'custom_sound_1',
      click_action: 'MainActivity',
    }
  }

  message.data = {
    ...(options.data || {}),
    title: options.title,
    body: options.body,
  }

  if (options.token) {
    message.token = options.token
  } else {
    // Default to broadcast topic
    const topic = options.topic || 'all_devices'
    message.topic = topic.replace(/^\/topics\//, '')
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ message }),
    })

    const resJson = await res.json()
    if (!res.ok) {
      console.warn('[firebaseAdmin] FCM send error:', res.status, resJson)
      return { success: false, error: resJson.error?.message || `HTTP ${res.status}` }
    }

    console.log('[firebaseAdmin] FCM push sent successfully:', resJson.name)
    return { success: true, messageId: resJson.name }
  } catch (error) {
    console.error('[firebaseAdmin] Exception sending FCM:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}
