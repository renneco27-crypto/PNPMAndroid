import { JsonDeckSchema, type JsonCard, type JsonDeck } from './jsonSchema'
import type { Card, Deck, DeckImage, QuizItem } from '@/lib/zodSchemas'
import { cleanDeckTitle } from './deckMeta'
import { findDuplicateCards } from '@/lib/deckDeduplicator'
import { populateDeckDistractors, selectBestDistractors } from '@/features/quiz/distractorEngine'
import { synthesizeCardsFromNotes } from '@/features/quiz/synthesizeStudyCards'
import { synthesizeDeckStagesFromQuiz } from '@/features/quiz/synthesizeFromQuiz'
import { v4 as uuidv4 } from 'uuid'
import { hasProse } from '@/components/KaTeXMath'

/**
 * Parses raw Question & Answer text lists (e.g., "1. Q: What is X? A: It is Y.")
 * into a structured JSON deck with multiple choice questions.
 */
export function parseQATextToDeckJson(text: string): string | null {
  if (!text || typeof text !== 'string') return null
  const trimmed = text.trim()

  const qaRegex = /(?:^|\n)\s*(?:\d+[.)]\s*)?(?:Q|Question)\s*:\s*([\s\S]+?)\s*(?:A|Answer)\s*:\s*([\s\S]+?)(?=(?:\r?\n\s*(?:\d+[.)]\s*)?(?:Q|Question)\s*:|$))/gi

  const matches: Array<{ question: string; answer: string; chapter: string }> = []

  let defaultChapter = 'General'
  const lines = trimmed.split(/\r?\n/)
  for (const line of lines) {
    const l = line.trim()
    const partMatch = l.match(/^(?:Part\s+[IVXLCDM\d]+|Chapter\s+\d+|Section\s+\d+)\s*[:–-]\s*(.+)$/i)
    if (partMatch) {
      defaultChapter = partMatch[1].trim()
      break
    }
  }

  let m: RegExpExecArray | null
  while ((m = qaRegex.exec(trimmed)) !== null) {
    const q = m[1].replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
    const a = m[2].replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (q && a) {
      matches.push({
        question: q,
        answer: a,
        chapter: defaultChapter,
      })
    }
  }

  if (matches.length < 2) return null

  const deckObject = {
    title: defaultChapter !== 'General' ? defaultChapter : 'Study Questions & Answers',
    subject: defaultChapter !== 'General' ? defaultChapter : 'General',
    chapter: defaultChapter,
    cards: matches.map((item) => ({
      type: 'multiple_choice',
      front: item.question,
      back: item.answer,
      chapter: item.chapter,
      subject: item.chapter,
      mc: {
        correct: item.answer,
        distractors: [],
      },
    })),
  }

  return JSON.stringify(deckObject, null, 2)
}

export function extractAllJsonBlocks(str: string): string[] {
  if (!str) return []
  const blocks: string[] = []
  let i = 0

  while (i < str.length) {
    const nextBrace = str.indexOf('{', i)
    const nextBracket = str.indexOf('[', i)

    if (nextBrace === -1 && nextBracket === -1) break

    let startIdx = -1
    let openChar = '{'
    let closeChar = '}'

    if (nextBrace !== -1 && (nextBracket === -1 || nextBrace < nextBracket)) {
      startIdx = nextBrace
      openChar = '{'
      closeChar = '}'
    } else {
      startIdx = nextBracket
      openChar = '['
      closeChar = ']'
    }

    let depth = 0
    let inString = false
    let escape = false
    let endIdx = -1

    for (let j = startIdx; j < str.length; j++) {
      const ch = str[j]
      if (inString) {
        if (escape) {
          escape = false
        } else if (ch === '\\') {
          escape = true
        } else if (ch === '"') {
          inString = false
        }
        continue
      }

      if (ch === '"') {
        inString = true
        continue
      }

      if (ch === openChar) {
        depth++
      } else if (ch === closeChar) {
        depth--
        if (depth === 0) {
          endIdx = j + 1
          break
        }
      }
    }

    if (endIdx !== -1) {
      blocks.push(str.slice(startIdx, endIdx))
      i = endIdx
    } else {
      break
    }
  }

  return blocks
}

