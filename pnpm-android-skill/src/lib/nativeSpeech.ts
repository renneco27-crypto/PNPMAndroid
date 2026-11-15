import { registerPlugin } from '@capacitor/core'

export interface NativeTTSPlugin {
  isAvailable(): Promise<{ available: boolean }>
  speak(options: { text: string, rate?: number, pitch?: number }): Promise<{ success: boolean, utteranceId: string }>
  stop(): Promise<{ success: boolean }>
  addListener(eventName: 'ttsEvent', listenerFunc: (info: any) => void): Promise<any>
}

export interface NativeSTTPlugin {
  startListening(): Promise<void>
  stopListening(): Promise<void>
  addListener(eventName: 'sttEvent', listenerFunc: (info: any) => void): Promise<any>
}

export const NativeTTS = registerPlugin<NativeTTSPlugin>('NativeTTS')
export const NativeSTT = registerPlugin<NativeSTTPlugin>('NativeSTT')

export async function speakNative(text: string, rate = 1.0, pitch = 1.0) {
  try {
    const { available } = await NativeTTS.isAvailable()
    if (available) {
      return NativeTTS.speak({ text, rate, pitch })
    }
  } catch (err) {
    console.warn('Native TTS not available', err)
  }
}

export async function stopNativeSpeech() {
  try {
    await NativeTTS.stop()
  } catch (err) {
    console.warn('Failed stopping TTS', err)
  }
}

export async function startNativeListening(onResult: (text: string) => void, onPartial?: (text: string) => void, onError?: (err: any) => void) {
  try {
    let listener = await NativeSTT.addListener('sttEvent', (info) => {
      if (info.event === 'result') onResult(info.text)
      if (info.event === 'partial' && onPartial) onPartial(info.text)
      if (info.event === 'error' && onError) onError(info.error)
    })

    await NativeSTT.startListening()
    
    return () => {
      NativeSTT.stopListening()
      listener.remove()
    }
  } catch (err) {
    console.warn('Native STT error', err)
    if (onError) onError(err)
  }
}
