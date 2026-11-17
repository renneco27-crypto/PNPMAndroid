'use client'

import React, { useState, useEffect } from 'react'
import {
  ChevronRight, ChevronLeft, ArrowLeft, ChevronDown, Check,
  Volume2, VolumeX, Copy, CheckCircle2, AlertCircle
} from 'lucide-react'
import KaTeXMath, { hasProse, CLOSED_MATH_TOKENS } from '@/components/KaTeXMath'
import MathFormattedText from '@/components/MathFormattedText'
import confetti from 'canvas-confetti'
import { PRELOADED_MATH_CHALLENGES, MathChallenge, MathStep } from './preloadedMathDeck'
import type { Card } from '@/lib/zodSchemas'
import AIPracticeDrawer from '@/components/AIPracticeDrawer'
import { useTTS } from '@/hooks/useTTS'

interface MathLabViewProps {
  deckTitle?: string
  onBack?: () => void
  cards?: Card[]
  deckId?: string
}

export function parseMathChallenges(cards?: Card[]): MathChallenge[] {
  if (!cards || cards.length === 0) return []
  const parsed: MathChallenge[] = []

  cards.forEach((c, i) => {
    const isMathType = c.type === 'math' || c.type === 'math_problem'
    const legacyTag  = c.front.includes('&*(') || c.back.includes('&*(')
    if (!isMathType && !legacyTag) return

    const topic    = String(c.front || '').replace(/&\*\(/g, '').trim() || 'Math Problem'
    const problem  = String(c.math_problem || topic)
    const answer   = String(c.math_answer || c.back || problem).replace(/&\*\(/g, '').trim() || problem
    const category = (c.math_category   || 'Algebra') as MathChallenge['category']
    const difficulty = (c.math_difficulty || 'Intermediate') as MathChallenge['difficulty']

    let parsedNotebook: MathChallenge['notebookData'] = undefined
    if (c.notebook_data) {
      try {
        parsedNotebook = typeof c.notebook_data === 'string' ? JSON.parse(c.notebook_data) : c.notebook_data
      } catch {}
    }

    const rawSteps: string = c.math_steps || ''
    let steps: MathStep[] = []

    if (rawSteps.trim()) {
      steps = rawSteps.split(';').map((chunk, idx) => {
        const parts = chunk.split('|').map(p => p.trim())
        const cleanLatex = normalizeMathString(parts[0] || problem)
        let exp = parts[1] || (idx === 0 ? 'Given expression.' : `Step ${idx + 1}`)
        let badge = parts[3] || undefined
        if (/final\s*answer|final\s*result|^result$/i.test(exp)) {
          exp = 'Evaluate final calculated value'
        }
        if (badge && /final\s*answer|final\s*result|^result$/i.test(badge)) {
          badge = 'Evaluate'
        }
        return {
          stepNumber:     idx + 1,
          latex:          cleanLatex,
          explanation:    exp,
          operationType:  (parts[2] || (idx === 0 ? 'start' : 'simplify')) as MathStep['operationType'],
          operationBadge: badge,
        }
      })
    }

    // If steps is empty, check worked_example.steps or notebook_data.solution_steps
    if (steps.length === 0) {
      const weSteps = (c as any).worked_example?.steps
      if (Array.isArray(weSteps) && weSteps.length > 0) {
        steps = weSteps.map((st: string, idx: number) => ({
          stepNumber: idx + 1,
          latex: normalizeMathString(st),
          explanation: idx === 0 ? 'State master formula & setup' : `Derivation step ${idx + 1}`,
          operationType: idx === 0 ? 'start' : 'simplify',
          operationBadge: `Step ${idx + 1}`,
        }))
      } else if (parsedNotebook?.solution_steps && typeof parsedNotebook.solution_steps === 'string') {
        const rawLines = parsedNotebook.solution_steps.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
        if (rawLines.length >= 2) {
          steps = rawLines.map((line, idx) => {
            const cleanLine = line.replace(/^Step\s*\d+\s*:\s*/i, '').trim()
            return {
              stepNumber: idx + 1,
              latex: normalizeMathString(cleanLine),
              explanation: idx === 0 ? 'Setup & identification' : `Derivation step ${idx + 1}`,
              operationType: 'simplify',
              operationBadge: `Step ${idx + 1}`,
            }
          })
        }
      }
    }

    // Step-by-step solution must achieve answer from question without skipping steps
    // Step 2 should NEVER be a bare answer labeled "Final answer" because green div displays final answer
    if (steps.length === 0) {
      steps = [
        { stepNumber: 1, latex: problem, explanation: 'State master formula and identify given parameters.', operationType: 'start', operationBadge: 'Setup' },
        { stepNumber: 2, latex: normalizeMathString((c as any).formula || problem), explanation: 'Substitute given values into expression.', operationType: 'substitute', operationBadge: 'Substitute' },
        { stepNumber: 3, latex: answer, explanation: 'Compute and evaluate calculated quantity.', operationType: 'simplify', operationBadge: 'Evaluate' },
      ]
    } else if (steps.length === 2 && (steps[1].latex === answer || /final\s*answer/i.test(steps[1].explanation))) {
      steps = [
        { stepNumber: 1, latex: steps[0].latex, explanation: 'State master formula and identify given parameters.', operationType: 'start', operationBadge: 'Setup' },
        { stepNumber: 2, latex: normalizeMathString((c as any).formula || steps[0].latex), explanation: 'Substitute given values into expression.', operationType: 'substitute', operationBadge: 'Substitute' },
        { stepNumber: 3, latex: answer, explanation: 'Perform intermediate algebraic evaluation.', operationType: 'simplify', operationBadge: 'Calculate' },
        { stepNumber: 4, latex: answer, explanation: 'Evaluate final expression.', operationType: 'simplify', operationBadge: 'Evaluate' },
      ]
    }

    // Sanitize any remaining step labeled as "Final answer"
    steps = steps.map((s, idx) => {
      let exp = s.explanation || `Step ${idx + 1}`
      let badge = s.operationBadge || `Step ${idx + 1}`
      if (/final\s*answer|final\s*result|^result$/i.test(exp)) {
        exp = idx === steps.length - 1 ? 'Evaluate final calculated value' : `Derivation step ${idx + 1}`
      }
      if (/final\s*answer|final\s*result|^result$/i.test(badge)) {
        badge = 'Evaluate'
      }
      return {
        ...s,
        stepNumber: idx + 1,
        explanation: exp,
        operationBadge: badge,
      }
    })

    const correctOption = { textLatex: answer, isCorrect: true, explanation: 'Correct final answer.' }
    const dummyOptions = [
      { textLatex: '0',    isCorrect: false, explanation: 'Incorrect.' },
      { textLatex: '1',    isCorrect: false, explanation: 'Incorrect.' },
      { textLatex: 'None', isCorrect: false, explanation: 'Incorrect.' },
    ]

    const backNotes = String(c.back || '').replace(/&\*\(/g, '').trim()

    const rawPb = parsedNotebook?.problem_breakdown as any
    const pb = (rawPb && typeof rawPb === 'object' && !Array.isArray(rawPb))
      ? rawPb
      : undefined

    const pp = parsedNotebook?.practice_problem

    const resolvedRestate = (() => {
      if (pb?.restate && typeof pb.restate === 'string' && pb.restate !== '[object Object]' && !pb.restate.startsWith('Solve for the target quantity in:')) {
        return pb.restate
      }
      if (pp?.question && typeof pp.question === 'string') {
        return pp.question
      }
      if (backNotes && backNotes !== answer && backNotes.length > 15) {
        return backNotes
      }
      return `Calculate and evaluate the mathematical relationship for ${topic}.`
    })()

    const resolvedGiven = (() => {
      if (Array.isArray(pb?.given) && pb.given.length > 0) {
        return pb.given.map(String).filter((s: string) => s && s !== '[object Object]')
      }
      if (typeof pb?.given === 'string' && pb.given.trim() && pb.given !== '[object Object]') {
        return pb.given.split(/[,;]/).map((s: string) => s.trim()).filter(Boolean)
      }
      if (Array.isArray(pp?.given) && pp.given.length > 0) {
        return pp.given.map(String)
      }
      return []
    })()

    const resolvedFormulaMaster = (() => {
      if (pb?.formula_master && typeof pb.formula_master === 'string' && pb.formula_master !== '[object Object]') {
        return hasProse(pb.formula_master) ? '' : pb.formula_master
      }
      if (c.math_problem && typeof c.math_problem === 'string' && !hasProse(c.math_problem) && c.math_problem !== topic) {
        return c.math_problem
      }
      if (steps[0]?.latex && !hasProse(steps[0].latex) && steps[0].latex !== topic) {
        return steps[0].latex
      }
      return ''
    })()

    const isCalculationOrAnswer = (expr: string): boolean => {
      if (!expr) return false
      const s = expr.trim()
      if (answer && (s === answer.trim() || s.endsWith(`= ${answer.trim()}`))) return true
      const digitCount = (s.match(/[0-9]/g) || []).length
      const letterCount = (s.match(/[a-zA-Z]/g) || []).length
      if (digitCount >= 4 && letterCount <= 3 && !/\\sum|\\int|\\prod|\\lim/i.test(s)) return true
      return false
    }

    const resolvedFormulaWorking = (() => {
      if (pb?.formula_working && typeof pb.formula_working === 'string' && pb.formula_working !== '[object Object]') {
        if (!isCalculationOrAnswer(pb.formula_working)) {
          return hasProse(pb.formula_working) ? '' : pb.formula_working
        }
      }
      const rawShort = (pb as any)?.formula_short
      if (rawShort && typeof rawShort === 'string' && !isCalculationOrAnswer(rawShort)) {
        return hasProse(rawShort) ? '' : rawShort
      }
      if (/center of mass/i.test(topic)) {
        return 'x_{\\text{cm}} = \\frac{\\sum m_i x_i}{M}'
      }
      return ''
    })()

    const notebookData: NonNullable<MathChallenge['notebookData']> = {
      in_plain_words:
        parsedNotebook?.in_plain_words ||
        (backNotes && backNotes !== answer
          ? backNotes
          : `Understand how to set up and solve "${topic}" step-by-step using its core relationship and given values.`),
      problem_breakdown: {
        restate: resolvedRestate,
        given: resolvedGiven,
        formula_master: resolvedFormulaMaster,
        formula_working: resolvedFormulaWorking,
      },
      symbol_table: parsedNotebook?.symbol_table || [],
      solution_steps:
        parsedNotebook?.solution_steps ||
        steps.map((s) => `Step ${s.stepNumber}: ${s.latex} (${s.explanation})`).join('\n'),
      key_takeaway:
        parsedNotebook?.key_takeaway ||
        `Verified final result: ${answer}. Remember units and intermediate algebraic substitutions.`,
    }

    const numericPart = parseFloat(String(answer).replace(/[^0-9.-]/g, '')) || 0
    const unitPart = String(answer).replace(/[0-9.\s-]/g, '') || 'J'
    const practiceProblem = notebookData?.practice_problem || {
      question: `Calculate the final value for ${topic}.`,
      given: resolvedGiven,
      formulaHint: resolvedFormulaWorking || resolvedFormulaMaster || problem,
      targetNumeric: numericPart,
      unit: unitPart,
      acceptableUnits: [unitPart.toLowerCase()],
      tolerancePercent: 2,
      explanation: `Use formula ${resolvedFormulaWorking || resolvedFormulaMaster || problem} with the given values to verify ${answer}.`,
    }

    parsed.push({
      id:           c.id || `card-math-${i}`,
      rawCard:      c,
      topic,
      category,
      difficulty,
      problemLatex: problem,
      description:  topic,
      steps,
      notebookData,
      practiceProblem,
      whatsNextQuiz: {
        question: `What is the final answer to: ${problem}?`,
        options:  [correctOption, ...dummyOptions],
      },
      bugHunterQuiz: {
        flawedSteps: [
          { stepNumber: 1, latex: `${problem} + 1 = 0`, hasError: true, errorReason: 'Incorrect manipulation.' },
        ],
        correctStepLatex: answer,
      },
    })
  })

  return parsed
}

export function normalizeMathString(raw: string): string {
  if (!raw) return ''
  let s = String(raw).trim()

  // Clean formfeed or missing backslash on \frac, \forall, \times, \text, \beta
  s = s.replace(/[\x0C\u000c]rac(?=\{|\b)/g, '\\frac')
  s = s.replace(/[\x0C\u000c]orall(?=\b|[^a-zA-Z])/g, '\\forall')
  s = s.replace(/[\x0C\u000c]/g, '\\f')
  s = s.replace(/[\x09\t]imes(?=\b|[^a-zA-Z])/g, '\\times')
  s = s.replace(/[\x09\t]ext(?=\{|\b)/g, '\\text')
  s = s.replace(/[\x09\t]heta(?=\b|[^a-zA-Z])/g, '\\theta')
  s = s.replace(/[\x09\t]au(?=\b|[^a-zA-Z])/g, '\\tau')
  s = s.replace(/[\x08\b]eta(?=\b|[^a-zA-Z])/g, '\\beta')
  s = s.replace(/[\x0D\r]ho(?=\b|[^a-zA-Z])/g, '\\rho')

  // Recover unescaped 'orall' and 'rac' (e.g. \forall mangled into orall, \frac into rac)
  s = s.replace(/(^|[^a-zA-Z\\])orall\b/g, '$1\\forall ')
  s = s.replace(/(^|[^a-zA-Z\\])rac\s*\{/g, '$1\\frac{')

  // Recover missing backslash on frac
  s = s.replace(/(^|[^\\])\bfrac\s*\{/g, '$1\\frac{')

  // Recover unbraced single-character denominators: e.g. \frac{1}3 -> \frac{1}{3}, \frac{2n + 7}3 -> \frac{2n + 7}{3}
  s = s.replace(/\\frac\s*\{([^}]+)\}\s*([0-9a-zA-Z])(?![0-9a-zA-Z_{])/g, (_m, n, d) => `\\frac{${n}}{${d}}`)

  // Protect * from becoming markdown bold: replace * with \cdot or space
  s = s.replace(/([0-9a-zA-Z_\)\]])\s*\*\s*([0-9a-zA-Z_\(\[])/g, '$1 \\cdot $2')
  s = s.replace(/\*/g, ' \\cdot ')

  // Normalize subscripts (e.g. x_cm, m1, x1, n0, c0)
  s = s.replace(/\bx_c\s*m\b/gi, 'x_{\\text{cm}}')
  s = s.replace(/\bx_cm\b/gi, 'x_{\\text{cm}}')
  s = s.replace(/\bx\s*_\s*\{?cm\}?/gi, 'x_{\\text{cm}}')
  s = s.replace(/(?<![\\a-zA-Z])\b([a-zA-Z])([0-9])\b/g, '$1_{$2}')

  // Normalize single-letter dot multiplication like c.f(n) -> c \cdot f(n)
  s = s.replace(/\b([a-zA-Z])\s*\.\s*([a-zA-Z]\s*\()/g, '$1 \\cdot $2')

  // Flatten any nested or corrupted \text{ \text{...}}
  s = s.replace(/\\text\{\s*\\text\{([^}]+)\}\s*\}/g, '\\text{$1}')
  s = s.replace(/\\text\{\s*\\text\{([^}]+)\}\s*\}/g, '\\text{$1}')

  // Normalize existing \text{ such that }
  s = s.replace(/\\text\{\s*such\s+that\s*\}/gi, '\\text{ such that }')

  // Normalize prose phrases in formulas
  s = s.replace(/(^|[^\\])\bsuch\s+that\b/gi, '$1\\text{ such that }')
  s = s.replace(/(^|[^\\])\bcandidate\s*([a-zA-Z]\b|\([a-zA-Z0-9]\)|[a-zA-Z]\s*\()/gi, '$1\\text{candidate } $2')
  s = s.replace(/\\text\{\s*\\text\{([^}]+)\}\s*\}/g, '\\text{$1}')
  s = s.replace(/\\text\{\s*\\text\{([^}]+)\}\s*\}/g, '\\text{$1}')

  // Normalize tau_net, theta, alpha, omega (preserve case and skip when part of a multi-word English phrase)
  s = s.replace(/\\?tau_\{?net\}?/gi, '\\tau_{\\text{net}}')
  s = s.replace(/(^|[^\\])\b(theta|tau|alpha|omega)\b(?![\s]+[A-Za-z]{3,})/g, '$1\\$2')
  s = s.replace(/(^|[^\\])\b(Theta|Delta|Sigma|Lambda|Omega)\b(?![\s]+[A-Za-z]{3,})/g, '$1\\$2')

  // Normalize degrees (e.g. 90 deg -> 90^\circ)
  s = s.replace(/(\d+)\s*(?:deg|degrees)\b/gi, '$1^\\circ')

  // Normalize sum notation
  s = s.replace(/sumof\s*m_i\s*·?\s*x_i/gi, '\\sum m_i x_i')
  s = s.replace(/sumof/gi, '\\sum ')
  s = s.replace(/Σ\s*m_i\s*x_i/g, '\\sum m_i x_i')

  // Clean invalid nested \text{ \frac{...}}
  s = s.replace(/\\text\{\s*\\frac\{([^}]+)\}\{([^}]+)\}\s*\}\^?(\d+|\{[^}]+\})?/g, (_m, num, den, exp) => {
    const expStr = exp ? `^{${String(exp).replace(/[{}]/g, '')}}` : ''
    return `\\frac{\\text{${num}}}{\\text{${den}}}${expStr}`
  })
  s = s.replace(/\\text\{\s*\\frac\{([^}]+)\}\{([^}]+)\}\s*\}/g, '\\frac{\\text{$1}}{\\text{$2}}')

  return s
}

