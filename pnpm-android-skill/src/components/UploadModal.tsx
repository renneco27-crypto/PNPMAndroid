'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import CreateDeckModalUI, { AttachedJsonDeck } from '@/ui/CreateDeckModalUI'
import { handleUpload, handleMultipleUpload, UploadError } from '@/features/upload/uploadHandler'
import { isJsonInput, extractJsonString } from '@/features/upload/jsonParser'
import { useToastStore } from '@/store/toastStore'
import { useUIStore } from '@/store/uiStore'
import { Capacitor } from '@capacitor/core'
import { useRelayJobStore } from '@/store/relayJobStore'
import { createBrowserSupabase } from '@/lib/supabase'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { GENERATION_PROMPT_TEMPLATE, DEFAULT_CARD_TARGETS } from '@/lib/relay/generationPrompt'
import { SharedFile, SharedFileEntry } from '@/components/ShareReceiver'

type UploadState = 'idle' | 'dragover' | 'processing' | 'success' | 'error'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function base64ToFile(base64: string, name: string, mimeType: string): File {
  const byteChars = atob(base64)
  const bytes = new Uint8Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i)
  return new File([bytes], name, { type: mimeType })
}

const CLAUDE_PROMPT_TEMPLATE = GENERATION_PROMPT_TEMPLATE
  .replace('{{CARD_TARGETS}}', JSON.stringify(DEFAULT_CARD_TARGETS, null, 2))
  .replace('{{TOPIC}}', '[INSERT TOPIC]')
  .replace('{{SUBJECT}}', '[Academic Subject]')
  .replace('{{CHAPTER}}', '[Chapter / Module]')
  .replace('{{LESSON}}', '[Lesson Name]')
  .replace('{{SOURCE_TEXT}}', '[Paste your lecture notes, slides, or study materials here]')
  .replace('{{ALREADY_EMITTED_FRONTS}}', '(None - starting new deck generation)')

