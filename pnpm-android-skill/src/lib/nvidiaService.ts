// src/lib/nvidiaService.ts
// Fast AI dispatcher for Lab Chat & Audit:
// Prioritizes Gemini 2.5 Flash (sub-2s response) with cached provider state and fast NVIDIA NIM fallback.

import fs from 'fs'
import path from 'path'
import { callAI } from './callAI'

interface LiveModelCache {
  provider: 'gemini' | 'nvidia'
  modelId: string
  verifiedAt: number
}

// Cache the verified working provider/model for 30 minutes
let verifiedModelCache: LiveModelCache | null = null
let nvidiaDeadUntil = 0
const CACHE_TTL_MS = 30 * 60 * 1000
const NVIDIA_COOLDOWN_MS = 15 * 60 * 1000

// Fast NVIDIA NIM candidates
export const CANDIDATE_MODELS: string[] = [
  'meta/llama-3.1-70b-instruct',
  'mistralai/mistral-large-2-instruct',
  'nvidia/llama-3.1-nemotron-70b-instruct',
]

/**
 * Loads environment variables from process.env and all .env files
 */
export function getEnvVar(key: string): string {
  if (process.env[key]) return process.env[key]!
  for (const envFile of ['.env', '.env.production', '.env.local']) {
    try {
      const envPath = path.resolve(process.cwd(), envFile)
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8')
        for (const line of content.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          const [k, ...v] = trimmed.split('=')
          if (k?.trim() === key && v.length) {
            return v.join('=').trim()
          }
        }
      }
    } catch {}
  }
  return ''
}

/**
 * Calls Gemini Cloud Console API (Google AI Studio / Cloud Console)
 */
async function callGeminiCloudConsole(
  systemPrompt: string,
  userPrompt: string
): Promise<{ text: string; model: string }> {
  const geminiKey =
    getEnvVar('GEMINI_API_KEY') ||
    getEnvVar('GOOGLE_API_KEY') ||
    getEnvVar('GOOGLE_GENAI_API_KEY')

  if (!geminiKey) {
    throw new Error('GEMINI_API_KEY is not set in environment or .env.local')
  }

  const preferredModel = getEnvVar('GEMINI_MODEL')
  // Use fast, verified production Gemini models (avoid non-existent gemini-3.8-flash which hangs/404s)
  const baseModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash']
  const candidateModels =
    preferredModel && !preferredModel.includes('3.8')
      ? [preferredModel, ...baseModels.filter((m) => m !== preferredModel)]
      : baseModels

  let lastErr: any = null

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 14000)

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: userPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1200,
            responseMimeType: 'application/json',
          },
        }),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        console.warn(`[Gemini Cloud Console] ${model} returned HTTP ${res.status}:`, errJson)
        throw new Error(errJson?.error?.message || `HTTP ${res.status} ${res.statusText}`)
      }

      const data = await res.json()
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
      if (text && typeof text === 'string') {
        verifiedModelCache = {
          provider: 'gemini',
          modelId: model,
          verifiedAt: Date.now(),
        }
        return { text, model }
      }
      throw new Error(`Gemini ${model} returned an empty response`)
    } catch (err: any) {
      console.warn(`[Gemini Cloud Console] ${model} failed:`, err?.message || err)
      lastErr = err
    }
  }

  throw lastErr || new Error('All Gemini Cloud Console models failed')
}

/**
 * Fast NVIDIA NIM fallback with short timeout and negative caching so it never blocks requests
 */
async function tryNvidiaFast(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  baseURL: string
): Promise<{ text: string; provider: 'nvidia'; model: string } | null> {
  if (!apiKey || Date.now() < nvidiaDeadUntil) return null

  const envModel = getEnvVar('NVIDIA_MODEL')
  const candidates =
    verifiedModelCache?.provider === 'nvidia'
      ? [verifiedModelCache.modelId]
      : envModel && !envModel.includes('deepseek-v4')
      ? [envModel, ...CANDIDATE_MODELS.filter((m) => m !== envModel)]
      : CANDIDATE_MODELS

  for (const modelId of candidates.slice(0, 2)) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const res = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 1200,
        }),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (res.ok) {
        const data = await res.json()
        const text = data?.choices?.[0]?.message?.content
        if (text && typeof text === 'string') {
          verifiedModelCache = {
            provider: 'nvidia',
            modelId,
            verifiedAt: Date.now(),
          }
          return { text, provider: 'nvidia', model: modelId }
        }
      }
    } catch {
      clearTimeout(timeout)
    }
  }

  // Mark NVIDIA on cooldown so subsequent requests don't waste time waiting on dead models
  nvidiaDeadUntil = Date.now() + NVIDIA_COOLDOWN_MS
  return null
}

/**
 * Main AI dispatcher for Lab Chat & Audit:
 * 1. Primary: Gemini 2.5 Flash (fast ~1.5s JSON response) when GEMINI_API_KEY is available.
 * 2. Secondary: NVIDIA NIM API with fast timeout and cooldown.
 * 3. Final Fallback: general callAI pipeline.
 */
export async function callLabAI(
  systemPrompt: string,
  userPrompt: string
): Promise<{ text: string; provider: 'nvidia' | 'gemini' | 'callAI'; model: string }> {
  const nvidiaKey = getEnvVar('NVIDIA_API_KEY')
  const nvidiaBaseURL = getEnvVar('NVIDIA_BASE_URL') || 'https://integrate.api.nvidia.com/v1'
  const hasGeminiKey = Boolean(
    getEnvVar('GEMINI_API_KEY') ||
    getEnvVar('GOOGLE_API_KEY') ||
    getEnvVar('GOOGLE_GENAI_API_KEY')
  )

  // 1. Try Gemini first (fastest and supports native JSON output)
  if (hasGeminiKey) {
    try {
      const geminiResult = await callGeminiCloudConsole(systemPrompt, userPrompt)
      return { text: geminiResult.text, provider: 'gemini', model: geminiResult.model }
    } catch (err: any) {
      console.warn('[Lab AI] Gemini primary error, trying fallback:', err?.message || err)
    }
  }

  // 2. Try NVIDIA fast fallback
  if (nvidiaKey) {
    const nRes = await tryNvidiaFast(systemPrompt, userPrompt, nvidiaKey, nvidiaBaseURL)
    if (nRes) return nRes
  }

  // 3. Final fallback to callAI
  const text = await callAI(systemPrompt, userPrompt)
  return { text, provider: 'callAI', model: 'standard-fallback' }
}