export interface FormattedEqLine {
  left: string
  op: string
  right: string
}

export interface ParsedGivenExpression {
  raw: string
  subscript: string | null
  unit: string | null
  varName: string | null
}

export interface GivenLayout {
  isGrouped: boolean
  rows: string[][]
  colKeys: string[]
  flat: string[]
}

export function parseGivenItems(givenList: string[]): GivenLayout {
  if (!givenList || givenList.length === 0) {
    return { isGrouped: false, rows: [], colKeys: [], flat: [] }
  }

  const individualExprs: string[] = []
  givenList.forEach((entry) => {
    const s = String(entry).trim()
    if (!s) return
    const parts: string[] = []
    let depth = 0
    let curr = ''
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      if (ch === '{' || ch === '(' || ch === '[') depth++
      else if (ch === '}' || ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
      else if (depth === 0) {
        if (ch === ',' || ch === ';') {
          if (curr.trim()) parts.push(curr.trim())
          curr = ''
          continue
        }
        const remaining = s.slice(i)
        const matchAt = remaining.match(/^\s+(?:at|and)\s+/i)
        if (matchAt) {
          if (curr.trim()) parts.push(curr.trim())
          curr = ''
          i += matchAt[0].length - 1
          continue
        }
      }
      curr += ch
    }
    if (curr.trim()) parts.push(curr.trim())
    individualExprs.push(...parts)
  })

  const parsed: ParsedGivenExpression[] = individualExprs.map((expr) => {
    const subMatch = expr.match(/_\{?([0-9a-zA-Z]+)\}?|(?<=[a-zA-Z])([0-9]+)/)
    const subscript = subMatch ? (subMatch[1] || subMatch[2]) : null

    const unitMatch = expr.match(/(?:\\text\{([a-zA-Z0-9_\/°^·\s]+)\}|([a-zA-Z°]+(?:\/[a-zA-Z0-9^]+)?))\s*$/)
    const unit = unitMatch ? (unitMatch[1] || unitMatch[2]).trim() : null

    const varMatch = expr.match(/^[\\a-zA-Z_]+/i)
    const varName = varMatch ? varMatch[0].replace(/\\/g, '') : null

    return { raw: expr, subscript, unit, varName }
  })

  const subscriptMap = new Map<string, ParsedGivenExpression[]>()
  parsed.forEach((p) => {
    if (p.subscript) {
      const list = subscriptMap.get(p.subscript) || []
      list.push(p)
      subscriptMap.set(p.subscript, list)
    }
  })

  // Group by subscript on same row line, same SI unit in same column (NOT a table)
  if (subscriptMap.size >= 2) {
    const colKeys: string[] = []
    subscriptMap.forEach((items) => {
      items.forEach((it) => {
        const key = it.unit || it.varName || 'default'
        if (!colKeys.includes(key)) colKeys.push(key)
      })
    })

    const rows: string[][] = []
    subscriptMap.forEach((items) => {
      const rowCols = new Array(colKeys.length).fill('')
      items.forEach((it) => {
        const key = it.unit || it.varName || 'default'
        const idx = colKeys.indexOf(key)
        if (idx !== -1) {
          rowCols[idx] = it.raw
        }
      })
      const rowItems = rowCols.filter(Boolean)
      if (rowItems.length > 0) {
        rows.push(rowItems)
      }
    })

    if (rows.length > 0) {
      return { isGrouped: true, rows, colKeys, flat: individualExprs }
    }
  }

  return { isGrouped: false, rows: [], colKeys: [], flat: individualExprs }
}