const CLAUDE_NOTES_PROMPT_TEMPLATE = `Analyze the entire reference material and extract ALL information into structured, comprehensive 3D STUDY NOTES ONLY (Keyword cards for the Notes tab).

======================================================================
1. EXTRACTION & CARD GENERATION RULES
======================================================================
• Identify every distinct topic, section, theory, concept, formula, process, and key term.
• Do NOT generate quiz questions, multiple choice, or true/false questions.
• Generate EXCLUSIVELY "keyword" type cards for the Notes tab.
• One keyword card per source slide or coherent topic block, strictly in source order.
• The "front" MUST be the Topic / Keyword / Concept / Section title.
• Always include "source_slide" (1-based integer).

======================================================================
2. MANDATORY TOPIC AUDIT & SELECTIVE GRAPH BLOCK ASSIGNMENT
======================================================================
CRITICAL RULE: DO NOT blindly force "what_breaks", tables, or ASCII diagrams onto every card!
Before writing the blocks for each card, FIRST AUDIT the topic to determine its true pedagogical nature.
Choose ONLY 2 to 4 representation blocks from the Personal Learning Graph Menu below that genuinely fit the topic after auditing:

• TOPIC AUDIT CRITERIA (CHOOSE ONLY WHAT FITS):
1. Algorithmic / Systems / Protocol Failure Mode:
   - Does this topic represent a system mechanism, protocol, or algorithm that freezes, crashes, drops packets, leaks memory, or corrupts data if omitted?
   - IF YES: Include "what_breaks" (1-2 sentences with physical Action-Noun Nickname) and/or "switch_tldr" (Fast vs Fallback path).
   - IF NO (e.g. definitions, historical facts, taxonomy overviews, formulas, properties): NEVER include "what_breaks"!
2. Multi-Item Comparison / Boundary / Numerical Matrix:
   - Does this topic compare multiple entities, contrast boundaries (RAM vs Wire, Client vs Server), or present numerical matrices/bins?
   - IF YES: Include "table".
   - IF NO: NEVER force an empty, trivial, or artificial table!
3. Branching Decision / Dual Pipeline:
   - Does the process branch into two distinct operational paths (Fast vs Slow, Cache Hit vs Miss, Base Case vs Recursive)?
   - IF YES: Include "ascii_diagram".
   - IF NO: Omit ASCII diagrams.
4. Mathematical / Physics Equation:
   - Does the topic define a formula or numerical calculation?
   - IF YES: Include "formula" + zero-skip "example" with real numbers plugged in.
5. Ordered Procedure / Lifecycle / Workflow:
   - Does the topic describe sequential stages, phases, or algorithmic steps?
   - IF YES: Include "steps" (items array).
6. Core Term / Taxonomy / Fundamental Principle:
   - Include "definition" with clear mechanical intuition and/or "note".
7. Trade-offs / Design Decisions:
   - Include "pros_cons" with "pros" and "cons" arrays.
8. Exact Source Text (MANDATORY on EVERY card):
   - ALWAYS include "verbatim" as the final block containing the EXACT word-for-word text from the slide/document. The UI has a dedicated top Verbatim tab that displays this original text 1:1.

======================================================================
3. PERSONAL LEARNING GRAPH BLOCK MENU (SELECT 2 TO 4 PER CARD)
======================================================================
- { "kind": "definition", "term": "<Term Name (Action Nickname)>", "text": "<clear mechanical definition>" }
- { "kind": "steps", "label": "<Procedure / Lifecycle Name>", "items": ["Step 1 description", "Step 2 description"] }
- { "kind": "table", "label": "<Table Title>", "columns": ["Col 1", "Col 2", "Col 3"], "rows": [["R1A", "R1B", "R1C"], ["R2A", "R2B", "R2C"]] }
- { "kind": "formula", "label": "<Formula Title>", "text": "<calculation or equation in LaTeX or plain math>" }
- { "kind": "example", "label": "<Concrete Plug-In Example>", "text": "<specific illustration with plugged-in values>" }
- { "kind": "what_breaks", "label": "If You Do Nothing — What Breaks?", "nickname": "<Action-Noun Nickname>", "text": "<1-2 sentences: what breaks or fails>" } (ONLY for mechanisms with real failure modes!)
- { "kind": "ascii_diagram", "label": "<2-Branch Flow Name>", "diagram": "[Input] ---> [Path A: Fast/Match] ---> [Result A]\n        \\--> [Path B: Slow/Fallback] -> [Result B]" } (ONLY for branching processes!)
- { "kind": "switch_tldr", "label": "3-Sentence Switch TL;DR", "match_path": "<Fast/Match path>", "mismatch_path": "<Slow/Fallback path>", "checker": "<The checker rule/tool>" } (ONLY for decision switches!)
- { "kind": "pros_cons", "label": "Advantages & Disadvantages", "pros": ["Pro point 1"], "cons": ["Con point 1"] }
- { "kind": "note", "text": "<critical caveats, boundaries, or context>" }
- { "kind": "verbatim", "label": "Verbatim Source Wording", "slide": <1-based slide number>, "text": "<EXACT word-for-word text from slide/document>" } (MANDATORY as the last block)

======================================================================
4. CARD LIMIT & HISTORICAL TIMELINE
======================================================================
• Generate up to a maximum of 130 keyword note cards total. Do NOT exceed 130 cards.
• HISTORICAL TIMELINE CARD: If the source contains dated historical events, add one additional keyword card at the end titled "Chronological Timeline — [topic]".
• Never omit important details, examples, or conditions from the source.

======================================================================
5. DIVERSE DEMONSTRATION CARDS (SHOWING SELECTIVE GRAPH USAGE)
======================================================================
Notice how each card audits the topic and uses ONLY the blocks that fit:

{
  "title": "[INSERT TOPIC]",
  "chapter": "[INSERT TOPIC]",
  "subject": "[Academic Subject]",
  "lesson": "Study Notes",
  "images": [],
  "cards": [
    {
      "type": "keyword",
      "front": "Equal-Frequency Binning",
      "source_slide": 1,
      "back_blocks": [
        {
          "kind": "what_breaks",
          "label": "If You Do Nothing — What Breaks?",
          "nickname": "Bucket Equalizer",
          "text": "Without equal-frequency binning, skewed outliers leave intervals empty and distort downstream models."
        },
        {
          "kind": "definition",
          "term": "Equal-Frequency Binning (Bucket Equalizer)",
          "text": "Sorts raw data and slices it into k buckets so every bucket holds the exact same count of N/k items."
        },
        {
          "kind": "table",
          "label": "Bin Assignment Example",
          "columns": ["Bin", "Original Values", "Bin Mean", "Bin Boundaries"],
          "rows": [
            ["G1", "4, 8, 9, 15", "9, 9, 9, 9", "4, 4, 4, 15"],
            ["G2", "21, 21, 24, 25", "23, 23, 23, 23", "21, 21, 25, 25"]
          ]
        },
        {
          "kind": "switch_tldr",
          "label": "3-Sentence Switch TL;DR",
          "match_path": "Smooth by Bin Means -> Replace every number in bucket with average.",
          "mismatch_path": "Smooth by Bin Boundaries -> Snap each number to closest boundary edge.",
          "checker": "Distance to min vs max boundary (|x - min| vs |max - x|) checks which edge wins."
        },
        {
          "kind": "verbatim",
          "label": "Verbatim Source Wording",
          "slide": 1,
          "text": "Equal-frequency (equi-depth) partitioning divides the range into N intervals, each containing approximately same number of samples."
        }
      ],
      "back": "• **Equal-Frequency Binning** — Sorts raw data into k buckets with equal sample counts."
    },
    {
      "type": "keyword",
      "front": "Bin Capacity Formula",
      "source_slide": 2,
      "back_blocks": [
        {
          "kind": "definition",
          "term": "Bin Capacity Rule",
          "text": "Calculates the exact number of elements allocated to each bin based on total sample count and bucket count."
        },
        {
          "kind": "formula",
          "label": "Calculation",
          "text": "C = \\\\frac{N}{k}"
        },
        {
          "kind": "example",
          "label": "Zero-Skip Plug-In",
          "text": "For N = 12 total items and k = 3 buckets: 12 / 3 = 4 items per bin."
        },
        {
          "kind": "verbatim",
          "label": "Verbatim Source Wording",
          "slide": 2,
          "text": "Bin capacity is determined by dividing the total count of observations N by the specified number of bins k."
        }
      ],
      "back": "• **Bin Capacity Formula** — C = N / k."
    },
    {
      "type": "keyword",
      "front": "Data Discretization Lifecycle",
      "source_slide": 3,
      "back_blocks": [
        {
          "kind": "definition",
          "term": "Data Discretization",
          "text": "Transforms continuous numeric attributes into categorical or discrete interval counterparts."
        },
        {
          "kind": "steps",
          "label": "Discretization Phases",
          "items": [
            "Sort the continuous raw values",
            "Select splitting or binning criterion",
            "Map intervals to discrete integer labels"
          ]
        },
        {
          "kind": "pros_cons",
          "label": "Trade-offs",
          "pros": ["Simplifies machine learning model training", "Reduces susceptibility to minor noise"],
          "cons": ["Loses fine-grained numerical precision"]
        },
        {
          "kind": "verbatim",
          "label": "Verbatim Source Wording",
          "slide": 3,
          "text": "Discretization techniques reduce the number of values for a continuous attribute by dividing the range into intervals."
        }
      ],
      "back": "• **Data Discretization** — Converts continuous numeric variables into discrete intervals."
    }
  ]
}

======================================================================
6. SYNTAX & FORMATTING CONSTRAINTS
======================================================================
• Output ONLY the raw valid JSON. Do NOT wrap with markdown fences (\`\`\`json) or code blocks.
• When you are done generating all study notes, output ONLY the completed JSON. Do NOT ask to continue, do NOT output a continue button/prompt, and do NOT include any conversational follow-up text.
• Every LaTeX command must be double-escaped: "\\\\frac", "\\\\cdot", "\\\\times".
• Every newline inside a JSON string must be written as \\n.

TOPIC: [INSERT TOPIC]
CHAPTER: [INSERT CHAPTER]
SUBJECT: [INSERT SUBJECT]
LESSON: [INSERT LESSON]
REFERENCE STUDY NOTES: [PASTE YOUR STUDY NOTES HERE]`

