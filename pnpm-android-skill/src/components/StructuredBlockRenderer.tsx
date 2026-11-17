'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronUp, Copy, Check, Zap, GitFork, Target } from 'lucide-react'
import type { BackBlock } from '@/lib/relay/relayTypes'
import MathFormattedText from './MathFormattedText'

/**
 * Strips unbalanced ** markers and completely strips ** inside back_blocks.
 * Also prevents label and content from sharing one bold span.
 */
export function sanitizeBlockString(text: string, stripAllBold: boolean = true): string {
  if (!text) return ''
  let s = String(text)

  if (stripAllBold) {
    return s.replace(/\*\*/g, '').trim()
  }

  // Count ** markers: if odd, remove the trailing one
  const matches = s.match(/\*\*/g)
  if (matches && matches.length % 2 !== 0) {
    const lastIdx = s.lastIndexOf('**')
    s = s.slice(0, lastIdx) + s.slice(lastIdx + 2)
  }

  // Strip empty **** markers
  s = s.replace(/\*\*\s*\*\*/g, '')

  return s.trim()
}

/**
 * Removes redundant card title prefix from block labels (case-insensitive)
 * e.g. "Equal-Frequency Binning Procedure" -> "Procedure"
 */
export function cleanBlockLabel(label: string, cardTitle?: string): string {
  if (!label) return ''
  let clean = sanitizeBlockString(label, true)

  if (cardTitle && cardTitle.trim()) {
    const titleTrimmed = cardTitle.trim()
    const regex = new RegExp(`^${titleTrimmed}[:\\s–-]+`, 'i')
    clean = clean.replace(regex, '').trim()

    // Also check single significant words from title if label starts with it
    const firstWord = titleTrimmed.split(/\s+/)[0]
    if (firstWord && firstWord.length > 4) {
      const wordRegex = new RegExp(`^${firstWord}[:\\s–-]+`, 'i')
      clean = clean.replace(wordRegex, '').trim()
    }
  }

  return clean || label
}

interface StructuredBlockRendererProps {
  blocks: BackBlock[]
  cardTitle?: string
  hideBold?: boolean
  hideVerbatimDrawer?: boolean
}

function CollapsibleVerbatimBlock({
  label,
  slide,
  text,
  hideBold,
}: {
  label?: string
  slide?: number
  text: string
  hideBold?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.04] overflow-hidden transition-all">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-amber-500/[0.08] transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30 select-none shrink-0">
            Verbatim Source
          </span>
          <span className="text-xs font-medium text-[var(--color-text-secondary,#cbd5e1)] truncate">
            {label || 'Exact Document / Slide Wording'}
            {typeof slide === 'number' ? ` (Slide ${slide})` : ''}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/80">
            {open ? 'Hide' : 'Show Verbatim'}
          </span>
          {open ? (
            <ChevronUp className="w-4 h-4 text-amber-300" />
          ) : (
            <ChevronDown className="w-4 h-4 text-amber-300" />
          )}
        </div>
      </button>

      {open && (
        <div className="px-3.5 pb-3.5 pt-2 border-t border-amber-500/20 bg-[var(--color-surface-1)]/70 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Word-for-word excerpt from parsed document
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--color-surface-3)] hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] border border-[var(--color-border)] transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <blockquote className="pl-3 border-l-2 border-amber-400/50 text-xs sm:text-sm italic leading-relaxed text-[var(--color-text-secondary,#cbd5e1)] whitespace-pre-wrap break-words">
            <MathFormattedText text={sanitizeBlockString(text, false)} hideBold={hideBold} />
          </blockquote>
        </div>
      )}
    </div>
  )
}

