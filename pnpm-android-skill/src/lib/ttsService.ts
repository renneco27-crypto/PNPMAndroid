import { stopNativeTTS, speakNativeTTS, isNativeTTSAvailable } from './nativeTTSBridge'

/**
 * Convert structured tabular data into natural spoken text with deliberate sentence-level pauses.
 * Each cell is spoken with its column label followed by a sentence boundary so TTS pauses between cells.
 * Each row begins with a row indicator so TTS pauses between rows.
 */
export function tableToSpeech(columns: string[], rows: (string | number)[][], label?: string): string {
  const cleanCols = (columns || []).map((c) => String(c || '').replace(/[*_`]/g, '').trim())
  const validRows = (rows || []).filter((r) => Array.isArray(r) && r.some((cell) => String(cell || '').trim()))
  if (validRows.length === 0) return ''

  const parts: string[] = []
  if (label) {
    parts.push(`Table, ${label.replace(/[*_`]/g, '').trim()}.`)
  } else {
    parts.push('Table.')
  }

  validRows.forEach((row, rIdx) => {
    parts.push(`Row ${rIdx + 1}.`)
    row.forEach((cell, cIdx) => {
      const colName = cleanCols[cIdx] || `Column ${cIdx + 1}`
      const val = String(cell ?? '').replace(/[*_`]/g, '').trim()
      if (val) {
        parts.push(`${colName}: ${val}.`)
      }
    })
  })

  return parts.join(' ')
}

/**
 * Clean text for TTS reading (strips markdown formatting, math directives, table directives,
 * and ensures proper sentence punctuation before bolded terms/keys so pauses are natural).
 */
export function cleanTextForSpeech(text: string): string {
  if (!text) return ''
  let t = text

  // 1. Normalize Table Directives into spoken sentences with pauses
  t = t.replace(/&\[TABLE:\s*([\s\S]*?)\]/gi, (_, content) => {
    let cols: string[] = []
    let rows: string[][] = []

    if (content.includes('||') || content.includes('¦')) {
      const rawRows = content.split('||').map((r: string) => r.trim()).filter(Boolean)
      if (rawRows.length > 0) {
        cols = rawRows[0].split('¦').map((c: string) => c.trim()).filter(Boolean)
        rows = rawRows.slice(1).map((row: string) => row.split('¦').map((c: string) => c.trim()))
      }
    } else {
      const lines = content.split('|').map((s: string) => s.trim()).filter(Boolean)
      if (lines.length > 0) {
        cols = lines[0].split(',').map((c: string) => c.trim()).filter(Boolean)
        rows = lines.slice(1).map((r: string) => r.split(',').map((c: string) => c.trim()))
      }
    }

    if (rows.length === 0 && cols.length === 0) return 'Table. '
    return tableToSpeech(cols, rows) + ' '
  })

  // Normalize Markdown tables into spoken sentences with pauses
  t = t.replace(/(?:^|\n)(\|[^\n]+\|\r?\n\|[\s\-:|]+\|\r?\n(?:\|[^\n]+\|(?:\r?\n|$))+)/g, (match) => {
    const lines = match.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const valid = lines.filter((l) => !/^[\|\s\-:]+$/.test(l))
    if (valid.length === 0) return ''
    const cols = valid[0].split('|').map((c) => c.trim()).filter(Boolean)
    const rows = valid.slice(1).map((r) => r.split('|').map((c) => c.trim()).filter(Boolean))
    return ' ' + tableToSpeech(cols, rows) + ' '
  })

  // 2. Normalize Code Directives
  t = t.replace(/&\[CODE:\s*([\s\S]*?)\]/gi, 'Code comparison. ')

  // 3. Normalize Math Steps & Symbols
  t = t.replace(/&\*\((?:STEPS|CANCEL):\s*([^)]+)\)/gi, 'Math steps. $1')
  t = t.replace(/&\*\(sqrt\{([^}]+)\}\)/gi, 'square root of $1')
  t = t.replace(/&\*\(cos\)/gi, 'cosine')
  t = t.replace(/&\*\(sin\)/gi, 'sine')
  t = t.replace(/&\*\(tan\)/gi, 'tangent')
  t = t.replace(/&\*\(sum\)/gi, 'sum of')
  t = t.replace(/&\*\(int\)/gi, 'integral of')
  t = t.replace(/&\*\(sigma\)/gi, 'sigma')
  t = t.replace(/&\*\(theta\)/gi, 'theta')
  t = t.replace(/&\*\(pi\)/gi, 'pi')
  t = t.replace(/&\*\(infty\)/gi, 'infinity')
  t = t.replace(/&\*([a-zA-Z]+)/gi, '$1')

  // 4. Convert newlines, bullets, and pipe segment dividers to sentence periods
  t = t.replace(/\r?\n+/g, '. ')
  t = t.replace(/\s*•\s*/g, '. ')
  t = t.replace(/\s*\|\s*/g, '. ')

  // 5. Ensure period before any bolded segment if not preceded by punctuation
  t = t.replace(/([^.?!;:\s])\s*\*\*([^*]+)\*\*/g, '$1. **$2**')
  t = t.replace(/([^.?!;:\s])\s*__([^_]+)__/g, '$1. __$2__')

  // 6. Strip math syntax
  t = t.replace(/\$\$(.*?)\$\$/g, '$1')
  t = t.replace(/\$(.*?)\$/g, '$1')

  // 7. Convert decimal numbers (e.g. 0.5 -> 0 point 5) so TTS says "point" instead of treating "." as a period
  t = t.replace(/(\d+)\.(\d+)/g, '$1 point $2')

  // 8. Strip markdown bold / italic / code / headers
  t = t.replace(/\*\*(.*?)\*\*/g, '$1')
  t = t.replace(/\*(.*?)\*/g, '$1')
  t = t.replace(/__(.*?)__/g, '$1')
  t = t.replace(/_(.*?)_/g, '$1')
  t = t.replace(/`([^`]+)`/g, '$1')
  t = t.replace(/^#+\s+/gm, '')
  t = t.replace(/^[•\-\*]\s+/gm, '')

  // 9. Normalize punctuation and spaces without breaking dotted identifiers (e.g. console.log, Node.js)
  t = t.replace(/\s*([,;?!])\s*/g, '$1 ')
  t = t.replace(/\s*:\s*/g, ': ')
  t = t.replace(/\s*\.(?![a-zA-Z0-9])\s*/g, '. ')
  t = t.replace(/\.{2,}/g, '.')
  t = t.replace(/\.\s*\./g, '.')
  t = t.replace(/([,;:?!])\s*\./g, '$1')
  t = t.replace(/\s+/g, ' ')

  return t.trim()
}

/**
 * Split text into individual sentences for anti-hang chunked speech synthesis.
 * Does NOT split on colon ':' or inside dotted words/numbers.
 */
export function splitIntoSentences(text: string): string[] {
  const cleaned = cleanTextForSpeech(text)
  if (!cleaned) return []

  // Split on real sentence boundaries: period (not followed by alphanumeric), exclamation, question, semicolon, newline
  const rawSegments = cleaned.split(/(?<=[?!;\n]|\.(?![a-zA-Z0-9]))\s+/)
  const sentences: string[] = []

  for (const seg of rawSegments) {
    const s = seg.trim()
    if (!s || s === '.') continue

    // If a segment is unusually long (> 180 chars), break on commas or clauses to prevent engine hang
    if (s.length > 180) {
      const sub = s.split(/(?<=[,])\s+/)
      for (const p of sub) {
        const trimmed = p.trim()
        if (trimmed && trimmed !== '.') sentences.push(trimmed)
      }
    } else {
      sentences.push(s)
    }
  }

  return sentences.length > 0 ? sentences : [cleaned]
}

export interface TTSQueueItem {
  id: string
  title?: string
  frontText?: string
  backText?: string
  rawText?: string
}

export type TTSStatus = 'idle' | 'playing' | 'paused'

export interface TTSState {
  status: TTSStatus
  currentItemIndex: number
  currentItemId: string | null
  currentSentenceIndex: number
  currentSentenceText: string
  totalItems: number
  rate: number
}

class TTSService {
  private currentUtterance: SpeechSynthesisUtterance | null = null
  private heartbeatInterval: NodeJS.Timeout | null = null
  private watchdogTimer: NodeJS.Timeout | null = null
  private isCancelled: boolean = false
  private currentAudio: HTMLAudioElement | null = null

  private queue: TTSQueueItem[] = []
  private itemIndex: number = 0
  private sentenceList: string[] = []
  private sentenceIndex: number = 0
  private rate: number = 1.125
  private status: TTSStatus = 'idle'

  private listeners: Set<(state: TTSState) => void> = new Set()

  public subscribe(listener: (state: TTSState) => void) {
    this.listeners.add(listener)
    listener(this.getState())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    const state = this.getState()
    this.listeners.forEach((l) => l(state))
  }

  public getState(): TTSState {
    const currentItem = (this.status !== 'idle' && this.itemIndex < this.queue.length) ? this.queue[this.itemIndex] : null
    return {
      status: this.status,
      currentItemIndex: this.itemIndex,
      currentItemId: currentItem ? currentItem.id : null,
      currentSentenceIndex: this.sentenceIndex,
      currentSentenceText: this.sentenceList[this.sentenceIndex] || '',
      totalItems: this.queue.length,
      rate: this.rate,
    }
  }

  public setRate(rate: number) {
    this.rate = Math.max(0.5, Math.min(2.0, rate))
    this.notify()
  }

  public isSpeaking(): boolean {
    if (this.status === 'playing') return true
    if (typeof window !== 'undefined' && window.speechSynthesis?.speaking) return true
    return false
  }

  /**
   * Speak text with optional rate and lifecycle callbacks (used by AIPracticeDrawer and single-block readers)
   */
  public async speak(
    text: string,
    options?: { rate?: number; onEnd?: () => void; onStop?: () => void }
  ): Promise<void> {
    this.stop()
    const sentences = splitIntoSentences(text)
    if (sentences.length === 0) {
      options?.onEnd?.()
      return
    }

    this.isCancelled = false
    this.status = 'playing'
    this.notify()

    // Brief settle delay after speechSynthesis.cancel() so Windows Chrome/Edge doesn't drop the new utterance
    await new Promise((r) => setTimeout(r, 50))

    const rate = options?.rate ?? this.rate
    for (const sentence of sentences) {
      if (this.isCancelled) {
        options?.onStop?.()
        return
      }
      await this.speakSentence(sentence, rate)
      if (this.isCancelled) {
        options?.onStop?.()
        return
      }
      // Natural inter-sentence pause
      await new Promise((r) => setTimeout(r, 180))
    }

    if (!this.isCancelled) {
      this.status = 'idle'
      this.notify()
      options?.onEnd?.()
    } else {
      options?.onStop?.()
    }
  }

  /**
   * Speak a single quick text snippet (e.g. for card pronunciation button)
   */
  public async speakSingle(text: string, rate: number = this.rate): Promise<void> {
    return this.speak(text, { rate })
  }

  /**
   * Start sequential playlist reading of cards or notes
   */
  public async startQueue(items: TTSQueueItem[], startIndex: number = 0) {
    this.stop()
    if (!items || items.length === 0) return

    this.queue = items
    this.itemIndex = Math.max(0, Math.min(startIndex, items.length - 1))
    this.isCancelled = false
    this.status = 'playing'
    this.notify()

    // Settle delay after cancel() so Chrome/Edge/WebView does not drop the first utterance
    await new Promise((r) => setTimeout(r, 60))

    if (!this.isCancelled) {
      this.processCurrentItem()
    }
  }

  private async processCurrentItem() {
    if (this.isCancelled || this.itemIndex >= this.queue.length) {
      this.stop()
      return
    }

    const item = this.queue[this.itemIndex]
    // Build sentence list for this item
    const sentences: string[] = []

    if (item.title) {
      sentences.push(...splitIntoSentences(item.title))
    }
    if (item.frontText) {
      sentences.push(...splitIntoSentences(item.frontText))
    }
    if (item.backText) {
      sentences.push(...splitIntoSentences(item.backText))
    }
    if (item.rawText) {
      sentences.push(...splitIntoSentences(item.rawText))
    }

    if (sentences.length === 0) {
      this.itemIndex++
      this.processCurrentItem()
      return
    }

    this.sentenceList = sentences
    this.sentenceIndex = 0
    this.notify()

    while (this.sentenceIndex < this.sentenceList.length) {
      if (this.isCancelled) return
      if (this.status === 'paused') {
        // Yield execution while paused
        await new Promise((r) => setTimeout(r, 200))
        continue
      }

      const sentence = this.sentenceList[this.sentenceIndex]
      this.notify()

      await this.speakSentence(sentence, this.rate)

      if (this.isCancelled) return

      // Slight natural pause between sentences, with deliberate extended pause for table rows & boundaries
      const isTableRow = /^Row \d+\./i.test(sentence) || /^Table/i.test(sentence)
      const pauseDuration = isTableRow ? 420 : 250
      await new Promise((r) => setTimeout(r, pauseDuration))
      this.sentenceIndex++
    }

    // Finished current item -> natural pause before next card/note
    if (!this.isCancelled) {
      await new Promise((r) => setTimeout(r, 450))
      this.itemIndex++
      this.processCurrentItem()
    }
  }

  /**
   * Core sentence speaker:
   * 1. Uses on-device Android Native TTS directly (0ms latency, 100% offline).
   * 2. Falls back to desktop SpeechSynthesis for web browsers.
   */
  private async speakSentence(sentence: string, rate: number): Promise<void> {
    if (this.isCancelled) return

    // 1. On-device Android Native TTS (fastest, offline, zero server dependence)
    try {
      const nativeAvailable = await isNativeTTSAvailable()
      if (nativeAvailable && !this.isCancelled) {
        const spoke = await speakNativeTTS(sentence, rate)
        if (spoke) return
      }
    } catch (err) {
      console.warn('[ttsService] Native TTS failed:', err)
    }

    if (this.isCancelled) return

    // 2. Fallback: Browser SpeechSynthesis for desktop browsers
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        resolve()
        return
      }

      this.clearTimers()

      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume()
      }

      const utterance = new SpeechSynthesisUtterance(sentence)
      utterance.rate = rate
      utterance.pitch = 1.0

      let isResolved = false
      const finish = () => {
        if (!isResolved) {
          isResolved = true
          this.clearTimers()
          resolve()
        }
      }

      utterance.onend = () => finish()
      utterance.onerror = () => finish()

      const timeoutMs = Math.max(4500, sentence.length * 150 * (1 / rate))
      this.watchdogTimer = setTimeout(() => {
        if (!isResolved) {
          try {
            window.speechSynthesis.resume()
          } catch {}
          finish()
        }
      }, timeoutMs)

      this.heartbeatInterval = setInterval(() => {
        if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
          window.speechSynthesis.pause()
          window.speechSynthesis.resume()
        }
      }, 7000)

      this.currentUtterance = utterance
      try {
        window.speechSynthesis.speak(utterance)
      } catch (err) {
        finish()
      }
    })
  }

  public pause() {
    if (this.status === 'playing') {
      this.status = 'paused'
      if (this.currentAudio) {
        try { this.currentAudio.pause() } catch {}
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.pause()
      }
      this.notify()
    }
  }

  public resume() {
    if (this.status === 'paused') {
      this.status = 'playing'
      if (this.currentAudio) {
        try { this.currentAudio.play().catch(() => {}) } catch {}
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.resume()
      }
      this.notify()
    }
  }

  public togglePlayPause() {
    if (this.status === 'playing') {
      this.pause()
    } else if (this.status === 'paused') {
      this.resume()
    }
  }

  public nextItem() {
    if (this.queue.length === 0) return
    this.stopSpeech()
    this.itemIndex = Math.min(this.itemIndex + 1, this.queue.length - 1)
    this.sentenceIndex = 0
    this.status = 'playing'
    this.processCurrentItem()
  }

  public prevItem() {
    if (this.queue.length === 0) return
    this.stopSpeech()
    this.itemIndex = Math.max(this.itemIndex - 1, 0)
    this.sentenceIndex = 0
    this.status = 'playing'
    this.processCurrentItem()
  }

  private stopSpeech() {
    this.clearTimers()
    stopNativeTTS().catch(() => {})
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel()
      } catch {}
    }
    if (this.currentAudio) {
      try {
        this.currentAudio.pause()
        this.currentAudio = null
      } catch {}
    }
  }

  public stop() {
    this.isCancelled = true
    this.stopSpeech()
    this.status = 'idle'
    this.sentenceList = []
    this.sentenceIndex = 0
    this.queue = []
    this.itemIndex = 0
    this.notify()
  }

  private clearTimers() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer)
      this.watchdogTimer = null
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }
}

export const ttsService = new TTSService()