export default function UploadModal() {
  const router = useRouter()
  const isOpen = useUIStore((s) => s.isUploadModalOpen)
  const tab = useUIStore((s) => s.uploadModalTab)
  const setTab = useUIStore((s) => s.setUploadModalTab)
  const closeUploadModal = useUIStore((s) => s.closeUploadModal)
  const pendingStoreFiles = useUIStore((s) => s.pendingSharedFiles)
  const clearPendingStoreFiles = useUIStore((s) => s.clearPendingSharedFiles)
  const addToast = useToastStore((s) => s.addToast)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const isSubmittingRef = useRef(false)
  const [deckName, setDeckName] = useState('')
  const [state, setState] = useState<UploadState>('idle')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [pasteText, setPasteText] = useState('')
  const [attachedJson, setAttachedJson] = useState<AttachedJsonDeck | null>(null)
  const attachedJsonPayloadRef = useRef<string>('')
  const [textLoading, setTextLoading] = useState(false)
  const [textProgress, setTextProgress] = useState('')

  const handlePasteTextChange = (val: string) => {
    // If the pasted input is JSON and large (>15KB) or starts like JSON, convert to memory capsule
    const trimmed = val.trim()
    const startsLikeJson = (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('```json') || trimmed.startsWith('```')) && (trimmed.includes('"cards"') || trimmed.includes('"type"') || trimmed.includes('"front"'))
    
    if (startsLikeJson && trimmed.length > 5000) {
      let clean = trimmed
      if (clean.startsWith('```')) {
        clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      }
      try {
        const extracted = extractJsonString(clean)
        const parsed = JSON.parse(extracted)
        const rawCards = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.cards) ? parsed.cards : (Array.isArray(parsed?.flashcards) ? parsed.flashcards : (Array.isArray(parsed?.items) ? parsed.items : [])))
        const cardCount = rawCards.length || 1
        const detectedTitle = parsed?.title || parsed?.subject || 'Pasted Deck JSON'
        
        attachedJsonPayloadRef.current = extracted
        setAttachedJson({
          name: 'deck.json',
          sizeBytes: new Blob([extracted]).size,
          cardCount,
          title: detectedTitle
        })
        if (!deckName.trim() && detectedTitle && detectedTitle !== 'Pasted Deck JSON') {
          setDeckName(detectedTitle)
        }
        setPasteText('')
        addToast(`Attached ${cardCount} cards from JSON (${(new Blob([extracted]).size / 1024).toFixed(1)} KB)`, 'success')
        return
      } catch (e) {
        // Fallback to normal text if it was not valid JSON
      }
    }
    setPasteText(val)
  }

  const handleClearAttachedJson = () => {
    attachedJsonPayloadRef.current = ''
    setAttachedJson(null)
  }

  const stageIncomingEntries = async (entries: SharedFileEntry[]) => {
    if (!entries || !entries.length) return
    try {
      const convertedFiles = await Promise.all(
        entries.map(async (entry) => {
          let f: File
          if (entry.base64) {
            f = base64ToFile(entry.base64, entry.name, entry.mimeType)
          } else {
            const fileUri = entry.path.startsWith('file://') ? entry.path : `file://${entry.path}`
            const { data } = await Filesystem.readFile({
              path: fileUri,
            })
            f = base64ToFile(data as string, entry.name, entry.mimeType)
          }
          if (entry.path) {
            ;(f as any).nativePath = entry.path
          }
          return f
        })
      )

      if (!convertedFiles.length) return

      // Stage files without auto-processing, preserving any already staged files
      setSelectedFiles((prev) => {
        const existingNames = new Set(prev.map((f) => f.name.toLowerCase()))
        const newUnique = convertedFiles.filter((f) => !existingNames.has(f.name.toLowerCase()))
        return [...prev, ...newUnique]
      })

      // Suggest sensible title from the first document if deck name is empty
      setDeckName((prev) => {
        if (prev.trim()) return prev
        const cleanName = convertedFiles[0].name
          .replace(/\.[^/.]+$/, '')
          .replace(/[_-]+/g, ' ')
          .trim()
        return cleanName.charAt(0).toUpperCase() + cleanName.slice(1)
      })

      setTab('file')
      setState('idle')
      addToast(`📄 Staged ${convertedFiles.length} file(s) for import`, 'success')
    } catch (err) {
      console.error('[UploadModal] Failed to stage shared files:', err)
      setError('Could not stage shared file')
    }
  }

  // Handle files shared via Android intent from Zustand store, session storage, or live events
  useEffect(() => {
    if (!isOpen) return

    // 1. Process files from reactive Zustand store
    if (pendingStoreFiles && pendingStoreFiles.length > 0) {
      stageIncomingEntries(pendingStoreFiles)
      clearPendingStoreFiles()
      return
    }

    // 2. Process files saved to sessionStorage on cold-start
    const pending = sessionStorage.getItem('pendingSharedFiles')
    if (pending) {
      sessionStorage.removeItem('pendingSharedFiles')
      try {
        const entries: SharedFileEntry[] = JSON.parse(pending)
        stageIncomingEntries(entries)
      } catch (err) {
        console.error('[UploadModal] Bad pendingSharedFiles JSON:', err)
      }
    }

    // 3. Listen for live incoming shared files while modal is already open
    const onLiveShared = (e: Event) => {
      const custom = e as CustomEvent<{ files: SharedFileEntry[] }>
      if (custom.detail?.files) {
        stageIncomingEntries(custom.detail.files)
      }
    }

    window.addEventListener('studyup:shared-files', onLiveShared)
    return () => {
      window.removeEventListener('studyup:shared-files', onLiveShared)
    }
  }, [isOpen, pendingStoreFiles])

  const hasActiveJob = useRelayJobStore((s) => s.jobs.some((j) => j.status === 'polling'))

  if (!isOpen) return null

  const reset = () => {
    setDeckName('')
    setState('idle')
    setProgress('')
    setError('')
    setSelectedFiles([])
    setPasteText('')
    setAttachedJson(null)
    attachedJsonPayloadRef.current = ''
    setTextLoading(false)
    setTextProgress('')
  }

  const handleClose = () => {
    closeUploadModal()
    if (state === 'success' || state === 'error') {
      setState('idle')
      setError('')
      setProgress('')
    }
  }

  const MAX_FILES = 4
  const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

  const handleFilesAdded = (newFiles: FileList | File[]) => {
    if (hasActiveJob) {
      addToast('A deck is currently being generated. Please wait for it to complete.', 'info')
      return
    }
    const arr = Array.from(newFiles)
    const oversized = arr.find((f) => f.size > MAX_FILE_SIZE)
    if (oversized) {
      setError(`File "${oversized.name}" exceeds the 10MB limit. Each file must be 10MB or less.`)
      setState('error')
      return
    }

    let hitLimit = false
    setSelectedFiles((prev) => {
      const existingKeys = new Set(prev.map((f) => `${f.name}_${f.size}`))
      const toAdd = arr.filter((f) => !existingKeys.has(`${f.name}_${f.size}`))
      if (prev.length + toAdd.length > MAX_FILES) {
        hitLimit = true
        const allowedSpace = Math.max(0, MAX_FILES - prev.length)
        return [...prev, ...toAdd.slice(0, allowedSpace)]
      }
      return [...prev, ...toAdd]
    })

    if (hitLimit) {
      setError(`Maximum ${MAX_FILES} files allowed per upload. Extra files were omitted.`)
      setState('error')
    } else {
      setError('')
      setState('idle')
    }
  }

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
    setError('')
    setState('idle')
  }

  const processSelectedFiles = async () => {
    if (hasActiveJob) {
      addToast('A deck is currently being generated. Please wait for it to complete.', 'info')
      return
    }
    if (selectedFiles.length === 0 || isSubmittingRef.current || state === 'processing') return
    isSubmittingRef.current = true
    const name = deckName.trim()

    if (selectedFiles.length > MAX_FILES) {
      setState('error')
      setError(`Maximum ${MAX_FILES} files allowed per upload`)
      isSubmittingRef.current = false
      return
    }

    const tooLarge = selectedFiles.find((f) => f.size > MAX_FILE_SIZE)
    if (tooLarge) {
      setState('error')
      setError(`File "${tooLarge.name}" exceeds 10MB limit`)
      isSubmittingRef.current = false
      return
    }

    // Pre-flight check: if files require AI conversion (non-JSON), verify server and extension relay are online
    const requiresAI = selectedFiles.some(f => !f.name.toLowerCase().endsWith('.json'))
    if (requiresAI) {
      try {
        const statusRes = await fetch('/api/relay/status?type=client', { signal: AbortSignal.timeout(5000), cache: 'no-store' })
        if (!statusRes.ok) {
          addToast('Relay server unreachable. Please start start_relay.bat or run_relay_hidden.vbs', 'error')
          setState('idle')
          isSubmittingRef.current = false
          return
        }
        const statusData = await statusRes.json().catch(() => ({}))
        const isOnline = Boolean(statusData.extensionOnline || (statusData.workerCount && statusData.workerCount > 0) || statusData.serverOnline)
        if (!isOnline) {
          addToast('Relay worker is offline. Start the relay daemon or use Claude.', 'error')
          setState('idle')
          isSubmittingRef.current = false
          return
        }
      } catch (err: any) {
        addToast(`Relay check error: ${err?.message || 'Server offline'}`, 'error')
        setState('idle')
        isSubmittingRef.current = false
        return
      }
    }

    setState('processing')
    setProgress('')
    setError('')

    try {
      const addJob = useRelayJobStore.getState().addJob
      const id = await handleMultipleUpload(selectedFiles, setProgress, name, (jobId, deckId, topic) => {
        addJob({ jobId, deckId, topic })
        addToast(`"${topic}" sent to relay — processing in background…`, 'success')
        handleClose()
      })
      // If onEnqueued fired, handleClose() already ran — id may be a sentinel deckId
      // Only navigate/toast if we got a real deck back synchronously
      const wasEnqueued = useRelayJobStore.getState().jobs.some(j => j.deckId === id)
      if (!wasEnqueued) {
        addToast('Deck created successfully!', 'success')
        handleClose()
        router.push('/study/' + id)
      }
    } catch (err) {
      const message = err instanceof UploadError ? err.message : 'Upload failed'
      setState('error')
      setError(message)
      addToast(message, 'error')
    } finally {
      isSubmittingRef.current = false
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setState('idle')
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesAdded(e.dataTransfer.files)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesAdded(e.target.files)
      e.target.value = '' // Reset input so re-selecting same files works
    }
  }

  const handleRetry = () => {
    if (selectedFiles.length > 0) {
      processSelectedFiles()
    } else {
      setState('idle')
    }
  }

  const handleGenerate = async () => {
    if (hasActiveJob) {
      addToast('A deck is currently being generated. Please wait for it to complete.', 'info')
      return
    }

    // Check if we have an attached large JSON payload in memory
    let isJson = false
    let payload = ''

    if (attachedJson && attachedJsonPayloadRef.current) {
      isJson = true
      payload = attachedJsonPayloadRef.current
    } else {
      let cleanText = pasteText.trim()
      if (!cleanText) return

      // Strip markdown code fences if user copied ```json ... ``` from Gemini/Claude
      if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      }

      isJson = isJsonInput(cleanText)
      payload = isJson ? extractJsonString(cleanText) : cleanText
    }
    
    const name = deckName.trim()

    if (!isJson) {
      try {
        const statusRes = await fetch('/api/relay/status?type=client', { signal: AbortSignal.timeout(5000), cache: 'no-store' })
        if (!statusRes.ok) {
          addToast('Relay server unreachable. Please start start_relay.bat or run_relay_hidden.vbs', 'error')
          return
        }
        const statusData = await statusRes.json().catch(() => ({}))
        const isOnline = Boolean(statusData.extensionOnline || (statusData.workerCount && statusData.workerCount > 0) || statusData.serverOnline)
        if (!isOnline) {
          addToast('Relay worker is offline. Start the relay daemon or use Claude.', 'error')
          return
        }
      } catch (err: any) {
        addToast(`Relay check error: ${err?.message || 'Server offline'}`, 'error')
        return
      }
    }

    setTextLoading(true)
    setTextProgress(isJson ? 'Parsing JSON deck…' : 'Sending to Gemini Flash Relay…')
    try {
      const fileName = isJson ? 'deck.json' : (tab === 'notes' ? 'notes_only.txt' : 'notes.txt')
      const file = new File([payload], fileName, { type: isJson ? 'application/json' : 'text/plain' })
      const addJob = useRelayJobStore.getState().addJob
      let enqueued = false
      const id = await handleUpload(file, (step) => {
        setTextProgress(step)
      }, name, (jobId, deckId, topic) => {
        enqueued = true
        addJob({ jobId, deckId, topic })
        addToast(`"${topic}" sent to relay — processing in background…`, 'success')
        handleClose()
      })
      if (!enqueued) {
        addToast('Deck created successfully!', 'success')
        handleClose()
        router.push('/study/' + id)
      }
    } catch (err) {
      const message = err instanceof UploadError ? err.message : 'Failed to generate deck'
      addToast(message, 'error')
    } finally {
      setTextLoading(false)
      setTextProgress('')
    }
  }

  const handleCopyToClaude = async () => {
    const prompt = CLAUDE_PROMPT_TEMPLATE
      .replace('[INSERT TOPIC]', deckName.trim() || '[INSERT TOPIC]')
    try {
      await navigator.clipboard.writeText(prompt)
      addToast('Full Deck Prompt copied — paste it in Claude', 'success')
      window.open('https://claude.ai/', '_blank', 'noopener,noreferrer')
    } catch (err) {
      addToast('Failed to copy prompt', 'error')
    }
  }

  const handleCopyNotesToClaude = async () => {
    const prompt = CLAUDE_NOTES_PROMPT_TEMPLATE
      .replace('[INSERT TOPIC]', deckName.trim() || '[INSERT TOPIC]')
    try {
      await navigator.clipboard.writeText(prompt)
      addToast('Notes Only Prompt copied — paste it in Claude', 'success')
      window.open('https://claude.ai/', '_blank', 'noopener,noreferrer')
    } catch (err) {
      addToast('Failed to copy prompt', 'error')
    }
  }

  const handleExportFilesToClaude = async () => {
    if (!selectedFiles.length) {
      addToast('Please stage at least one file first', 'error')
      return
    }

    const topic =
      deckName.trim() ||
      selectedFiles[0].name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim() ||
      '[INSERT TOPIC]'
    const prompt = CLAUDE_PROMPT_TEMPLATE.replace('[INSERT TOPIC]', topic)

    if (Capacitor.getPlatform() === 'android') {
      try {
        const filePayloads = await Promise.all(
          selectedFiles.map(async (file) => {
            const nativePath = (file as any).nativePath as string | undefined
            if (nativePath) {
              return {
                name: file.name,
                path: nativePath,
              }
            }
            const base64Data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => {
                const res = reader.result as string
                resolve(res.split(',')[1] || res)
              }
              reader.onerror = reject
              reader.readAsDataURL(file)
            })
            return {
              name: file.name,
              base64: base64Data,
            }
          })
        )

        await SharedFile.exportToClaude({
          prompt,
          files: filePayloads,
        })
        addToast('🚀 Exported files to Claude app!', 'success')
        return
      } catch (err) {
        console.warn('Native exportToClaude failed, falling back to clipboard:', err)
      }
    }

    // Web Browser Fallback: Copy template prompt to clipboard and open Claude
    try {
      await navigator.clipboard.writeText(prompt)
      addToast('Prompt template copied — attach your files in Claude', 'success')
      window.open('https://claude.ai/', '_blank', 'noopener,noreferrer')
    } catch {
      addToast('Failed to copy prompt', 'error')
    }
  }

  return (
    <CreateDeckModalUI
      isOpen={isOpen}
      tab={tab}
      onSelectTab={setTab}
      deckName={deckName}
      onDeckNameChange={setDeckName}
      hasActiveJob={hasActiveJob}
      fileInputRef={fileInputRef}
      state={state}
      progress={progress}
      error={error}
      selectedFiles={selectedFiles}
      pasteText={pasteText}
      onPasteTextChange={handlePasteTextChange}
      attachedJson={attachedJson}
      onClearAttachedJson={handleClearAttachedJson}
      textLoading={textLoading}
      textProgress={textProgress}
      onClose={handleClose}
      onFileSelect={handleFileSelect}
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); setState('dragover') }}
      onDragLeave={() => setState('idle')}
      onRemoveFile={handleRemoveFile}
      onProcessFiles={processSelectedFiles}
      onExportFilesToClaude={handleExportFilesToClaude}
      onGenerateText={handleGenerate}
      onCopyToClaude={handleCopyToClaude}
      onCopyNotesToClaude={handleCopyNotesToClaude}
      onRetry={handleRetry}
      formatFileSize={formatFileSize}
    />
  )
}
