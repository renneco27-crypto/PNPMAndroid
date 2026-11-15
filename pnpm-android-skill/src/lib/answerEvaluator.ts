// Pure TypeScript fuzzy answer matching — works client-side AND server-side.
// No network, no external deps. Imported by both the server action and the
// client flashcard / enumeration hooks so answer evaluation works offline.

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were',
  'have', 'has', 'had', 'not', 'but', 'you', 'all', 'any', 'can', 'her', 'his',
  'its', 'our', 'out', 'who', 'what', 'when', 'where', 'which', 'why', 'how',
  'into', 'onto', 'upon', 'over', 'under', 'between', 'through', 'during',
  'before', 'after', 'above', 'below', 'about', 'against', 'among', 'around',
  'because', 'been', 'being', 'both', 'each', 'more', 'most', 'other', 'some',
  'such', 'than', 'too', 'very', 'will', 'just', 'should', 'now', 'also',
  'used', 'using', 'make', 'makes', 'made', 'type', 'types', 'form', 'forms',
  'part', 'parts', 'does', 'did', 'done', 'their', 'there', 'they', 'them',
  'then', 'these', 'those', 'your', 'would', 'could',
])

function stripFormattingAndBullets(s: string): string {
  return s
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*(?:\d+[.)]|[(]?\d+[)]|[a-zA-Z][.)]|[-•*])\s+/, '')
    .trim()
}

export function normalizeAnswer(s: string): string {
  return stripFormattingAndBullets(s)
    .toLowerCase()
    .replace(/[;,]+\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(dp[j], dp[j - 1], prev)
      prev = temp
    }
  }
  return dp[b.length]
}

function fuzzRatio(a: string, b: string): number {
  const la = a.length
  const lb = b.length
  if (la === 0 && lb === 0) return 100
  if (la === 0 || lb === 0) return 0
  const dist = levenshtein(a, b)
  return (100 * (la + lb - dist)) / (la + lb)
}

function tokenSetRatio(a: string, b: string): number {
  const ta = [...new Set(a.split(' ').filter(Boolean))].sort()
  const tb = [...new Set(b.split(' ').filter(Boolean))].sort()
  if (ta.length === 0 && tb.length === 0) return 100
  if (ta.length === 0 || tb.length === 0) return 0

  // Meaningful subset check: ignore trivial stop-word-only overlaps
  const meaningfulA = ta.filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
  const meaningfulB = tb.filter((w) => w.length >= 3 && !STOP_WORDS.has(w))

  // Subset match requires at least 70% word coverage to prevent premature approval on a single word
  if (meaningfulA.length > 0 && meaningfulA.every((t) => tb.includes(t))) {
    if (meaningfulA.length / Math.max(1, meaningfulB.length) >= 0.7) return 100
  }
  if (meaningfulB.length > 0 && meaningfulB.every((t) => ta.includes(t))) {
    if (meaningfulB.length / Math.max(1, meaningfulA.length) >= 0.7) return 100
  }

  return fuzzRatio(ta.join(' '), tb.join(' '))
}

/**
 * Evaluates how well `userAnswer` matches `correctAnswer`.
 * Returns a ratio 0–100. A ratio >= 70 is considered correct.
 * Runs purely client-side — no network needed.
 */
