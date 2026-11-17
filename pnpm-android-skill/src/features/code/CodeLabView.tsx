'use client'

import React, { useState, useEffect, useRef } from 'react'
import {
  ArrowLeft, RotateCcw, Play, CheckCircle2, XCircle,
  FileCode, Bug, Terminal, ChevronDown, Check,
  BookOpen, Code2, Eye, Table, Sparkles, Copy, Maximize2, Minimize2,
  ChevronLeft, ChevronRight, AlertCircle, Loader2, Volume2, VolumeX
} from 'lucide-react'
import confetti from 'canvas-confetti'
import {
  PRELOADED_CODING_CHALLENGES,
  UnifiedCodeChallenge,
} from './preloadedCodingDeck'
import type { Card } from '@/lib/zodSchemas'
import AIPracticeDrawer from '@/components/AIPracticeDrawer'
import { useScrolledTopSpacing } from '@/hooks/useScrolledTopSpacing'
import MathFormattedText from '@/components/MathFormattedText'
import { useTTS } from '@/hooks/useTTS'

type CodeMode = 'scenario' | 'bug_hunter' | 'practice'
type ViewTab = 'ide' | 'notebook'

interface CodeLabViewProps {
  deckTitle?: string
  onBack?: () => void
  cards?: Card[]
  deckId?: string
}

function splitTopLevelStatements(body: string): string[] {
  const result: string[] = []
  let current = ''
  let depthParen = 0
  let depthBracket = 0
  let depthBrace = 0
  let inSingle = false
  let inDouble = false
  let inBacktick = false

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    const prev = i > 0 ? body[i - 1] : ''

    if (ch === "'" && !inDouble && !inBacktick && prev !== '\\') inSingle = !inSingle
    else if (ch === '"' && !inSingle && !inBacktick && prev !== '\\') inDouble = !inDouble
    else if (ch === '`' && !inSingle && !inDouble && prev !== '\\') inBacktick = !inBacktick

    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === '(') depthParen++
      else if (ch === ')') depthParen = Math.max(0, depthParen - 1)
      else if (ch === '[') depthBracket++
      else if (ch === ']') depthBracket = Math.max(0, depthBracket - 1)
      else if (ch === '{') depthBrace++
      else if (ch === '}') depthBrace = Math.max(0, depthBrace - 1)
    }

    current += ch

    if (!inSingle && !inDouble && !inBacktick && depthParen === 0 && depthBracket === 0 && depthBrace === 0 && ch === ';') {
      if (current.trim()) result.push(current.trim())
      current = ''
    }
  }

  if (current.trim()) result.push(current.trim())
  return result
}

export interface BlockCommentDelimiter {
  start: RegExp
  end: RegExp
}

export const BLOCK_COMMENT_DELIMITERS: BlockCommentDelimiter[] = [
  { start: /^\/\*/, end: /\*\// },
  { start: /^<!--/, end: /-->/ },
  { start: /^\{-/, end: /-\}/ },
  { start: /^\(\*/, end: /\*\)/ },
  { start: /^<#/, end: /#>/ },
  { start: /^--\[\[/, end: /\]\]/ },
  { start: /^%\{/, end: /%\}/ },
  { start: /^=begin\b/, end: /^=end\b/ },
  { start: /^"""/, end: /"""/ },
  { start: /^'''/, end: /'''/ },
]

export function isSingleLineComment(trimmed: string): boolean {
  if (trimmed.startsWith('//')) return true
  if (trimmed.startsWith('--')) return true
  if (trimmed.startsWith('%')) return true
  if (trimmed.startsWith(';')) return true
  if (trimmed.startsWith("'")) return true
  if (/^rem\b/i.test(trimmed)) return true
  if (trimmed.startsWith('::')) return true
  if (trimmed.startsWith('#')) {
    // Exclude C/C++ preprocessor directives
    if (/^#(?:include|define|undef|if|ifdef|ifndef|else|elif|endif|pragma|error|warning)\b/i.test(trimmed)) {
      return false
    }
    return true
  }
  return false
}

/**
 * Ensures across 20+ programming languages that when a line is a comment in a laboratory script,
 * an empty line (blank line space) is placed after the comment before the following code.
 */
export function formatCommentSpacing(code: string): string {
  if (!code) return ''
  const lines = code.split('\n')
  const result: string[] = []

  let inBlock: BlockCommentDelimiter | null = null

  interface LineInfo {
    raw: string
    trimmed: string
    isComment: boolean
    isCommentEnd: boolean
    isEmpty: boolean
  }

  const lineInfos: LineInfo[] = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()

    if (inBlock) {
      const ends = inBlock.end.test(trimmed)
      lineInfos.push({ raw, trimmed, isComment: true, isCommentEnd: ends, isEmpty: false })
      if (ends) inBlock = null
      continue
    }

    if (!trimmed) {
      lineInfos.push({ raw, trimmed, isComment: false, isCommentEnd: false, isEmpty: true })
      continue
    }

    // Check block comment start
    let matchedBlock: BlockCommentDelimiter | null = null
    for (const b of BLOCK_COMMENT_DELIMITERS) {
      if (b.start.test(trimmed)) {
        matchedBlock = b
        break
      }
    }

    if (matchedBlock) {
      let endsOnSameLine = false
      if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
        endsOnSameLine = trimmed.length >= 6 && trimmed.slice(3).includes(trimmed.slice(0, 3))
      } else {
        endsOnSameLine = matchedBlock.end.test(trimmed.slice(2))
      }

      if (endsOnSameLine) {
        lineInfos.push({ raw, trimmed, isComment: true, isCommentEnd: true, isEmpty: false })
      } else {
        inBlock = matchedBlock
        lineInfos.push({ raw, trimmed, isComment: true, isCommentEnd: false, isEmpty: false })
      }
      continue
    }

    if (isSingleLineComment(trimmed)) {
      lineInfos.push({ raw, trimmed, isComment: true, isCommentEnd: true, isEmpty: false })
      continue
    }

    lineInfos.push({ raw, trimmed, isComment: false, isCommentEnd: false, isEmpty: false })
  }

  // Pass 2: reconstruct with line space after comment
  for (let i = 0; i < lineInfos.length; i++) {
    const cur = lineInfos[i]
    result.push(cur.raw)

    if (cur.isCommentEnd) {
      // Look ahead to find the next non-empty line
      let nextIdx = i + 1
      while (nextIdx < lineInfos.length && lineInfos[nextIdx].isEmpty) {
        nextIdx++
      }

      if (nextIdx < lineInfos.length) {
        const next = lineInfos[nextIdx]
        // If next non-empty line is code (not another comment line), ensure there is an empty line
        if (!next.isComment) {
          // If the next immediate line is not already empty, insert an empty line
          if (i + 1 >= lineInfos.length || !lineInfos[i + 1].isEmpty) {
            result.push('')
          }
        }
      }
    }
  }

  return result.join('\n')
}