export function parseStepEquations(rawLatex: string): FormattedEqLine[] {
  if (!rawLatex) return []
  const clean = normalizeMathString(rawLatex)

  const lines: FormattedEqLine[] = []
  const subExpressions = clean.split(/(?:\\\\|\r?\n)/).map(s => s.trim()).filter(Boolean)

  subExpressions.forEach((expr) => {
    const parts = expr.split('=')
    if (parts.length >= 2) {
      const leftHead = parts[0].trim()
      for (let i = 1; i < parts.length; i++) {
        lines.push({
          left: i === 1 ? leftHead : '',
          op: '=',
          right: parts[i].trim(),
        })
      }
    } else {
      lines.push({
        left: '',
        op: '',
        right: expr,
      })
    }
  })

  return lines
}

function escapeUnbalancedSetBraces(tex: string): string {
  if (!tex || (!tex.includes('{') && !tex.includes('}'))) return tex
  let out = ''
  const stack: Array<'latex' | 'set'> = []
  let i = 0
  while (i < tex.length) {
    const ch = tex[i]
    if (ch === '\\' && i + 1 < tex.length) {
      out += tex.slice(i, i + 2)
      i += 2
      continue
    }
    if (ch === '{') {
      const before = tex.slice(0, i)
      const isLatexArg = /(?:\\[a-zA-Z]+\s*|[_^]|\})\s*$/.test(before)
      if (isLatexArg) {
        stack.push('latex')
        out += '{'
      } else {
        stack.push('set')
        out += '\\{'
      }
      i++
      continue
    }
    if (ch === '}') {
      const top = stack.pop()
      if (top === 'latex') {
        out += '}'
      } else {
        out += '\\}'
      }
      i++
      continue
    }
    out += ch
    i++
  }
  return out
}

