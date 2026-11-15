import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'

export class AIError extends Error {
  provider: string
  constructor(provider: string, message: string) {
    super(message)
    this.name = 'AIError'
    this.provider = provider
  }
}

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>
  try {
    const envPath = path.resolve(process.cwd(), '.env.local')
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const [k, ...v] = trimmed.split('=')
        if (k && v.length) env[k.trim()] = v.join('=').trim()
      }
    }
  } catch {}
  return env
}

function getProviderConfig(): { provider: string; apiKey: string; model: string; baseURL?: string } {
  const env = loadEnv()
  const provider = env.AI_PROVIDER || (env.NVIDIA_API_KEY ? 'nvidia' : 'gemini')

  switch (provider) {
    case 'gemini':
      return {
        provider: 'gemini',
        apiKey: env.GEMINI_API_KEY || '',
        model: env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
      }
    case 'openrouter':
      return {
        provider: 'openrouter',
        apiKey: env.OPENROUTER_API_KEY || '',
        model: env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
        baseURL: 'https://openrouter.ai/api/v1',
      }
    case 'groq':
      return {
        provider: 'groq',
        apiKey: env.GROQ_API_KEY || '',
        model: env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        baseURL: 'https://api.groq.com/openai/v1',
      }
    case 'nvidia':
      return {
        provider: 'nvidia',
        apiKey: env.NVIDIA_API_KEY || '',
        model: env.NVIDIA_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b',
        baseURL: env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      }
    case 'opencode':
    case 'zen':
    case 'opencode-zen':
      const zenKey = env.OPENCODE_API_KEY || env.OPENCODE_ZEN_API_KEY
      if (!zenKey && env.NVIDIA_API_KEY) {
        return {
          provider: 'nvidia',
          apiKey: env.NVIDIA_API_KEY,
          model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
          baseURL: env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
        }
      }
      return {
        provider: 'zen',
        apiKey: zenKey || '',
        model: env.OPENCODE_MODEL || 'opencode/nemotron-3.5-lightning-free',
        baseURL: env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/v1',
      }
    default:
      throw new AIError(provider, `Unknown AI provider: "${provider}". Use gemini, openrouter, groq, nvidia, or zen/opencode.`)
  }
}

export async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const config = getProviderConfig()
  console.log(`[callAI] Requesting provider: ${config.provider} | model: ${config.model}`)
  const startTime = Date.now()

  if (!config.apiKey) {
    throw new AIError(config.provider, `Missing API key for provider "${config.provider}". Set ${config.provider.toUpperCase()}_API_KEY in .env.local`)
  }

  if (config.provider === 'gemini') {
    const genAI = new GoogleGenerativeAI(config.apiKey)
    const model = genAI.getGenerativeModel({ model: config.model })
    const result = await model.generateContent([{ text: systemPrompt }, { text: userPrompt }])
    const text = result.response.text()
    if (!text) {
      throw new AIError(config.provider, 'Gemini returned an empty response')
    }
    console.log(`[callAI] Gemini response received in ${Date.now() - startTime}ms`)
    return text
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: 30000,
  })

  try {
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 4000,
      temperature: 0.2,
    })

    const text = response.choices?.[0]?.message?.content
    if (!text) {
      throw new AIError(config.provider, `OpenAI-compatible provider "${config.provider}" returned an empty response`)
    }
    console.log(`[callAI] ${config.provider} response received in ${Date.now() - startTime}ms`)
    return text
  } catch (err: any) {
    console.warn(`[callAI] Primary provider "${config.provider}" failed (${err.message}). Attempting fast fallback...`)
    const env = loadEnv()
    if (env.GROQ_API_KEY && config.provider !== 'groq') {
      try {
        console.log('[callAI] Auto-recovering via Groq ultra-fast engine...')
        const groqClient = new OpenAI({
          apiKey: env.GROQ_API_KEY,
          baseURL: 'https://api.groq.com/openai/v1',
          timeout: 15000,
        })
        const groqModel = env.GROQ_MODEL || 'llama-3.3-70b-versatile'
        const groqRes = await groqClient.chat.completions.create({
          model: groqModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 4000,
          temperature: 0.2,
        })
        const groqText = groqRes.choices?.[0]?.message?.content
        if (groqText) {
          console.log(`[callAI] Groq fallback completed in ${Date.now() - startTime}ms`)
          return groqText
        }
      } catch (fallbackErr: any) {
        console.warn('[callAI] Groq fallback failed:', fallbackErr.message)
      }
    }
    throw err
  }
}