export function formatCodeSnippet(raw: string): string {
  if (!raw) return ''
  let text = raw.replace(/\r\n/g, '\n').trim()

  const hasSingleLineHtml = /<\/?(?:!DOCTYPE|html|head|body|script)\b[^>]*>\s*<\/?(?:html|head|body|script|title)\b/i.test(text)
  const hasSingleLineFunc = /^\s*(?:public|private|protected|static|async\s+function|function)\s+\w+\s*\([^)]*\)\s*\{.+\}\s*$/m.test(text)

  if (!hasSingleLineHtml && !hasSingleLineFunc) {
    return formatCommentSpacing(text)
  }

  // 1. Expand concatenated HTML structural tags onto separate lines
  for (let pass = 0; pass < 3; pass++) {
    text = text
      .replace(/(<!DOCTYPE[^>]*>)\s*(?=<)/gi, '$1\n')
      .replace(/(<\/?(?:html|head|body|script)[^>]*>)\s*(?=<)/gi, '$1\n')
      .replace(/(<\/title>)\s*(?=<\/head>)/gi, '$1\n')
      .replace(/(<script[^>]*>)\s*(?!\n)/gi, '$1\n')
      .replace(/([^\n])\s*(<\/script>)/gi, '$1\n$2')
  }

  // 2. Expand single-line function/method declarations into multi-line indented blocks
  const expandedLines: string[] = []
  const rawLines = text.split('\n')

  for (const line of rawLines) {
    const fnMatch = line.match(/^(\s*)((?:(?:public|private|protected|static|async)\s+)*function\s+\w+\s*\([^)]*\)|(?:public|private|protected)\s+(?:static\s+)?[\w<>[\]]+\s+\w+\s*\([^)]*\))\s*\{\s*(.+?)\s*\}\s*$/)
    if (fnMatch) {
      const baseIndent = fnMatch[1]
      const signature = fnMatch[2].trim()
      const innerBody = fnMatch[3].trim()
      const stmts = splitTopLevelStatements(innerBody)
      expandedLines.push(`${baseIndent}${signature} {`)
      for (const stmt of stmts) {
        const ifSingle = stmt.match(/^if\s*\((.+?)\)\s*([^{].+)$/)
        if (ifSingle) {
          expandedLines.push(`${baseIndent}  if (${ifSingle[1].trim()}) {`)
          expandedLines.push(`${baseIndent}    ${ifSingle[2].trim()}`)
          expandedLines.push(`${baseIndent}  }`)
        } else {
          expandedLines.push(`${baseIndent}  ${stmt}`)
        }
      }
      expandedLines.push(`${baseIndent}}`)
    } else {
      expandedLines.push(line)
    }
  }

  // 3. Apply clean structural indentation if HTML tags were expanded
  if (hasSingleLineHtml) {
    const finalLines: string[] = []
    let inBody = false
    let inScript = false
    for (let i = 0; i < expandedLines.length; i++) {
      const l = expandedLines[i]
      const trimmed = l.trim()
      if (!trimmed) {
        finalLines.push('')
        continue
      }
      if (/^<!DOCTYPE/i.test(trimmed) || /^<\/?html/i.test(trimmed)) {
        finalLines.push(trimmed)
        continue
      }
      if (/^<head/i.test(trimmed) || /^<\/head/i.test(trimmed)) {
        finalLines.push(`  ${trimmed}`)
        continue
      }
      if (/^<body/i.test(trimmed)) {
        finalLines.push(`  ${trimmed}`)
        inBody = true
        continue
      }
      if (/^<\/body/i.test(trimmed)) {
        inBody = false
        finalLines.push(`  ${trimmed}`)
        continue
      }
      if (/^<script/i.test(trimmed)) {
        finalLines.push(`${inBody ? '    ' : '  '}${trimmed}`)
        inScript = true
        continue
      }
      if (/^<\/script/i.test(trimmed)) {
        inScript = false
        finalLines.push(`${inBody ? '    ' : '  '}${trimmed}`)
        continue
      }
      if (inScript) {
        const prefix = inBody ? '      ' : '    '
        const leadingSpaces = (l.match(/^\s*/) || [''])[0]
        finalLines.push(`${prefix}${leadingSpaces}${trimmed}`)
      } else {
        finalLines.push(l)
      }
    }
    return formatCommentSpacing(finalLines.join('\n'))
  }

  return formatCommentSpacing(expandedLines.join('\n'))
}

