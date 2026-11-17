'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, Eye, EyeOff, Search, ChevronDown, ChevronUp, Tag, Volume2, VolumeX } from 'lucide-react'
import { getCardsByDeck, bulkDeleteCards } from '@/db/cardRepository'
import { getDeck } from '@/db/deckRepository'
import { normalizeTextForDedup } from '@/lib/deckDeduplicator'
import { getAuthHeaders } from '@/lib/supabase'
import TopBar from '@/components/TopBar'
import ExportButton from '@/features/export/ExportButton'
import MathFormattedText from '@/components/MathFormattedText'
import StructuredBlockRenderer from '@/components/StructuredBlockRenderer'
import NotesScreen from '@/ui/NotesScreen'
import { useTTS } from '@/hooks/useTTS'
import type { Card, Deck } from '@/lib/zodSchemas'
import type { BackBlock } from '@/lib/relay/relayTypes'

function parseRawNoteToBlocks(rawText: string, cardTitle?: string): BackBlock[] {
  if (!rawText) return []
  const blocks: BackBlock[] = []

  // 1. Check for table directives &[TABLE: ...]
  const tableRegex = /&\[TABLE:\s*([\s\S]*?)\]/gi
  const cleanedText = rawText.replace(tableRegex, (_, content) => {
    if (content.includes('||') || content.includes('¦')) {
      const rawRows = content.split('||').map((r: string) => r.trim()).filter(Boolean)
      if (rawRows.length > 0) {
        const columns = rawRows[0].split('¦').map((c: string) => c.trim()).filter(Boolean)
        const rows = rawRows.slice(1).map((row: string) => row.split('¦').map((c: string) => c.trim()))
        blocks.push({ kind: 'table', label: 'Data Table', columns, rows })
      }
    } else {
      const lines = content.split('|').map((s: string) => s.trim()).filter(Boolean)
      if (lines.length > 0) {
        const columns = lines[0].split(',').map((c: string) => c.trim())
        const rows = lines.slice(1).map((r: string) => r.split(',').map((c: string) => c.trim()))
        blocks.push({ kind: 'table', label: 'Data Table', columns, rows })
      }
    }
    return ''
  })

  // 2. Process remaining lines/bullets
  const lines = cleanedText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const stepItems: string[] = []
  let activeStepLabel = 'Key Steps'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const cleanLine = line.replace(/^[•\-\*]\s*/, '').trim()
    if (!cleanLine) continue

    // Numbered step (e.g. "1. Step description" or "Step 1:")
    const stepMatch = cleanLine.match(/^(?:(?:Step\s+)?(\d+)[:.)]\s*)(.*)/i)
    if (stepMatch) {
      stepItems.push(stepMatch[2] || cleanLine)
      continue
    }

    // Sub-header label like "UCD Process :" or "Key Principles:"
    if (/^[A-Za-z0-9\s()&/,'.-]{1,40}\s*:$/i.test(cleanLine)) {
      if (stepItems.length > 0) {
        blocks.push({ kind: 'steps', label: activeStepLabel, items: [...stepItems] })
        stepItems.length = 0
      }
      activeStepLabel = cleanLine.replace(/:$/, '').trim()
      continue
    }

    // If we have accumulated numbered steps, flush them before processing a non-step
    if (stepItems.length > 0) {
      blocks.push({ kind: 'steps', label: activeStepLabel, items: [...stepItems] })
      stepItems.length = 0
      activeStepLabel = 'Key Steps'
    }

    // Example style
    if (/^example[:–-]/i.test(cleanLine)) {
      blocks.push({
        kind: 'example',
        label: 'Example',
        text: cleanLine.replace(/^example[:–-]\s*/i, ''),
      })
      continue
    }

    // Formula style
    if (/^formula[:–-]/i.test(cleanLine) || cleanLine.includes('$$')) {
      blocks.push({
        kind: 'formula',
        label: 'Formula',
        text: cleanLine.replace(/^formula[:–-]\s*/i, ''),
      })
      continue
    }

    // Definition style: "Term — Definition", "Term – Definition", "Term: Definition", "**Term** — Definition"
    const defMatch = cleanLine.match(/^(?:(?:\d+[:.)]\s*)?(\*\*[^*]+\*\*|[A-Za-z0-9][A-Za-z0-9\s()&/,'.-]{1,50}?))\s*(?:—|–|:|-)\s+(.+)/)
    if (defMatch) {
      let term = defMatch[1].replace(/\*\*/g, '').trim()
      term = term.replace(/^\d+[\.\)]\s*/, '').trim()
      blocks.push({
        kind: 'definition',
        term,
        text: defMatch[2].trim(),
      })
      continue
    }

    // If multiple short standalone lines follow each other, treat as list items
    if (cleanLine.length < 50 && !cleanLine.endsWith('.')) {
      stepItems.push(cleanLine)
      continue
    }

    // Default note block
    blocks.push({
      kind: 'note',
      text: cleanLine,
    })
  }

  if (stepItems.length > 0) {
    blocks.push({ kind: 'steps', label: activeStepLabel, items: stepItems })
  }

  return blocks
}

function FormattedNoteText({ text, hideBold = false }: { text: string; hideBold?: boolean }) {
  // If the text is or contains a Table Directive or Markdown Table, render it directly via MathFormattedText
  if (/&\[\s*table/i.test(text) || (text.includes('|') && text.includes('\n') && /\|.*\|/.test(text))) {
    return (
      <div className="text-sm sm:text-[15px] text-[var(--color-text-primary)] leading-relaxed">
        <MathFormattedText text={text} hideBold={hideBold} />
      </div>
    )
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  // Split multiple lines or bullet points
  const items: string[] = []
  for (const line of lines) {
    if (line.includes('•') && !/&\[/i.test(line)) {
      const parts = line.split('•').map(p => p.trim()).filter(Boolean)
      items.push(...parts)
    } else {
      items.push(line)
    }
  }

  if (items.length === 0) {
    return (
      <div className="text-sm sm:text-[15px] text-[var(--color-text-primary)] leading-relaxed">
        <MathFormattedText text={text} hideBold={hideBold} />
      </div>
    )
  }

  return (
    <div className="space-y-1.5 pt-1">
      {items.map((item, idx) => {
        // If this item contains a Table or Code directive, render it directly without splitting on '|'
        if (/&\[/i.test(item)) {
          return (
            <div key={idx} className="my-1.5">
              <MathFormattedText text={item} hideBold={hideBold} />
            </div>
          )
        }

        // Check for key-value pair like "Born: Feb 8, 1890 | Died: Oct 2, 1960"
        const segments = item.split('|').map(s => s.trim()).filter(Boolean)

        return (
          <div key={idx} className="flex items-start gap-2 text-sm sm:text-[14.5px] font-normal text-[var(--color-text-secondary,#cbd5e1)] leading-relaxed min-w-0">
            <span className="text-[var(--color-accent)] mt-1 select-none shrink-0">•</span>
            <div className="flex-1 min-w-0 flex flex-wrap gap-x-3 gap-y-1 break-words [overflow-wrap:anywhere]">
              {segments.map((seg, sIdx) => {
                const colonIdx = seg.indexOf(':')
                const dashEnIdx = seg.indexOf(' – ')
                const dashHyIdx = seg.indexOf(' - ')
                const equalIdx = seg.indexOf(' = ')

                let label = ''
                let value = ''
                let separator = ''

                if (colonIdx > 0 && colonIdx < 40) {
                  label = seg.slice(0, colonIdx).trim()
                  value = seg.slice(colonIdx + 1).trim()
                  separator = ':'
                } else if (dashEnIdx > 0 && dashEnIdx < 40) {
                  label = seg.slice(0, dashEnIdx).trim()
                  value = seg.slice(dashEnIdx + 3).trim()
                  separator = '–'
                } else if (dashHyIdx > 0 && dashHyIdx < 40) {
                  label = seg.slice(0, dashHyIdx).trim()
                  value = seg.slice(dashHyIdx + 3).trim()
                  separator = '-'
                } else if (equalIdx > 0 && equalIdx < 40) {
                  label = seg.slice(0, equalIdx).trim()
                  value = seg.slice(equalIdx + 3).trim()
                  separator = '='
                }

                if (label && value) {
                  // Separate leading numbering (e.g. "1. ", "2) ") so the number is NOT rendered bold
                  const numMatch = label.match(/^(\d+[\.\)]\s*)(.*)$/)
                  let numPrefix = ''
                  let actualLabel = label
                  if (numMatch) {
                    numPrefix = numMatch[1]
                    actualLabel = numMatch[2]
                  }
                  const boldLabelText = actualLabel.includes('**') ? actualLabel : `**${actualLabel}**`
                  return (
                    <span key={sIdx} className="inline">
                      {numPrefix && (
                        <span className="font-normal text-[var(--color-text-muted)] select-none mr-1">
                          {numPrefix}
                        </span>
                      )}
                      <span className="font-semibold text-[var(--color-text-primary)] mr-1.5">
                        <MathFormattedText text={boldLabelText} hideBold={hideBold} /> {separator}
                      </span>
                      <span>
                        <MathFormattedText text={value} hideBold={hideBold} />
                      </span>
                    </span>
                  )
                }

                return (
                  <span key={sIdx}>
                    <MathFormattedText text={seg} hideBold={hideBold} />
                  </span>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function NotesContent({ deckId }: { deckId?: string }) {
  const router = useRouter()
  const effectiveDeckId = (deckId && deckId !== '_offline')
    ? deckId
    : (typeof window !== 'undefined' ? window.location.pathname.split('/study/')[1]?.split('/')[0]?.split('?')[0] || '' : '')
  const { status, currentItemId, startQueue, stop } = useTTS()
  const [deck, setDeck] = useState<Deck | null>(null)
  const [keywords, setKeywords] = useState<Card[]>([])
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [revealAll, setRevealAll] = useState(true)
  const [hideBoldKeywords, setHideBoldKeywords] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [activeNoteTab, setActiveNoteTab] = useState<'notes' | 'verbatim'>('notes')

  useEffect(() => {
    async function load() {
      if (!effectiveDeckId) return
      const [d, allCards] = await Promise.all([getDeck(effectiveDeckId), getCardsByDeck(effectiveDeckId)])
      setDeck(d ?? null)

      const isTableContent = (c: Card) =>
        /&\[\s*table/i.test(c.front || '') ||
        /&\[\s*table/i.test(c.back || '') ||
        /(?:^|\n)\|.+?\|.+?\|(?:\n|$)/.test(c.front || '') ||
        /(?:^|\n)\|.+?\|.+?\|(?:\n|$)/.test(c.back || '')

      // Look for keyword cards or any cards containing tables, fallback to definition cards if no keyword/table cards exist
      const kwOrTable = allCards.filter(c => c.type === 'keyword' || isTableContent(c))
      const rawTargetCards = kwOrTable.length > 0 ? kwOrTable : allCards.filter(c => c.type === 'definition' || c.type === 'concept')

      // Permanent 100% exact Note Deduplication on load (deletes forever in IndexedDB and backend only when 100% identical)
      // Preserves intentional enumeration-in-notes ("... (Key Concepts)") unless there are 2 identical copies of it
      const seenNoteKeys = new Set<string>()
      const dupNoteIds: string[] = []
      const targetCards: Card[] = []

      for (const c of rawTargetCards) {
        const cleanFront = normalizeTextForDedup(c.front)
        const cleanBack = normalizeTextForDedup(c.back)
        const pairKey = `${c.type}:::${cleanFront}:::${cleanBack}`

        if (seenNoteKeys.has(pairKey)) {
          dupNoteIds.push(c.id)
          continue
        }
        seenNoteKeys.add(pairKey)
        targetCards.push(c)
      }

      if (dupNoteIds.length > 0) {
        await bulkDeleteCards(dupNoteIds).catch(() => {})
        if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.onLine) {
          (async () => {
            try {
              const headers = await getAuthHeaders({ 'Content-Type': 'application/json' })
              fetch('/api/decks/deduplicate', {
                method: 'POST',
                headers,
                body: JSON.stringify({ deckId: effectiveDeckId, title: d?.title }),
              }).catch(() => {})
            } catch {}
          })()
        }
      }

      // Semantic ordering: Table data first, then definitions/core concepts, then enumerations at bottom of topic
      const isEnumCard = (c: Card) => {
        const t = (c.type as string).toLowerCase()
        return t === 'enumeration' || t === 'enum' || c.front.includes('(Key Concepts)')
      }

      const isMiscCard = (c: Card) => {
        const text = `${c.front} ${c.chapter || ''}`.toLowerCase()
        return text.includes('miscellaneous') || text.includes('overview')
      }

      targetCards.sort((a, b) => {
        // 1. Table data first
        const aTable = isTableContent(a) ? 0 : 1
        const bTable = isTableContent(b) ? 0 : 1
        if (aTable !== bTable) return aTable - bTable

        // 2. Enumeration at the bottom of the section
        const aEnum = isEnumCard(a) ? 1 : 0
        const bEnum = isEnumCard(b) ? 1 : 0
        if (aEnum !== bEnum) return aEnum - bEnum

        // 3. Miscellaneous/overview at the very end
        const aMisc = isMiscCard(a) ? 1 : 0
        const bMisc = isMiscCard(b) ? 1 : 0
        if (aMisc !== bMisc) return aMisc - bMisc

        return 0
      })

      setKeywords(targetCards)
      setRevealed(new Set(targetCards.map(c => c.id)))
      setLoading(false)
    }
    load()
  }, [effectiveDeckId])

  const toggleReveal = (id: string) => {
    setRevealed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleToggleNotes = () => {
    if (revealAll) {
      setRevealed(new Set())
      setRevealAll(false)
    } else {
      setRevealed(new Set(keywords.map(k => k.id)))
      setRevealAll(true)
    }
  }

  const filtered = keywords.filter(k =>
    !search ||
    k.front.toLowerCase().includes(search.toLowerCase()) ||
    k.back.toLowerCase().includes(search.toLowerCase()) ||
    k.chapter.toLowerCase().includes(search.toLowerCase())
  )

  // Group by chapter
  const grouped = filtered.reduce<Record<string, Card[]>>((acc, card) => {
    const chapter = card.chapter || 'General'
    if (!acc[chapter]) acc[chapter] = []
    acc[chapter].push(card)
    return acc
  }, {})

  const cleanSpeechTitle = (text: string) => {
    return text
      .replace(/\*\*/g, '')
      .replace(/__/g, '')
      .replace(/`/g, '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const getCardVerbatimText = (card: Card): string => {
    const rawBlocks: BackBlock[] =
      (card as any).back_blocks &&
      Array.isArray((card as any).back_blocks) &&
      (card as any).back_blocks.length > 0
        ? (card as any).back_blocks
        : []
    const verbatimBlock = rawBlocks.find((b) => b && b.kind === 'verbatim')
    if (verbatimBlock && verbatimBlock.text) {
      return verbatimBlock.text
    }
    return (card.back || '').replace(/&\[TABLE:\s*[\s\S]*?\]/gi, '').trim()
  }

  const parseNoteToSpeechText = (card: Card, mode: 'notes' | 'verbatim' = activeNoteTab): string => {
    if (mode === 'verbatim') {
      const verbatim = getCardVerbatimText(card)
      return verbatim
        .replace(/[*_`]/g, '')
        .replace(/•/g, '. ')
        .replace(/\n+/g, '. ')
        .replace(/\s+/g, ' ')
        .trim()
    }

    const blocks: BackBlock[] =
      (card as any).back_blocks &&
      Array.isArray((card as any).back_blocks) &&
      (card as any).back_blocks.length > 0
        ? (card as any).back_blocks
        : parseRawNoteToBlocks(card.back, card.front)

    if (blocks && blocks.length > 0) {
      const parts: string[] = []
      for (const b of blocks) {
        if (b.kind === 'definition') {
          const term = (b.term || '').replace(/[*_`]/g, '').trim()
          const text = (b.text || '').replace(/[*_`]/g, '').trim()
          if (term && text) parts.push(`${term}: ${text}`)
          else if (term || text) parts.push(term || text)
        } else if (b.kind === 'steps') {
          const label = b.label ? `${b.label}: ` : ''
          const items = (b.items || []).map((it, idx) => `Step ${idx + 1}, ${it.replace(/[*_`]/g, '').trim()}`).join('. ')
          if (items) parts.push(`${label}${items}`)
        } else if (b.kind === 'table') {
          const cols = (b.columns || []).map(c => c.replace(/[*_`]/g, '').trim())
          const rows = b.rows || []
          // Read table box by box: Header (top box), pause, cell value (current box), pause, next header, next cell value...
          rows.forEach((row) => {
            row.forEach((cell, cIdx) => {
              const colName = cols[cIdx] || `Column ${cIdx + 1}`
              const val = String(cell || '').replace(/[*_`]/g, '').trim()
              if (val) {
                parts.push(`${colName}. ${val}`)
              }
            })
          })
        } else if (b.kind === 'what_breaks') {
          const text = (b.text || '').replace(/[*_`]/g, '').trim()
          if (text) parts.push(`What breaks without it: ${text}`)
        } else if (b.kind === 'switch_tldr') {
          const switchParts = [
            b.match_path ? `Fast path, ${b.match_path.replace(/[*_`]/g, '').trim()}` : '',
            b.mismatch_path ? `Slow path, ${b.mismatch_path.replace(/[*_`]/g, '').trim()}` : '',
            b.checker ? `Checker, ${b.checker.replace(/[*_`]/g, '').trim()}` : '',
          ].filter(Boolean)
          if (switchParts.length > 0) parts.push(switchParts.join(', '))
        } else if ((b as any).kind === 'ascii_diagram') {
          const rawDiagram = ((b as any).diagram || '')
          const diagramText = rawDiagram
            .replace(/\+?[-=]{1,3}>\s*/g, ', branches to ')
            .replace(/\\-->\s*/g, ', fallback branches to ')
            .replace(/-->\s*/g, ', leads to ')
            .replace(/->\s*/g, ', leads to ')
            .replace(/==>\s*/g, ', results in ')
            .replace(/\[\s*/g, '')
            .replace(/\s*\]/g, ', ')
            .replace(/[\r\n]+/g, ', ')
            .replace(/[[\]|`+]/g, ' ')
            .replace(/\s*,\s*,+/g, ', ')
            .replace(/\s+/g, ' ')
            .trim()
          if (diagramText) parts.push(`Mechanical flow: ${diagramText.replace(/^,\s*/, '')}`)
        } else if (b.kind === 'formula' || b.kind === 'example' || b.kind === 'note') {
          const text = (b.text || '').replace(/[*_`]/g, '').trim()
          if (text) {
            const prefix = ('label' in b && b.label) ? `${b.label}: ` : ''
            parts.push(`${prefix}${text}`)
          }
        } else if ((b as any).kind === 'pros_cons') {
          const pros = (((b as any).pros || []) as string[]).map(p => p.replace(/[*_`]/g, '').trim()).filter(Boolean)
          const cons = (((b as any).cons || []) as string[]).map(c => c.replace(/[*_`]/g, '').trim()).filter(Boolean)
          if (pros.length > 0) parts.push(`Advantages: ${pros.join('. ')}`)
          if (cons.length > 0) parts.push(`Disadvantages: ${cons.join('. ')}`)
        }
      }
      if (parts.length > 0) {
        return parts.join('. ')
      }
    }

    let raw = card.back || ''
    // 1. Table directives &[TABLE: ...]
    raw = raw.replace(/&\[TABLE:\s*([\s\S]*?)\]/gi, (_, content) => {
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
          cols = lines[0].split(',').map((c: string) => c.trim())
          rows = lines.slice(1).map((r: string) => r.split(',').map((c: string) => c.trim()))
        }
      }
      return rows.map((r) => {
        return r.map((cell, cIdx) => {
          const col = cols[cIdx] || `Column ${cIdx + 1}`
          return `${col}. ${cell}`
        }).join('. ')
      }).join('. ')
    })

    // 2. Markdown tables | Col 1 | Col 2 |
    raw = raw.replace(/(?:^|\n)(\|[^\n]+\|\r?\n\|[\s\-:|]+\|\r?\n(?:\|[^\n]+\|(?:\r?\n|$))+)/g, (match) => {
      const lines = match.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      const valid = lines.filter(l => !/^[\|\s\-:]+$/.test(l))
      if (valid.length === 0) return ''
      const cols = valid[0].split('|').map(c => c.trim()).filter(Boolean)
      const rows = valid.slice(1).map(r => r.split('|').map(c => c.trim()).filter(Boolean))
      return rows.map((r) => {
        return r.map((cell, cIdx) => {
          const col = cols[cIdx] || `Column ${cIdx + 1}`
          return `${col}. ${cell}`
        }).join('. ')
      }).join('. ')
    })

    return raw
      .replace(/[*_`]/g, '')
      .replace(/•/g, '. ')
      .replace(/\n+/g, '. ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const handleStartTTS = () => {
    const queueItems = filtered.map(c => ({
      id: c.id,
      title: cleanSpeechTitle(c.front || 'Note'),
      backText: parseNoteToSpeechText(c, activeNoteTab),
    }))
    startQueue(queueItems, 0)
  }

  const handleSpeakSingleNote = (e: React.MouseEvent, card: Card) => {
    e.stopPropagation()
    if (status !== 'idle' && currentItemId === card.id) {
      stop()
      return
    }
    startQueue([{
      id: card.id,
      title: cleanSpeechTitle(card.front || 'Note'),
      backText: parseNoteToSpeechText(card, activeNoteTab),
    }], 0)
  }

  return (
    <NotesScreen
      loading={loading}
      hasKeywords={keywords.length > 0}
      deck={deck}
      effectiveDeckId={effectiveDeckId}
      filtered={filtered}
      grouped={grouped}
      search={search}
      onSearchChange={setSearch}
      hideBoldKeywords={hideBoldKeywords}
      onToggleHideBold={() => setHideBoldKeywords(!hideBoldKeywords)}
      revealAll={revealAll}
      onToggleRevealAll={handleToggleNotes}
      revealed={revealed}
      onToggleRevealCard={toggleReveal}
      status={status}
      currentItemId={currentItemId}
      onStartTTS={handleStartTTS}
      onStopTTS={stop}
      onSpeakSingleNote={handleSpeakSingleNote}
      activeNoteTab={activeNoteTab}
      onTabChange={setActiveNoteTab}
      renderBlocksOrText={(card) => {
        if (activeNoteTab === 'verbatim') {
          const verbatimText = getCardVerbatimText(card)
          const slideNumber = typeof (card as any).source_slide === 'number'
            ? (card as any).source_slide
            : undefined

          return (
            <div className="space-y-2">
              {slideNumber !== undefined && (
                <div className="flex items-center justify-between text-[11px] font-mono text-[var(--color-text-muted)] pb-1.5 border-b border-[var(--color-border)]/50">
                  <span className="font-semibold text-[var(--color-text-secondary)]">Slide {slideNumber}</span>
                  <span className="uppercase tracking-wider text-[10px] text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                    Verbatim Source
                  </span>
                </div>
              )}
              <FormattedNoteText text={verbatimText} hideBold={hideBoldKeywords} />
            </div>
          )
        }

        const rawBlocks: BackBlock[] =
          (card as any).back_blocks &&
          Array.isArray((card as any).back_blocks) &&
          (card as any).back_blocks.length > 0
            ? (card as any).back_blocks
            : parseRawNoteToBlocks(card.back, card.front)

        return rawBlocks && rawBlocks.length > 0 ? (
          <StructuredBlockRenderer
            blocks={rawBlocks}
            cardTitle={card.front}
            hideBold={hideBoldKeywords}
            hideVerbatimDrawer={true}
          />
        ) : (
          <FormattedNoteText text={card.back} hideBold={hideBoldKeywords} />
        )
      }}
      onBack={() => router.push(`/study/${effectiveDeckId}`)}
    />
  )
}

export default function NotesClient({ deckId }: { deckId?: string }) {
  return <NotesContent deckId={deckId} />
}