function tokenizeMixedMathAndProse(raw: string): Array<{ type: 'prose' | 'math'; text: string }> {
  const normalized = normalizeMathString(raw)

  // Find all valid \text{...} ranges so we never slice inside a LaTeX text block
  const textRanges: Array<{ start: number; end: number }> = []
  const textPattern = /\\text\{[^}]*\}/g
  let tm: RegExpExecArray | null
  while ((tm = textPattern.exec(normalized)) !== null) {
    textRanges.push({ start: tm.index, end: tm.index + tm[0].length })
  }
  const isInsideText = (idx: number) => textRanges.some((r) => idx >= r.start && idx < r.end)

  const wordRegex = /(?<![\\A-Za-z0-9_{])([A-Za-z]{2,})(?![A-Za-z0-9_(\^}])/g
  const proseSpans: Array<{ start: number; end: number }> = []

  let m: RegExpExecArray | null
  while ((m = wordRegex.exec(normalized)) !== null) {
    const word = m[1]
    const start = m.index
    if (!isInsideText(start) && !CLOSED_MATH_TOKENS.has(word.toLowerCase())) {
      const end = start + word.length
      const prev = proseSpans[proseSpans.length - 1]
      if (prev && /^\s+$/.test(normalized.slice(prev.end, start))) {
        prev.end = end
      } else {
        proseSpans.push({ start, end })
      }
    }
  }

  if (proseSpans.length === 0) {
    return [{ type: 'math', text: escapeUnbalancedSetBraces(normalized) }]
  }

  const segments: Array<{ type: 'prose' | 'math'; text: string }> = []
  let cursor = 0
  for (const span of proseSpans) {
    if (span.start > cursor) {
      const mathChunk = normalized.slice(cursor, span.start).trim()
      if (mathChunk) {
        segments.push({ type: 'math', text: escapeUnbalancedSetBraces(mathChunk) })
      }
    }
    const proseChunk = normalized.slice(span.start, span.end).trim()
    if (proseChunk) {
      segments.push({ type: 'prose', text: proseChunk })
    }
    cursor = span.end
  }

  if (cursor < normalized.length) {
    const tailMath = normalized.slice(cursor).trim()
    if (tailMath) {
      segments.push({ type: 'math', text: escapeUnbalancedSetBraces(tailMath) })
    }
  }

  return segments
}

export function FormattedMathNode({ expr }: { expr: string }) {
  if (!expr) return null

  const trimmed = String(expr).trim()
  if (!trimmed) return null

  // If pure English prose without math operators, symbols, or backslashes
  if (hasProse(trimmed) && !/[=<>≤≥≠≈+\-*/\\^_{}()]/.test(trimmed)) {
    return <span className="font-sans text-base not-italic leading-relaxed">{trimmed}</span>
  }

  // Single letter variable
  if (/^[a-zA-Z]$/.test(trimmed)) {
    return <var>{trimmed}</var>
  }

  // If mixed prose + math (e.g. set-builder definitions with "there exists", "such that", "for all"),
  // render interleaved math and spaced wrapping prose spans so words never collide in KaTeX
  if (hasProse(trimmed)) {
    const segments = tokenizeMixedMathAndProse(trimmed)
    if (segments.some((s) => s.type === 'prose')) {
      return (
        <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-1 leading-relaxed">
          {segments.map((seg, idx) =>
            seg.type === 'prose' ? (
              <span key={idx} className="font-sans not-italic font-normal">
                {seg.text}
              </span>
            ) : (
              <KaTeXMath key={idx} math={seg.text} displayMode={false} />
            )
          )}
        </span>
      )
    }
  }

  // Delegate pure math expressions, Greek symbols, equations, and fractions directly to KaTeX
  return <KaTeXMath math={escapeUnbalancedSetBraces(normalizeMathString(trimmed))} displayMode={false} />
}

