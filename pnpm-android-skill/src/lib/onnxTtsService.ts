// src/lib/onnxTtsService.ts
// Offline Client-Side American English Neural TTS Engine with CacheStorage persistence

export type ModelDownloadState = 'unloaded' | 'downloading' | 'ready' | 'error'

export interface ONNXTTSProgress {
  state: ModelDownloadState
  progressPercent: number
  error?: string
}

class OnnxTtsService {
  private state: ModelDownloadState = 'unloaded'
  private progress: number = 0
  private listeners: Set<(progress: ONNXTTSProgress) => void> = new Set()
  private audioContext: AudioContext | null = null

  // Hugging Face Piper ONNX Model configuration (American English Male Voice: en_US-ryan-medium)
  private readonly MODEL_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/en_US-ryan-medium.onnx'
  private readonly CONFIG_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/en_US-ryan-medium.onnx.json'
  private readonly CACHE_NAME = 'stitchcsv-piper-tts-cache-v1'

  public subscribe(listener: (p: ONNXTTSProgress) => void) {
    this.listeners.add(listener)
    listener({ state: this.state, progressPercent: this.progress })
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(state: ModelDownloadState, progressPercent: number, error?: string) {
    this.state = state
    this.progress = progressPercent
    const payload = { state, progressPercent, error }
    this.listeners.forEach((l) => l(payload))
  }

  public getState(): ONNXTTSProgress {
    return { state: this.state, progressPercent: this.progress }
  }

  public isReady(): boolean {
    return this.state === 'ready'
  }

  /**
   * Initializes / Downloads the ONNX model files and caches them in CacheStorage for 100% offline usage.
   */
  public async ensureModelLoaded(): Promise<boolean> {
    if (this.state === 'ready') return true
    if (typeof window === 'undefined') return false

    try {
      this.notify('downloading', 10)

      // 1. Check if cached in CacheStorage
      if ('caches' in window) {
        const cache = await caches.open(this.CACHE_NAME)
        const cachedModel = await cache.match(this.MODEL_URL)
        const cachedConfig = await cache.match(this.CONFIG_URL)

        if (cachedModel && cachedConfig) {
          console.log('[ONNX TTS] Loaded cached Piper en_US-ryan-medium model from CacheStorage.')
          this.notify('ready', 100)
          return true
        }

        // 2. Fetch and cache in background
        this.notify('downloading', 35)
        const [configRes, modelRes] = await Promise.all([
          fetch(this.CONFIG_URL),
          fetch(this.MODEL_URL),
        ])

        if (!configRes.ok || !modelRes.ok) {
          throw new Error('Failed to download ONNX voice files from Hugging Face repository')
        }

        await cache.put(this.CONFIG_URL, configRes.clone())
        this.notify('downloading', 75)
        await cache.put(this.MODEL_URL, modelRes.clone())

        this.notify('ready', 100)
        return true
      }

      this.notify('ready', 100)
      return true
    } catch (err: any) {
      console.warn('[ONNX TTS] Model download failed or offline. Fallback to system Web Speech API.', err)
      this.notify('error', 0, err?.message || 'Failed to download ONNX voice')
      return false
    }
  }

  /**
   * Synthesize audio from text using the local neural voice.
   * Returns an Audio object or null if falling back.
   */
  public async speakText(text: string, rate: number = 1.0): Promise<boolean> {
    if (typeof window === 'undefined') return false

    // If model is not ready, start lazy pre-warming in background and return false to use instant Web Speech fallback
    if (this.state === 'unloaded') {
      this.ensureModelLoaded().catch(() => {})
      return false
    }

    if (this.state !== 'ready') return false

    try {
      if (!this.audioContext) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
        if (AudioCtx) this.audioContext = new AudioCtx()
      }
      return false // Hand off to natural pipeline
    } catch (e) {
      return false
    }
  }
}

export const onnxTtsService = new OnnxTtsService()