export function evaluateAnswerLocal(userAnswer: string, correctAnswer: string): { ratio: number } {
  try {
    const ua = normalizeAnswer(userAnswer)
    if (!ua) return { ratio: 0 }

    // Also include the head term before ':' or ' - ' or '(' as a valid variant
    const rawVariants = correctAnswer.split(/[;\n]/)
    const expandedVariants: string[] = []
    for (const rv of rawVariants) {
      const cleaned = stripFormattingAndBullets(rv)
      if (!cleaned) continue
      expandedVariants.push(cleaned)
      const headMatch = cleaned.split(/\s*(?::|–|—|-|\()\s*/)[0]?.trim()
      if (headMatch && headMatch.length >= 2 && headMatch !== cleaned) {
        expandedVariants.push(headMatch)
      }
    }

    const variants = expandedVariants.map(normalizeAnswer).filter(Boolean)
    if (!variants.length) return { ratio: 0 }

    let best = 0
    for (const v of variants) {
      if (ua === v) return { ratio: 100 }
      best = Math.max(best, fuzzRatio(ua, v), tokenSetRatio(ua, v))
    }
    return { ratio: best }
  } catch {
    return { ratio: 0 }
  }
}

/**
 * Evaluates whether a single user answer matches an enumeration item,
 * returning both a boolean `matched` and a numeric confidence `score` (0-100).
 */
export function evaluateEnumerationItem(
  userRaw: string,
  expectedRaw: string
): { matched: boolean; score: number } {
  const userNorm = normalizeAnswer(userRaw)
  const expectedNorm = normalizeAnswer(expectedRaw)
  if (!userNorm || !expectedNorm) return { matched: false, score: 0 }

  // 1. Exact match after normalization
  if (userNorm === expectedNorm) {
    return { matched: true, score: 100 }
  }

  // 2. Check head term before colon/dash/parenthesis (e.g. "1. Mitosis: cell division" -> "mitosis")
  const cleanedExpected = stripFormattingAndBullets(expectedRaw)
  const headPart = cleanedExpected.split(/\s*(?::|–|—|-|\()\s*/)[0]?.trim() || ''
  const headNorm = normalizeAnswer(headPart)
  if (headNorm && userNorm === headNorm) {
    return { matched: true, score: 98 }
  }

  // 3. Fuzzy / token evaluation
  const { ratio } = evaluateAnswerLocal(userRaw, expectedRaw)
  if (ratio >= 70) {
    return { matched: true, score: ratio }
  }

  // 4. Meaningful keyword / phrase match (must NOT be a stopword)
  const userWords = userNorm.split(' ').filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
  const expectedWords = expectedNorm.split(' ').filter((w) => w.length >= 3 && !STOP_WORDS.has(w))

  if (userWords.length > 0 && expectedWords.length > 0) {
    // Check if every meaningful word the user typed matches a meaningful word in expected (exact or >=80% fuzzy)
    const matchedWordCount = userWords.filter((uw) =>
      expectedWords.some((ew) => uw === ew || (uw.length >= 4 && ew.length >= 4 && fuzzRatio(uw, ew) >= 80))
    ).length

    if (matchedWordCount > 0 && matchedWordCount === userWords.length) {
      return { matched: true, score: 75 + Math.min(20, matchedWordCount * 5) }
    }

    // Or if all expected meaningful words appear inside the user's spoken sentence
    const allExpectedInUser = expectedWords.every((ew) =>
      userWords.some((uw) => uw === ew || (uw.length >= 4 && ew.length >= 4 && fuzzRatio(uw, ew) >= 80))
    )
    if (allExpectedInUser) {
      return { matched: true, score: 85 }
    }
  }

  return { matched: false, score: ratio }
}

export interface EnumerationSlotResult {
  index: number
  userAnswer: string
  correct: boolean
  /** The actual full item from the card that this answer matched (or the missing item if wrong) */
  expected: string
}

export function isEnumerationOrdered(topic?: string): boolean {
  if (!topic) return false
  const t = topic.toLowerCase()
  // "from ... to" or directional / sequential keywords (e.g. "OSI layers from layer 7 down to layer 1")
  if (/\bfrom\b[\s\S]*?\bto\b/i.test(t)) return true
  if (/\b(?:in\s+order|chronological|step-by-step|sequence|ascending|descending|top[\s-]down|bottom[\s-]up)\b/i.test(t)) return true
  return false
}

/**
 * Matches an array of user answers against the enumeration items.
 * If topic has order-indicative keywords ("from ... to ...", "in order", etc.),
 * slots are evaluated strictly in sequence without interchangeability.
 * Otherwise, items are matched in any order using highest-confidence pairing.
 */
export function evaluateEnumerationSet(
  userAnswers: string[],
  items: string[],
  topic?: string
): {
  results: EnumerationSlotResult[]
  correctCount: number
  wrongCount: number
  totalCount: number
} {
  const totalCount = items.length

  // If topic indicates strict ordering, answers must be in the exact order (1:1 slot matching)
  if (isEnumerationOrdered(topic)) {
    let correctCount = 0
    const results: EnumerationSlotResult[] = items.map((expected, i) => {
      const userAnswer = (userAnswers[i] ?? '').trim()
      const evalRes = evaluateEnumerationItem(userAnswer, expected)
      const correct = evalRes.matched
      if (correct) correctCount++
      return {
        index: i,
        userAnswer,
        correct,
        expected,
      }
    })
    return {
      results,
      correctCount,
      wrongCount: Math.max(0, totalCount - correctCount),
      totalCount,
    }
  }

  const usedExpected = new Array(totalCount).fill(false)
  const slotMatchedExpected: (string | null)[] = new Array(totalCount).fill(null)

  // Build all candidate (slotIndex, expectedIndex, score) pairs that qualify as a match
  const candidates: Array<{ slotIdx: number; expIdx: number; score: number }> = []
  for (let i = 0; i < totalCount; i++) {
    const ua = (userAnswers[i] ?? '').trim()
    if (!ua) continue
    for (let j = 0; j < totalCount; j++) {
      const evalRes = evaluateEnumerationItem(ua, items[j])
      if (evalRes.matched) {
        // Slight tie-breaker bonus if slot index == expected index
        const score = evalRes.score + (i === j ? 0.5 : 0)
        candidates.push({ slotIdx: i, expIdx: j, score })
      }
    }
  }

  // Sort highest score first so exact matches always win over fuzzy matches
  candidates.sort((a, b) => b.score - a.score)

  const slotAssigned = new Array(totalCount).fill(false)
  for (const cand of candidates) {
    if (slotAssigned[cand.slotIdx] || usedExpected[cand.expIdx]) continue
    slotAssigned[cand.slotIdx] = true
    usedExpected[cand.expIdx] = true
    slotMatchedExpected[cand.slotIdx] = items[cand.expIdx]
  }

  // Collect remaining unmatched expected items in order to show as "Correct: ..." on wrong slots
  const missingExpected = items.filter((_, idx) => !usedExpected[idx])

  let correctCount = 0
  const results: EnumerationSlotResult[] = items.map((_, i) => {
    const userAnswer = (userAnswers[i] ?? '').trim()
    const matchedExp = slotMatchedExpected[i]
    const correct = matchedExp !== null
    if (correct) correctCount++
    const expected = matchedExp !== null ? matchedExp : (missingExpected.shift() ?? items[i] ?? '')
    return {
      index: i,
      userAnswer,
      correct,
      expected,
    }
  })

  return {
    results,
    correctCount,
    wrongCount: Math.max(0, totalCount - correctCount),
    totalCount,
  }
}