export function extractJsonString(text: string): string {
  if (!text) return ''
  // 0. Check if input is a raw Q&A text list (e.g. "1. Q: ... A: ...")
  const qaJson = parseQATextToDeckJson(text)
  if (qaJson) return qaJson

  // Pre-normalize chat emoticon corruptions (e.g. "n""apple\" -> "n":\"apple\") BEFORE quote/brace scanning
  // so an unescaped quote next to an emoji never flips inString polarity and truncates the closing brace!
  let str = text
    .trim()
    .replace(/[\uD83D\uDE15\uD83D\uDE41\uD83D\uDE42\uD83D\uDE10]\s*\\?"/g, ':\\"')
    .replace(/[\uD83D\uDE15\uD83D\uDE41\uD83D\uDE42\uD83D\uDE10]\s*(?=[\[{\d"'])/g, ': ')

  // 1. Check for markdown code fences
  const fenced = str.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) {
    str = fenced[1].trim()
  }

  // 1.5 Multi-block check: If text contains multiple JSON arrays/objects, merge them into a single deck
  const multiBlocks = extractAllJsonBlocks(str)
  if (multiBlocks.length > 1) {
    let combinedCards: any[] = []
    let baseDeckObj: Record<string, any> | null = null

    for (const b of multiBlocks) {
      let parsed: any = null
      try {
        parsed = JSON.parse(b)
      } catch {
        try {
          parsed = JSON.parse(repairJsonString(b))
        } catch {}
      }

      if (Array.isArray(parsed)) {
        combinedCards = combinedCards.concat(parsed)
      } else if (parsed && typeof parsed === 'object') {
        if (!baseDeckObj) {
          baseDeckObj = { ...parsed }
          if (Array.isArray(parsed.cards)) {
            combinedCards = combinedCards.concat(parsed.cards)
          }
        } else if (Array.isArray(parsed.cards)) {
          combinedCards = combinedCards.concat(parsed.cards)
        } else {
          combinedCards.push(parsed)
        }
      }
    }

    if (combinedCards.length > 0) {
      if (baseDeckObj) {
        baseDeckObj.cards = combinedCards
        return JSON.stringify(baseDeckObj, null, 2)
      }
      return JSON.stringify(combinedCards, null, 2)
    }
  }

  // 2. Find start of JSON object or array
  const firstBrace = str.indexOf('{')
  const firstBracket = str.indexOf('[')

  let startIdx = -1
  let openChar = '{'
  let closeChar = '}'

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace
    openChar = '{'
    closeChar = '}'
  } else if (firstBracket !== -1) {
    startIdx = firstBracket
    openChar = '['
    closeChar = ']'
  }

  if (startIdx === -1) {
    return str
  }

  // 3. Scan matching closing brace with string & escape awareness
  let depth = 0
  let inString = false
  let escape = false
  let endIdx = -1

  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (ch === '\\') {
        escape = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === openChar) {
      depth++
    } else if (ch === closeChar) {
      depth--
      if (depth === 0) {
        endIdx = i + 1
        break
      }
    }
  }

  if (endIdx !== -1) {
    return str.slice(startIdx, endIdx)
  }

  // Fallback: strip sentinel markers and whitespace
  return str
    .replace(/END_OF_JSON/g, '')
    .replace(/CONTINUE_FROM_NEXT_ROW/g, '')
    .trim()
}

export function repairJsonString(str: string): string {
  if (!str) return ''
  // 0. Fix auto-converted chat emoticons where ':\' or ':"' became an emoji (e.g. Skype/Slack auto-emoji , , )
  // e.g. "n""apple" or "n"\"apple\" -> "n":\"apple\"
  let s = str.replace(/[\uD83D\uDE15\uD83D\uDE41\uD83D\uDE42\uD83D\uDE10]\s*\\?"/g, ':\\"')
  s = s.replace(/[\uD83D\uDE15\uD83D\uDE41\uD83D\uDE42\uD83D\uDE10]\s*(?=[\[{\d"'])/g, ': ')

  // 1. Double-escape any backslash before LaTeX commands of 2+ letters (e.g. \frac, \times, \text, \sqrt, \cdot, \theta, \beta, \rho, \nu, \begin)
  // This prevents JSON.parse from consuming \f as form-feed (turning \frac into rac), \t as tab, \b as backspace, \r as CR, \n as newline!
  s = s.replace(/(?<!\\)\\(?=[a-zA-Z]{2,})/g, '\\\\')

  // 1b. Double-escape set braces \{ and \} so JSON.parse preserves LaTeX set notation
  s = s.replace(/(?<!\\)\\(?=[{}])/g, '\\\\')

  // 2. Double-escape \u when not followed by 4 hex digits (e.g. \uparrow, \unit) to prevent "Bad Unicode escape"
  s = s.replace(/(?<!\\)\\u(?![0-9a-fA-F]{4})/g, '\\\\u')

  // 3. Fix unescaped backslashes before non-standard JSON escapes (\", \\, \/, \b, \f, \n, \r, \t)
  s = s.replace(/(?<!\\)\\([^"\\\/bfnrtu])/g, '\\\\$1')

  return s
}

export function extractLooseCardFragments(text: string): any[] {
  if (!text) return []
  const segments = text.split(/(?:\r?\n\s*continue\s*\r?\n|\b(?:CONTINUE_TO_NEXT_PAGE|CONTINUE_FROM_NEXT_ROW)\b)/i)
  const matchedSpans: { start: number; end: number; text: string }[] = []

  for (const seg of segments) {
    const normalized = repairJsonString(seg)
    const stack: number[] = []
    let inString = false
    let escape = false

    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i]
      if (inString) {
        if (escape) {
          escape = false
        } else if (ch === '\\') {
          escape = true
        } else if (ch === '"') {
          inString = false
        } else if (ch === '\n') {
          const nextPart = normalized.slice(i + 1, i + 50)
          if (/^\s*"(?:type|front|back|back_blocks|mc|tf|id|code|math|source_slide|kind|term|answer|text)"\s*:/i.test(nextPart) || /^\s*\{\s*"(?:type|front)"/i.test(nextPart)) {
            inString = false
          }
        }
        continue
      }
      if (ch === '"') { inString = true; continue }
      if (ch === '{') { stack.push(i); continue }
      if (ch === '}') {
        if (stack.length === 0) continue
        const start = stack.pop() as number
        const candidate = normalized.slice(start, i + 1)
        if (/^\s*\{\s*"(?:type|index|number|slot|front|question|term|title|subject|chapter|lesson|cards|images|items|flashcards|(?:code|codelab|math|mathlab|notes?|keyword|flashcards?|def|definition|enum|enumeration|id|identification|mc|multiple_choice|tf|true_false|images?|img)(?:[\.\s_#-]*\d+)?)"\s*:/i.test(candidate)) {
          for (let j = matchedSpans.length - 1; j >= 0; j--) {
            if (matchedSpans[j].start >= start && matchedSpans[j].end <= i + 1) {
              matchedSpans.splice(j, 1)
            }
          }
          matchedSpans.push({ start, end: i + 1, text: candidate })
        }
      }
    }
  }

  const isInnerSubObject = (obj: any): boolean => {
    if (!obj || typeof obj !== 'object') return true
    if (obj.use_case !== undefined && typeof obj.code === 'string' && !obj.type && !obj.front) return true
    if (obj.memory_effect !== undefined || (obj.section !== undefined && obj.fn !== undefined)) return true
    if (obj.starterCode !== undefined || obj.solutionKeywords !== undefined || obj.buggy_code !== undefined) return true
    if (obj.symbol !== undefined && obj.meaning !== undefined) return true
    if (obj.formula_master !== undefined || obj.formula_working !== undefined) return true
    if (obj.targetNumeric !== undefined && obj.formulaHint !== undefined && !obj.type) return true
    if (obj.latex !== undefined && obj.operation !== undefined && !obj.type) return true
    return false
  }

  const cards: any[] = []
  const seenCardKeys = new Set<string>()

  for (const span of matchedSpans) {
    const frag = span.text
    let obj: any = null
    try {
      obj = JSON.parse(frag)
    } catch {}

    if (!obj) {
      try {
        const repaired = repairJsonString(frag)
        obj = JSON.parse(repaired)
      } catch {}
    }

    if (!obj) {
      try {
        const relaxed = repairJsonString(frag).replace(/"([^"]+)":\s*"([\s\S]*?)"(?=\s*[,}\]])/g, (_, key, val) => {
          const cleanVal = val.replace(/(?<!\\)"/g, '\\"')
          return `"${key}":"${cleanVal}"`
        })
        obj = JSON.parse(relaxed)
      } catch {}
    }

    if (obj && typeof obj === 'object') {
      const candidates = Array.isArray(obj.cards) ? obj.cards : (Array.isArray(obj.items) ? obj.items : (Array.isArray(obj.flashcards) ? obj.flashcards : [obj]))
      for (const c of candidates) {
        if (!isInnerSubObject(c)) {
          const type = String(c.type || '').toLowerCase().trim()
          const front = String(c.front || c.question || c.term || c.title || '').trim()
          const back = String(c.back || c.answer || c.definition || '').trim()
          const key = `${type}:::${front.toLowerCase()}:::${back.toLowerCase()}`
          if (!seenCardKeys.has(key)) {
            seenCardKeys.add(key)
            cards.push(c)
          }
        }
      }
    }
  }
  return cards
}

function inferTopicFromCards(cards: any[]): { title: string; subject: string } | null {
  if (!cards || !Array.isArray(cards) || cards.length === 0) return null
  
  const textSample = cards.slice(0, 15).map(c => `${c.front || ''} ${c.back || ''} ${c.topic || ''}`).join(' ')
  
  let subject = 'General'
  if (/torque|rotational|center of mass|moment of inertia|kinematics|momentum|gravity|velocity|acceleration|force|physic|angular/i.test(textSample)) {
    subject = 'Physics'
  } else if (/derivative|integral|matrix|algebra|equation|polynomial|calculus|geometry|trig|logarithm/i.test(textSample)) {
    subject = 'Mathematics'
  } else if (/python|javascript|typescript|function|algorithm|react|variable|compiler|array|object|recursion/i.test(textSample)) {
    subject = 'Computer Science'
  } else if (/cell|dna|rna|protein|organism|photosynthesis|mitosis|biology|enzyme|membrane/i.test(textSample)) {
    subject = 'Biology'
  } else if (/molecule|atom|reaction|acid|base|periodic|element|chemistry|mole|stoichiometry/i.test(textSample)) {
    subject = 'Chemistry'
  }

  // Common high-yield conceptual pairs (check first for broader coverage)
  if (/torque/i.test(textSample) && /center of mass/i.test(textSample)) {
    return { title: 'Center of Mass & Torque', subject }
  } else if (/moment of inertia/i.test(textSample) && /rotational/i.test(textSample)) {
    return { title: 'Rotational Kinematics & Moment of Inertia', subject }
  } else if (/center of mass/i.test(textSample)) {
    return { title: 'Center of Mass', subject }
  } else if (/torque/i.test(textSample)) {
    return { title: 'Torque & Rotational Motion', subject }
  } else if (/moment of inertia/i.test(textSample)) {
    return { title: 'Moment of Inertia', subject }
  } else if (/rotational kinematics/i.test(textSample)) {
    return { title: 'Rotational Kinematics', subject }
  }

  // Look for card definitions or question targets like "Which statement best defines X?"
  for (const c of cards.slice(0, 8)) {
    const front = String(c.front || '').trim()
    const defineMatch = front.match(/(?:defines?|meaning of|what is|concept of)\s+([a-zA-Z\s]{3,35})\??/i)
    if (defineMatch && defineMatch[1]) {
      const topicName = defineMatch[1].trim()
      if (!/^(the|a|an|which|this|that|following|best|correct|true|false)$/i.test(topicName)) {
        const formatted = topicName.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
        return { title: formatted, subject }
      }
    }
  }

  return null
}

export function parseJsonFile(
  text: string,
  title?: string,
  fallbackTitle?: string,
  customDeckId?: string
): { deck: Deck; cards: Card[]; images: DeckImage[] } {
  if (!text || !text.trim()) {
    throw new Error('parseJsonFile: input text is empty or blank')
  }

  let raw: unknown
  const extracted = extractJsonString(text)
  if (!extracted || !extracted.trim()) {
    throw new Error('parseJsonFile: no JSON structure found in input')
  }

  try {
    raw = JSON.parse(extracted)
  } catch (err) {
    try {
      raw = JSON.parse(repairJsonString(extracted))
    } catch {
      try {
        const recovered = recoverTruncatedBuffer(text)
        raw = recovered ? JSON.parse(repairJsonString(recovered)) : null
      } catch {
        const salvagedCards = extractLooseCardFragments(text)
        if (salvagedCards.length > 0) {
          raw = { cards: salvagedCards }
        } else {
          throw new Error('parseJsonFile: input is not valid JSON')
        }
      }
    }
  }

  if (!raw) {
    const salvagedCards = extractLooseCardFragments(text)
    if (salvagedCards.length > 0) {
      raw = { cards: salvagedCards }
    } else {
      throw new Error('parseJsonFile: input is not valid JSON')
    }
  }

  // Normalize candidate to object with cards array
  let rawCards: any[] = []
  let detectedTitle = ''
  let detectedSubject = 'General'
  let detectedChapter = ''
  let detectedLesson = ''
  let detectedNotes = ''

  const pickArray = (o: any): any[] | null => {
    if (!o || typeof o !== 'object') return null
    for (const k of ['cards', 'flashcards', 'items', 'questions', 'quizItems', 'quiz_items', 'notes_list', 'codelab', 'mathlab']) {
      if (Array.isArray(o[k]) && o[k].length > 0) return o[k]
    }
    return null
  }

  // Unwrap single-key heading wrappers like { "code.1": { ... } } or { "math.2": { ... } }
  const unwrapHeadingKeyObject = (o: any): any => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return o
    const keys = Object.keys(o)
    if (keys.length === 1) {
      const k = keys[0]
      const m = k.match(/^(code|codelab|code_lab|math|mathlab|math_lab|notes?|keyword|flashcards?|def|definition|enum|enumeration|id|identification|mc|multiple_choice|tf|true_false|images?|img)(?:[\.\s_#\/-]*(\d+)(?:\/\d+)?)?$/i)
      if (m && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) {
        const inner = { ...o[k] }
        if (!inner.type) inner.type = k
        if (m[2] && inner.index === undefined) inner.index = parseInt(m[2], 10)
        return inner
      }
    }
    return o
  }

  let topObj: Record<string, any> | null = null

  if (Array.isArray(raw)) {
    rawCards = raw.map(unwrapHeadingKeyObject)
  } else if (raw && typeof raw === 'object') {
    const obj = unwrapHeadingKeyObject(raw) as Record<string, any>
    topObj = obj
    if (typeof obj.json === 'string' && (obj.json.trim().startsWith('{') || obj.json.trim().startsWith('['))) {
      return parseJsonFile(obj.json, title || obj.title, fallbackTitle, customDeckId)
    }

    const picked = pickArray(obj)
      ?? pickArray(obj.deck)
      ?? pickArray(obj.data)
      ?? pickArray(obj.result)
      ?? pickArray(obj.payload)
      ?? (Array.isArray(obj.deck) ? obj.deck : null)
      ?? (Array.isArray(obj.cards) ? obj.cards : null)
      ?? (Array.isArray(obj.items) ? obj.items : null)
      ?? (Array.isArray(obj.flashcards) ? obj.flashcards : null)
      ?? (Array.isArray(obj.quizItems) ? obj.quizItems : null)
      ?? (isValidCardObject(obj) ? [obj] : [])
    rawCards = picked.map(unwrapHeadingKeyObject)

    if (rawCards.length === 0 && (obj.notes || obj.summary || obj.content)) {
      const noteContent = typeof obj.notes === 'string' ? obj.notes : (typeof obj.summary === 'string' ? obj.summary : (typeof obj.content === 'string' ? obj.content : ''))
      if (noteContent && noteContent.trim()) {
        detectedNotes = noteContent.trim()
        rawCards = [{
          front: obj.title || title || fallbackTitle || 'Study Notes',
          back: detectedNotes,
          type: 'keyword'
        }]
      }
    }

    const isGenericTitle = (s?: string) => {
      if (!s) return true
      const trimmed = s.trim().toLowerCase()
      return (
        /^(chapter\s*\d+|week\s*\d+|module\s*\d+|unit\s*\d+|lesson\s*\d+|part\s*\d+|general|study notes|notes|untitled|study deck|deck|temp|new text document(\s*\(\d+\))?|text document(\s*\(\d+\))?|document(\s*\d+)?)$/i.test(trimmed) ||
        /^(white|blue|dark|black|red|green|yellow|purple|square|circle|gradient)\b/i.test(trimmed) ||
        /(?:presentation|geometric|template|minimalist|modern|theme|slideshow)/i.test(trimmed)
      )
    }

    if (obj.title && typeof obj.title === 'string' && obj.title.trim() && !isGenericTitle(obj.title)) {
      detectedTitle = obj.title.trim()
    } else if (obj.deck && typeof obj.deck === 'object' && obj.deck.title && typeof obj.deck.title === 'string' && !isGenericTitle(obj.deck.title)) {
      detectedTitle = obj.deck.title.trim()
    } else if (obj.subject && typeof obj.subject === 'string' && obj.subject.trim() && !isGenericTitle(obj.subject)) {
      detectedTitle = obj.subject.trim()
    } else if (obj.chapter && typeof obj.chapter === 'string' && obj.chapter.trim() && !isGenericTitle(obj.chapter)) {
      detectedTitle = obj.chapter.trim()
    } else if (obj.title && typeof obj.title === 'string' && obj.title.trim()) {
      detectedTitle = obj.title.trim()
    } else if (obj.subject && typeof obj.subject === 'string' && obj.subject.trim() && obj.subject.toLowerCase() !== 'general') {
      detectedTitle = obj.subject.trim()
    } else if (obj.chapter && typeof obj.chapter === 'string' && obj.chapter.trim()) {
      detectedTitle = obj.chapter.trim()
    }
    if (obj.subject) detectedSubject = obj.subject
    if (obj.chapter) detectedChapter = obj.chapter
    if (obj.lesson) detectedLesson = obj.lesson
  }

  // Extract images from top-level or from fragments
  let rawImages: any[] = []
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, any>
    if (Array.isArray(obj.images)) {
      rawImages = [...obj.images]
    } else if ((obj.url || obj.imageUrl || obj.dataUrl) && !obj.cards && !obj.flashcards && !obj.code && !obj.math) {
      rawImages = [obj]
    }
  }
  const remainingCards: any[] = []
  for (const item of rawCards) {
    if (!item || typeof item !== 'object') continue
    const rawTypeStr = String(item.type || item.card_type || item.mode || item.heading || '').toLowerCase().trim()
    const isExplicitImage = /^(?:images?|img|gallery|visual)(?:[\.\s_#\/-]*\d+(?:\/\d+)?)?$/i.test(rawTypeStr)
    const isImageOnlyItem = Boolean(
      (item.url || item.imageUrl || item.dataUrl || item.src) &&
      (item.title || item.caption || isExplicitImage) &&
      !item.back && !item.code && !item.math && !item.mc && !item.tf && !item.id && !item.enum_items
    )
    if (Array.isArray(item.images)) {
      rawImages.push(...item.images)
    }
    if (isExplicitImage || isImageOnlyItem) {
      rawImages.push(item)
    } else {
      remainingCards.push(item)
    }
  }
  rawCards = remainingCards

  if (rawCards.length === 0 && rawImages.length === 0) {
    const keys = topObj ? Object.keys(topObj).join(', ') : (typeof raw)
    throw new Error(`parseJsonFile: No flashcards, labs, notes, or images found in the JSON payload (top-level keys: ${keys || 'empty'})`)
  }

  const isGeneric = (s?: string) => {
    if (!s) return true
    const trimmed = s.trim().toLowerCase()
    return (
      /^(chapter\s*\d+|week\s*\d+|module\s*\d+|unit\s*\d+|lesson\s*\d+|part\s*\d+|general|study notes|notes|untitled|study deck|deck|temp|new text document(\s*\(\d+\))?|text document(\s*\(\d+\))?|document(\s*\d+)?)$/i.test(trimmed) ||
      /^(white|blue|dark|black|red|green|yellow|purple|square|circle|gradient)\b/i.test(trimmed) ||
      /(?:presentation|geometric|template|minimalist|modern|theme|slideshow)/i.test(trimmed)
    )
  }

  let chosenTitle = detectedTitle
  if (!chosenTitle || isGeneric(chosenTitle)) {
    if (title && !isGeneric(title)) {
      chosenTitle = title
    } else if (detectedSubject && !isGeneric(detectedSubject)) {
      chosenTitle = detectedSubject
    } else if (fallbackTitle && !isGeneric(fallbackTitle)) {
      chosenTitle = fallbackTitle
    } else {
      chosenTitle = detectedTitle || title || fallbackTitle || ''
    }
  }

  // Infer topic and subject from cards content if title is still missing or generic
  if (!chosenTitle || isGeneric(chosenTitle) || chosenTitle.toLowerCase() === 'study deck' || chosenTitle.toLowerCase() === 'deck') {
    const inferred = inferTopicFromCards(rawCards)
    if (inferred) {
      if (!chosenTitle || isGeneric(chosenTitle) || chosenTitle.toLowerCase() === 'study deck' || chosenTitle.toLowerCase() === 'deck') {
        chosenTitle = inferred.title
      }
      if (!detectedSubject || isGeneric(detectedSubject) || detectedSubject.toLowerCase() === 'general') {
        detectedSubject = inferred.subject
      }
    }
  }

  if (!chosenTitle) {
    chosenTitle = 'Study Deck'
  }

  const deckId = customDeckId || uuidv4()
  const finalTitle = cleanDeckTitle(chosenTitle)
  const finalSubject = detectedSubject || 'General'

  const cards: Card[] = []
  const quizItems: QuizItem[] = []

  const parsePositiveIndex = (val: any): number | undefined => {
    if (typeof val === 'number' && Number.isFinite(val) && val >= 1) return Math.floor(val)
    if (typeof val === 'string' && val.trim()) {
      const m = val.trim().match(/(?:^|[\.\s_#\/-\[\(])(\d+)(?:\s*\/\s*\d+)?[\]\)]?$/) || val.trim().match(/^(\d+)(?:\s*\/\s*\d+)?$/)
      if (m) {
        const n = parseInt(m[1], 10)
        if (n >= 1) return n
      }
    }
    return undefined
  }

  const normalizeModeToken = (token: string): string | null => {
    const t = token.toLowerCase().replace(/[\s_-]+/g, '_')
    if (t === 'code' || t === 'codelab' || t === 'code_lab' || t === 'code_challenge' || t === 'coding' || t === 'programming') return 'code'
    if (t === 'math' || t === 'mathlab' || t === 'math_lab' || t === 'math_problem' || t === 'calculus' || t === 'formula') return 'math'
    if (t === 'keyword' || t === 'note' || t === 'notes' || t === 'study_note' || t === 'study_notes' || t === 'key') return 'keyword'
    if (t === 'definition' || t === 'def' || t === 'flashcard' || t === 'flashcards' || t === 'card') return 'definition'
    if (t === 'enumeration' || t === 'enum' || t === 'list') return 'enumeration'
    if (t === 'identification' || t === 'ident' || t === 'id') return 'identification'
    if (t === 'multiple_choice' || t === 'mc' || t === 'multiplechoice' || t === 'quiz') return 'multiple_choice'
    if (t === 'true_false' || t === 'tf' || t === 'truefalse' || t === 'true_or_false') return 'true_false'
    return null
  }

  rawCards.forEach((jc: any) => {
    if (!jc || typeof jc !== 'object') return

    // 1. Parse explicit index/number if present on the card object (e.g. "index": 1, "number": "1/3", "slot": 2)
    let cardIndex: number | undefined =
      parsePositiveIndex(jc.index) ??
      parsePositiveIndex(jc.cardIndex) ??
      parsePositiveIndex(jc.number) ??
      parsePositiveIndex(jc.slot) ??
      parsePositiveIndex(jc.item_number) ??
      parsePositiveIndex(jc.card_number) ??
      parsePositiveIndex(jc.order)

    // 2. Inspect raw type / mode / heading field (supports "code.1", "math.2", "flashcard.3", "enum.1", "tf.2", "notes.1", etc.)
    const rawTypeField = String(jc.type || jc.card_type || jc.mode || jc.heading || jc.category || '').trim()
    let detectedMode: string | null = null

    if (rawTypeField) {
      const typeMatch = rawTypeField.match(/^([a-zA-Z_/\s-]+?)(?:[\.\s_#\/-]*(\d+)(?:\s*\/\s*\d+)?)?$/)
      if (typeMatch) {
        const modeCandidate = normalizeModeToken(typeMatch[1].trim())
        if (modeCandidate) detectedMode = modeCandidate
        if (typeMatch[2] && cardIndex === undefined) {
          cardIndex = parseInt(typeMatch[2], 10)
        }
      }
      if (!detectedMode) {
        if (/^code/i.test(rawTypeField)) detectedMode = 'code'
        else if (/^math/i.test(rawTypeField)) detectedMode = 'math'
        else if (/^(?:note|keyword)/i.test(rawTypeField)) detectedMode = 'keyword'
        else if (/^enum/i.test(rawTypeField)) detectedMode = 'enumeration'
        else if (/^(?:id\b|ident)/i.test(rawTypeField)) detectedMode = 'identification'
        else if (/^(?:mc\b|multiple)/i.test(rawTypeField)) detectedMode = 'multiple_choice'
        else if (/^(?:tf\b|true)/i.test(rawTypeField)) detectedMode = 'true_false'
        else if (/^(?:def|flashcard)/i.test(rawTypeField)) detectedMode = 'definition'
      }
    }

    // 3. Extract raw front/title and check for heading prefixes like "code.1: ...", "math.2 - ...", "notes.1: ...", "1/3: ..."
    let front = String(
      jc.front || jc.question || jc.term || jc.title || jc.clue || jc.keyword || jc.definition || jc.problem || jc.prompt || jc.topic || jc.statement ||
      jc.code?.title || jc.math?.title || jc.math?.problem || ''
    ).trim()

    if (front) {
      // Check for "<mode>.<number>: <title>" or "<mode> #<number> - <title>" or "<mode> 1/n: <title>"
      const headingPrefixMatch = front.match(
        /^(code(?:_?lab)?|math(?:_?lab)?|notes?|keyword|flashcards?|def(?:inition)?|enum(?:eration)?|id(?:entification)?|mc|multiple[\s_]?choice|tf|true[\s_\/]?false)(?:[\.\s_#-]+(\d+)(?:\s*\/\s*\d+)?)?\s*[:\-—]\s+([\s\S]+)$/i
      )
      if (headingPrefixMatch) {
        const prefixMode = normalizeModeToken(headingPrefixMatch[1].trim())
        if (prefixMode && !detectedMode) {
          detectedMode = prefixMode
        }
        if (headingPrefixMatch[2] && cardIndex === undefined) {
          cardIndex = parseInt(headingPrefixMatch[2], 10)
        }
        front = headingPrefixMatch[3].trim()
      } else {
        // Check for leading "code.1 <title>" (dot + number with space)
        const dotNumberPrefixMatch = front.match(
          /^(code(?:_?lab)?|math(?:_?lab)?|notes?|keyword|flashcards?|def(?:inition)?|enum(?:eration)?|id(?:entification)?|mc|tf)\.(\d+)(?:\s*\/\s*\d+)?\s+([\s\S]+)$/i
        )
        if (dotNumberPrefixMatch) {
          const prefixMode = normalizeModeToken(dotNumberPrefixMatch[1].trim())
          if (prefixMode && !detectedMode) detectedMode = prefixMode
          if (cardIndex === undefined) cardIndex = parseInt(dotNumberPrefixMatch[2], 10)
          front = dotNumberPrefixMatch[3].trim()
        } else {
          // Check for leading "[1/5] <title>" or "(1/5) <title>" or "1/5: <title>"
          const ratioPrefixMatch = front.match(/^(?:[\[\(]?(\d+)\s*\/\s*\d+[\]\)]?[:\-—\s]+|#(\d+)[:\-—\s]+)([\s\S]+)$/)
          if (ratioPrefixMatch) {
            const idxNum = parseInt(ratioPrefixMatch[1] || ratioPrefixMatch[2], 10)
            if (idxNum >= 1 && cardIndex === undefined) cardIndex = idxNum
            front = ratioPrefixMatch[3].trim()
          }
        }
      }
    }

    // 4. Structural inspection fallback: if mode is still unset or defaulted to 'definition', inspect nested/flat keys!
    if (!detectedMode || detectedMode === 'definition') {
      if (
        jc.code !== undefined ||
        jc.script_html !== undefined ||
        jc.syntax_formula !== undefined ||
        jc.code_starter !== undefined ||
        jc.code_solution !== undefined ||
        jc.code_lab_data !== undefined ||
        jc.practice_challenge !== undefined ||
        jc.bug_hunter !== undefined ||
        (jc.test_suite !== undefined && (jc.starter !== undefined || jc.solution !== undefined || jc.language !== undefined))
      ) {
        detectedMode = 'code'
      } else if (
        jc.math !== undefined ||
        jc.problem_breakdown !== undefined ||
        jc.solution_steps !== undefined ||
        jc.practice_problem !== undefined ||
        jc.symbol_table !== undefined ||
        jc.math_problem !== undefined ||
        jc.math_steps !== undefined ||
        jc.notebook_data !== undefined
      ) {
        detectedMode = 'math'
      } else if (jc.mc !== undefined || jc.mc_correct !== undefined || Array.isArray(jc.distractors)) {
        detectedMode = 'multiple_choice'
      } else if (jc.tf !== undefined || jc.tf_answer !== undefined) {
        detectedMode = 'true_false'
      } else if (jc.enum_items !== undefined || (Array.isArray(jc.items) && !jc.cards)) {
        detectedMode = 'enumeration'
      } else if ((jc.id && typeof jc.id === 'object' && jc.id.answer !== undefined) || jc.id_answer !== undefined) {
        detectedMode = 'identification'
      } else if (jc.notes !== undefined || (typeof jc.back === 'string' && (jc.back.includes('&[TABLE:') || /^\s*•\s*\*\*/m.test(jc.back)))) {
        if (!rawTypeField) detectedMode = 'keyword'
      }
    }

    const typeStr = detectedMode || 'definition'
    const type = typeStr as any
    const isPlaceholder = (s: any) => typeof s === 'string' && /^\s*(?:\.{2,}|…|none|null|undefined)\s*$/i.test(s)
    if (!front || isPlaceholder(front)) return
    if (isPlaceholder(jc.back) && isPlaceholder(jc.mc?.correct) && isPlaceholder(jc.tf?.answer)) return

    let back = String(
      jc.back ||
      jc.answer ||
      jc.definition ||
      (Array.isArray(jc.notes) ? jc.notes.map((n: string) => `• ${n}`).join('\n') : jc.notes) ||
      ''
    ).trim()

    // Strip conversational AI intro/outro fluff if present
    back = back
      .replace(/^(?:Got it,?|Here is the|Sure,?|These are all from).*?[\r\n]+/i, '')
      .replace(/[\r\n]+(?:Ask me anything|Let me know if|Here is the rebuilt).*$/i, '')
      .trim()

    // Auto-bold pattern: if note lines have pattern "Term: Definition", "Term - Definition", or "Term — Definition" without bold
    if (typeStr === 'keyword' || typeStr === 'definition' || typeStr === 'notes') {
      back = back.split('\n').map((line) => {
        if (!line.includes('**')) {
          const match = line.match(/^([•\-\*]?\s*)([^:\-—\n]{2,60})\s*([:\-—])\s*(.*)$/)
          if (match && !match[2].trim().toLowerCase().startsWith('http')) {
            const bullet = match[1] || ''
            const term = match[2].trim()
            const delim = match[3]
            const rest = match[4].trim()
            return `${bullet}**${term}** ${delim} ${rest}`
          }
        }
        return line
      }).join('\n')
    }

    if (!back) {
      if (typeStr === 'multiple_choice') back = jc.mc?.correct || jc.mc_correct || ''
      else if (typeStr === 'enumeration') {
        const rawItems = jc.enum_items || jc.answer || jc.items || []
        back = Array.isArray(rawItems) ? rawItems.join(', ') : String(rawItems)
      }
      else if (typeStr === 'identification' || typeStr === 'id') back = jc.id?.answer || jc.id_answer || ''
      else if (typeStr === 'true_false') {
        const rawAns = jc.tf?.answer ?? jc.tf_answer
        back = rawAns === true || String(rawAns).toLowerCase() === 'true' ? 'True' : 'False'
      }
      else if ((typeStr === 'code' || typeStr === 'code_challenge') && jc.code) {
        back = typeof jc.code === 'string' ? jc.code : (jc.code.solution || jc.code.starter || front)
      } else if ((typeStr === 'math' || typeStr === 'math_problem') && jc.math) {
        back = jc.math.final_answer || jc.math.answer || jc.math.problem || front
      }
    }

    if (!back) back = front

    const card: Card = {
      id: uuidv4(),
      deckId,
      front,
      back,
      chapter: jc.chapter || detectedChapter || '',
      subject: jc.subject || detectedSubject || '',
      lesson: jc.lesson || detectedLesson || '',
      type,
      mastery: 0,
      status: 'new',
      know: null,
      correctCount: 0,
      wrongCount: 0,
      lastReviewed: null,
      nextReview: null,
    } as any
    if (cardIndex !== undefined) {
      ;(card as any).cardIndex = cardIndex
    }

    if (jc.source_slide !== undefined) {
      ;(card as any).source_slide = jc.source_slide
    }

    if (Array.isArray(jc.back_blocks) && jc.back_blocks.length > 0) {
      ;(card as any).back_blocks = jc.back_blocks
      if (!jc.back) {
        card.back = jc.back_blocks.map((b: any) => {
          if (b.kind === 'definition') return `• **${b.term}** — ${b.text}`
          if (b.kind === 'what_breaks') return `• ⚡ **${b.label || 'What Breaks Without It'}**${b.nickname ? ` (${b.nickname})` : ''}: ${b.text}`
          if (b.kind === 'ascii_diagram') return `\`\`\`\n${b.diagram || ''}\n\`\`\``
          if (b.kind === 'switch_tldr') {
            return [
              b.match_path ? `• Fast/Match: ${b.match_path}` : '',
              b.mismatch_path ? `• Slow/Mismatch: ${b.mismatch_path}` : '',
              b.checker ? `• Checker: ${b.checker}` : '',
            ].filter(Boolean).join('\n')
          }
          if (b.kind === 'verbatim') return `• [Verbatim Source${b.slide ? ` Slide ${b.slide}` : ''}]: ${b.text}`
          if (b.kind === 'steps') return `• ${b.label || 'Procedure'}:\n` + (b.items || []).map((it: string, i: number) => `  ${i + 1}. ${it}`).join('\n')
          if (b.kind === 'table') return `&[TABLE: ${(b.columns || []).join(' ¦ ')} || ${(b.rows || []).map((r: any[]) => r.join(' ¦ ')).join(' || ')}]`
          if (b.kind === 'formula') return `• ${b.label || 'Formula'}: ${b.text}`
          if (b.kind === 'example') return `• ${b.label || 'Example'}: ${b.text}`
          if (b.kind === 'pros_cons') {
            const pros = (b.pros || []).map((p: string) => `• [+] ${p}`).join('\n')
            const cons = (b.cons || []).map((c: string) => `• [-] ${c}`).join('\n')
            return [pros, cons].filter(Boolean).join('\n')
          }
          return `• ${b.text || ''}`
        }).join('\n')
      }
    }

    if (typeStr === 'multiple_choice') {
      const correct = jc.mc?.correct || jc.mc_correct || card.mc_correct || back
      if (isPlaceholder(correct)) return
      const rawDist = (jc.mc?.distractors || [jc.mc_distractor1, jc.mc_distractor2, jc.mc_distractor3]).filter(Boolean).filter((d: string) => !isPlaceholder(d))
      if (rawDist.length === 0) return
      card.mc_correct = correct
      card.mc_distractor1 = rawDist[0] || ''
      card.mc_distractor2 = rawDist[1] || ''
      card.mc_distractor3 = rawDist[2] || ''
      if (!card.back) card.back = correct
      if (correct) {
        const qItem: any = {
          mode: 'multiple_choice',
          question: front,
          correct: correct,
          distractors: [
            card.mc_distractor1 || '',
            card.mc_distractor2 || '',
            card.mc_distractor3 || ''
          ],
          chapter: card.chapter,
          subject: card.subject,
        }
        if (cardIndex !== undefined) qItem.cardIndex = cardIndex
        quizItems.push(qItem)
      }
    }

    if (typeStr === 'true_false') {
      const rawAns = jc.tf?.answer ?? jc.tf_answer ?? back
      const truthy = rawAns === true || String(rawAns).toLowerCase().trim() === 'true'
      card.tf_answer = truthy ? 'true' : 'false'
      const explanation = jc.tf?.explanation || jc.tf_explanation || (card as any).explanation || ''
      ;(card as any).explanation = explanation
      if (!card.back) card.back = truthy ? 'True' : 'False'
      const qItem: any = {
        mode: 'true_false',
        statement: front,
        falseVersion: front,
        explanation: explanation,
        correct: truthy,
        chapter: card.chapter,
        subject: card.subject,
      }
      if (cardIndex !== undefined) qItem.cardIndex = cardIndex
      quizItems.push(qItem)
    }

    if (typeStr === 'enumeration') {
      let items: string[] = []
      if (Array.isArray(jc.enum_items)) items = jc.enum_items
      else if (Array.isArray(jc.answer)) items = jc.answer
      else if (Array.isArray(jc.items)) items = jc.items
      else if (typeof jc.enum_items === 'string') items = jc.enum_items.split(';').map((s: string) => s.trim()).filter(Boolean)
      else if (back) {
        items = back.split(/[\n,;]/).map((l: string) => l.replace(/^\d+[\.\)]\s*/, '').replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean)
      }
      items = items.filter(it => !isPlaceholder(it))
      if (items.length < 2) return
      card.enum_items = items.join(';')
      if (!card.back) card.back = items.join(', ')
      if (items.length >= 2) {
        const qItem: any = {
          mode: 'enumeration',
          topic: front,
          items: items,
          chapter: card.chapter,
          subject: card.subject,
        }
        if (cardIndex !== undefined) qItem.cardIndex = cardIndex
        quizItems.push(qItem)

        // Only auto-generate keyword note for full deck builds, not single-slot (1/n) enumeration edits
        if (cardIndex === undefined && rawCards.length > 1) {
          const enumNoteBody = items.map((it, idx) => {
            const cleanIt = it.replace(/^(?:\d+[\.\)]|\s*•|\s*-\s*)\s*/, '').trim()
            const match = cleanIt.match(/^([^:\-—]+)\s*[:\-—]\s*(.*)$/)
            if (match) {
              return `${idx + 1}. **${match[1].trim()}** — ${match[2].trim()}`
            }
            return `${idx + 1}. **${cleanIt}**`
          }).join('\n')

          cards.push({
            id: uuidv4(),
            deckId,
            front: `${front} (Key Concepts)`,
            back: enumNoteBody,
            chapter: card.chapter,
            subject: card.subject,
            lesson: card.lesson,
            type: 'keyword',
            mastery: 0,
            status: 'new',
            know: null,
            correctCount: 0,
            wrongCount: 0,
            lastReviewed: null,
            nextReview: null,
          } as any)
        }
      }
    }

    if (typeStr === 'identification' || typeStr === 'id') {
      const ans = jc.id?.answer || jc.id_answer || back
      card.id_answer = ans
      const rawVariants = jc.id?.variants || (jc.id_variants ? jc.id_variants.split(';') : [ans.toLowerCase()])
      card.id_variants = Array.isArray(rawVariants) ? rawVariants.join(';') : String(rawVariants)
      if (!card.back) card.back = ans
      const qItem: any = {
        mode: 'identification',
        definition: front,
        answer: ans,
        acceptVariants: Array.isArray(rawVariants) ? rawVariants : [ans.toLowerCase()],
        chapter: card.chapter,
        subject: card.subject,
      }
      if (cardIndex !== undefined) qItem.cardIndex = cardIndex
      quizItems.push(qItem)
    }

    if (typeStr === 'code' || typeStr === 'code_challenge') {
      const rawCode = jc.code !== undefined ? jc.code : jc
      const codeObj = typeof rawCode === 'object' && rawCode !== null
        ? rawCode
        : { solution: String(rawCode || ''), starter: String(rawCode || ''), language: 'javascript' }
      card.code_language = codeObj.language || jc.code_language || jc.language || 'javascript'
      card.code_starter = codeObj.starter || jc.code_starter || jc.starter || ''
      card.code_keywords = Array.isArray(codeObj.keywords)
        ? codeObj.keywords.join(';')
        : (Array.isArray(jc.keywords) ? jc.keywords.join(';') : (codeObj.keywords || jc.code_keywords || jc.keywords || ''))
      card.code_solution = codeObj.solution || jc.code_solution || jc.solution || ''
      card.code_output = codeObj.output || jc.code_output || jc.output || ''
      if (jc.code_lab_data && typeof jc.code_lab_data === 'string') {
        card.code_lab_data = jc.code_lab_data
      } else if (codeObj.script_html || codeObj.data_map || codeObj.syntax_formula || codeObj.in_plain_words || codeObj.test_suite || codeObj.variations || codeObj.practice_challenge || codeObj.bug_hunter || jc.syntax_formula || jc.in_plain_words) {
        card.code_lab_data = JSON.stringify({
          in_plain_words: codeObj.in_plain_words || jc.in_plain_words,
          syntax_formula: codeObj.syntax_formula || jc.syntax_formula,
          script_html: codeObj.script_html || jc.script_html,
          data_map: codeObj.data_map || jc.data_map,
          test_suite: codeObj.test_suite || jc.test_suite,
          variations: codeObj.variations || jc.variations,
          practice_challenge: codeObj.practice_challenge || jc.practice_challenge,
          bug_hunter: codeObj.bug_hunter || jc.bug_hunter,
        })
      }
    }

    if (typeStr === 'math' || typeStr === 'math_problem') {
      const mathSrc = (jc.math && typeof jc.math === 'object') ? jc.math : jc
      const cleanLatexStr = (val: any): any => {
        if (!val) return ''
        if (Array.isArray(val)) {
          return val.map((item: any) => cleanLatexStr(item))
        }
        if (typeof val === 'object' && val !== null) {
          const res: Record<string, any> = {}
          for (const [k, v] of Object.entries(val)) {
            res[k] = cleanLatexStr(v)
          }
          return res
        }
        if (typeof val !== 'string') {
          return String(val)
        }
        return val
          .replace(/[\x0C\u000c]rac(?=\{)/g, '\\frac')
          .replace(/(^|[^a-zA-Z\\])rac(?=\{)/g, '$1\\frac')
          .replace(/[\x09\t]imes(?=\b|[^a-zA-Z])/g, '\\times')
          .replace(/[\x09\t]ext(?=\{)/g, '\\text')
          .replace(/[\x08\b]eta(?=\b|[^a-zA-Z])/g, '\\beta')
      }

      // Support Claude's strict schema: formula, variables, worked_example
      const rawFormula = mathSrc.formula || jc.formula || mathSrc.problem || jc.math_problem || ''
      const cleanFormula = cleanLatexStr(rawFormula)
      const rawVars = mathSrc.variables || jc.variables || mathSrc.symbol_table
      const workedEx = mathSrc.worked_example || jc.worked_example || {}

      card.math_problem = cleanFormula
      card.math_answer = cleanLatexStr(workedEx.answer || mathSrc.answer || jc.math_answer || '')
      card.math_category = mathSrc.category || jc.math_category || ''
      card.math_difficulty = mathSrc.difficulty || jc.math_difficulty || ''

      const mappedSymbols = Array.isArray(rawVars) && rawVars.length > 0
        ? rawVars.map((v: any) => ({
            symbol: String(v.symbol || ''),
            meaning: String(v.meaning || ''),
            unit: String(v.unit || ''),
          }))
        : (mathSrc.symbol_table || undefined)

      if (Array.isArray(mathSrc.steps) && mathSrc.steps.length > 0) {
        card.math_steps = mathSrc.steps
          .map((s: any) => [
            cleanLatexStr(s.latex || s.math || ''),
            s.explanation || s.instruction || '',
            s.operation || s.operationType || '',
            s.badge || s.operationBadge || ''
          ].join('|'))
          .join(' ; ')
      } else if (Array.isArray(workedEx.steps) && workedEx.steps.length > 0) {
        card.math_steps = workedEx.steps
          .map((s: any, sIdx: number) => [
            cleanLatexStr(s),
            `Step ${sIdx + 1}`,
            sIdx === 0 ? 'start' : sIdx === workedEx.steps.length - 1 ? 'final' : 'simplify',
            `Step ${sIdx + 1}`
          ].join('|'))
          .join(' ; ')
      } else if (typeof jc.math_steps === 'string') {
        card.math_steps = jc.math_steps
      }

      if (jc.notebook_data) {
        card.notebook_data = typeof jc.notebook_data === 'string' ? jc.notebook_data : JSON.stringify(jc.notebook_data)
      } else {
        const problemBreakdown = {
          restate: front,
          given: workedEx.given || (mathSrc.problem_breakdown?.given || ''),
          formula_master: cleanFormula && !hasProse(cleanFormula) ? cleanFormula : (mathSrc.problem_breakdown?.formula_master || ''),
          formula_working: (mathSrc.problem_breakdown?.formula_working && !hasProse(mathSrc.problem_breakdown.formula_working))
            ? mathSrc.problem_breakdown.formula_working
            : ((mathSrc.problem_breakdown?.formula_short && !hasProse(mathSrc.problem_breakdown.formula_short))
                ? mathSrc.problem_breakdown.formula_short
                : (cleanFormula && !hasProse(cleanFormula) ? cleanFormula : '')),
        }

        const solutionSteps = Array.isArray(workedEx.steps)
          ? workedEx.steps.join('\n\n')
          : cleanLatexStr(mathSrc.solution_steps || '')

        card.notebook_data = JSON.stringify({
          symbol_table: mappedSymbols,
          in_plain_words: mathSrc.in_plain_words || `Master the mathematical setup for ${front}.`,
          problem_breakdown: problemBreakdown,
          solution_steps: solutionSteps,
          key_takeaway: mathSrc.key_takeaway || (workedEx.answer ? `Final value: ${workedEx.answer}` : undefined),
          practice_problem: mathSrc.practice_problem,
        })
      }
    }

    cards.push(card)
  })

  // Prioritize MathLab ('math') and CodeLab ('code') cards at the very top of the deck, followed by Notes ('keyword'),
  // and preserve 1/n cardIndex ordering within the same type!
  cards.sort((a: any, b: any) => {
    const priority = (type: string) => {
      if (type === 'math') return 0
      if (type === 'code') return 1
      if (type === 'keyword') return 2
      if (type === 'enumeration') return 3
      if (type === 'identification') return 4
      return 5
    }
    const pDiff = priority(a.type) - priority(b.type)
    if (pDiff !== 0) return pDiff
    if (typeof a.cardIndex === 'number' && typeof b.cardIndex === 'number') {
      return a.cardIndex - b.cardIndex
    }
    return 0
  })

  const { uniqueCards } = findDuplicateCards(cards)
  const staged = synthesizeDeckStagesFromQuiz(uniqueCards, quizItems, deckId)
  const synthesized = synthesizeCardsFromNotes(staged.cards, staged.quizItems, deckId)
  const populatedCards = populateDeckDistractors(synthesized.cards)
  const finalQuizItems = synthesized.quizItems

  // Sync populated distractors to multiple-choice quiz items
  const cardMap = new Map(populatedCards.map((c) => [c.front, c]))
  for (const q of finalQuizItems) {
    if (q.mode === 'multiple_choice') {
      const c = cardMap.get(q.question)
      if (c && (!q.distractors || q.distractors.length < 3 || q.distractors.every((d: string) => !d))) {
        q.distractors = [c.mc_distractor1, c.mc_distractor2, c.mc_distractor3].filter(Boolean) as string[]
      }
      if (!q.distractors || q.distractors.length < 3 || q.distractors.every((d: string) => !d)) {
        const dummyCard: any = { front: q.question, back: q.correct, chapter: q.chapter, subject: q.subject }
        q.distractors = selectBestDistractors(q.correct, dummyCard, populatedCards)
      }
    }
  }

  const deckImages: DeckImage[] = []
  const seenImageUrls = new Set<string>()

  rawImages.forEach((item: any, idx: number) => {
    if (!item) return
    let rawUrl = typeof item === 'string'
      ? item
      : String(item.url || item.imageUrl || item.dataUrl || item.src || item.link || item.href || item.image || item.uri || '').trim()

    // Normalize Wikimedia thumb URLs to standard 960px width so Varnish CDN doesn't reject with HTTP 400
    if (rawUrl.includes('wikimedia.org') && rawUrl.includes('/thumb/')) {
      rawUrl = rawUrl.replace(/\/\d+px-([^/]+)$/, '/960px-$1').replace(/^http:\/\//i, 'https://')
    }

    if (!rawUrl || seenImageUrls.has(rawUrl.toLowerCase())) return
    seenImageUrls.add(rawUrl.toLowerCase())

    let imageIndex: number | undefined =
      typeof item === 'object'
        ? (parsePositiveIndex(item.index) ?? parsePositiveIndex(item.number) ?? parsePositiveIndex(item.slot) ?? parsePositiveIndex(item.type))
        : undefined

    let title = typeof item === 'object' && item.title
      ? String(item.title).trim()
      : `Visual Reference ${idx + 1}`

    const imgHeadingMatch = title.match(/^(?:images?|img|gallery|visual)?(?:[\.\s_#-]*(\d+)(?:\s*\/\s*\d+)?)[:\-—\s]+([\s\S]+)$/i)
    if (imgHeadingMatch && imgHeadingMatch[1]) {
      if (imageIndex === undefined) imageIndex = parseInt(imgHeadingMatch[1], 10)
      title = imgHeadingMatch[2].trim()
    }

    const caption = typeof item === 'object' && item.caption
      ? String(item.caption).trim()
      : undefined

    const transcript = typeof item === 'object' && item.transcript
      ? String(item.transcript).trim()
      : undefined

    const imgRecord: any = {
      id: `img-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
      deckId,
      title,
      caption,
      transcript,
      dataUrl: rawUrl,
      createdAt: new Date(Date.now() + idx * 10).toISOString(),
    }
    if (imageIndex !== undefined) {
      imgRecord.imageIndex = imageIndex
    }
    deckImages.push(imgRecord)
  })

  const deck: Deck = {
    id: deckId,
    title: finalTitle,
    subject: finalSubject,
    uploadedAt: new Date().toISOString(),
    cards: populatedCards,
    quizItems: finalQuizItems,
    sourceFormat: 'json',
    sourceJson: extracted,
    transcripts: Array.isArray((raw as any)?.transcripts) ? (raw as any).transcripts : undefined,
  }

  return { deck, cards: populatedCards, images: deckImages }
}

export interface MergeDeckDetails {
  json: string
  newCardsCount: number
  identicalCardsCount: number
  totalCardsCount: number
}

function normalizeCardValue(val: any): string {
  if (val === null || val === undefined) return ''
  return String(val)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function extractCardAnswer(card: any): string {
  if (!card || typeof card !== 'object') return ''
  if (card.back) return normalizeCardValue(card.back)
  if (card.answer) return normalizeCardValue(card.answer)
  if (card.definition) return normalizeCardValue(card.definition)
  if (Array.isArray(card.notes)) return normalizeCardValue(card.notes.join('\n'))
  if (card.notes) return normalizeCardValue(card.notes)
  if (card.mc?.correct || card.mc_correct) return normalizeCardValue(card.mc?.correct || card.mc_correct)
  if (card.id?.answer || card.id_answer) return normalizeCardValue(card.id?.answer || card.id_answer)
  if (card.tf?.answer !== undefined || card.tf_answer !== undefined) {
    const raw = card.tf?.answer ?? card.tf_answer
    return raw === true || String(raw).toLowerCase() === 'true' ? 'true' : 'false'
  }
  if (card.enum_items) {
    return Array.isArray(card.enum_items) ? normalizeCardValue(card.enum_items.join(',')) : normalizeCardValue(card.enum_items)
  }
  if (card.code?.solution) return normalizeCardValue(card.code.solution)
  if (card.math?.problem || card.math?.answer) return normalizeCardValue((card.math.problem || '') + ' ' + (card.math.answer || ''))
  return ''
}

export function mergeDeckWithDetails(existing: string, incoming: string): MergeDeckDetails {
  try {
    const extractExisting = extractJsonString(existing) || existing
    const extractIncoming = extractJsonString(incoming) || incoming

    let prior: any = null
    let next: any = null

    try { prior = JSON.parse(extractExisting) } catch { prior = JSON.parse(repairJsonString(extractExisting)) }
    try { next = JSON.parse(extractIncoming) } catch { next = JSON.parse(repairJsonString(extractIncoming)) }

    const priorCards: any[] = Array.isArray(prior?.cards)
      ? prior.cards
      : Array.isArray(prior?.flashcards)
      ? prior.flashcards
      : Array.isArray(prior)
      ? prior
      : []

    const nextCards: any[] = Array.isArray(next?.cards)
      ? next.cards
      : Array.isArray(next?.flashcards)
      ? next.flashcards
      : Array.isArray(next)
      ? next
      : []

    // Build signatures of existing published cards to detect identical cards
    const existingFullSignatures = new Set<string>()
    const existingFrontTypeSignatures = new Set<string>()
    const existingFrontAnswerSignatures = new Set<string>()
    const existingFronts = new Set<string>()

    for (const card of priorCards) {
      if (!card || typeof card !== 'object') continue
      const front = normalizeCardValue(card.front || card.question || card.term || card.title || card.clue || card.keyword)
      if (!front) continue
      const type = normalizeCardValue(card.type || card.card_type || 'definition')
      const answer = extractCardAnswer(card)

      existingFronts.add(front)
      existingFullSignatures.add(`${type}:::${front}:::${answer}`)
      existingFrontTypeSignatures.add(`${type}:::${front}`)
      if (answer) {
        existingFrontAnswerSignatures.add(`${front}:::${answer}`)
      }
    }

    // Filter incoming cards: keep ONLY cards that are NEW and NOT identical to existing cards
    const newCards: any[] = []
    let identicalCardsCount = 0
    const seenIncoming = new Set<string>()

    for (const incomingCard of nextCards) {
      if (!incomingCard || typeof incomingCard !== 'object') continue
      const front = normalizeCardValue(incomingCard.front || incomingCard.question || incomingCard.term || incomingCard.title || incomingCard.clue || incomingCard.keyword)
      if (!front) continue // Skip invalid empty cards
      const type = normalizeCardValue(incomingCard.type || incomingCard.card_type || 'definition')
      const answer = extractCardAnswer(incomingCard)

      const fullSig = `${type}:::${front}:::${answer}`
      const frontTypeSig = `${type}:::${front}`
      const frontAnswerSig = `${front}:::${answer}`

      // Check if incoming card is identical to an existing card in the published deck
      const isIdentical =
        existingFullSignatures.has(fullSig) ||
        existingFrontAnswerSignatures.has(frontAnswerSig) ||
        (existingFrontTypeSignatures.has(frontTypeSig) && (!answer || !existingFullSignatures.size))

      if (isIdentical) {
        identicalCardsCount++
        continue
      }

      // Also deduplicate within incoming batch itself
      if (seenIncoming.has(fullSig) || seenIncoming.has(frontTypeSig)) {
        identicalCardsCount++
        continue
      }

      seenIncoming.add(fullSig)
      seenIncoming.add(frontTypeSig)
      newCards.push(incomingCard)
    }

    // Add cards ON TOP: new cards are placed at the top (beginning) of the deck
    const mergedCards = [...newCards, ...priorCards]

    const baseObj = typeof prior === 'object' && prior !== null && !Array.isArray(prior)
      ? prior
      : typeof next === 'object' && next !== null && !Array.isArray(next)
      ? next
      : {}

    const resultDeck = {
      ...baseObj,
      cards: mergedCards,
    }

    return {
      json: JSON.stringify(resultDeck),
      newCardsCount: newCards.length,
      identicalCardsCount,
      totalCardsCount: mergedCards.length,
    }
  } catch (err) {
    return {
      json: incoming,
      newCardsCount: 0,
      identicalCardsCount: 0,
      totalCardsCount: 0,
    }
  }
}

export function mergeDeckJson(existing: string, incoming: string): string {
  return mergeDeckWithDetails(existing, incoming).json
}

export function recoverTruncatedBuffer(text: string): string | null {
  const fragments: string[] = []
  const stack: number[] = []
  let inString = false
  let escape = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') { stack.push(i); continue }
    if (ch === '}') {
      if (stack.length === 0) continue
      const start = stack.pop() as number
      const candidate = text.slice(start, i + 1)
      if (/^\s*\{\s*"(?:type|front|question|term|title)"\s*:/i.test(candidate)) {
        fragments.push(candidate)
      }
    }
  }

  if (fragments.length === 0) return null
  return '{ "cards": [' + fragments.join(',') + '] }'
}

export function healJsonString(rawText: string): string {
  if (!rawText || !rawText.trim()) return ''
  const extracted = extractJsonString(rawText) || rawText.trim()
  try {
    JSON.parse(extracted)
    return extracted
  } catch {
    try {
      const repaired = repairJsonString(extracted)
      JSON.parse(repaired)
      return repaired
    } catch {
      try {
        const recovered = recoverTruncatedBuffer(rawText)
        if (recovered) {
          const repairedRecovered = repairJsonString(recovered)
          JSON.parse(repairedRecovered)
          return repairedRecovered
        }
      } catch {}
      const salvaged = extractLooseCardFragments(rawText)
      if (salvaged.length > 0) {
        return JSON.stringify({ cards: salvaged }, null, 2)
      }
    }
  }
  return extracted
}

const VALID_CARD_TYPES = new Set([
  'keyword',
  'definition',
  'multiple_choice',
  'true_false',
  'enumeration',
  'identification',
  'math',
  'code',
  'math_problem',
  'code_challenge',
  'quiz',
])

function isValidCardObject(item: unknown): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  const card = item as Record<string, unknown>

  // Check single-key wrapper like { "code.1": { ... } }
  const keys = Object.keys(card)
  if (keys.length === 1 && /^(code|codelab|math|mathlab|notes?|keyword|flashcards?|def|definition|enum|enumeration|id|identification|mc|multiple_choice|tf|true_false|images?|img)(?:[\.\s_#\/-]*\d+(?:\/\d+)?)?$/i.test(keys[0])) {
    return true
  }

  const front = card.front || card.question || card.term || card.title || card.clue || card.keyword || card.prompt || card.problem || card.topic || card.statement
  const hasFront = typeof front === 'string' && front.trim().length > 0
  const rawType = typeof (card.type || card.card_type || card.mode || card.heading) === 'string'
    ? String(card.type || card.card_type || card.mode || card.heading).toLowerCase().trim()
    : ''
  const baseType = rawType.replace(/[\.\s_#\/-]*\d+(?:\/\d+)?$/, '').trim()
  const hasType = VALID_CARD_TYPES.has(baseType) || /^(code|math|note|flashcard|def|enum|id|mc|tf|image|img)/i.test(baseType)
  const hasSubObjects = Boolean(
    card.mc || card.tf || card.id || card.enum_items || card.math || card.code || card.quiz || card.options ||
    card.script_html || card.syntax_formula || card.problem_breakdown || card.practice_problem || card.url || card.imageUrl || card.dataUrl
  )
  const hasBack = typeof (card.back || card.answer || card.definition || card.solution || card.explanation || card.caption) === 'string'

  if (hasFront && (hasBack || hasType || hasSubObjects)) return true
  if (hasType && (hasFront || hasBack || hasSubObjects)) return true
  if (hasSubObjects) return true
  if (hasFront) return true

  return false
}

/**
 * Strict check if the input text is a valid Flashcard / Study Deck JSON.
 * It strictly inspects the schema headings and patterns:
 * 1. Must parse as valid JSON (or have an extractable valid JSON object/array).
 * 2. Must contain the deck schema headings and card patterns:
 *    - An object with a "cards", "flashcards", or "deck" array property containing valid card objects.
 *    - OR an array of card objects directly, where each item has "type" (keyword, definition, math, code, etc.) and "front".
 *
 * Plain text, study notes, or markdown that contain (), {}, [], math equations, or code snippets
 * but do NOT follow this strict JSON deck structure will return FALSE and be sent to Gemini Cloud AI.
 */
export function isJsonInput(text: string): boolean {
  if (!text || typeof text !== 'string') return false
  const trimmed = text.trim()
  if (trimmed.length < 8) return false

  // Allow raw Question & Answer text lists (e.g. from the image) to be treated directly as valid deck inputs
  if (parseQATextToDeckJson(trimmed)) return true

  // Quick pre-check: must contain braces or brackets and quotes
  if (!trimmed.includes('{') && !trimmed.includes('[')) return false
  if (!trimmed.includes('"') && !trimmed.includes("'")) return false

  // Extract candidate JSON string (handles markdown code fences like ```json ... ``` and sentinels)
  const candidate = extractJsonString(trimmed)
  if (!candidate) return false

  let parsed: unknown = null
  try {
    parsed = JSON.parse(candidate)
  } catch {
    try {
      parsed = JSON.parse(repairJsonString(candidate))
    } catch {
      const recovered = recoverTruncatedBuffer(trimmed)
      if (recovered) {
        try {
          parsed = JSON.parse(repairJsonString(recovered))
        } catch {
          const loose = extractLooseCardFragments(trimmed)
          if (loose.length > 0) parsed = { cards: loose }
          else return false
        }
      } else {
        const loose = extractLooseCardFragments(trimmed)
        if (loose.length > 0) parsed = { cards: loose }
        else return false
      }
    }
  }

  if (!parsed || typeof parsed !== 'object') return false

  // Pattern 1: Single card object: { type: "code", front: "...", code: { ... } }
  if (!Array.isArray(parsed) && parsed !== null) {
    const obj = parsed as Record<string, unknown>

    if (isValidCardObject(obj)) {
      return true
    }

    const cardsArray = obj.cards || obj.flashcards || obj.quizItems || (obj.deck && (obj.deck as Record<string, unknown>).cards)
    if (Array.isArray(cardsArray)) {
      if (cardsArray.length === 0) {
        return Boolean(obj.chapter || obj.subject || obj.lesson || obj.title)
      }
      return cardsArray.some(isValidCardObject) || cardsArray.length > 0
    }

    if (Array.isArray(obj.images) && obj.images.length > 0) {
      return true
    }
    if (Array.isArray(obj.items) && (obj.items.some(isValidCardObject) || obj.items.length > 0)) {
      return true
    }
    if (Array.isArray(obj.questions) && obj.questions.length > 0) {
      return true
    }
    if (Boolean(obj.title || obj.subject || obj.chapter) && (Boolean(obj.notes) || Boolean(obj.summary))) {
      return true
    }
  }

  // Pattern 2: Array of cards directly: [ { type: "keyword", front: "..." }, ... ]
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return false
    return parsed.some(isValidCardObject)
  }

  return false
}
