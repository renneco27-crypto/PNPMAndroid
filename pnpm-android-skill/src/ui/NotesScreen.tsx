'use client'

import React, { useState, useMemo } from 'react'
import { BookOpen, Eye, EyeOff, Search, ChevronDown, ChevronUp, Tag, Volume2, VolumeX, Sparkles } from 'lucide-react'
import TopBar from '@/components/TopBar'
import ExportButton from '@/features/export/ExportButton'
import MathFormattedText from '@/components/MathFormattedText'
import StructuredBlockRenderer from '@/components/StructuredBlockRenderer'
import AIPracticeDrawer, { type ScreenContext } from '@/components/AIPracticeDrawer'
import type { Card, Deck } from '@/lib/zodSchemas'

export interface NotesScreenProps {
  loading: boolean
  hasKeywords: boolean
  deck: Deck | null
  effectiveDeckId: string
  filtered: Card[]
  grouped: Record<string, Card[]>
  search: string
  onSearchChange: (val: string) => void
  hideBoldKeywords: boolean
  onToggleHideBold: () => void
  revealAll: boolean
  onToggleRevealAll: () => void
  revealed: Set<string>
  onToggleRevealCard: (id: string) => void
  status: string
  currentItemId: string | null
  onStartTTS: () => void
  onStopTTS: () => void
  onSpeakSingleNote: (e: React.MouseEvent, card: Card) => void
  renderBlocksOrText: (card: Card) => React.ReactNode
  activeNoteTab?: 'notes' | 'verbatim'
  onTabChange?: (tab: 'notes' | 'verbatim') => void
  onBack: () => void
}