function CollapsibleCodeBox({
  title,
  subtitle,
  code,
  onOpenIDE,
  compact = false,
}: {
  title?: string
  subtitle?: string
  code: string
  onOpenIDE?: () => void
  compact?: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const formattedCode = formatCodeSnippet(code)
  const lineCount = formattedCode.split('\n').length
  const shouldTruncate = lineCount > (compact ? 7 : 16)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {}
  }

  return (
    <div className={`glass-panel rounded-2xl border border-[var(--color-border)] max-w-full min-w-0 overflow-hidden box-border ${compact ? 'p-3' : 'p-5'}`}>
      {(title || onOpenIDE) && (
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-[var(--color-border)]">
          <div>
            {title && <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-semibold">{title}</h3>}
            {subtitle && <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">{subtitle}</p>}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:text-white text-xs flex items-center gap-1 cursor-pointer transition-colors"
              title="Copy code"
            >
              {copied ? <Check size={13} className="text-[var(--color-know)]" /> : <Copy size={13} />}
              <span className="text-[10px] hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
            </button>

            {onOpenIDE && (
              <button
                onClick={onOpenIDE}
                className="text-xs text-[#10b981] hover:underline flex items-center gap-1 font-mono font-medium cursor-pointer"
              >
                Open in IDE →
              </button>
            )}
          </div>
        </div>
      )}

      <div className="relative">
        <pre
          style={{ fontVariantLigatures: 'none' }}
          className={`rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 font-mono text-xs sm:text-sm text-slate-200 overflow-x-auto leading-relaxed transition-all duration-200 ${
            !isExpanded && shouldTruncate ? (compact ? 'max-h-32 overflow-hidden' : 'max-h-64 overflow-hidden') : ''
          }`}
        >
          <code style={{ fontVariantLigatures: 'none' }}>{formattedCode}</code>
        </pre>

        {shouldTruncate && !isExpanded && (
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[var(--color-surface)] via-[var(--color-surface)]/80 to-transparent rounded-b-xl flex items-end justify-center pb-2">
            <button
              onClick={() => setIsExpanded(true)}
              className="px-3.5 py-1.5 rounded-full bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-white border border-[var(--color-border)] text-xs font-mono font-semibold flex items-center gap-1.5 shadow-lg backdrop-blur-md cursor-pointer transition-all active:scale-95"
            >
              <Maximize2 size={12} />
              <span>Click to view full code ({lineCount} lines)</span>
            </button>
          </div>
        )}
      </div>

      {shouldTruncate && isExpanded && (
        <div className="flex justify-end pt-2">
          <button
            onClick={() => setIsExpanded(false)}
            className="text-xs text-[var(--color-text-secondary)] hover:text-white flex items-center gap-1 font-mono cursor-pointer"
          >
            <Minimize2 size={13} />
            <span>Show less</span>
          </button>
        </div>
      )}
    </div>
  )
}

export function parseCodeChallenges(cards?: Card[]): UnifiedCodeChallenge[] {
  if (!cards || cards.length === 0) return []
  const parsed: UnifiedCodeChallenge[] = []

  cards.forEach((c, i) => {
    const isCodeType = c.type === 'code' || c.type === 'code_challenge'
    const legacyTag = c.front.includes('&[CODE:') || c.back.includes('&[CODE:')
    if (!isCodeType && !legacyTag) return

    const topic = c.front.replace(/&\[CODE:.*?\]/g, '').trim() || 'Code Challenge'
    let lang = c.code_language || 'javascript'
    if (legacyTag) {
      const match = (c.front + c.back).match(/&\[CODE:(.*?)\]/)
      if (match) lang = match[1].toLowerCase().trim()
    }

    const starter = formatCodeSnippet(c.code_starter || '')
    const solution = formatCodeSnippet(c.code_solution || '')
    const output = c.code_output || 'Program completed successfully.'
    const keywords = c.code_keywords ? c.code_keywords.split(';').map(k => k.trim()).filter(Boolean) : []
    const prompt = c.back.replace(/&\[CODE:.*?\]/g, '').trim() || topic

    let codeLabData: UnifiedCodeChallenge['codeLabData'] = undefined
    if (c.code_lab_data) {
      try {
        codeLabData = JSON.parse(c.code_lab_data)
        if (codeLabData?.script_html) {
          codeLabData.script_html = formatCodeSnippet(codeLabData.script_html)
        }
        if (codeLabData?.syntax_formula) {
          codeLabData.syntax_formula = formatCodeSnippet(codeLabData.syntax_formula)
        }
      } catch {}
    }

    const practiceChallenge = codeLabData?.practice_challenge || {
      prompt: `Write or complete the code to solve: ${topic}`,
      starterCode: starter.slice(0, 50),
      solutionKeywords: keywords.length > 0 ? keywords : [lang],
      explanation: `Validates correct syntax and usage of key concepts.`,
      simulatedOutput: output,
    }

    parsed.push({
      id: c.id || `card-code-${i}`,
      rawCard: c,
      language: lang as any,
      topic,
      category: 'Algorithms',
      description: topic,
      codeLabData,
      practiceChallenge,
      scenario: {
        scenarioPrompt: prompt,
        starterTemplate: starter,
        expectedKeywords: keywords,
        simulatedOutput: output,
        sampleSolution: solution,
      },
      bugHunter: codeLabData?.bug_hunter
        ? {
            scenarioPrompt: codeLabData.bug_hunter.prompt || `Find and fix the bugs in this ${lang} code.`,
            buggyCode: formatCodeSnippet(codeLabData.bug_hunter.buggy_code || codeLabData.bug_hunter.buggyCode || starter),
            bugCount: 1,
            bugDescriptions: codeLabData.bug_hunter.bug_descriptions || ['Fix the bugs to make the code execute properly.'],
            cleanSolution: formatCodeSnippet(codeLabData.bug_hunter.clean_solution || solution),
            simulatedOutput: codeLabData.bug_hunter.simulated_output || output,
          }
        : PRELOADED_CODING_CHALLENGES.find(p =>
            p.topic.toLowerCase() === topic.toLowerCase() ||
            (topic.toLowerCase().includes('switch') && p.topic.toLowerCase().includes('switch'))
          )?.bugHunter || {
            scenarioPrompt: `Find and fix the bugs in this ${lang} code.`,
            buggyCode: starter || solution,
            bugCount: 1,
            bugDescriptions: ['Fix the bugs to make the code execute properly.'],
            cleanSolution: solution,
            simulatedOutput: output,
          },
    })
  })

  return parsed
}

export interface TerminalExecutionData {
  shellTitle: string
  command: string
  outputLabel: string
  stdout: string
  invocations?: string
  testSuiteCode?: string
  exitCode: number
  verifiedMessage: string
}

export function evaluateScriptPrintOutput(script: string, _lang: string = 'java'): string | null {
  if (!script) return null

  const outputs: string[] = []
  const printRegex = /(?:System\.out\.println|System\.out\.print|console\.log|print)\s*\(([\s\S]*?)\);?/g
  const matches = [...script.matchAll(printRegex)]
  if (matches.length === 0) return null

  const env: Record<string, any> = {}

  // Parse simple primitive variable assignments:
  const varRegex = /(?:(?:String|int|double|float|long|char|boolean|var|let|const)\s+)?(\b[A-Za-z_]\w*\b)\s*=\s*([^;]+);/g
  for (const match of script.matchAll(varRegex)) {
    const varName = match[1]
    const rawVal = match[2].trim()

    const strMatch = rawVal.match(/^["'](.*)["']$/)
    if (strMatch) {
      env[varName] = strMatch[1]
      continue
    }

    if (rawVal !== '' && !isNaN(Number(rawVal))) {
      env[varName] = Number(rawVal)
      continue
    }

    if (rawVal === 'true') { env[varName] = true; continue; }
    if (rawVal === 'false') { env[varName] = false; continue; }
  }

  // Parse inline switch expressions:
  const switchRegex = /(?:(?:int|double|String|var|let|const)\s+)?(\b[A-Za-z_]\w*\b)\s*=\s*switch\s*\(([^)]+)\)\s*\{([\s\S]*?)\};/g
  for (const sMatch of script.matchAll(switchRegex)) {
    const varName = sMatch[1]
    const selectorExpr = sMatch[2].trim()
    const switchBody = sMatch[3]

    const selectorVal = env[selectorExpr] !== undefined ? String(env[selectorExpr]) : selectorExpr.replace(/['"]/g, '')

    const caseRegex = /case\s+["']?([^"':\s-]+)["']?\s*(?:->|:)\s*(?:return\s+)?([^;]+);/g
    let matchedVal: any = undefined
    let defaultVal: any = undefined

    for (const cMatch of switchBody.matchAll(caseRegex)) {
      const caseKey = cMatch[1].trim()
      const valStr = cMatch[2].trim().replace(/^["']|["']$/g, '')
      if (caseKey.toLowerCase() === selectorVal.toLowerCase()) {
        matchedVal = valStr
        break
      }
    }

    const defaultMatch = switchBody.match(/default\s*(?:->|:)\s*(?:return\s+)?([^;]+);/)
    if (defaultMatch) {
      defaultVal = defaultMatch[1].trim().replace(/^["']|["']$/g, '')
    }

    env[varName] = matchedVal !== undefined ? matchedVal : (defaultVal !== undefined ? defaultVal : 0)
  }

  // Evaluate print calls strictly — never output unresolved variable names
  for (const m of matches) {
    const rawArg = m[1].trim()

    // 1. String concatenation: "Status Code: " + code
    const parts = rawArg.split(/\s*\+\s*/)
    if (parts.length > 1) {
      let unresolved = false
      const evaluated = parts.map(part => {
        const trimmed = part.trim()
        const strLit = trimmed.match(/^["'](.*)["']$/)
        if (strLit) return strLit[1]
        if (trimmed !== '' && !isNaN(Number(trimmed))) return trimmed
        if (env[trimmed] !== undefined) return String(env[trimmed])
        unresolved = true
        return ''
      }).join('')
      if (unresolved) return null
      outputs.push(evaluated)
      continue
    }

    // 2. String literal: "Hello World"
    const litMatch = rawArg.match(/^["'](.*)["']$/)
    if (litMatch) {
      outputs.push(litMatch[1])
      continue
    }

    // 3. Number literal
    if (rawArg !== '' && !isNaN(Number(rawArg))) {
      outputs.push(rawArg)
      continue
    }

    // 4. Resolved variable reference
    if (env[rawArg] !== undefined) {
      outputs.push(String(env[rawArg]))
      continue
    }

    // Unresolved complex object/array/call — return null so simulatedOutput is used
    return null
  }

  return outputs.length > 0 ? outputs.join('\n') : null
}

export function isOutputRelevantToScript(script: string, output: string): boolean {
  if (!script || !output) return false
  const scriptLower = script.toLowerCase()
  const words = output.toLowerCase().split(/[\s:,\-_./$]+/).filter(w => w.length >= 4)
  if (words.length === 0) return true
  return words.some(w => scriptLower.includes(w))
}

function extractTopLevelInvocations(script: string): string | undefined {
  if (!script) return undefined
  // Check Java main method first
  const mainMatch = script.match(/public\s+static\s+void\s+main\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*\}/)
  if (mainMatch && mainMatch[1]) {
    return mainMatch[1]
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .join('\n')
  }

  // Strip HTML wrappers and extract top-level statements outside function/class blocks
  const cleaned = formatCodeSnippet(script)
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<head>[\s\S]*?<\/head>/gi, '')
    .replace(/<\/?(?:html|body|script)[^>]*>/gi, '')
    .trim()

  const lines = cleaned.split('\n')
  const topCalls: string[] = []
  let braceDepth = 0

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('//')) continue

    const opens = (line.match(/\{/g) || []).length
    const closes = (line.match(/\}/g) || []).length

    if (braceDepth === 0) {
      const isDecl = /^(?:function\s+|async\s+function\s+|def\s+|class\s+|public\s+|private\s+|protected\s+)/.test(line)
      const isEmptyInit = /^(?:let|const|var)\s+\w+\s*=\s*\[\s*\]\s*;?$/.test(line)
      if (!isDecl && !isEmptyInit && opens === closes) {
        topCalls.push(line)
      }
    }

    braceDepth = Math.max(0, braceDepth + opens - closes)
  }

  return topCalls.length > 0 ? topCalls.join('\n') : undefined
}

function sanitizeOutput(raw: string, script: string): string {
  let s = (raw || '').trim()
  if (/^[A-Za-z_]\w*$/.test(s)) {
    // Single bare variable name mistakenly set as output (e.g. 'inventory')
    const itemMatch = script.match(/addItem\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\d+)\s*\)/)
    if (itemMatch) {
      return `[ { name: '${itemMatch[1]}', quantity: ${itemMatch[2]} } ]`
    }
    const singleMatch = script.match(/addItem\s*\(\s*['"]([^'"]+)['"]\s*\)/)
    if (singleMatch) {
      return `[ '${singleMatch[1]}' ]`
    }
  }
  return s
}

export function formatTestSuiteWithPrintCalls(
  rawSuite: string,
  invocations: string | undefined,
  script: string,
  stdout: string,
  lang: string
): string {
  const normLang = (lang || 'java').toLowerCase()
  const isJs =
    normLang.includes('js') ||
    normLang.includes('script') ||
    normLang.includes('node') ||
    normLang.includes('ts') ||
    normLang.includes('html')
  const isPy = normLang.includes('py')
  const isSql = normLang.includes('sql')
  const isJava = normLang.includes('java') && !isJs

  const printFn = isPy ? 'print' : (isJava ? 'System.out.println' : (isSql ? 'SELECT' : 'console.log'))
  const commentPrefix = isPy ? '#' : (isSql ? '--' : '//')

  let text = (rawSuite || '').trim()

  // Convert old multi-line console comments (e.g., listItems();\n// console:\n// 1 Apples 50)
  if (text.includes('console:') || text.includes('console :')) {
    const rawLines = text.split('\n')
    const processed: string[] = []
    let pendingCall = ''
    let inConsoleBlock = false

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i].trim()
      if (!line) continue

      if (/^(?:\/\/|#)\s*console:?\s*\(no output\)/i.test(line)) {
        if (pendingCall) {
          processed.push(pendingCall.endsWith(';') ? pendingCall : `${pendingCall};`)
          pendingCall = ''
        }
        continue
      }

      if (/^(?:\/\/|#)\s*console:?/i.test(line)) {
        inConsoleBlock = true
        continue
      }

      if (inConsoleBlock) {
        if (/^(?:\/\/|#)\s*(.*)$/.test(line)) {
          const match = line.match(/^(?:\/\/|#)\s*(.*)$/)
          const outText = match ? match[1].trim() : ''
          if (pendingCall) {
            const cleanCall = pendingCall.replace(/;$/, '')
            processed.push(`${printFn}(${cleanCall}); ${commentPrefix} -> ${outText}`)
            pendingCall = ''
          } else {
            processed.push(`${commentPrefix} -> ${outText}`)
          }
          inConsoleBlock = false
          continue
        }
        inConsoleBlock = false
      }

      if (pendingCall) {
        processed.push(pendingCall.endsWith(';') ? pendingCall : `${pendingCall};`)
        pendingCall = ''
      }

      if (!line.startsWith('//') && !line.startsWith('#')) {
        pendingCall = line
      } else {
        processed.push(line)
      }
    }

    if (pendingCall) {
      if (stdout) {
        const cleanCall = pendingCall.replace(/;$/, '')
        processed.push(`${printFn}(${cleanCall}); ${commentPrefix} -> ${stdout}`)
      } else {
        processed.push(pendingCall.endsWith(';') ? pendingCall : `${pendingCall};`)
      }
    }

    if (processed.length > 0) {
      text = processed.join('\n')
    }
  }

  // Check if text already contains explicit print function calls
  const hasPrintCall = /(?:System\.out\.println|System\.out\.print|console\.log|print)\s*\(/.test(text)

  if (hasPrintCall) {
    // If it has print calls, ensure any without output comment get paired with stdout
    const lines = text.split('\n')
    const resultLines = lines.map(line => {
      const trimmed = line.trim()
      if (/(?:System\.out\.println|System\.out\.print|console\.log|print)\s*\(/.test(trimmed)) {
        if (!trimmed.includes('//') && !trimmed.includes('#') && !trimmed.includes('->') && stdout) {
          return `${line} ${commentPrefix} -> ${stdout}`
        }
      }
      return line
    })
    return resultLines.join('\n')
  }

  // If no print call in text, inspect invocations or fallback
  const baseCode = text || (invocations || '').trim()

  if (baseCode) {
    const lines = baseCode.split('\n').map(l => l.trim()).filter(Boolean)
    const hasPrint = lines.some(l => /(?:System\.out\.println|console\.log|print)\s*\(/.test(l))
    if (hasPrint) {
      return lines.map(line => {
        if (/(?:System\.out\.println|console\.log|print)\s*\(/.test(line) && !line.includes('//') && !line.includes('#') && stdout) {
          return `${line} ${commentPrefix} -> ${stdout}`
        }
        return line
      }).join('\n')
    }

    // Check if script has a print call we should mirror (e.g. console.log(inventory))
    const scriptPrintMatch = script.match(/(?:System\.out\.println|console\.log|print)\s*\(([^)]+)\);?/)
    if (scriptPrintMatch) {
      const callTarget = scriptPrintMatch[1].trim()
      const printStatement = `${printFn}(${callTarget}); ${commentPrefix} -> ${stdout}`
      return `${baseCode}\n${printStatement}`
    }

    // Wrap the last statement in print call with answer
    const nonCommentLines = lines.filter(l => !l.startsWith('//') && !l.startsWith('#'))
    if (nonCommentLines.length > 0) {
      const lastLine = nonCommentLines[nonCommentLines.length - 1]
      const stripped = lastLine.replace(/;$/, '')
      const wrapped = `${printFn}(${stripped}); ${commentPrefix} -> ${stdout}`
      const idx = lines.lastIndexOf(lastLine)
      lines[idx] = wrapped
      return lines.join('\n')
    }
  }

  return `${printFn}(); ${commentPrefix} -> ${stdout}`
}

export function getTerminalExecutionData(challenge: UnifiedCodeChallenge): TerminalExecutionData {
  const lang = (challenge.language || 'java').toLowerCase()
  const script = challenge.codeLabData?.script_html || challenge.scenario.sampleSolution || ''
  const rawStaticOutput = (challenge.scenario.simulatedOutput || '').trim()
  const isGenericFallback =
    !rawStaticOutput ||
    rawStaticOutput === 'Program completed successfully.' ||
    rawStaticOutput === '// output' ||
    rawStaticOutput === '// terminal output'

  const testSuite = (challenge.codeLabData?.test_suite || '').trim()

  let shellTitle = 'Java Runtime'
  let command = 'java Main.java'
  let outputLabel = 'Terminal Output'
  if (lang.includes('py')) {
    shellTitle = 'Python Runtime'
    command = 'python3 main.py'
    outputLabel = 'Terminal Output'
  } else if (lang.includes('js') || lang.includes('node') || lang.includes('script') || lang.includes('ts') || lang.includes('html')) {
    shellTitle = 'JavaScript Console'
    command = 'node main.js'
    outputLabel = 'Console Output'
  } else if (lang.includes('sql')) {
    shellTitle = 'SQL Engine'
    command = 'sqlite3 :memory: < query.sql'
    outputLabel = 'Query Output'
  }

  const invocations = extractTopLevelInvocations(script)
  const dynamicStdout = evaluateScriptPrintOutput(script, lang)

  // Check if script has an explicit "// Expected: ..." comment
  const expectedCommentMatch = script.match(/\/\/\s*Expected:\s*(.+)$/m)
  const expectedFromComment = expectedCommentMatch ? expectedCommentMatch[1].trim() : ''

  // Extract all outputs if testSuite has lines with comments like // -> 6, // -> 7, or # -> ...
  const suiteOutputs: string[] = []
  if (testSuite) {
    const suiteLines = testSuite.split('\n')
    for (const sLine of suiteLines) {
      const match = sLine.match(/(?:\/\/|#|--)\s*(?:->|=>)\s*(.+)$/)
      if (match && match[1].trim()) {
        suiteOutputs.push(match[1].trim())
      }
    }
  }

  let finalStdout = ''
  if (suiteOutputs.length > 1) {
    // When the test suite has multiple printing calls, show all outputs line-by-line
    finalStdout = suiteOutputs.join('\n')
  } else if (!isGenericFallback) {
    finalStdout = rawStaticOutput
  } else if (suiteOutputs.length === 1) {
    finalStdout = suiteOutputs[0]
  } else if (expectedFromComment) {
    finalStdout = expectedFromComment
  } else if (dynamicStdout) {
    finalStdout = dynamicStdout
  } else if (challenge.codeLabData?.practice_challenge?.simulatedOutput) {
    finalStdout = challenge.codeLabData.practice_challenge.simulatedOutput
  } else if (testSuite) {
    finalStdout = testSuite
  } else {
    finalStdout = 'Executed successfully (no stdout).'
  }

  // Ensure output is resolved beyond bare variable names
  finalStdout = sanitizeOutput(finalStdout, script)

  // Format test suite so it always includes the print function paired with its answer
  const formattedSuite = formatTestSuiteWithPrintCalls(testSuite, invocations, script, finalStdout, lang)

  return {
    shellTitle,
    command,
    outputLabel,
    stdout: finalStdout,
    invocations,
    testSuiteCode: formattedSuite ? formatCodeSnippet(formattedSuite) : undefined,
    exitCode: 0,
    verifiedMessage: 'Output verified against Laboratory Script'
  }
}

export function getVerificationSnippet(challenge: UnifiedCodeChallenge): string {
  const termData = getTerminalExecutionData(challenge)
  const calls = termData.testSuiteCode || termData.invocations
  if (calls) {
    return `${calls}\n\n// Laboratory ${termData.outputLabel}:\n${termData.stdout}`
  }
  return `// Laboratory ${termData.outputLabel}:\n${termData.stdout}`
}

export default function CodeLabView({
  deckTitle = 'Coding IDE',
  onBack,
  cards,
  deckId,
}: CodeLabViewProps) {
  const [challenges, setChallenges] = useState<UnifiedCodeChallenge[]>(() => {
    const fromCards = parseCodeChallenges(cards)
    if (fromCards.length > 0) return fromCards
    return PRELOADED_CODING_CHALLENGES
  })
  
  const [currentIndex, setCurrentIndex] = useState(0)
  const [labStyle, setLabStyle] = useState<'notes' | 'exam'>('notes')
  const [mode, setMode] = useState<CodeMode>('scenario')
  const [activeTab, setActiveTab] = useState<ViewTab>('notebook')
  const [showSolution, setShowSolution] = useState(false)
  const [isMemoryMapOpen, setIsMemoryMapOpen] = useState(false)
  const [showFormulaDetails, setShowFormulaDetails] = useState(false)
  const [copiedGiven, setCopiedGiven] = useState(false)
  const { status: ttsStatus, currentItemId: ttsCurrentId, speakSingle, stop: stopTTS } = useTTS()
  const [activeSpeakingCard, setActiveSpeakingCard] = useState<string | null>(null)
  const isScrolled = useScrolledTopSpacing(4)

  useEffect(() => {
    const updated = parseCodeChallenges(cards)
    if (updated.length > 0) {
      setChallenges(updated)
      setCurrentIndex(0)
    } else if (cards && cards.length > 0) {
      setChallenges([])
      setCurrentIndex(0)
    }
  }, [cards])

  const currentChallenge = challenges[currentIndex] || challenges[0]
  const langKey = currentChallenge?.language || 'java'
  const practice = currentChallenge?.practiceChallenge || currentChallenge?.codeLabData?.practice_challenge


  
  const modeData = currentChallenge
    ? (mode === 'scenario' 
        ? currentChallenge.scenario 
        : mode === 'bug_hunter' 
        ? currentChallenge.bugHunter 
        : {
            scenarioPrompt: practice?.prompt || 'Complete the practice expression.',
            starterTemplate: practice?.starterCode || '',
            expectedKeywords: practice?.solutionKeywords || [],
            simulatedOutput: practice?.simulatedOutput || 'Verified output',
            sampleSolution: practice?.hint || practice?.starterCode || ''
          })
    : null

  const [userCode, setUserCode] = useState(() => {
    if (!currentChallenge) return ''
    if (mode === 'bug_hunter') return currentChallenge.bugHunter.buggyCode
    return ''
  })

  const [feedback, setFeedback] = useState<{
    status: 'idle' | 'success' | 'error'
    message: string
    output?: string
  }>({ status: 'idle', message: '' })

  const handleChallengeChange = (idx: number) => {
    setCurrentIndex(idx)
    setShowSolution(false)
    const next = challenges[idx]
    if (next) {
      setUserCode(mode === 'bug_hunter' ? next.bugHunter.buggyCode : '')
    }
    setFeedback({ status: 'idle', message: '' })
  }

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!currentChallenge) return
    setUserCode(mode === 'bug_hunter' ? currentChallenge.bugHunter.buggyCode : '')
    setFeedback({ status: 'idle', message: '' })
  }, [mode, currentChallenge])

  const handleRun = () => {
    if (!currentChallenge) return
    const code = userCode.trim()

    if (!code) {
      setFeedback({
        status: 'error',
        message: 'Editor is empty.',
        output: 'Please provide code before running.',
      })
      return
    }

    // 1. Universal Bracket / Brace Balance Check for C-family & structured languages
    const isCStyle = ['java', 'javascript', 'typescript', 'cpp', 'c', 'csharp'].includes(
      (currentChallenge.language || '').toLowerCase()
    )

    if (isCStyle) {
      const openBraces = (code.match(/\{/g) || []).length
      const closeBraces = (code.match(/\}/g) || []).length
      if (openBraces !== closeBraces) {
        setFeedback({
          status: 'error',
          message: 'Syntax Error: Unbalanced braces',
          output: `error: reached end of file while parsing (found ${openBraces} '{' vs ${closeBraces} '}')`,
        })
        return
      }

      const openParens = (code.match(/\(/g) || []).length
      const closeParens = (code.match(/\)/g) || []).length
      if (openParens !== closeParens) {
        setFeedback({
          status: 'error',
          message: 'Syntax Error: Unbalanced parentheses',
          output: `error: syntax error, mismatched parentheses (found ${openParens} '(' vs ${closeParens} ')')`,
        })
        return
      }
    }

    if (mode === 'practice') {
      const curPractice = currentChallenge.practiceChallenge || currentChallenge.codeLabData?.practice_challenge
      if (!curPractice) {
        setFeedback({
          status: 'success',
          message: 'Output Verified · All Cases Passed',
          output: 'Practice verified.',
        })
        return
      }

      const raw = code
      const normalizedRaw = raw.replace(/=>/g, '->')
      let isMatch = false

      if (curPractice.solutionPattern) {
        try {
          // Allow custom variable names in selector (e.g. switch(lawrence), switch(s), etc.)
          const flexPattern = curPractice.solutionPattern
            .replace(/speed/gi, '[A-Za-z0-9_]+')
            .replace(/selector/gi, '[A-Za-z0-9_]+')
          const regex = new RegExp(flexPattern, 'i')
          if (regex.test(raw) || regex.test(normalizedRaw)) isMatch = true
        } catch {}
      }

      if (!isMatch && curPractice.solutionKeywords && curPractice.solutionKeywords.length > 0) {
        const allFound = curPractice.solutionKeywords.every(kw => {
          if (kw === '->') return raw.includes('->') || raw.includes('=>')
          const targetKw = kw.toLowerCase()
          return raw.toLowerCase().includes(targetKw) || normalizedRaw.toLowerCase().includes(targetKw)
        })
        if (allFound) isMatch = true
      }

      if (isMatch) {
        setFeedback({
          status: 'success',
          message: 'Output Verified · All Cases Passed',
          output: curPractice.simulatedOutput ? `Test Output:\n${curPractice.simulatedOutput}` : 'Verified.',
        })
        try {
          confetti({
            particleCount: 75,
            spread: 60,
            origin: { y: 0.6 },
            colors: ['#4f8ef7', '#34d399', '#818cf8', '#fbbf24'],
          })
        } catch {}
      } else {
        setFeedback({
          status: 'error',
          message: 'Verification Failed',
          output: `Logic or syntax issue detected.\nHint: ${curPractice.hint || 'Check expression syntax and branches.'}`,
        })
      }
    } else if (mode === 'scenario') {
      const scenario = currentChallenge.scenario
      const missingKeywords: string[] = []

      if (scenario.expectedKeywords) {
        for (const kw of scenario.expectedKeywords) {
          // Allow -> or => for arrow syntax flexibility on mobile
          if (kw === '->') {
            if (!code.includes('->') && !code.includes('=>')) {
              missingKeywords.push(kw)
            }
          } else if (!code.toLowerCase().includes(kw.toLowerCase())) {
            missingKeywords.push(kw)
          }
        }
      }

      if (missingKeywords.length > 0) {
        setFeedback({
          status: 'error',
          message: 'Compilation Failed: Missing required keywords',
          output: `Compiler error: Symbol not found or missing expected pattern (${missingKeywords.join(', ')})`,
        })
        return
      }

      // Check if switch is used, verify case labels exist
      if (code.includes('switch') && !code.includes('case')) {
        setFeedback({
          status: 'error',
          message: 'Compilation Failed: Incomplete switch block',
          output: `Compiler error: Switch expression must declare at least one case branch.`,
        })
        return
      }

      // Relevance check: verify the code implements the target challenge function or domain
      const fnMatch = scenario.sampleSolution.match(/(?:public\s+static\s+[\w<>[\]]+\s+|function\s+|def\s+)(\w+)\s*\(/)
      if (fnMatch) {
        const fnName = fnMatch[1]
        if (!code.includes(fnName)) {
          // Check if domain-specific string literals or cases are present
          const domainMatches = [...scenario.sampleSolution.matchAll(/["']([A-Z_]{3,})["']/g)].map(m => m[1])
          if (domainMatches.length > 0) {
            const hasDomain = domainMatches.some(d => code.includes(d))
            if (!hasDomain) {
              setFeedback({
                status: 'error',
                message: `Challenge Mismatch: Missing target "${fnName}"`,
                output: `Compiler error: Code in editor does not implement or invoke "${fnName}". Expected domain parameters: ${domainMatches.slice(0, 3).join(', ')}.`,
              })
              return
            }
          }
        }
      }

      // Compute actual output of user code and compare with expected output
      const userStdout = evaluateScriptPrintOutput(code, langKey)
      if (userStdout && scenario.simulatedOutput) {
        const normUser = userStdout.trim().toLowerCase()
        const normExpected = scenario.simulatedOutput.trim().toLowerCase()
        if (normUser !== normExpected && !normUser.includes(normExpected) && !normExpected.includes(normUser)) {
          setFeedback({
            status: 'error',
            message: 'Output Mismatch: Logic does not match challenge',
            output: `Program output:\n${userStdout}\n\nExpected output:\n${scenario.simulatedOutput}`,
          })
          return
        }
      }

      setFeedback({
        status: 'success',
        message: 'Compilation Successful · Output Verified',
        output: userStdout ? `Output:\n${userStdout}` : (scenario.simulatedOutput ? `Output:\n${scenario.simulatedOutput}` : 'Program executed successfully with exit code 0.'),
      })
      try {
        confetti({
          particleCount: 75,
          spread: 60,
          origin: { y: 0.6 },
          colors: ['#4f8ef7', '#34d399', '#818cf8', '#fbbf24'],
        })
      } catch {}
    } else {
      const bugHunter = currentChallenge.bugHunter
      const cleanLower = bugHunter.cleanSolution.toLowerCase().replace(/\s+/g, '')
      const buggyLower = bugHunter.buggyCode.toLowerCase().replace(/\s+/g, '')
      const userLower = code.toLowerCase().replace(/\s+/g, '')

      // 1. Relevance check: verify user code addresses this bug hunter challenge
      const fnMatch = bugHunter.cleanSolution.match(/(?:public\s+static\s+[\w<>[\]]+\s+|function\s+|def\s+)(\w+)\s*\(/)
      if (fnMatch) {
        const fnName = fnMatch[1].toLowerCase()
        if (!userLower.includes(fnName)) {
          setFeedback({
            status: 'error',
            message: 'Challenge Mismatch: Unrelated Code',
            output: `The editor does not contain the target method "${fnMatch[1]}". Click "Reset" to load the buggy snippet for this challenge.`,
          })
          return
        }
      }

      // 2. Check if code is unchanged from buggy snippet
      if (userLower === buggyLower) {
        setFeedback({
          status: 'error',
          message: 'Bugs Still Present: Snippet Unmodified',
          output: `Runtime error / logic flaw detected: Check ${bugHunter.bugDescriptions[0] || 'the buggy line'}.`,
        })
        return
      }

      // 3. Fallthrough bug specific check:
      if (bugHunter.bugDescriptions.some(d => d.toLowerCase().includes('break') || d.toLowerCase().includes('fallthrough'))) {
        const usesArrow = code.includes('->') || code.includes('=>')
        const usesBreak = /\bbreak\s*;/i.test(code)
        if (!usesArrow && !usesBreak) {
          setFeedback({
            status: 'error',
            message: 'Fallthrough Bug Still Present',
            output: 'Traditional switch cases still lack break statements. Add "break;" or convert to modern switch arrow ("->") syntax.',
          })
          return
        }
      }

      // 4. Output verification
      const userStdout = evaluateScriptPrintOutput(code, langKey)
      if (userStdout && bugHunter.simulatedOutput) {
        const normUser = userStdout.trim().toLowerCase()
        const normExpected = bugHunter.simulatedOutput.trim().toLowerCase()
        if (normUser !== normExpected && !normUser.includes(normExpected) && !normExpected.includes(normUser)) {
          setFeedback({
            status: 'error',
            message: 'Output Mismatch: Bug not resolved',
            output: `Program output:\n${userStdout}\n\nExpected output:\n${bugHunter.simulatedOutput}`,
          })
          return
        }
      }

      const matchesClean = userLower.includes(cleanLower) || cleanLower.includes(userLower)
      const hasKeyFix = (code.includes('->') || code.includes('=>') || /\bbreak\s*;/i.test(code))

      if (matchesClean || hasKeyFix) {
        setFeedback({
          status: 'success',
          message: 'All Bugs Resolved!',
          output: userStdout ? `Output:\n${userStdout}` : (bugHunter.simulatedOutput ? `Output:\n${bugHunter.simulatedOutput}` : 'All tests passed.'),
        })
        try {
          confetti({
            particleCount: 75,
            spread: 60,
            origin: { y: 0.6 },
            colors: ['#4f8ef7', '#34d399', '#818cf8', '#fbbf24'],
          })
        } catch {}
      } else {
        setFeedback({
          status: 'error',
          message: 'Bugs still present in the snippet.',
          output: `Runtime error / logic flaw detected: Check ${bugHunter.bugDescriptions[0] || 'the buggy line'}.`,
        })
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const start = e.currentTarget.selectionStart
      const end = e.currentTarget.selectionEnd
      const val = userCode
      setUserCode(val.substring(0, start) + '  ' + val.substring(end))
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2
        }
      }, 0)
    }
  }

  const handleReset = () => {
    if (!currentChallenge) return
    setUserCode(mode === 'bug_hunter' ? currentChallenge.bugHunter.buggyCode : '')
    setFeedback({ status: 'idle', message: '' })
  }

  const handleCopyGiven = () => {
    const termData = getTerminalExecutionData(currentChallenge)
    const suiteDisplay = termData.testSuiteCode || termData.invocations
    const text = suiteDisplay || currentChallenge?.scenario?.starterTemplate || currentChallenge?.topic || ''
    try {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedGiven(true)
        setTimeout(() => setCopiedGiven(false), 1500)
      })
    } catch {}
  }

  if (!currentChallenge || challenges.length === 0) {
    return (
      <div className="codelab-theme min-h-screen bg-[#050505] text-[#fff] font-sans antialiased flex flex-col">
        <header className="sticky top-0 z-30 border-b border-[#222] bg-[#101010] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                className="p-1.5 rounded-lg border border-[#222] hover:bg-[#191919] text-white transition-colors cursor-pointer"
                title="Back"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <div className="logo text-xl font-black text-[#2fd16a] uppercase">CodeLab</div>
          </div>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#191919] border border-[#222] flex items-center justify-center text-neutral-400 mb-4">
            <Terminal size={32} />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">No Coding Challenges Found</h2>
          <p className="text-sm text-neutral-400 max-w-md mb-6">
            This deck does not contain cards with type &quot;code&quot; or &quot;code_challenge&quot;.
          </p>
          {onBack && (
            <button
              onClick={onBack}
              className="px-5 py-2.5 rounded-xl bg-[#191919] text-white font-medium hover:bg-[#222] border border-[#222] transition-all cursor-pointer flex items-center gap-2"
            >
              <ArrowLeft size={16} />
              <span>Back to Deck</span>
            </button>
          )}
        </main>
      </div>
    )
  }

  const lines = userCode.split('\n')
  const ext = langKey === 'java' ? 'java' : langKey === 'sql' ? 'sql' : langKey === 'python' ? 'py' : 'js'
  const termData = getTerminalExecutionData(currentChallenge)
  const suiteDisplay = termData.testSuiteCode || termData.invocations
  const syntaxBlueprint = currentChallenge.codeLabData?.syntax_formula || currentChallenge.scenario?.starterTemplate || ''
  const finalExpected = currentChallenge.scenario?.simulatedOutput || currentChallenge.bugHunter?.simulatedOutput || termData.stdout || 'Verified'
  const dataMap = currentChallenge.codeLabData?.data_map || []

  return (
    <div className="codelab-theme min-h-screen bg-[var(--bg)] text-[var(--text)] antialiased transition-colors selection:bg-[#2fd16a] selection:text-black pb-24">
      {/* SCOPED STYLES MATCHING MathLab_ Center of Mass.html WITH GREEN CODELAB THEME */}
      <style>{`
        .codelab-theme {
          --bg: #050505;
          --card: #101010;
          --card2: #191919;
          --text: #ffffff;
          --muted: #a8a8a8;
          --line: #222222;
          --green: #2fd16a;
          --okbg: #17582d;
          --okt: #ffffff;
          --hero: #052e16;
        }
        @media (prefers-color-scheme: light) {
          :root:not([data-theme="dark"]) .codelab-theme {
            --bg: #f4f4f4;
            --card: #ffffff;
            --card2: #f0f0f0;
            --text: #111111;
            --muted: #666666;
            --line: #e2e2e2;
            --green: #14a44d;
            --okbg: #17703a;
            --okt: #ffffff;
            --hero: #dcfce7;
          }
        }
        :root[data-theme="light"] .codelab-theme {
          --bg: #f4f4f4;
          --card: #ffffff;
          --card2: #f0f0f0;
          --text: #111111;
          --muted: #666666;
          --line: #e2e2e2;
          --green: #14a44d;
          --okbg: #17703a;
          --okt: #ffffff;
          --hero: #dcfce7;
        }

        .codelab-theme main {
          max-width: 640px;
          width: 100%;
          margin: 0 auto;
          padding: max(calc(env(safe-area-inset-top, 0px) + 12px), 20px) 14px 48px;
          min-width: 0;
          box-sizing: border-box;
          overflow-x: hidden;
        }
        .codelab-theme .bar {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 4px 2px 14px;
        }
        .codelab-theme .logo {
          flex: 1;
          font-size: 1.7rem;
          font-weight: 900;
          letter-spacing: -.03em;
          color: var(--green);
          text-transform: uppercase;
        }
        .codelab-theme .avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: var(--green);
          display: grid;
          place-items: center;
          color: #000;
          font-weight: 800;
          font-size: 0.85rem;
        }
        .codelab-theme .hero {
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
        .codelab-theme .tag {
          font-size: .75rem;
          font-weight: 800;
          letter-spacing: .12em;
          text-transform: uppercase;
          color: var(--green);
          margin: 0 0 8px;
        }
        .codelab-theme h1 {
          font-size: 1.65rem;
          line-height: 1.15;
          font-weight: 900;
          margin: 0 0 12px;
          letter-spacing: -.02em;
          overflow-wrap: anywhere;
          word-break: break-word;
          max-width: 100%;
        }
        .codelab-theme .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 10px;
        }
        .codelab-theme .chip {
          background: var(--card2);
          border-radius: 999px;
          padding: 5px 14px;
          font-size: .85rem;
          font-weight: 600;
        }
        .codelab-theme .card {
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
        .codelab-theme .card * {
          box-sizing: border-box;
        }
        .codelab-theme .head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin: 0 0 12px;
          max-width: 100%;
          min-width: 0;
        }
        .codelab-theme h2 {
          font-size: 1.15rem;
          font-weight: 800;
          margin: 0;
          overflow-wrap: anywhere;
          word-break: break-word;
          min-width: 0;
        }
        .codelab-theme .btn {
          background: none;
          border: 0;
          color: var(--green);
          font: 600 .95rem system-ui, sans-serif;
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 6px;
          cursor: pointer;
        }
        .codelab-theme p {
          margin: 0;
        }
        .codelab-theme .lab {
          font-size: .72rem;
          font-weight: 700;
          color: var(--muted);
          margin: 0 0 6px;
          text-transform: uppercase;
          letter-spacing: .1em;
        }
        .codelab-theme .grid {
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
        .codelab-theme .pair {
          grid-template-columns: repeat(2, max-content max-content max-content);
          font: 1.1rem Georgia, serif;
          padding: 0 2px;
          min-width: 0;
          max-width: 100%;
          overflow-x: auto;
        }
        .codelab-theme .pair .g2 {
          padding-left: 2.2em;
        }
        .codelab-theme .pair .r {
          white-space: nowrap;
        }
        .codelab-theme .eqbox {
          background: var(--card2);
          border-radius: 10px;
          padding: 12px 14px;
          font: 0.95rem/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          overflow-x: auto;
          overflow-y: hidden;
          max-width: 100%;
          min-width: 0;
          box-sizing: border-box;
          overflow-wrap: anywhere;
          word-break: break-word;
          -webkit-overflow-scrolling: touch;
        }
        .codelab-theme .frm {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          min-width: 0;
          max-width: 100%;
        }
        .codelab-theme .frm > div {
          flex: 1 1 130px;
          min-width: 0;
          max-width: 100%;
        }
        .codelab-theme .frm > div:first-child {
          flex: 2 1 250px;
          min-width: 0;
          max-width: 100%;
        }
        .codelab-theme .note {
          display: none;
          margin-top: 12px;
          color: var(--muted);
          font-size: .95rem;
        }
        .codelab-theme .note.on {
          display: block;
        }
        .codelab-theme .step {
          display: grid;
          grid-template-columns: 2rem minmax(0, 1fr);
          gap: 12px;
          padding: 14px 0;
          border-top: 1px solid var(--line);
          min-width: 0;
          max-width: 100%;
          overflow: hidden;
        }
        .codelab-theme .step:first-of-type {
          border-top: 0;
          padding-top: 0;
        }
        .codelab-theme .num {
          width: 2rem;
          height: 2rem;
          border-radius: 50%;
          background: var(--green);
          color: #000;
          font-weight: 800;
          display: grid;
          place-items: center;
          font-size: .95rem;
        }
        .codelab-theme .t {
          font-weight: 600;
          margin: 3px 0 8px;
        }
        .codelab-theme .final {
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
        .codelab-theme .final > div:first-child {
          flex: 1;
          min-width: 0;
          overflow: hidden;
        }
        .codelab-theme .final small {
          display: block;
          font-size: .72rem;
          font-weight: 800;
          letter-spacing: .14em;
          text-transform: uppercase;
          opacity: .9;
        }
        .codelab-theme .final .v {
          font: 600 1.35rem/1.3 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          overflow-x: auto;
          overflow-wrap: anywhere;
          word-break: break-all;
          max-width: 100%;
          min-width: 0;
        }
        .codelab-theme .chk {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 2px solid #5be08c;
          display: grid;
          place-items: center;
          color: #5be08c;
          flex: none;
        }
        .codelab-theme .big {
          border-left: 4px solid var(--green);
        }
        .codelab-theme .sym {
          display: grid;
          grid-template-columns: minmax(0, 5.5rem) minmax(0, 1fr);
          min-width: 0;
          max-width: 100%;
          overflow-x: auto;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .codelab-theme .sym > * {
          padding: 10px 0;
          border-top: 1px solid var(--line);
          min-width: 0;
        }
        .codelab-theme .sym > :nth-child(-n+2) {
          border-top: 0;
        }
        .codelab-theme .sym .s {
          font: 600 0.95rem ui-monospace, SFMono-Regular, Menlo, monospace;
          overflow-wrap: anywhere;
          word-break: break-all;
          min-width: 0;
        }
        .codelab-theme .sym b {
          display: block;
          font-weight: 600;
        }
        .codelab-theme .sym .u {
          display: block;
          color: var(--green);
          font-size: .85rem;
          font-weight: 600;
        }
        .codelab-theme nav {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          background: var(--card);
          border-top: 1px solid var(--line);
          padding: 8px 8px calc(8px + env(safe-area-inset-bottom, 0px));
          z-index: 40;
        }
        .codelab-theme nav div {
          max-width: 640px;
          margin: 0 auto;
          display: flex;
          justify-content: space-around;
        }
        .codelab-theme nav span {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          font-size: .72rem;
          color: var(--muted);
          min-width: 56px;
          cursor: pointer;
        }
        .codelab-theme nav span.on {
          color: var(--green);
          font-weight: 700;
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

          <div className="logo">CodeLab</div>

          {/* Segmented Mode Switcher (Notes vs Exam) */}
          <div className="flex items-center p-0.5 rounded-lg bg-[var(--card2)] border border-[var(--line)] shrink-0">
            <button
              onClick={() => setLabStyle('notes')}
              className={`px-3 py-1 rounded text-xs font-semibold transition-all cursor-pointer ${
                labStyle === 'notes'
                  ? 'bg-[var(--green)] text-black font-bold'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              Notes
            </button>
            <button
              onClick={() => setLabStyle('exam')}
              className={`px-3 py-1 rounded text-xs font-semibold transition-all cursor-pointer ${
                labStyle === 'exam'
                  ? 'bg-[var(--green)] text-black font-bold'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              Exam
            </button>
          </div>

          {/* Avatar in Green */}
          <div className="avatar">CL</div>
        </div>

        {/* PROMINENT CARD SWITCHER BAR (Direct top buttons to access all challenges/cards) */}
        {challenges.length > 1 && (
          <div className="mb-3.5 p-2 rounded-2xl bg-[var(--card)] border border-[var(--line)] shadow-sm flex items-center justify-between gap-2 select-none">
            <button
              onClick={() => handleChallengeChange(Math.max(0, currentIndex - 1))}
              disabled={currentIndex === 0}
              className="px-2.5 py-1.5 rounded-xl border border-[var(--line)] bg-[var(--card2)] disabled:opacity-20 text-xs font-bold text-[var(--text)] flex items-center gap-1 hover:border-[var(--green)] transition-all cursor-pointer shrink-0"
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
                      ? 'bg-[var(--green)] text-black shadow-[0_2px_10px_rgba(47,209,106,0.45)] scale-105'
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
              className="px-2.5 py-1.5 rounded-xl border border-[var(--line)] bg-[var(--card2)] disabled:opacity-20 text-xs font-bold text-[var(--text)] flex items-center gap-1 hover:border-[var(--green)] transition-all cursor-pointer shrink-0"
              title="Next Card"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* HERO SECTION */}
        <header className="hero">
          <p className="tag">Notebook · Challenge {currentIndex + 1} of {challenges.length}</p>
          <h1>{currentChallenge.topic}</h1>
          <div className="chips">
            <span className="chip">{langKey.toUpperCase()}</span>
            <span className="chip">{currentChallenge.category || 'Algorithms'}</span>
            <span className="chip">{labStyle === 'exam' ? (mode === 'bug_hunter' ? 'Bug Hunter' : mode === 'practice' ? 'Practice' : 'Build') : 'Notes Style'}</span>
          </div>

          {/* Signature / Blueprint preview */}
          {syntaxBlueprint && (
            <div className="eqbox mt-2 text-xs sm:text-sm">
              <code>{formatCodeSnippet(syntaxBlueprint)}</code>
            </div>
          )}
        </header>

        {/* ===================== NOTES STYLE ===================== */}
        {labStyle === 'notes' && (
          <>
            {/* 1. IN PLAIN WORDS CARD */}
            {(currentChallenge.codeLabData?.in_plain_words || currentChallenge.description) && (
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
                        speakSingle(currentChallenge.codeLabData?.in_plain_words || currentChallenge.description)
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
                  <MathFormattedText text={currentChallenge.codeLabData?.in_plain_words || currentChallenge.description || ''} />
                </p>
              </section>
            )}

            {/* 2. GIVEN CARD */}
            {suiteDisplay && (
              <section className="card">
                <div className="head">
                  <h2>Given</h2>
                  <button className="btn" onClick={handleCopyGiven} aria-label="Copy given suite">
                    <Copy size={16} />
                    <span>{copiedGiven ? 'Copied' : ''}</span>
                  </button>
                </div>
                <div className="eqbox text-xs">
                  <code>{suiteDisplay}</code>
                </div>
              </section>
            )}

            {/* 3. FORMULA / STARTER CODE CARD */}
            <section className="card">
              <div className="head">
                <h2>Starter &amp; Syntax</h2>
                <button className="btn" onClick={() => setShowFormulaDetails(!showFormulaDetails)}>
                  <span>See details</span>
                  <ChevronRight size={16} className={`transition-transform ${showFormulaDetails ? 'rotate-90' : ''}`} />
                </button>
              </div>
              <div className="frm">
                <div style={{ flex: '1 1 100%' }}>
                  <p className="lab">Template Blueprint</p>
                  <div className="eqbox text-xs">
                    <code>{formatCodeSnippet(currentChallenge.scenario?.starterTemplate || currentChallenge.scenario?.sampleSolution || '')}</code>
                  </div>
                </div>
              </div>
              <p className={`note ${showFormulaDetails ? 'on' : ''}`}>
                Analyze signature types, parameter definitions, and memory lifecycle constraints before executing test scenarios.
              </p>
            </section>

            {/* 4. STEP-BY-STEP SOLUTION / LOGIC BREAKDOWN */}
            <section className="card">
              <h2 style={{ marginBottom: '14px' }}>Step-by-step solution</h2>
              
              <div className="step">
                <div className="num">1</div>
                <div>
                  <p className="t">Method signature and input parameters</p>
                  <div className="eqbox text-xs">
                    <code>{formatCodeSnippet(currentChallenge.scenario?.starterTemplate || '')}</code>
                  </div>
                </div>
              </div>

              <div className="step">
                <div className="num">2</div>
                <div>
                  <p className="t">Algorithmic implementation</p>
                  <div className="eqbox text-xs">
                    <code>{formatCodeSnippet(currentChallenge.scenario?.sampleSolution || '')}</code>
                  </div>
                </div>
              </div>

              <div className="step">
                <div className="num">3</div>
                <div>
                  <p className="t">Execution verification and return</p>
                  <div className="eqbox text-xs">
                    <code>{finalExpected}</code>
                  </div>
                </div>
              </div>
            </section>

            {/* 5. FINAL EXPECTED OUTPUT BANNER */}
            <section className="final">
              <div>
                <small>Expected Output</small>
                <div className="v">{finalExpected}</div>
              </div>
              <div className="chk">
                <Check size={24} />
              </div>
            </section>

            {/* 6. BIG IDEA CARD */}
            <section className="card big">
              <h2 style={{ marginBottom: '8px' }}>Big idea</h2>
              <p className="leading-relaxed">
                <MathFormattedText
                  text={
                    currentChallenge.codeLabData?.in_plain_words
                      ? `Master the fundamental flow of ${currentChallenge.topic}. Pay attention to edge conditions and return signatures.`
                      : 'Consistent code architecture and proper contract handling prevent runtime exceptions and memory degradation.'
                  }
                />
              </p>
            </section>

            {/* 7. PARAMETERS AND TYPES CARD */}
            {dataMap.length > 0 && (
              <section className="card">
                <h2 style={{ marginBottom: '6px' }}>Parameters and Types</h2>
                <div className="sym">
                  {dataMap.map((row, idx) => (
                    <React.Fragment key={idx}>
                      <span className="s font-mono text-xs">{row.fn || row.section}</span>
                      <div>
                        <b>{row.concept}</b>
                        <span className="u">
                          <MathFormattedText text={row.memory_effect || ''} />
                        </span>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* ===================== EXAM STYLE ===================== */}
        {labStyle === 'exam' && (
          <>
            <section className="card">
              <div className="head">
                <h2>Interactive IDE &amp; Runner</h2>
                <div className="flex items-center gap-1 bg-[var(--card2)] p-0.5 rounded-lg text-xs">
                  <button
                    onClick={() => setMode('scenario')}
                    className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                      mode === 'scenario' ? 'bg-[var(--green)] text-black font-bold' : 'text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    Build
                  </button>
                  <button
                    onClick={() => setMode('bug_hunter')}
                    className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                      mode === 'bug_hunter' ? 'bg-[var(--green)] text-black font-bold' : 'text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    Bug Hunter
                  </button>
                  {practice && (
                    <button
                      onClick={() => setMode('practice')}
                      className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                        mode === 'practice' ? 'bg-[var(--green)] text-black font-bold' : 'text-[var(--muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      Practice
                    </button>
                  )}
                </div>
              </div>

              {/* Objective Statement */}
              <div className="mb-3">
                <p className="lab">
                  {mode === 'scenario' ? 'Objective' : mode === 'bug_hunter' ? 'Debug Objective' : 'Practice Objective'}
                </p>
                <p className="text-sm text-neutral-300">
                  <MathFormattedText text={modeData?.scenarioPrompt || ''} />
                </p>
              </div>

              {/* Solution toggle */}
              {showSolution && modeData && (
                <div className="mb-3 eqbox text-xs text-[#2fd16a] border border-[#2fd16a]/30">
                  <p className="lab text-[#2fd16a]">Reference Solution</p>
                  <code>
                    {mode === 'scenario'
                      ? currentChallenge.scenario.sampleSolution
                      : mode === 'bug_hunter'
                      ? currentChallenge.bugHunter.cleanSolution
                      : (practice?.hint || practice?.starterCode || '')}
                  </code>
                </div>
              )}

              {/* Code Editor Container */}
              <div className="rounded-xl border border-[var(--line)] overflow-hidden bg-[var(--card2)] mb-3">
                <div className="bg-[var(--card)] px-3 py-1.5 border-b border-[var(--line)] flex items-center justify-between text-xs font-mono text-[var(--muted)]">
                  <span>Main.{ext}</span>
                  <span>{lines.length} lines</span>
                </div>

                <div className="flex bg-[var(--card2)] min-h-[300px]">
                  <div
                    ref={lineNumbersRef}
                    className="select-none text-[var(--muted)] text-right py-3 px-2 border-r border-[var(--line)] font-mono text-xs leading-5 shrink-0 min-w-[36px]"
                  >
                    {lines.map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>

                  <textarea
                    ref={textareaRef}
                    value={userCode}
                    onChange={(e) => {
                      setUserCode(e.target.value)
                      setFeedback({ status: 'idle', message: '' })
                    }}
                    onScroll={(e) => {
                      if (lineNumbersRef.current) {
                        lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop
                      }
                    }}
                    onKeyDown={handleKeyDown}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoComplete="off"
                    autoCorrect="off"
                    className="flex-1 w-full min-h-[300px] p-3 font-mono text-xs sm:text-sm leading-5 text-[var(--text)] bg-transparent outline-none resize-y whitespace-pre"
                    placeholder="// Enter code here..."
                  />
                </div>

                {/* Actions Bar */}
                <div className="p-2 border-t border-[var(--line)] bg-[var(--card)] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setShowSolution(!showSolution)}
                      className="px-2.5 py-1 rounded-lg border border-[var(--line)] hover:bg-[var(--card2)] text-xs text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
                    >
                      {showSolution ? 'Hide Solution' : 'View Solution'}
                    </button>
                    <button
                      onClick={handleReset}
                      className="px-2.5 py-1 rounded-lg border border-[var(--line)] hover:bg-[var(--card2)] text-xs text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
                    >
                      Reset
                    </button>
                  </div>

                  <button
                    onClick={handleRun}
                    className="px-4 py-1.5 rounded-lg bg-[var(--green)] text-black font-bold text-xs flex items-center gap-1.5 hover:opacity-90 active:scale-95 transition-all cursor-pointer"
                  >
                    <Play size={13} fill="currentColor" />
                    <span>Run Code</span>
                  </button>
                </div>
              </div>

              {/* Output Console Embedded */}
              <div className="eqbox text-xs max-h-44 overflow-y-auto">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="flex items-center gap-1 text-[var(--muted)] font-bold uppercase text-[10px]">
                    <Terminal size={12} />
                    <span>Console Output</span>
                  </span>
                  {feedback.status !== 'idle' && (
                    <span className={`font-semibold flex items-center gap-1 ${
                      feedback.status === 'success' ? 'text-[var(--green)]' : 'text-rose-400'
                    }`}>
                      {feedback.status === 'success' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                      {feedback.message}
                    </span>
                  )}
                </div>
                {feedback.output ? (
                  <pre className="whitespace-pre-wrap leading-relaxed text-[var(--text)]">
                    <code>{feedback.output}</code>
                  </pre>
                ) : (
                  <p className="text-[var(--muted)] italic text-xs">Click Run Code to verify execution output.</p>
                )}
              </div>
            </section>

            {/* Expected Output Banner */}
            <section className="final">
              <div>
                <small>Expected Output</small>
                <div className="v">{finalExpected}</div>
              </div>
              <div className="chk">
                <Check size={24} />
              </div>
            </section>
          </>
        )}
      </main>

      {/* AI Practice Drawer */}
      {currentChallenge && (
        <AIPracticeDrawer
          kind="code"
          deckId={deckId || 'code-lab'}
          language={langKey as any}
          currentScreenContext={{
            screen: 'code',
            topic: currentChallenge.topic,
            activeTab: labStyle === 'notes' ? 'notebook' : 'ide',
            mode,
            language: langKey,
            userCode,
            expectedOutput: currentChallenge.scenario?.simulatedOutput || currentChallenge.bugHunter?.simulatedOutput,
            bugDescriptions: currentChallenge.bugHunter?.bugDescriptions,
            feedbackStatus: feedback.status,
            feedbackOutput: feedback.output || feedback.message,
          }}
        />
      )}
    </div>
  )
}