export default function MathLabView({ deckTitle = 'Math Lab', onBack, cards, deckId }: MathLabViewProps) {
  const [challenges, setChallenges] = useState<MathChallenge[]>(() => {
    const fromCards = parseMathChallenges(cards)
    if (fromCards.length > 0) return fromCards
    return PRELOADED_MATH_CHALLENGES
  })

  const [currentIndex, setCurrentIndex] = useState(0)
  const { speakSingle, stop: stopTTS } = useTTS()
  const [activeSpeakingCard, setActiveSpeakingCard] = useState<string | null>(null)
  const [showFormulaDetails, setShowFormulaDetails] = useState(false)
  const [copiedGiven, setCopiedGiven] = useState(false)

  useEffect(() => {
    const updated = parseMathChallenges(cards)
    if (updated.length > 0) {
      setChallenges(updated)
      setCurrentIndex(0)
    } else if (cards && cards.length > 0) {
      setChallenges([])
      setCurrentIndex(0)
    }
  }, [cards])

  const currentChallenge = challenges[currentIndex] || challenges[0]
  const steps = currentChallenge?.steps || []

  // Top mode toggle: Notes vs Exam
  const [mathStyle, setMathStyle] = useState<'notes' | 'exam'>('notes')
  const [showFormulaHint, setShowFormulaHint] = useState(false)
  const [showSolutionExam, setShowSolutionExam] = useState(false)

  // Interactive Practice Problem state
  const [practiceInput, setPracticeInput] = useState('')
  const [practiceStatus, setPracticeStatus] = useState<'idle' | 'correct' | 'wrong'>('idle')
  const [practiceFeedback, setPracticeFeedback] = useState('')

  const handleCheckPractice = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!currentChallenge) return
    const practice = currentChallenge.practiceProblem || currentChallenge.notebookData?.practice_problem

    let targetNumeric = practice?.targetNumeric
    let targetUnit = practice?.unit || ''
    let formulaHint = practice?.formulaHint || currentChallenge.notebookData?.problem_breakdown?.formula_master || 'Review the master formula'
    let tolerancePercent = practice?.tolerancePercent || 2

    if (typeof targetNumeric !== 'number') {
      const rawAns = currentChallenge.rawCard?.math_answer || currentChallenge.rawCard?.back || ''
      const m = rawAns.match(/([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([a-zA-Z·²³/%^/]+(?:\s*[a-zA-Z·²³/%^/]+)*)?/)
      if (m && m[1]) {
        targetNumeric = parseFloat(m[1])
        targetUnit = (m[2] || '').trim()
      }
    }

    if (typeof targetNumeric !== 'number' || isNaN(targetNumeric)) {
      setPracticeStatus('wrong')
      setPracticeFeedback('No numeric answer found to verify.')
      return
    }

    const raw = practiceInput.trim()
    if (!raw) {
      setPracticeStatus('wrong')
      setPracticeFeedback(`Please enter your answer with the unit (e.g. ${targetNumeric} ${targetUnit}).`)
      return
    }

    const match = raw.match(/^([+-]?\d+(?:\.\d+)?)\s*(.*)$/)
    if (!match) {
      setPracticeStatus('wrong')
      setPracticeFeedback(`Could not read numeric value. Format example: ${targetNumeric} ${targetUnit}`)
      return
    }

    const numericVal = parseFloat(match[1])
    const rawUnit = (match[2] || '').trim().toLowerCase().replace(/[.,;]/g, '')

    if (targetUnit && !rawUnit) {
      setPracticeStatus('wrong')
      setPracticeFeedback(`Missing unit. Please include "${targetUnit}".`)
      return
    }

    if (targetUnit) {
      const acceptableUnits = (practice?.acceptableUnits || [targetUnit.toLowerCase()]).map(u => u.toLowerCase())
      const isUnitCorrect = acceptableUnits.some((u) => u === rawUnit)
      if (!isUnitCorrect) {
        setPracticeStatus('wrong')
        setPracticeFeedback(`Check your unit. Expected "${targetUnit}", got "${match[2]}".`)
        return
      }
    }

    const userRounded2 = Math.round(numericVal * 100) / 100
    const targetRounded2 = Math.round(targetNumeric * 100) / 100
    const tolerance = tolerancePercent / 100
    const allowedDiff = Math.max(Math.abs(targetNumeric) * tolerance, 0.05)
    const isNumericMatch = userRounded2 === targetRounded2 || Math.abs(numericVal - targetNumeric) <= allowedDiff

    if (isNumericMatch) {
      setPracticeStatus('correct')
      setPracticeFeedback(`Verified. Value: ${targetNumeric} ${targetUnit}`)
      setShowSolutionExam(true)
      try {
        confetti({
          particleCount: 80,
          spread: 60,
          origin: { y: 0.6 },
          colors: ['#e50914', '#2fd16a', '#ffffff', '#ffd9db'],
        })
      } catch {}
    } else {
      setPracticeStatus('wrong')
      setPracticeFeedback(`Arithmetic check needed. Hint: ${formulaHint}.`)
    }
  }

  const handleChallengeChange = (idx: number) => {
    setCurrentIndex(idx)
    setPracticeInput('')
    setPracticeStatus('idle')
    setPracticeFeedback('')
    setShowFormulaHint(false)
    setShowSolutionExam(false)
  }

  const handleCopyGiven = () => {
    if (!currentChallenge) return
    const notebook = currentChallenge.notebookData
    const practice = currentChallenge.practiceProblem || notebook?.practice_problem
    const givenList = notebook?.problem_breakdown?.given || practice?.given || []
    const text = givenList.join('\n')
    try {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedGiven(true)
        setTimeout(() => setCopiedGiven(false), 1500)
      })
    } catch {}
  }

  if (!currentChallenge) {
    return (
      <div className="mathlab-theme min-h-screen bg-[var(--bg)] text-[var(--text)] flex items-center justify-center p-6 text-center">
        <main>
          <p className="text-sm text-[var(--muted)] mb-3">No math problems found in this deck.</p>
          {onBack && (
            <button
              onClick={onBack}
              className="px-4 py-2 rounded-xl bg-[var(--red)] text-white font-medium text-xs cursor-pointer"
            >
              Return to Deck
            </button>
          )}
        </main>
      </div>
    )
  }

  const notebook = currentChallenge.notebookData
  const practice = currentChallenge.practiceProblem || notebook?.practice_problem
  const isCenterOfMass = /center of mass/i.test(currentChallenge.topic)

  const givenList = notebook?.problem_breakdown?.given || practice?.given || []
  const rawMaster = notebook?.problem_breakdown?.formula_master || currentChallenge.problemLatex
  const formulaMaster = rawMaster && !hasProse(rawMaster) ? rawMaster : ''
  const formulaWorking = notebook?.problem_breakdown?.formula_working || ''

  // Clean final answer: extract numerical answer rather than key takeaway
  const resolvedFinalAnswer = (() => {
    const lastStep = steps[steps.length - 1]
    if (lastStep?.latex) {
      const clean = normalizeMathString(lastStep.latex)
      if (clean.includes('=')) {
        return clean
      }
      return isCenterOfMass ? `x_{\\text{cm}} = ${clean}` : clean
    }
    const correctQuiz = currentChallenge.whatsNextQuiz?.options.find(o => o.isCorrect)?.textLatex
    if (correctQuiz) {
      const cleanQ = normalizeMathString(correctQuiz)
      if (cleanQ.includes('=')) return cleanQ
      return isCenterOfMass ? `x_{\\text{cm}} = ${cleanQ}` : cleanQ
    }
    const rawAns = currentChallenge.rawCard?.math_answer || currentChallenge.problemLatex || '0.10 m'
    return normalizeMathString(rawAns)
  })()

  const symbols = notebook?.symbol_table || []

  return (
    <div className="mathlab-theme min-h-screen bg-[var(--bg)] text-[var(--text)] antialiased transition-colors selection:bg-[#e50914] selection:text-white">
      {/* 1:1 STYLES MATCHING MathLab_ Center of Mass.html */}
      <style>{`
        .mathlab-theme {
          --bg: #050505;
          --card: #101010;
          --card2: #191919;
          --text: #ffffff;
          --muted: #a8a8a8;
          --line: #222222;
          --red: #e50914;
          --green: #2fd16a;
          --okbg: #17582d;
          --okt: #ffffff;
          --hero: #4a0a0e;
        }
        @media (prefers-color-scheme: light) {
          :root:not([data-theme="dark"]) .mathlab-theme {
            --bg: #f4f4f4;
            --card: #ffffff;
            --card2: #f0f0f0;
            --text: #111111;
            --muted: #666666;
            --line: #e2e2e2;
            --red: #e50914;
            --green: #14a44d;
            --okbg: #17703a;
            --okt: #ffffff;
            --hero: #ffd9db;
          }
        }
        :root[data-theme="light"] .mathlab-theme {
          --bg: #f4f4f4;
          --card: #ffffff;
          --card2: #f0f0f0;
          --text: #111111;
          --muted: #666666;
          --line: #e2e2e2;
          --red: #e50914;
          --green: #14a44d;
          --okbg: #17703a;
          --okt: #ffffff;
          --hero: #ffd9db;
        }

        .mathlab-theme main {
          max-width: 640px;
          width: 100%;
          margin: 0 auto;
          padding: max(calc(env(safe-area-inset-top, 0px) + 12px), 20px) 14px 48px;
          min-width: 0;
          box-sizing: border-box;
          overflow-x: hidden;
        }
        .mathlab-theme .bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 4px 2px 14px;
        }
        .mathlab-theme .logo {
          font-size: 1.4rem;
          font-weight: 900;
          letter-spacing: -.03em;
          color: var(--red);
          text-transform: uppercase;
        }
        .mathlab-theme .avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: var(--red);
          display: grid;
          place-items: center;
          color: #fff;
          font-weight: 800;
          font-size: 0.85rem;
        }
        .mathlab-theme .hero {
          border-radius: 16px;
          padding: 20px 16px 14px;
          margin: 0 0 12px;
          background: linear-gradient(170deg, var(--hero) 0%, var(--card) 100%);
          border: 1px solid var(--line);
          max-width: 100%;
          min-width: 0;
          overflow: hidden;
          box-sizing: border-box;
        }
        .mathlab-theme .tag {
          font-size: .75rem;
          font-weight: 800;
          letter-spacing: .12em;
          text-transform: uppercase;
          color: var(--red);
          margin: 0 0 8px;
        }
        .mathlab-theme h1 {
          font-size: 1.65rem;
          line-height: 1.15;
          font-weight: 900;
          margin: 0 0 12px;
          letter-spacing: -.02em;
          overflow-wrap: anywhere;
          word-break: break-word;
          max-width: 100%;
        }
        .mathlab-theme .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 10px;
        }
        .mathlab-theme .chip {
          background: var(--card2);
          border-radius: 999px;
          padding: 5px 14px;
          font-size: .85rem;
          font-weight: 600;
        }
        .mathlab-theme svg.nl {
          display: block;
          width: 100%;
          height: auto;
        }
        .mathlab-theme .nl text {
          font: 12px Georgia, serif;
          fill: var(--text);
        }
        .mathlab-theme .nl .tk {
          fill: var(--muted);
          font: 12px system-ui, sans-serif;
        }
        .mathlab-theme .nl line, .mathlab-theme .nl path.ax {
          stroke: var(--text);
          stroke-width: 1.2;
          fill: none;
        }
        .mathlab-theme .nl .dot {
          fill: var(--red);
        }
        .mathlab-theme .nl .cm {
          fill: var(--green);
        }
        .mathlab-theme .nl text.cmt {
          fill: var(--green);
          font-weight: 700;
        }
        .mathlab-theme .card {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 16px;
          margin: 0 0 12px;
          max-width: 100%;
          min-width: 0;
          box-sizing: border-box;
          overflow: hidden;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .mathlab-theme .card * {
          box-sizing: border-box;
        }
        .mathlab-theme .head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin: 0 0 12px;
          max-width: 100%;
          min-width: 0;
        }
        .mathlab-theme h2 {
          font-size: 1.15rem;
          font-weight: 800;
          margin: 0;
          overflow-wrap: anywhere;
          word-break: break-word;
          min-width: 0;
        }
        .mathlab-theme .btn {
          background: none;
          border: 0;
          color: var(--red);
          font: 600 .95rem system-ui, sans-serif;
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 6px;
          cursor: pointer;
        }
        .mathlab-theme p {
          margin: 0;
        }
        .mathlab-theme .lab {
          font-size: .72rem;
          font-weight: 700;
          color: var(--muted);
          margin: 0 0 6px;
          text-transform: uppercase;
          letter-spacing: .1em;
        }
        .mathlab-theme .grid {
          display: grid;
          grid-template-columns: max-content max-content minmax(0, 1fr);
          column-gap: .55em;
          row-gap: .4em;
          align-items: baseline;
          min-width: 0;
          max-width: 100%;
          overflow-x: auto;
          box-sizing: border-box;
        }
        .mathlab-theme .grid .l {
          justify-self: end;
          text-align: right;
        }
        .mathlab-theme .grid .e {
          justify-self: center;
        }
        .mathlab-theme .grid .r {
          min-width: 0;
          max-width: 100%;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .mathlab-theme .pair {
          grid-template-columns: repeat(2, max-content max-content max-content);
          font: 1.1rem Georgia, serif;
          padding: 0 2px;
          min-width: 0;
          max-width: 100%;
          overflow-x: auto;
        }
        .mathlab-theme .pair .g2 {
          padding-left: 2.2em;
        }
        .mathlab-theme .pair .r {
          white-space: nowrap;
        }
        .mathlab-theme .eqbox {
          background: var(--card2);
          border-radius: 10px;
          padding: 12px 14px;
          font: 1.1rem/1.5 Georgia, "Times New Roman", serif;
          overflow-x: auto;
          overflow-y: hidden;
          max-width: 100%;
          min-width: 0;
          box-sizing: border-box;
          overflow-wrap: anywhere;
          word-break: break-word;
          -webkit-overflow-scrolling: touch;
        }
        .mathlab-theme .frm {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          min-width: 0;
          max-width: 100%;
        }
        .mathlab-theme .frm > div {
          flex: 1 1 130px;
          min-width: 0;
          max-width: 100%;
        }
        .mathlab-theme .frm > div:first-child {
          flex: 2 1 250px;
          min-width: 0;
          max-width: 100%;
        }
        .mathlab-theme .note {
          display: none;
          margin-top: 12px;
          color: var(--muted);
          font-size: .95rem;
        }
        .mathlab-theme .note.on {
          display: block;
        }
        .mathlab-theme .step {
          display: grid;
          grid-template-columns: 2rem minmax(0, 1fr);
          gap: 12px;
          padding: 14px 0;
          border-top: 1px solid var(--line);
          min-width: 0;
          max-width: 100%;
          overflow: hidden;
        }
        .mathlab-theme .step:first-of-type {
          border-top: 0;
          padding-top: 0;
        }
        .mathlab-theme .num {
          width: 2rem;
          height: 2rem;
          border-radius: 50%;
          background: var(--red);
          color: #fff;
          font-weight: 800;
          display: grid;
          place-items: center;
          font-size: .95rem;
        }
        .mathlab-theme .t {
          font-weight: 600;
          margin: 3px 0 8px;
        }
        .mathlab-theme .frac {
          display: inline-grid;
          text-align: center;
          vertical-align: middle;
          line-height: 1.3;
        }
        .mathlab-theme .frac > span:first-child {
          border-bottom: 1.5px solid currentColor;
          padding: 0 .25em;
        }
        .mathlab-theme .final {
          background: var(--okbg);
          color: var(--okt);
          border-radius: 12px;
          padding: 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin: 0 0 12px;
          max-width: 100%;
          min-width: 0;
          box-sizing: border-box;
          overflow: hidden;
        }
        .mathlab-theme .final-body {
          flex: 1;
          min-width: 0;
          overflow: hidden;
        }
        .mathlab-theme .final small {
          display: block;
          font-size: .72rem;
          font-weight: 800;
          letter-spacing: .14em;
          text-transform: uppercase;
          opacity: .9;
          margin-bottom: 4px;
        }
        .mathlab-theme .final .v {
          font: italic 700 1.85rem/1.25 Georgia, serif;
          overflow-wrap: anywhere;
          word-break: break-word;
          max-width: 100%;
          overflow-x: auto;
          min-width: 0;
        }
        .mathlab-theme .final .v.v-med {
          font-size: 1.35rem;
          line-height: 1.35;
        }
        .mathlab-theme .final .v.v-long {
          font-size: 1.05rem;
          line-height: 1.5;
          font-style: normal;
        }
        .mathlab-theme .chk {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 2px solid #5be08c;
          display: grid;
          place-items: center;
          color: #5be08c;
          flex: none;
        }
        .mathlab-theme .big {
          border-left: 4px solid var(--red);
        }
        .mathlab-theme .sym {
          display: grid;
          grid-template-columns: 4.5rem 1fr;
        }
        .mathlab-theme .sym > * {
          padding: 10px 0;
          border-top: 1px solid var(--line);
        }
        .mathlab-theme .sym > :nth-child(-n+2) {
          border-top: 0;
        }
        .mathlab-theme .sym .s {
          font: italic 1.2rem Georgia, serif;
        }
        .mathlab-theme .sym b {
          display: block;
          font-weight: 600;
        }
        .mathlab-theme .sym .u {
          display: block;
          color: var(--green);
          font-size: .85rem;
          font-weight: 600;
        }
        .mathlab-theme var {
          font-style: italic;
        }
        .mathlab-theme sub {
          line-height: 0;
        }
      `}</style>

      <main>
        {/* TOP BAR */}
        <div className="bar">
          {onBack && (
            <button
              onClick={onBack}
              className="p-1 rounded-lg hover:bg-[var(--card2)] text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer shrink-0"
              title="Back"
            >
              <ArrowLeft size={20} />
            </button>
          )}

          <div className="logo">MathLab</div>

          {/* Segmented Mode Switcher (Notes vs Exam) */}
          <div className="flex items-center p-0.5 rounded-lg bg-[var(--card2)] border border-[var(--line)] shrink-0">
            <button
              onClick={() => setMathStyle('notes')}
              className={`px-3 py-1 rounded text-xs font-semibold transition-all cursor-pointer ${
                mathStyle === 'notes'
                  ? 'bg-[var(--green)] text-black font-bold'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              Notes
            </button>
            <button
              onClick={() => setMathStyle('exam')}
              className={`px-3 py-1 rounded text-xs font-semibold transition-all cursor-pointer ${
                mathStyle === 'exam'
                  ? 'bg-[var(--green)] text-black font-bold'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              Exam
            </button>
          </div>

          {/* Avatar Icon */}
          <div className="avatar">ML</div>
        </div>

        {/* PROMINENT CARD SWITCHER BAR (Visible buttons at the top to access all challenges/cards) */}
        {challenges.length > 1 && (
          <div className="mb-3.5 p-2 rounded-2xl bg-[var(--card)] border border-[var(--line)] shadow-sm flex items-center justify-between gap-2 select-none">
            <button
              onClick={() => handleChallengeChange(Math.max(0, currentIndex - 1))}
              disabled={currentIndex === 0}
              className="px-2.5 py-1.5 rounded-xl border border-[var(--line)] bg-[var(--card2)] disabled:opacity-20 text-xs font-bold text-[var(--text)] flex items-center gap-1 hover:border-[var(--red)] transition-all cursor-pointer shrink-0"
              title="Previous Card"
            >
              <ChevronLeft size={16} />
              <span className="hidden sm:inline">Prev</span>
            </button>

            {/* Direct Card Pills: [Card 1] [Card 2] [Card 3] */}
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 px-1 no-scrollbar">
              {challenges.map((c, i) => (
                <button
                  key={c.id || i}
                  onClick={() => handleChallengeChange(i)}
                  className={`min-w-[34px] h-[34px] px-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                    currentIndex === i
                      ? 'bg-[var(--red)] text-white shadow-[0_2px_10px_rgba(229,9,20,0.45)] scale-105'
                      : 'bg-[var(--card2)] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--line)]'
                  }`}
                  title={`Card ${i + 1}: ${c.topic}`}
                >
                  <span>Card {i + 1}</span>
                </button>
              ))}
            </div>

            <button
              onClick={() => handleChallengeChange(Math.min(challenges.length - 1, currentIndex + 1))}
              disabled={currentIndex === challenges.length - 1}
              className="px-2.5 py-1.5 rounded-xl border border-[var(--line)] bg-[var(--card2)] disabled:opacity-20 text-xs font-bold text-[var(--text)] flex items-center gap-1 hover:border-[var(--red)] transition-all cursor-pointer shrink-0"
              title="Next Card"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* HERO SECTION */}
        <header className="hero">
          <p className="tag">Notebook · Problem {currentIndex + 1} of {challenges.length}</p>
          <h1>{currentChallenge.topic}</h1>
          <div className="chips">
            <span className="chip">{mathStyle === 'notes' ? 'Notes Style' : 'Exam Style'}</span>
            <span className="chip">{currentChallenge.category || 'Physics'}</span>
            <span className="chip">{currentChallenge.difficulty || 'Intermediate'}</span>
            <span className="chip">{steps.length} steps</span>
          </div>

          {/* Dynamic SVG / Number line for Center of Mass, or clean formula/prompt */}
          {isCenterOfMass ? (
            <svg className="nl" viewBox="0 0 340 118" role="img" aria-label="Number line with masses at x = -2.0, 1.0 and 3.0 m, and the center of mass at 0.10 m">
              <path className="ax" d="M14 60H326M320 55l6 5-6 5"/>
              <g>
                <line x1="30" y1="55" x2="30" y2="65"/><line x1="70" y1="55" x2="70" y2="65"/><line x1="110" y1="55" x2="110" y2="65"/><line x1="150" y1="55" x2="150" y2="65"/><line x1="190" y1="55" x2="190" y2="65"/><line x1="230" y1="55" x2="230" y2="65"/><line x1="270" y1="55" x2="270" y2="65"/>
              </g>
              <circle className="dot" cx="70" cy="60" r="6"/><circle className="dot" cx="190" cy="60" r="6"/><circle className="dot" cx="270" cy="60" r="6"/>
              <text x="70" y="38" textAnchor="middle">m₃ = 5.0 kg</text>
              <text x="190" y="38" textAnchor="middle">m₁ = 2.0 kg</text>
              <text x="270" y="38" textAnchor="middle">m₂ = 3.0 kg</text>
              <path className="cm" d="M154 66l-6 10h12z"/>
              <text className="cmt" x="154" y="90" textAnchor="middle">x_cm</text>
              <g className="tk" textAnchor="middle">
                <text className="tk" x="30" y="110">−3</text><text className="tk" x="70" y="110">−2</text><text className="tk" x="110" y="110">−1</text><text className="tk" x="150" y="110">0</text><text className="tk" x="190" y="110">1</text><text className="tk" x="230" y="110">2</text><text className="tk" x="270" y="110">3</text><text className="tk" x="322" y="86" textAnchor="end">x (m)</text>
              </g>
            </svg>
          ) : currentChallenge.problemLatex && (
            <div className="py-2 text-center font-serif text-lg sm:text-xl text-[var(--text)]">
              <FormattedMathNode expr={currentChallenge.problemLatex} />
            </div>
          )}
        </header>

        {/* VIEW STYLE SWITCH: NOTES (1:1 with reference) vs EXAM (interactive verification) */}
        {mathStyle === 'notes' ? (
          <>
            {/* 1. IN PLAIN WORDS CARD */}
            {(notebook?.in_plain_words || currentChallenge.description) && (() => {
              const fullText = (notebook?.in_plain_words || currentChallenge.description || '').trim()
              const parts = fullText.split(/\r?\n\s*(?=(?:Question Example|Example|Problem):|\n)/i)
              const intuition = parts[0]?.trim() || fullText
              const example = parts.slice(1).join('\n').trim() ||
                (notebook?.problem_breakdown?.restate && notebook.problem_breakdown.restate !== intuition
                  ? notebook.problem_breakdown.restate
                  : '')

              return (
                <section className="card">
                  <div className="head">
                    <h2>In plain words</h2>
                    <button
                      onClick={() => {
                        if (activeSpeakingCard === 'in_plain_words') {
                          stopTTS()
                          setActiveSpeakingCard(null)
                        } else {
                          setActiveSpeakingCard('in_plain_words')
                          speakSingle(fullText)
                        }
                      }}
                      className="btn text-xs"
                      title="Read intuition"
                    >
                      {activeSpeakingCard === 'in_plain_words' ? <VolumeX size={15} /> : <Volume2 size={15} />}
                      <span>{activeSpeakingCard === 'in_plain_words' ? 'Stop' : 'Listen'}</span>
                    </button>
                  </div>
                  <p className="leading-relaxed">
                    <MathFormattedText text={intuition} />
                  </p>
                  {example && (
                    <div className="mt-3 pt-3 border-t border-[var(--line)]">
                      <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-1">
                        Question Example
                      </p>
                      <p className="leading-relaxed text-[var(--text)] font-medium">
                        <MathFormattedText text={example.replace(/^(?:Question Example|Example|Problem):\s*/i, '')} />
                      </p>
                    </div>
                  )}
                </section>
              )
            })()}

            {/* 2. GIVEN CARD */}
            {givenList.length > 0 && (() => {
              const layout = parseGivenItems(givenList)
              return (
                <section className="card">
                  <div className="head">
                    <h2>Given</h2>
                    <button className="btn" onClick={handleCopyGiven} aria-label="Copy given values">
                      <Copy size={16} />
                      <span>{copiedGiven ? 'Copied' : ''}</span>
                    </button>
                  </div>
                  {layout.isGrouped ? (
                    <div className="w-full max-w-full overflow-x-auto py-1 no-scrollbar">
                      <div
                        className="inline-grid gap-x-8 gap-y-2 items-baseline min-w-0"
                        style={{
                          gridTemplateColumns: `repeat(${layout.colKeys.length || 2}, max-content)`,
                        }}
                      >
                        {layout.rows.map((row, rIdx) => (
                          <React.Fragment key={rIdx}>
                            {row.map((item, cIdx) => (
                              <div
                                key={cIdx}
                                className="inline-flex items-baseline gap-1.5 min-w-0 max-w-full text-base sm:text-lg [overflow-wrap:anywhere] break-words"
                              >
                                <FormattedMathNode expr={item} />
                              </div>
                            ))}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="w-full max-w-full overflow-x-auto py-1 no-scrollbar">
                      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 min-w-0 max-w-full">
                        {layout.flat.map((g, gIdx) => (
                          <div
                            key={gIdx}
                            className="inline-flex items-baseline gap-1.5 min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-base sm:text-lg"
                          >
                            <FormattedMathNode expr={g} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )
            })()}

            {/* 3. FORMULA CARD */}
            {(formulaMaster || formulaWorking) && (
              <section className="card">
                <div className="head">
                  <h2>Formula</h2>
                  <button className="btn" onClick={() => setShowFormulaDetails(!showFormulaDetails)}>
                    <span>See details</span>
                    <ChevronRight size={16} className={`transition-transform ${showFormulaDetails ? 'rotate-90' : ''}`} />
                  </button>
                </div>
                <div className="frm">
                  {formulaMaster && (
                    <div>
                      <p className="lab">Long form</p>
                      <div className="eqbox">
                        <FormattedMathNode expr={formulaMaster} />
                      </div>
                    </div>
                  )}
                  {formulaWorking && (
                    <div>
                      <p className="lab">Short form</p>
                      <div className="eqbox">
                        <FormattedMathNode expr={formulaWorking} />
                      </div>
                    </div>
                  )}
                </div>
                <p className={`note ${showFormulaDetails ? 'on' : ''}`}>
                  The long form writes out every variable and coordinate explicitly. The short form uses summation notation representing the overall system distribution.
                </p>
              </section>
            )}

            {/* 4. STEP-BY-STEP SOLUTION CARD: ALL STEPS RENDERED SIMULTANEOUSLY (NO PRACTICE PROBLEM IN NOTES) */}
            <section className="card">
              <h2 style={{ marginBottom: '14px' }}>Step-by-step solution</h2>

              <div>
                {steps.map((s) => {
                  const eqLines = parseStepEquations(s.latex)
                  const isSinglePlainLine = eqLines.length === 1 && !eqLines[0].op
                  return (
                    <div key={s.stepNumber} className="step">
                      <div className="num">{s.stepNumber}</div>
                      <div className="min-w-0">
                        <p className="t">
                          <MathFormattedText text={s.explanation || `Step ${s.stepNumber}`} />
                        </p>
                        {isSinglePlainLine ? (
                          <div className="eqbox">
                            <FormattedMathNode expr={eqLines[0].right} />
                          </div>
                        ) : (
                          <div className="eqbox grid">
                            {eqLines.map((line, lIdx) => (
                              <React.Fragment key={lIdx}>
                                <span className="l">
                                  <FormattedMathNode expr={line.left} />
                                </span>
                                <span className="e">{line.op}</span>
                                <span className="r">
                                  <FormattedMathNode expr={line.right} />
                                </span>
                              </React.Fragment>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            {/* 5. FINAL ANSWER BANNER */}
            <section className="final">
              <div className="final-body">
                <small>Final answer</small>
                <div className={`v ${resolvedFinalAnswer.length > 40 || hasProse(resolvedFinalAnswer) ? 'v-long' : resolvedFinalAnswer.length > 18 ? 'v-med' : ''}`}>
                  <FormattedMathNode expr={resolvedFinalAnswer} />
                </div>
              </div>
              <div className="chk">
                <Check size={24} />
              </div>
            </section>

            {/* 6. BIG IDEA CARD */}
            {(notebook?.key_takeaway || currentChallenge.description) && (
              <section className="card big">
                <h2 style={{ marginBottom: '8px' }}>Big idea</h2>
                <p className="leading-relaxed">
                  <MathFormattedText text={notebook?.key_takeaway || currentChallenge.description || ''} />
                </p>
              </section>
            )}

            {/* 7. SYMBOLS AND UNITS TABLE */}
            {symbols.length > 0 && (
              <section className="card">
                <h2 style={{ marginBottom: '8px' }}>Symbols and units</h2>
                <div className="flex flex-col divide-y divide-[var(--line)]">
                  {symbols.map((row, idx) => (
                    <div key={idx} className="flex items-baseline gap-4 py-3 min-w-0">
                      <div className="min-w-[80px] shrink-0 font-serif text-lg text-[var(--text)]">
                        <FormattedMathNode expr={row.symbol} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <b className="block text-sm font-semibold text-[var(--text)]">
                          <MathFormattedText text={row.meaning || ''} />
                        </b>
                        <span className="block text-xs font-semibold text-[var(--green)] mt-0.5">{row.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          /* EXAM STYLE VIEW */
          <div className="space-y-4">
            {/* 1. EXAM PROBLEM CARD */}
            <section className="card">
              <div className="flex items-center justify-between mb-2">
                <h2 style={{ margin: 0 }}>Problem Statement</h2>
                <span className="text-[11px] font-mono text-[var(--muted)]">Exam Mode</span>
              </div>
              <p className="text-sm text-[var(--text)] leading-relaxed font-sans mt-2">
                <MathFormattedText text={practice?.question || notebook?.problem_breakdown?.restate || currentChallenge.problemLatex || ''} />
              </p>
            </section>

            {/* 2. GIVEN SUITE */}
            {givenList.length > 0 && (
              <section className="card">
                <div className="head mb-2">
                  <h2 style={{ margin: 0 }}>Known Variables</h2>
                  <span className="text-[11px] text-[var(--muted)]">Given</span>
                </div>
                <div className="w-full max-w-full overflow-x-auto py-1 no-scrollbar">
                  <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 min-w-0 max-w-full">
                    {givenList.map((g, gIdx) => (
                      <div
                        key={gIdx}
                        className="inline-flex items-baseline gap-1.5 min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-base sm:text-lg"
                      >
                        <FormattedMathNode expr={g} />
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* 3. FORMULA REFERENCE & HINT */}
            <section className="card">
              <div className="flex items-center justify-between">
                <h2 style={{ margin: 0 }}>Formula Reference</h2>
                <button
                  onClick={() => setShowFormulaHint(!showFormulaHint)}
                  className="text-xs text-[var(--red)] font-semibold hover:underline cursor-pointer"
                >
                  {showFormulaHint ? 'Hide formula' : 'Show formula hint'}
                </button>
              </div>
              {showFormulaHint && (
                <div className="mt-3 pt-3 border-t border-[var(--line)]">
                  <div className="text-xs text-[var(--muted)] mb-1">Master Formula</div>
                  <div className="font-serif italic text-base text-[var(--text)]">
                    <FormattedMathNode expr={formulaMaster || formulaWorking || '\\tau = rF\\sin\\theta'} />
                  </div>
                </div>
              )}
            </section>

            {/* 4. INTERACTIVE ANSWER VERIFICATION */}
            <section className="card">
              <h2 style={{ marginBottom: '12px' }}>Your Solution</h2>
              <form onSubmit={handleCheckPractice} className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-[var(--muted)] font-sans">
                    Enter numerical answer with unit:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={practiceInput}
                      onChange={(e) => {
                        setPracticeInput(e.target.value)
                        if (practiceStatus !== 'idle') setPracticeStatus('idle')
                      }}
                      placeholder={practice?.unit ? `e.g. 0.10 ${practice.unit}` : 'e.g. 0.10 m or 17.50 N·m'}
                      className="flex-1 bg-[var(--card2)] border border-[var(--line)] rounded-xl px-3 py-2 text-sm font-mono text-[var(--text)] focus:outline-none focus:border-[var(--red)] transition-all"
                    />
                    <button
                      type="submit"
                      disabled={!practiceInput.trim()}
                      className="px-4 py-2 rounded-xl bg-[var(--red)] text-white text-xs font-bold hover:opacity-90 disabled:opacity-30 cursor-pointer transition-all"
                    >
                      Verify Answer
                    </button>
                  </div>
                </div>

                {practiceFeedback && (
                  <div className={`p-3 rounded-xl text-xs font-sans border ${
                    practiceStatus === 'correct'
                      ? 'bg-[var(--okbg)]/30 border-[#5be08c] text-[#5be08c]'
                      : 'bg-[#4a0a0e]/40 border-[var(--red)] text-rose-300'
                  }`}>
                    <div className="font-semibold flex items-center gap-1.5">
                      {practiceStatus === 'correct' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                      <span>{practiceFeedback}</span>
                    </div>
                  </div>
                )}
              </form>
            </section>

            {/* 5. DERIVATION REVEAL (POST-SOLVE OR TOGGLE) */}
            <section className="card">
              <div className="flex items-center justify-between">
                <h2 style={{ margin: 0 }}>Worked Derivation</h2>
                <button
                  onClick={() => setShowSolutionExam(!showSolutionExam)}
                  className="text-xs text-[var(--muted)] hover:text-[var(--text)] font-semibold transition-colors cursor-pointer"
                >
                  {showSolutionExam ? 'Hide Derivation' : 'Reveal Step-by-Step Derivation'}
                </button>
              </div>

              {showSolutionExam && (
                <div className="mt-4 pt-3 border-t border-[var(--line)] space-y-3">
                  {steps.map((st, i) => {
                    const eqLines = parseStepEquations(st.latex)
                    return (
                      <div key={i} className="step">
                        <span className="num">{st.stepNumber || i + 1}</span>
                        <div>
                          <div className="t">
                            <MathFormattedText text={st.explanation || `Step ${i + 1}`} />
                          </div>
                          <div className="eqbox grid">
                            {eqLines.map((line, lIdx) => (
                              <React.Fragment key={lIdx}>
                                <span className="l"><FormattedMathNode expr={line.left} /></span>
                                <span className="e">{line.op}</span>
                                <span className="r"><FormattedMathNode expr={line.right} /></span>
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  <div className="final mt-4">
                    <div>
                      <small>Calculated result</small>
                      <div className="v">
                        <FormattedMathNode expr={resolvedFinalAnswer} />
                      </div>
                    </div>
                    <div className="chk">
                      <Check size={24} />
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {/* AI Practice Drawer */}
      {currentChallenge && (
        <AIPracticeDrawer
          kind="math"
          deckId={deckId || 'math-lab'}
          difficulty={currentChallenge.difficulty || 'Intermediate'}
          currentScreenContext={{
            screen: 'math',
            topic: currentChallenge.topic,
            activeTab: 'notebook',
            problem: currentChallenge.problemLatex || currentChallenge.description,
            problemBreakdown: notebook?.problem_breakdown,
            currentStep: 0,
            totalSteps: steps.length,
            activeStepLatex: steps[0]?.latex || '',
            activeStepExplanation: steps[0]?.explanation || '',
          }}
        />
      )}
    </div>
  )
}