export default function NotesScreen({
  loading,
  hasKeywords,
  deck,
  effectiveDeckId,
  filtered,
  grouped,
  search,
  onSearchChange,
  hideBoldKeywords,
  onToggleHideBold,
  revealAll,
  onToggleRevealAll,
  revealed,
  onToggleRevealCard,
  status,
  currentItemId,
  onStartTTS,
  onStopTTS,
  onSpeakSingleNote,
  renderBlocksOrText,
  activeNoteTab = 'notes',
  onTabChange,
  onBack,
}: NotesScreenProps) {
  const [focusedCardId, setFocusedCardId] = useState<string | null>(null)

  const activeNoteCard = useMemo(() => {
    if (!filtered || filtered.length === 0) return null
    if (focusedCardId) {
      const match = filtered.find((c) => c.id === focusedCardId)
      if (match) return match
    }
    if (currentItemId) {
      const match = filtered.find((c) => c.id === currentItemId)
      if (match) return match
    }
    return filtered[0]
  }, [filtered, focusedCardId, currentItemId])

  const notesScreenContext = useMemo<ScreenContext | undefined>(() => {
    if (!activeNoteCard) return undefined
    const blocks: any[] = Array.isArray((activeNoteCard as any).back_blocks)
      ? (activeNoteCard as any).back_blocks
      : []
    const verbatimBlock = blocks.find((b) => b && b.kind === 'verbatim')
    return {
      screen: 'notes',
      topic: activeNoteCard.front || deck?.title || 'Study Note',
      activeTab: 'notes',
      problem: (activeNoteCard.back || '').slice(0, 750),
      keyTakeaway: (verbatimBlock?.text || activeNoteCard.chapter || '').slice(0, 400),
    }
  }, [activeNoteCard, deck?.title])

  if (loading) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="animate-pulse text-[var(--color-text-muted)]">Loading notes…</div>
      </div>
    )
  }

  if (!hasKeywords) {
    return (
      <div className="min-h-screen bg-transparent flex flex-col">
        <TopBar title="Notes" onBack={onBack} />
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <BookOpen size={48} className="text-[var(--color-text-muted)] mb-4 opacity-40" />
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">No notes found in this deck</h2>
          <p className="text-sm text-[var(--color-text-secondary)] max-w-xs">
            Add rows with <code className="bg-[var(--color-surface-2)] px-1 rounded text-xs">type = keyword</code> or definition cards to see them organized as notes.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-transparent flex flex-col relative">
      <TopBar
        title={deck?.title ?? 'Notes'}
        onBack={onBack}
        rightSlot={
          <div className="flex items-center gap-1.5 sm:gap-2">
            {filtered.length > 0 && (
              <button
                onClick={status !== 'idle' ? onStopTTS : onStartTTS}
                className={`flex items-center gap-1 px-2 sm:px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors border ${
                  status !== 'idle'
                    ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)] shadow-sm'
                    : 'text-[var(--color-accent)] border-[var(--color-border)] hover:bg-[var(--color-surface-2)]'
                }`}
                title={status !== 'idle' ? 'Stop reading' : 'Listen to all notes read aloud sentence by sentence'}
              >
                {status !== 'idle' ? <VolumeX size={13} /> : <Volume2 size={13} />}
                <span className="hidden xs:inline">{status !== 'idle' ? 'Stop' : 'Read Notes'}</span>
              </button>
            )}
            <button
              onClick={onToggleHideBold}
              className={`flex items-center gap-1 px-2 sm:px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors border ${
                hideBoldKeywords
                  ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)] shadow-sm'
                  : 'text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-2)]'
              }`}
              title={hideBoldKeywords ? "Show bolded words" : "Mask bolded/important words for active recall"}
            >
              <Tag size={13} />
              <span className="hidden xs:inline">{hideBoldKeywords ? 'Important Masked' : 'Mask Key Words'}</span>
            </button>
            <button
              onClick={onToggleRevealAll}
              className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] rounded-lg transition-colors"
              title={revealAll ? 'Collapse all notes' : 'Expand all notes'}
            >
              {revealAll ? <EyeOff size={13} /> : <Eye size={13} />}
              <span className="hidden sm:inline">{revealAll ? 'Collapse All' : 'Expand All'}</span>
            </button>
            <ExportButton deckId={effectiveDeckId} deckTitle={deck?.title ?? 'Notes'} />
          </div>
        }
      />

      {/* Top Segmented Tabs: Notes (Concepts & Tables) | Verbatim (Source Notes) */}
      <div className="px-4 pt-3 pb-1">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <div className="inline-flex p-1 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] shadow-sm">
            <button
              type="button"
              onClick={() => onTabChange?.('notes')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeNoteTab === 'notes'
                  ? 'bg-[var(--color-accent)] text-white shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <BookOpen size={13} />
              <span>Notes</span>
            </button>
            <button
              type="button"
              onClick={() => onTabChange?.('verbatim')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeNoteTab === 'verbatim'
                  ? 'bg-[var(--color-accent)] text-white shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <span>Verbatim</span>
            </button>
          </div>

          <span className="text-[11px] font-mono text-[var(--color-text-muted)] hidden xs:inline">
            {activeNoteTab === 'notes' ? 'Concepts, Tables & Breakdown' : 'Exact Source Text'}
          </span>
        </div>
      </div>

      {/* Search bar */}
      <div className="px-4 pt-4 pb-2">
        <div className="relative max-w-2xl mx-auto">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search keywords, dates, topics, or definitions…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
          />
        </div>
      </div>

      {/* Notes list */}
      <div className="flex-1 overflow-auto px-4 pb-8 pt-2 max-w-2xl mx-auto w-full">
        {Object.entries(grouped).map(([chapter, cards]) => (
          <div key={chapter} className="mb-6">
            <div className="flex flex-col gap-3">
              {cards.map(card => {
                const isCurrentlyPlaying = status !== 'idle' && currentItemId === card.id
                const isRevealed = isCurrentlyPlaying || revealed.has(card.id)
                const isFocusedForAI = activeNoteCard?.id === card.id
                return (
                  <div
                    key={card.id}
                    onClick={() => setFocusedCardId(card.id)}
                    className={`glass-panel rounded-2xl border p-4 transition-all duration-200 shadow-sm ${
                      isCurrentlyPlaying
                        ? 'border-[var(--color-know)] ring-2 ring-[var(--color-know)]/40 shadow-lg'
                        : isFocusedForAI
                          ? 'border-[var(--color-accent)]/45'
                          : 'border-[var(--color-border)]'
                    }`}
                  >
                    <div
                      onClick={(e) => {
                        e.stopPropagation()
                        setFocusedCardId(card.id)
                        onToggleRevealCard(card.id)
                      }}
                      className="flex items-start justify-between gap-3 cursor-pointer select-none group"
                    >
                      <div className="flex-1 min-w-0">
                        <h4 className="font-['Playfair_Display'] font-semibold text-[var(--color-text-primary)] text-base tracking-wide leading-snug break-words [overflow-wrap:anywhere]">
                          <MathFormattedText text={card.front} hideBold={hideBoldKeywords} />
                        </h4>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => onSpeakSingleNote(e, card)}
                          className={`p-1 rounded-lg transition-colors ${
                            isCurrentlyPlaying
                              ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/15'
                              : 'text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:bg-[var(--color-surface-2)]'
                          }`}
                          title={isCurrentlyPlaying ? "Stop reading this note" : "Listen to this note"}
                        >
                          {isCurrentlyPlaying ? <VolumeX size={15} /> : <Volume2 size={15} />}
                        </button>
                        <span className="text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] transition-colors mt-0.5">
                          {isRevealed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </span>
                      </div>
                    </div>

                    {isRevealed && (
                      <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                        {renderBlocksOrText(card)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-12 text-[var(--color-text-muted)] text-sm">
            No notes matching "{search}"
          </div>
        )}
      </div>

      {/* 3D Personal Learning Graph AI Sidebar for Study Notes */}
      <AIPracticeDrawer
        kind="notes"
        deckId={effectiveDeckId}
        currentScreenContext={notesScreenContext}
      />
    </div>
  )
}
