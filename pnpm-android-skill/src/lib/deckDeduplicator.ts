import type { Card } from '@/lib/zodSchemas'

/**
 * Exact 100% normalization (only trims outer whitespace and normalizes CRLF -> LF)
 * so intentional variations like Enumeration-in-Notes ("... (Key Concepts)") are NEVER touched,
 * while true 100% duplicate cards/notes are permanently removed.
 */
export function normalizeTextForDedup(val: unknown): string {
  if (val === null || val === undefined) return ''
  return String(val)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function getCardTypeGroup(typeRaw: unknown): string {
  const t = String(typeRaw || 'definition').toLowerCase().trim()
  if (t === 'keyword' || t === 'notes' || t === 'note') return 'keyword'
  if (t === 'definition' || t === 'concept') return 'definition'
  if (t === 'enum' || t === 'enumeration') return 'enumeration'
  if (t === 'tf' || t === 'true_false') return 'true_false'
  if (t === 'id' || t === 'identification') return 'identification'
  if (t === 'math' || t === 'math_problem' || t === 'math_lab' || t === 'mathlab') return 'math'
  if (t === 'code' || t === 'code_challenge' || t === 'code_lab' || t === 'codelab') return 'code'
  return t
}

/**
 * Identifies 100% exact duplicate cards within a deck.
 * Only marks a card as a duplicate when (type, front, back) are 100% identical.
 * Never removes enumeration cards or their intentional "(Key Concepts)" Notes entries
 * unless there are literally two 100% identical copies of the exact same entry.
 */
export function findDuplicateCards(cards: Card[]): {
  uniqueCards: Card[]
  duplicateIds: string[]
} {
  const seenByKey = new Map<string, Card>()
  const duplicateIds: string[] = []

  for (const card of cards) {
    const group = getCardTypeGroup(card.type)
    const frontNorm = normalizeTextForDedup(card.front)
    const backNorm = normalizeTextForDedup(card.back)

    if (!frontNorm && !backNorm) continue

    // Strictly 100% match on type + exact front + exact back
    const key = `${group}:::${frontNorm}:::${backNorm}`
    const existing = seenByKey.get(key)

    if (!existing) {
      seenByKey.set(key, card)
    } else {
      // Keep whichever card has more study progress (mastery + correctCount + wrongCount)
      const existingProgress = (existing.mastery || 0) * 10 + (existing.correctCount || 0) + (existing.wrongCount || 0)
      const currentProgress = (card.mastery || 0) * 10 + (card.correctCount || 0) + (card.wrongCount || 0)

      if (currentProgress > existingProgress) {
        duplicateIds.push(existing.id)
        seenByKey.set(key, card)
      } else {
        duplicateIds.push(card.id)
      }
    }
  }

  return {
    uniqueCards: Array.from(seenByKey.values()),
    duplicateIds,
  }
}

/**
 * Deduplicates raw JSON deck content (used both locally on deck.sourceJson and on the server
 * for Supabase decks.json_content / csv_content across DB A and DB B) when items are 100% identical.
 */
export function deduplicateJsonDeckString(rawJson: string): {
  cleanedJson: string
  removedCount: number
} {
  if (!rawJson || typeof rawJson !== 'string') {
    return { cleanedJson: rawJson, removedCount: 0 }
  }

  try {
    const parsed = JSON.parse(rawJson)
    const isArrayRoot = Array.isArray(parsed)
    const cardsArray: any[] | null = isArrayRoot
      ? parsed
      : Array.isArray(parsed?.cards)
        ? parsed.cards
        : Array.isArray(parsed?.flashcards)
          ? parsed.flashcards
          : Array.isArray(parsed?.items)
            ? parsed.items
            : null

    if (!cardsArray || cardsArray.length <= 1) {
      return { cleanedJson: rawJson, removedCount: 0 }
    }

    const seen = new Set<string>()
    const deduped: any[] = []
    let removedCount = 0

    for (const item of cardsArray) {
      if (!item || typeof item !== 'object') {
        deduped.push(item)
        continue
      }
      const group = getCardTypeGroup(item.type || item.card_type || 'definition')
      const frontRaw = item.front || item.question || item.term || item.title || item.clue || item.keyword || ''
      const backRaw =
        item.back ||
        item.answer ||
        item.definition ||
        (Array.isArray(item.notes) ? item.notes.join('\n') : item.notes) ||
        (Array.isArray(item.enum_items) ? item.enum_items.join(';') : item.enum_items) ||
        item.mc?.correct ||
        item.mc_correct ||
        item.id?.answer ||
        item.id_answer ||
        ''

      const frontNorm = normalizeTextForDedup(frontRaw)
      const backNorm = normalizeTextForDedup(backRaw)
      if (!frontNorm && !backNorm) {
        deduped.push(item)
        continue
      }

      // Strictly 100% match on type + exact front + exact back
      const sig = `${group}:::${frontNorm}:::${backNorm}`
      if (seen.has(sig)) {
        removedCount++
        continue
      }
      seen.add(sig)
      deduped.push(item)
    }

    if (removedCount === 0) {
      return { cleanedJson: rawJson, removedCount: 0 }
    }

    if (isArrayRoot) {
      return { cleanedJson: JSON.stringify(deduped), removedCount }
    }

    const updatedObj = { ...parsed }
    if (Array.isArray(parsed.cards)) updatedObj.cards = deduped
    else if (Array.isArray(parsed.flashcards)) updatedObj.flashcards = deduped
    else if (Array.isArray(parsed.items)) updatedObj.items = deduped

    return {
      cleanedJson: JSON.stringify(updatedObj),
      removedCount,
    }
  } catch {
    return { cleanedJson: rawJson, removedCount: 0 }
  }
}
