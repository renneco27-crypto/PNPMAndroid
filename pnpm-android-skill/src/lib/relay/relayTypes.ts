export interface CardTargetRule {
  min: number
  max: number
  conditional?: boolean
}

export interface CardTargetsConfig {
  keyword_notes: CardTargetRule
  definition: CardTargetRule
  multiple_choice: CardTargetRule
  true_false: CardTargetRule
  enumeration: CardTargetRule
  identification?: CardTargetRule
  math?: { conditional: true; min?: number; max?: number }
  code?: { conditional: true; min?: number; max?: number }
}

export const DEFAULT_CARD_TARGETS: CardTargetsConfig = {
  keyword_notes: { min: 10, max: 25 },
  definition: { min: 10, max: 20 },
  enumeration: { min: 4, max: 10 },
  multiple_choice: { min: 12, max: 25 },
  true_false: { min: 10, max: 20 },
  math: { conditional: true },
  code: { conditional: true },
}

export type BackBlockKind = 'definition' | 'steps' | 'table' | 'formula' | 'example' | 'note' | 'pros_cons'

export interface DefinitionBlock {
  kind: 'definition'
  term: string
  text: string
}

export interface StepsBlock {
  kind: 'steps'
  label: string
  items: string[]
}

export interface TableBlock {
  kind: 'table'
  label: string
  columns: string[]
  rows: string[][]
}

export interface FormulaBlock {
  kind: 'formula'
  label: string
  text: string
}

export interface ExampleBlock {
  kind: 'example'
  label: string
  text: string
}

export interface NoteBlock {
  kind: 'note'
  text: string
}

export interface ProsConsBlock {
  kind: 'pros_cons'
  label?: string
  pros: string[]
  cons: string[]
}

export type BackBlock =
  | DefinitionBlock
  | StepsBlock
  | TableBlock
  | FormulaBlock
  | ExampleBlock
  | NoteBlock
  | ProsConsBlock

export interface RelayCard {
  id?: string
  type: string
  front: string
  back?: string
  back_blocks?: BackBlock[]
  source_slide?: number
  chapter?: string
  subject?: string
  lesson?: string
  mc?: {
    correct: string
    distractors: string[]
  }
  tf?: {
    answer: boolean | string
    explanation: string
  }
  id_card?: {
    answer: string
    variants?: string[]
  }
  id_answer?: string
  id_variants?: string
  enum_items?: string[]
  math?: any
  code?: any
}

export interface SourceIssue {
  slide?: number
  issue: string
  suggested_fix?: string
}

export interface SlideTranscript {
  slide?: number
  title?: string
  text: string
}

export interface DeckImageInput {
  title: string
  url?: string
  dataUrl?: string
  caption?: string
  transcript?: string
}

export interface RelayDeckOutput {
  title?: string
  subject?: string
  chapter?: string
  lesson?: string
  cards: RelayCard[]
  images?: DeckImageInput[]
  transcripts?: SlideTranscript[]
  source_issues?: SourceIssue[]
  unreadable_slides?: number[]
}

export interface ValidationIssue {
  cardIndex: number
  cardFront: string
  cardType: string
  reason: string
}

export interface ValidationReport {
  droppedCards: ValidationIssue[]
  totalExamined: number
  validCount: number
}

export interface RelayPipelineResult {
  deck: RelayDeckOutput
  validationReport: ValidationReport
  sourceIssues: SourceIssue[]
  unreadableSlides: number[]
  countsByType: Record<string, number>
  warnings: string[]
  tokenUsage?: {
    totalPromptTokens?: number
    totalCompletionTokens?: number
    totalCalls: number
  }
}
