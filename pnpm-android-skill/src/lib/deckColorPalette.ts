export interface DeckColorTheme {
  name: string
  accent: string
  accentSoft: string
  accentGlow: string
  borderHover: string
  text: string
  pillBg: string
  pillText: string
  gradient: string
  iconBg: string
}

export const DECK_COLOR_THEMES: DeckColorTheme[] = [
  {
    name: 'emerald',
    accent: '#10b981',
    accentSoft: 'rgba(16, 185, 129, 0.12)',
    accentGlow: 'rgba(16, 185, 129, 0.3)',
    borderHover: 'rgba(16, 185, 129, 0.5)',
    text: '#34d399',
    pillBg: 'rgba(16, 185, 129, 0.18)',
    pillText: '#6ee7b7',
    gradient: 'from-emerald-500/10 via-transparent to-transparent',
    iconBg: 'bg-emerald-500/15 text-emerald-400',
  },
  {
    name: 'violet',
    accent: '#a855f7',
    accentSoft: 'rgba(168, 85, 247, 0.12)',
    accentGlow: 'rgba(168, 85, 247, 0.3)',
    borderHover: 'rgba(168, 85, 247, 0.5)',
    text: '#c084fc',
    pillBg: 'rgba(168, 85, 247, 0.18)',
    pillText: '#d8b4fe',
    gradient: 'from-purple-500/10 via-transparent to-transparent',
    iconBg: 'bg-purple-500/15 text-purple-400',
  },
  {
    name: 'cyan',
    accent: '#06b6d4',
    accentSoft: 'rgba(6, 182, 212, 0.12)',
    accentGlow: 'rgba(6, 182, 212, 0.3)',
    borderHover: 'rgba(6, 182, 212, 0.5)',
    text: '#22d3ee',
    pillBg: 'rgba(6, 182, 212, 0.18)',
    pillText: '#67e8f9',
    gradient: 'from-cyan-500/10 via-transparent to-transparent',
    iconBg: 'bg-cyan-500/15 text-cyan-400',
  },
  {
    name: 'amber',
    accent: '#f59e0b',
    accentSoft: 'rgba(245, 158, 11, 0.12)',
    accentGlow: 'rgba(245, 158, 11, 0.3)',
    borderHover: 'rgba(245, 158, 11, 0.5)',
    text: '#fbbf24',
    pillBg: 'rgba(245, 158, 11, 0.18)',
    pillText: '#fde68a',
    gradient: 'from-amber-500/10 via-transparent to-transparent',
    iconBg: 'bg-amber-500/15 text-amber-400',
  },
  {
    name: 'rose',
    accent: '#ec4899',
    accentSoft: 'rgba(236, 72, 153, 0.12)',
    accentGlow: 'rgba(236, 72, 153, 0.3)',
    borderHover: 'rgba(236, 72, 153, 0.5)',
    text: '#f472b6',
    pillBg: 'rgba(236, 72, 153, 0.18)',
    pillText: '#fbcfe8',
    gradient: 'from-pink-500/10 via-transparent to-transparent',
    iconBg: 'bg-pink-500/15 text-pink-400',
  },
  {
    name: 'indigo',
    accent: '#6366f1',
    accentSoft: 'rgba(99, 102, 241, 0.12)',
    accentGlow: 'rgba(99, 102, 241, 0.3)',
    borderHover: 'rgba(99, 102, 241, 0.5)',
    text: '#818cf8',
    pillBg: 'rgba(99, 102, 241, 0.18)',
    pillText: '#c7d2fe',
    gradient: 'from-indigo-500/10 via-transparent to-transparent',
    iconBg: 'bg-indigo-500/15 text-indigo-400',
  },
  {
    name: 'teal',
    accent: '#14b8a6',
    accentSoft: 'rgba(20, 184, 166, 0.12)',
    accentGlow: 'rgba(20, 184, 166, 0.3)',
    borderHover: 'rgba(20, 184, 166, 0.5)',
    text: '#2dd4bf',
    pillBg: 'rgba(20, 184, 166, 0.18)',
    pillText: '#99f6e4',
    gradient: 'from-teal-500/10 via-transparent to-transparent',
    iconBg: 'bg-teal-500/15 text-teal-400',
  },
]

export function getDeckTheme(deckId: string | number, subjectOrTitle: string = '', index?: number): DeckColorTheme {
  if (typeof index === 'number' && index >= 0) {
    return DECK_COLOR_THEMES[index % DECK_COLOR_THEMES.length]
  }

  const str = `${deckId}_${subjectOrTitle}`
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  const idx = Math.abs(hash) % DECK_COLOR_THEMES.length
  return DECK_COLOR_THEMES[idx]
}
