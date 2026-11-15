import { registerPlugin, Capacitor } from '@capacitor/core'

export interface NativeTTSPluginInterface {
  isAvailable(): Promise<{ available: boolean }>
  speak(options: { text: string; rate?: number; pitch?: number }): Promise<{ success: boolean; utteranceId: string }>
  stop(): Promise<{ success: boolean }>
  addListener(
    eventName: 'ttsEvent',
    listenerFunc: (event: { utteranceId: string; event: 'start' | 'done' | 'error' }) => void
  ): Promise<any>
  removeAllListeners(): Promise<void>
}

export const NativeTTS = registerPlugin<NativeTTSPluginInterface>('NativeTTS')

export async function isNativeTTSAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const res = await NativeTTS.isAvailable()
    return !!res?.available
  } catch {
    return false
  }
}

export async function speakNativeTTS(text: string, rate: number = 1.0): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    return new Promise(async (resolve) => {
      let listener: any = null
      let expectedUtteranceId: string | null = null
      const pendingEvents: any[] = []

      listener = await NativeTTS.addListener('ttsEvent', (event) => {
        if (!expectedUtteranceId) {
          pendingEvents.push(event)
          return
        }
        if (event.utteranceId === expectedUtteranceId) {
          if (event.event === 'done' || event.event === 'error') {
            if (listener) listener.remove()
            resolve(event.event === 'done')
          }
        }
      })

      const res = await NativeTTS.speak({ text, rate })
      if (!res?.success) {
        if (listener) listener.remove()
        resolve(false)
      } else {
        expectedUtteranceId = res.utteranceId
        for (const ev of pendingEvents) {
          if (ev.utteranceId === expectedUtteranceId) {
            if (ev.event === 'done' || ev.event === 'error') {
              if (listener) listener.remove()
              resolve(ev.event === 'done')
              return
            }
          }
        }
      }
    })
  } catch (err) {
    console.warn('[NativeTTS] Speak failed:', err)
    return false
  }
}

export async function stopNativeTTS(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await NativeTTS.stop()
  } catch {}
}