export default function StructuredBlockRenderer({
  blocks,
  cardTitle,
  hideBold = false,
  hideVerbatimDrawer = false,
}: StructuredBlockRendererProps) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null

  const isKeyConcepts = cardTitle ? /key\s*concept/i.test(cardTitle) : false
  let defCounter = 0

  // Filter or keep verbatim blocks based on hideVerbatimDrawer
  const activeBlocks = hideVerbatimDrawer
    ? blocks.filter((b) => b && b.kind !== 'verbatim')
    : blocks

  // If hideVerbatimDrawer left 0 blocks (card had only verbatim block), fallback to rendering all blocks so card is not blank
  const candidateBlocks = activeBlocks.length > 0 ? activeBlocks : blocks

  // Always keep verbatim blocks pinned to the bottom of the card
  const sortedBlocks = [
    ...candidateBlocks.filter((b) => b && b.kind !== 'verbatim'),
    ...candidateBlocks.filter((b) => b && b.kind === 'verbatim'),
  ]

  const renderSingleBlock = (block: BackBlock, idx: number) => {
    switch (block.kind) {
      case 'what_breaks': {
        const label = cleanBlockLabel(block.label || 'If You Do Nothing — What Breaks?', cardTitle)
        const nickname = block.nickname ? sanitizeBlockString(block.nickname, true) : ''
        return (
          <div
            key={idx}
            className="rounded-xl p-3.5 sm:p-4 bg-rose-500/[0.07] border border-rose-500/25 shadow-sm my-2"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/30 select-none">
                <Zap size={11} className="text-rose-400" /> {label}
              </span>
              {nickname && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 select-none">
                  Action Nickname: {nickname}
                </span>
              )}
            </div>
            <div className="text-sm sm:text-[14.5px] font-normal text-[var(--color-text-primary)] leading-relaxed">
              <MathFormattedText text={sanitizeBlockString(block.text, false)} hideBold={hideBold} />
            </div>
          </div>
        )
      }

      case 'ascii_diagram': {
        const label = cleanBlockLabel(block.label || '2-Branch Mechanical Flow', cardTitle)
        return (
          <div
            key={idx}
            className="rounded-xl overflow-hidden bg-[var(--color-surface-1)] border border-[var(--color-border)] my-2.5 shadow-sm"
          >
            {label && (
              <div className="px-3.5 py-2 bg-[var(--color-surface-3)] border-b border-[var(--color-border)] flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300 select-none flex items-center gap-1.5">
                  <GitFork size={12} className="text-cyan-400" /> {label}
                </span>
                <span className="text-[10px] text-[var(--color-text-muted)] select-none">
                  3D Flow Map
                </span>
              </div>
            )}
            <pre className="p-3.5 overflow-x-auto font-mono text-[11.5px] sm:text-xs leading-[1.5] text-cyan-100/95 whitespace-pre select-text">
              {block.diagram}
            </pre>
          </div>
        )
      }

      case 'switch_tldr': {
        const label = cleanBlockLabel(block.label || '3-Sentence Switch TL;DR', cardTitle)
        return (
          <div
            key={idx}
            className="rounded-xl p-3.5 sm:p-4 bg-emerald-500/[0.06] border border-emerald-500/25 my-2.5 space-y-2"
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 select-none">
                <Target size={11} className="text-emerald-400" /> {label}
              </span>
            </div>
            <div className="space-y-1.5 text-xs sm:text-sm leading-relaxed">
              {block.match_path && (
                <div className="flex items-start gap-2">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-300 shrink-0 mt-0.5">
                    Fast / Match
                  </span>
                  <div className="flex-1 min-w-0 text-[var(--color-text-primary)]">
                    <MathFormattedText text={sanitizeBlockString(block.match_path, false)} hideBold={hideBold} />
                  </div>
                </div>
              )}
              {block.mismatch_path && (
                <div className="flex items-start gap-2">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 shrink-0 mt-0.5">
                    Slow / Mismatch
                  </span>
                  <div className="flex-1 min-w-0 text-[var(--color-text-primary)]">
                    <MathFormattedText text={sanitizeBlockString(block.mismatch_path, false)} hideBold={hideBold} />
                  </div>
                </div>
              )}
              {block.checker && (
                <div className="flex items-start gap-2">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-cyan-500/20 text-cyan-300 shrink-0 mt-0.5">
                    The Checker
                  </span>
                  <div className="flex-1 min-w-0 text-[var(--color-text-primary)]">
                    <MathFormattedText text={sanitizeBlockString(block.checker, false)} hideBold={hideBold} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      }

      case 'verbatim': {
        if (!block.text) return null
        return (
          <CollapsibleVerbatimBlock
            key={idx}
            label={block.label}
            slide={block.slide}
            text={block.text}
            hideBold={hideBold}
          />
        )
      }
      case 'definition': {
        defCounter++
        const rawTerm = sanitizeBlockString(block.term, false).replace(/^\d+[\.\)]\s*/, '').trim()
        const cleanTerm = rawTerm
        const cleanText = sanitizeBlockString(block.text, false)

        // Check if cleanText ends with a formula/equation (e.g. "...: tau = r F sin(theta).")
        let bodyText = cleanText
        let extractedFormula: string | null = null
        const colonEqMatch = cleanText.match(/^(.*?)(?::\s*)([A-Za-z0-9_\\^+\-*/=()\s]{3,}\s*=\s*[A-Za-z0-9_\\^+\-*/=()\s]{2,}\.?)$/)
        if (colonEqMatch && colonEqMatch[1].length > 10) {
          bodyText = colonEqMatch[1].trim()
          extractedFormula = colonEqMatch[2].replace(/\.$/, '').trim()
        }

        return (
          <div
            key={idx}
            className="rounded-xl p-3.5 sm:p-4 bg-[var(--color-surface-2)]/60 border border-[var(--color-border)] shadow-sm my-2.5 transition-all"
          >
            {cleanTerm && (
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/25 select-none">
                  Concept
                </span>
                {isKeyConcepts && (
                  <span className="text-sm sm:text-base font-normal text-[var(--color-text-muted)] select-none">
                    {defCounter}.
                  </span>
                )}
                <span className="text-sm sm:text-base font-bold text-[var(--color-text-primary)] tracking-tight">
                  <MathFormattedText text={cleanTerm} hideBold={hideBold} />
                </span>
              </div>
            )}
            <div className="text-sm sm:text-[14.5px] font-normal text-[var(--color-text-secondary,#cbd5e1)] leading-relaxed">
              <MathFormattedText text={bodyText} hideBold={hideBold} />
            </div>
            {extractedFormula && (
              <div className="mt-2.5 px-3 py-1.5 rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-border)] font-mono text-xs sm:text-sm text-[var(--color-accent)] inline-flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] select-none">Formula</span>
                <MathFormattedText text={extractedFormula} hideBold={hideBold} />
              </div>
            )}
          </div>
        )
      }

      case 'steps': {
        const label = cleanBlockLabel(block.label || 'Procedure', cardTitle)
        const items = Array.isArray(block.items) ? block.items : []
        return (
          <div key={idx} className="space-y-2">
            {label && (
              <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)] select-none">
                {label}
              </span>
            )}
            <ol className="space-y-2.5">
              {items.map((item, itemIdx) => (
                <li
                  key={itemIdx}
                  className="flex items-start gap-2.5 text-sm sm:text-[15px] leading-[1.55] text-[var(--color-text-secondary,#cbd5e1)]"
                >
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-surface-3)] text-[var(--color-accent)] font-semibold text-xs shrink-0 select-none mt-0.5">
                    {itemIdx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <MathFormattedText text={sanitizeBlockString(item, false)} hideBold={hideBold} />
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )
      }

      case 'table': {
        const columns = Array.isArray(block.columns) ? block.columns : []
        const rows = Array.isArray(block.rows) ? block.rows : []

        return (
          <div
            key={idx}
            className="overflow-hidden rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] shadow-sm select-text w-full my-2.5"
          >
            <div className="overflow-x-auto max-w-full w-full">
              <table className="w-full text-left text-xs sm:text-sm font-normal border-collapse tabular-nums">
                <thead>
                  <tr className="bg-[var(--color-surface-3)] border-b border-[var(--color-border)]">
                    {columns.map((col, colIdx) => (
                      <th
                        key={colIdx}
                        className="px-3.5 py-3 sm:px-4 sm:py-3.5 text-[11px] font-bold text-[var(--color-text-primary)] border-r last:border-r-0 border-[var(--color-border)] uppercase tracking-wider"
                      >
                        <MathFormattedText text={col} hideBold={hideBold} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {rows.map((row, rIdx) => (
                    <tr
                      key={rIdx}
                      className="even:bg-[var(--color-surface-1)]/40 hover:bg-[var(--color-surface-3)]/40 transition-colors"
                    >
                      {row.map((cell, cIdx) => (
                        <td
                          key={cIdx}
                          className={`px-3.5 py-3 sm:px-4 sm:py-3.5 text-[var(--color-text-primary)] border-r last:border-r-0 border-[var(--color-border)] text-left ${
                            cIdx === 0 ? 'font-semibold' : ''
                          }`}
                        >
                          <MathFormattedText text={sanitizeBlockString(cell, false)} hideBold={hideBold} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      }

      case 'formula': {
        const label = cleanBlockLabel(block.label || 'Formula', cardTitle)
        return (
          <div key={idx} className="space-y-1 my-1">
            {label && (
              <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)] select-none">
                {label}
              </span>
            )}
            <div className="overflow-x-auto py-2 px-3 rounded-lg bg-[var(--color-surface-1)] border border-[var(--color-border)] font-mono text-xs sm:text-sm text-[var(--color-accent)]">
              <MathFormattedText text={block.text} hideBold={hideBold} />
            </div>
          </div>
        )
      }

      case 'example': {
        const label = cleanBlockLabel(block.label || 'Example', cardTitle)
        return (
          <div
            key={idx}
            className="ml-4 pl-3.5 py-2.5 rounded-r-xl border-l-2 border-l-[var(--color-accent,#ff2d85)]/60 bg-[var(--color-surface-2)]/40 min-w-0"
          >
            {label && (
              <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-accent)] block mb-1">
                {label}
              </span>
            )}
            <div className="text-sm leading-[1.55] text-[var(--color-text-secondary,#cbd5e1)]">
              <MathFormattedText text={sanitizeBlockString(block.text, false)} hideBold={hideBold} />
            </div>
          </div>
        )
      }

      case 'note': {
        return (
          <div key={idx} className="text-sm sm:text-[14.5px] font-normal leading-relaxed text-[var(--color-text-secondary,#cbd5e1)] py-1.5 flex items-start gap-2.5 min-w-0">
            <span className="text-[var(--color-accent)] select-none mt-1 shrink-0">•</span>
            <div className="flex-1 min-w-0 break-words">
              <MathFormattedText text={sanitizeBlockString(block.text, false)} hideBold={hideBold} />
            </div>
          </div>
        )
      }

      case 'pros_cons': {
        const label = cleanBlockLabel(block.label || 'Advantages & Disadvantages', cardTitle)
        const pros = Array.isArray(block.pros) ? block.pros : []
        const cons = Array.isArray(block.cons) ? block.cons : []
        return (
          <div key={idx} className="space-y-2 my-2">
            {label && (
              <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)] select-none">
                {label}
              </span>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {pros.length > 0 && (
                <div className="rounded-xl p-3 bg-emerald-500/10 border border-emerald-500/20">
                  <span className="text-xs font-semibold text-emerald-400 block mb-1.5">Advantages / Pros</span>
                  <ul className="space-y-1 text-xs sm:text-sm text-[var(--color-text-primary)]">
                    {pros.map((p, pIdx) => (
                      <li key={pIdx} className="flex items-start gap-1.5">
                        <span className="text-emerald-400 mt-0.5">•</span>
                        <div className="flex-1 min-w-0">
                          <MathFormattedText text={sanitizeBlockString(p, false)} hideBold={hideBold} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {cons.length > 0 && (
                <div className="rounded-xl p-3 bg-rose-500/10 border border-rose-500/20">
                  <span className="text-xs font-semibold text-rose-400 block mb-1.5">Disadvantages / Cons</span>
                  <ul className="space-y-1 text-xs sm:text-sm text-[var(--color-text-primary)]">
                    {cons.map((c, cIdx) => (
                      <li key={cIdx} className="flex items-start gap-1.5">
                        <span className="text-rose-400 mt-0.5">•</span>
                        <div className="flex-1 min-w-0">
                          <MathFormattedText text={sanitizeBlockString(c, false)} hideBold={hideBold} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )
      }

      default:
        return null
    }
  }

  return (
    <div className="space-y-3 sm:space-y-3.5">
      {sortedBlocks.map((block, index) => renderSingleBlock(block, index))}
    </div>
  )
}
