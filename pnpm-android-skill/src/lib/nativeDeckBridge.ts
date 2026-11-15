'use client'

import { Capacitor } from '@capacitor/core'

export interface NativeDeckMeta {
  id: string
  title: string
  subject: string
  sizeBytes?: number
  lastModified?: number
  csvContent?: string
}

function getNativePlugin(): any {
  if (typeof window === 'undefined') return null
  const Cap = (window as any).Capacitor
  return Cap?.Plugins?.NativeDeckStorage || null
}

export async function isNativeStorageAvailable(): Promise<boolean> {
  return Capacitor.isNativePlatform() && Boolean(getNativePlugin())
}

export async function saveNativeDeckCSV(
  id: string,
  title: string,
  csvContent: string,
  subject = 'General'
): Promise<boolean> {
  try {
    const plugin = getNativePlugin()
    if (plugin?.saveDeckCSV) {
      const res = await plugin.saveDeckCSV({ id, title, csvContent, subject })
      return Boolean(res?.success)
    }

    // Web LocalStorage backup fallback
    if (typeof window !== 'undefined') {
      localStorage.setItem(`studyup_native_deck_${id}`, JSON.stringify({ id, title, subject, csvContent }))
      const list = JSON.parse(localStorage.getItem('studyup_native_decks_index') || '[]')
      if (!list.includes(id)) {
        list.push(id)
        localStorage.setItem('studyup_native_decks_index', JSON.stringify(list))
      }
      return true
    }
  } catch (err) {
    console.warn('[NativeDeckBridge] Failed to save deck CSV:', err)
  }
  return false
}

export async function getNativeDeckCSV(id: string): Promise<NativeDeckMeta | null> {
  try {
    const plugin = getNativePlugin()
    if (plugin?.getDeckCSV) {
      const res = await plugin.getDeckCSV({ id })
      if (res?.csvContent) {
        return {
          id: res.id || id,
          title: res.title || 'Untitled Deck',
          subject: res.subject || 'General',
          csvContent: res.csvContent,
        }
      }
    }

    // Web LocalStorage fallback
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(`studyup_native_deck_${id}`)
      if (raw) return JSON.parse(raw)
    }
  } catch (err) {
    console.warn('[NativeDeckBridge] Failed to get deck CSV:', err)
  }
  return null
}

export async function listNativeDecks(): Promise<NativeDeckMeta[]> {
  try {
    const plugin = getNativePlugin()
    if (plugin?.listSavedDecks) {
      const res = await plugin.listSavedDecks()
      if (Array.isArray(res?.decks)) {
        return res.decks
      }
    }

    // Web fallback
    if (typeof window !== 'undefined') {
      const list: string[] = JSON.parse(localStorage.getItem('studyup_native_decks_index') || '[]')
      const decks: NativeDeckMeta[] = []
      for (const id of list) {
        const raw = localStorage.getItem(`studyup_native_deck_${id}`)
        if (raw) decks.push(JSON.parse(raw))
      }
      return decks
    }
  } catch (err) {
    console.warn('[NativeDeckBridge] Failed to list native decks:', err)
  }
  return []
}

export async function deleteNativeDeckCSV(id: string): Promise<boolean> {
  try {
    const plugin = getNativePlugin()
    if (plugin?.deleteDeckCSV) {
      const res = await plugin.deleteDeckCSV({ id })
      return Boolean(res?.success)
    }

    if (typeof window !== 'undefined') {
      localStorage.removeItem(`studyup_native_deck_${id}`)
      const list: string[] = JSON.parse(localStorage.getItem('studyup_native_decks_index') || '[]')
      const next = list.filter((i) => i !== id)
      localStorage.setItem('studyup_native_decks_index', JSON.stringify(next))
      return true
    }
  } catch (err) {
    console.warn('[NativeDeckBridge] Failed to delete native deck:', err)
  }
  return false
}
