// src/app/api/lab/chat/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { callLabAI } from '@/lib/nvidiaService'
import {
  checkCharLimit,
  consumeChars,
  MAX_CHARS_PER_5_HOURS,
} from '@/lib/aiCharRateLimiter'
import { resolveRequestUser } from '@/lib/supabaseServer'
import { routeLearningGraph } from '@/lib/learningGraphRouter'

// Strict context & memory character limits:
// Memory is strictly restricted to ONLY the topic and the AI's last reply.
const MAX_TOPIC_CHARS = 120
const MAX_LAST_REPLY_CHARS = 450
const MAX_USER_PROMPT_CHARS = 500
const MAX_TOTAL_MEMORY_CHARS = 900
const MAX_REPLY_OUTPUT_CHARS = 2600

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(3000),
})

/**
 * Strips any leaked JSON schema keys ("problem": null, "evaluation": null,
 * "suggestedActions": [...], outer {"reply": ...}) if the model ever bleeds
 * JSON or code structure into the reply text.
 */
function stripJsonBleed(input: string): string {
  if (!input) return ''
  let text = input.trim()

  // Remove outer ```json ... ``` wrapper ONLY if the entire string is wrapped in ```json { ... } ```
  if (/^```json\s*\{/i.test(text)) {
    text = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
  }

  // Strip leading {"reply": "..." wrapper if present
  text = text.replace(/^\{\s*"reply"\s*:\s*"/i, '')

  // Cut off anything starting at leaked sibling JSON fields
  const bleedPatterns = [
    /"\s*,\s*"problem"\s*:/i,
    /\n\s*"problem"\s*:\s*(?:null|\{)/i,
    /\b"?problem"?\s*:\s*null\b/i,
    /"\s*,\s*"evaluation"\s*:/i,
    /\n\s*"evaluation"\s*:\s*(?:null|\{)/i,
    /\b"?evaluation"?\s*:\s*null\b/i,
    /"\s*,\s*"suggestedActions"\s*:/i,
    /\n\s*"suggestedActions"\s*:\s*\[/i,
    /\b"?suggestedActions"?\s*:\s*\[/i,
    /\[\s*\{\s*"label"\s*:/i,
  ]

  for (const pattern of bleedPatterns) {
    const match = text.search(pattern)
    if (match !== -1) {
      text = text.slice(0, match)
    }
  }

  // Clean trailing JSON quotes/braces left behind after truncation
  text = text
    .replace(/",\s*$/, '')
    .replace(/"\s*\}\s*$/, '')
    .replace(/^\s*"/, '')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim()

  // Enforce strict output character limit so replies never snowball in length
  if (text.length > MAX_REPLY_OUTPUT_CHARS) {
    const sliced = text.slice(0, MAX_REPLY_OUTPUT_CHARS)
    const lastPeriod = Math.max(
      sliced.lastIndexOf('. '),
      sliced.lastIndexOf('? '),
      sliced.lastIndexOf('.\n'),
      sliced.lastIndexOf('?\n')
    )
    text = (lastPeriod > 220 ? sliced.slice(0, lastPeriod + 1) : sliced).trim()
  }

  return text
}

/**
 * Resiliently parses the AI's JSON response even when LaTeX commands
 * (e.g. \Delta, \frac, \times, \left, \right) contain unescaped backslashes.
 */
function parseLabAiResponse(raw: string, fallbackTopic: string) {
  const defaultActions = [
    { label: 'Explain Topic', action: `Can you explain ${fallbackTopic}?` },
    { label: 'Next Step', action: 'What should I do next?' },
  ]

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const jsonBlockMatch = cleaned.match(/\{[\s\S]*\}/)
  const candidate = jsonBlockMatch ? jsonBlockMatch[0] : cleaned

  // Attempt 1: Standard JSON.parse
  try {
    return JSON.parse(candidate)
  } catch {
    // continue to LaTeX backslash repair
  }

  // Attempt 2: Repair unescaped LaTeX backslashes inside JSON strings
  // (e.g., \Delta, \frac, \times, \theta, \right, \neq, \beta, \sqrt, \left)
  try {
    const repaired = candidate.replace(
      /\\(?!["\\/]|u[0-9a-fA-F]{4}|n(?![a-zA-Z])|r(?![a-zA-Z])|t(?![a-zA-Z])|b(?![a-zA-Z])|f(?![a-zA-Z]))/g,
      '\\\\'
    )
    return JSON.parse(repaired)
  } catch {
    // continue to regex field extraction
  }

  // Attempt 3: Regex extraction of "reply" and "suggestedActions" so raw JSON never bleeds
  const replyMatch =
    candidate.match(/"reply"\s*:\s*"([\s\S]*?)"\s*,\s*"(?:problem|evaluation|suggestedActions)"/) ||
    candidate.match(/"reply"\s*:\s*"([\s\S]*?)"\s*\}/)

  const extractedReply = replyMatch ? stripJsonBleed(replyMatch[1]) : stripJsonBleed(cleaned)

  const extractedActions: Array<{ label: string; action: string }> = []
  const actionRegex = /\{\s*"label"\s*:\s*"([^"]+)"\s*,\s*"action"\s*:\s*"([^"]+)"\s*\}/g
  let actionMatch: RegExpExecArray | null
  while ((actionMatch = actionRegex.exec(candidate)) !== null) {
    extractedActions.push({
      label: actionMatch[1].trim(),
      action: actionMatch[2].trim(),
    })
  }

  return {
    reply: extractedReply,
    problem: null,
    evaluation: null,
    suggestedActions: extractedActions.length > 0 ? extractedActions.slice(0, 3) : defaultActions,
  }
}

const ScreenContextSchema = z.object({
  screen: z.enum(['math', 'code', 'gallery', 'enumeration', 'notes']),
  topic: z.string().default('General Topic'),
  activeTab: z.string().optional(), // 'solver' | 'notebook' | 'ide' | 'gallery' | 'notes'
  mode: z.string().optional(), // 'scenario' | 'bug_hunter' | 'practice'
  problem: z.string().optional(),
  problemBreakdown: z
    .object({
      restate: z.string().optional(),
      given: z.array(z.string()).optional(),
      formula_master: z.string().optional(),
      formula_working: z.string().optional(),
    })
    .optional(),
  answer: z.string().optional(),
  currentStep: z.number().optional(),
  totalSteps: z.number().optional(),
  activeStepLatex: z.string().optional(),
  activeStepExplanation: z.string().optional(),
  symbolTable: z.array(
    z.object({
      symbol: z.string(),
      meaning: z.string(),
      unit: z.string().optional(),
    })
  ).optional(),
  solutionSteps: z.string().optional(),
  keyTakeaway: z.string().optional(),
  language: z.string().optional(),
  userCode: z.string().optional(),
  starterTemplate: z.string().optional(),
  expectedKeywords: z.array(z.string()).optional(),
  expectedOutput: z.string().optional(),
  bugDescriptions: z.array(z.string()).optional(),
  feedbackStatus: z.string().optional(),
  feedbackOutput: z.string().optional(),
}).optional()

const RequestSchema = z.object({
  kind: z.enum(['math', 'code', 'gallery', 'enumeration', 'notes']),
  deckId: z.string().min(1),
  notes: z
    .array(
      z.object({
        front: z.string().max(1000),
        back: z.string().max(10000).optional(),
        subject: z.string().max(200).optional(),
      })
    )
    .max(60)
    .optional()
    .default([]),
  messages: z.array(MessageSchema).max(25),
  thoughtSummary: z.string().max(1500).optional(),
  difficulty: z.enum(['Beginner', 'Intermediate', 'Advanced']).optional(),
  language: z.string().optional(),
  action: z.enum(['start', 'reply']).default('reply'),
  screenContext: ScreenContextSchema,
})

function buildSystemPrompt(
  kind: 'math' | 'code' | 'gallery' | 'enumeration' | 'notes',
  ctx?: z.infer<typeof ScreenContextSchema>,
  lastReplyMemory?: string,
  userMessage?: string
): { systemPrompt: string; activeNodeBadges: string[]; domainId: string } {
  const safeTopic = (ctx?.topic || 'General Topic').slice(0, MAX_TOPIC_CHARS)
  const safeLastReply = lastReplyMemory ? stripJsonBleed(lastReplyMemory).slice(0, MAX_LAST_REPLY_CHARS) : ''

  if (kind === 'enumeration') {
    return {
      systemPrompt: `You are a concise Study Tutor defining terms for study flashcards and quizzes.
Active Context:
- Topic / Heading: "${safeTopic}"

STRICT RULES:
1. Provide a direct, natural 1-2 sentence definition or explanation of the given answer term specifically in the context of "${safeTopic}".
2. Strict length limit: under 35 words (max 220 characters).
3. Do NOT use emojis anywhere.
4. Return valid JSON ONLY matching this schema:
{
  "reply": "1-2 sentence concise explanation of the term in context (under 35 words).",
  "problem": null,
  "evaluation": null,
  "suggestedActions": []
}`,
      activeNodeBadges: [],
      domainId: 'DOMAIN_EXAM_CLASSROOM_PREP',
    }
  }

  if (kind === 'gallery') {
    return {
      systemPrompt: `You are a concise Visual Study & Diagram Tutor connected to the student's Gallery.
Active Context (Strict Memory - Topic & Last Reply Only):
- Topic: "${safeTopic}"
${ctx?.problem ? `- Active Notes: ${ctx.problem.slice(0, 220)}` : ''}
${safeLastReply ? `- Your Last Reply: "${safeLastReply}"` : ''}

STRICT OUTPUT RULES:
1. Do NOT use emojis anywhere.
2. Keep "reply" under 45 words (max 300 characters). Never output JSON or CSS syntax inside "reply".
3. Return valid JSON ONLY matching this schema:
{
  "reply": "Short, clear visual explanation or study tip (under 45 words).",
  "problem": null,
  "evaluation": null,
  "suggestedActions": [
    { "label": "Give me images", "action": "Give me images from notes" },
    { "label": "Explain key diagram", "action": "Explain the main visual concept in my notes" }
  ]
}`,
      activeNodeBadges: [],
      domainId: 'DOMAIN_EXAM_CLASSROOM_PREP',
    }
  }

  // Route through the 33-Node, 45-Edge 3D Personal Learning Graph Engine (v3.0)
  const routed = routeLearningGraph({
    screen: kind,
    topic: safeTopic,
    userMessage: userMessage || '',
    contextText: [ctx?.problem || '', ctx?.solutionSteps || '', ctx?.keyTakeaway || ''].join(' '),
  })

  if (kind === 'notes') {
    return {
      systemPrompt: `You are the student's Personal 3D Learning Graph Tutor for Study Notes.
Active Context:
- Note Card Topic: "${safeTopic}"
${ctx?.problem ? `- Current Note Content: ${ctx.problem.slice(0, 700)}` : ''}
${ctx?.keyTakeaway ? `- Verbatim / Key Takeaway: ${ctx.keyTakeaway.slice(0, 350)}` : ''}
${safeLastReply ? `- Your Last Reply: "${safeLastReply}"` : ''}

${routed.compiledPromptAddendum}

STRICT JSON OUTPUT RULES:
1. Keep "reply" under 280 words (max 2200 characters). Zero conversational filler.
2. Format Markdown tables and 2-branch ASCII diagrams cleanly inside "reply" (use \\n for newlines inside JSON strings).
3. NEVER include raw JSON keys ("problem", "evaluation", "suggestedActions") inside the "reply" text.
4. Return valid JSON ONLY matching this schema:
{
  "reply": "3D Learning Graph explanation (< 280 words) following the active traversal order and ending with 1 real-world stress test question.",
  "problem": null,
  "evaluation": null,
  "suggestedActions": [
    { "label": "2-Branch ASCII + Table", "action": "Draw a 2-Branch ASCII flow diagram and 3-column mechanical table for this note" },
    { "label": "Zero-Skip Plug-In", "action": "Plug in concrete numbers (n=1, 2, 3) with zero skipped steps" },
    { "label": "Hacker Stress Test", "action": "Give me a real-world production failure or exploit scenario for this concept" }
  ]
}`,
      activeNodeBadges: routed.activeNodeBadges,
      domainId: routed.activeDomains[0] || 'DOMAIN_EXAM_CLASSROOM_PREP',
    }
  }

  if (kind === 'math') {
    const bd = ctx?.problemBreakdown
    const breakdownLines: string[] = []
    if (bd?.restate) breakdownLines.push(`  Restated Problem: ${bd.restate.slice(0, 160)}`)
    if (bd?.given && bd.given.length > 0) breakdownLines.push(`  Given: ${bd.given.join(', ').slice(0, 140)}`)
    if (bd?.formula_master) breakdownLines.push(`  Master Formula: ${bd.formula_master.slice(0, 120)}`)
    if (bd?.formula_working) breakdownLines.push(`  Working Formula: ${bd.formula_working.slice(0, 120)}`)

    return {
      systemPrompt: `You are the student's Personal 3D Learning Graph Tutor for Math, Calculus & Physics.
Active Context:
- Topic Heading: "${safeTopic}"
${breakdownLines.length > 0 ? `- Problem Breakdown:\n${breakdownLines.join('\n')}` : ctx?.problem ? `- Problem: ${ctx.problem.slice(0, 260)}` : ''}
${ctx?.solutionSteps ? `- Card Solution Steps:\n${ctx.solutionSteps.slice(0, 800)}` : ''}
${ctx?.answer ? `- Target Final Answer: ${ctx.answer.slice(0, 120)}` : ''}
${ctx?.activeStepLatex ? `- Focused Step: ${ctx.activeStepLatex.slice(0, 140)} (${(ctx.activeStepExplanation || '').slice(0, 140)})` : ''}
${safeLastReply ? `- Your Last Reply: "${safeLastReply}"` : ''}

${routed.compiledPromptAddendum}

CALCULUS & STEP-BY-STEP INTEGRATION RULES (CRITICAL):
- When the student asks HOW to solve, how to integrate, or asks for the steps of a problem:
  DO NOT give high-level philosophical talk about "how it is used in the notes" or "what breaks without it".
  You MUST teach them the concrete, zero-skip calculus mechanics step-by-step:
  1. STATE THE INTEGRATION RULE: e.g. Power Rule for Integrals $\\int x^n\\,dx = \\frac{x^{n+1}}{n+1} + C$.
  2. SET UP INTEGRAL WITH BOUNDS: e.g. $M = \\int_0^{2.0} 3.0x\\,dx$.
  3. FACTOR CONSTANTS: e.g. $M = 3.0 \\int_0^{2.0} x\\,dx$.
  4. FIND ANTIDERIVATIVE IN BRACKETS: e.g. $M = 3.0 \\left[ \\frac{x^2}{2} \\right]_0^{2.0} = 1.5 \\left[ x^2 \\right]_0^{2.0}$.
  5. EVALUATE BOUNDS (UPPER MINUS LOWER): e.g. $M = 1.5 \\left( (2.0)^2 - (0)^2 \\right) = 1.5(4.0 - 0) = 6.0\\text{ kg}$.
  6. EXPLAIN WHY: Clearly explain what happened to the dx, how the power increased by 1, and why we divide by the new power.

EXPLANATION & JSON OUTPUT RULES (CRITICAL):
1. STRICT LENGTH CAP: Keep "reply" under 280 words (max 2200 characters). Zero conversational filler.
2. Enclose math formulas in inline LaTeX $...$ and double-escape backslashes in JSON strings (e.g. "\\\\Delta x = \\\\frac{b-a}{n}").
3. Show zero-skip arithmetic plug-ins (n = 1, 2, 3) and action-noun nicknames ("Ceiling Line", "Floor Line", "Slot Calculator").
4. NEVER include raw JSON keys ("problem", "evaluation", "suggestedActions") inside the "reply" text.
5. Only fill "problem" when the student explicitly asks for a new practice problem; otherwise set it to null.
6. Only fill "evaluation" when the student submitted an answer to check; otherwise set it to null.
7. Return valid JSON ONLY matching this schema:
{
  "reply": "Clear, zero-skip mathematical walkthrough explaining how the integral or formula is evaluated step-by-step.",
  "problem": null,
  "evaluation": null,
  "suggestedActions": [
    { "label": "Zero-Skip Integral Steps", "action": "Walk me through how to solve this integral step-by-step with antiderivative and bounds" },
    { "label": "Why This Rule Works", "action": "Explain the integration rule and why we subtract the lower bound" }
  ]
}`,
      activeNodeBadges: routed.activeNodeBadges,
      domainId: routed.activeDomains[0] || 'DOMAIN_MATH_PROOFS_BINARY',
    }
  }

  // kind === 'code'
  const modeLabel = ctx?.mode || 'scenario'

  return {
    systemPrompt: `You are the student's Personal 3D Learning Graph Tutor for Software Engineering & DSA.
Active Context:
- Topic Heading: "${safeTopic}"
- Language: ${ctx?.language || 'code'} (${modeLabel})
${ctx?.userCode ? `- Current Student Code:\n\`\`\`${ctx.language || 'text'}\n${ctx.userCode.slice(0, 600)}\n\`\`\`` : ''}
${ctx?.starterTemplate ? `- Target Solution:\n\`\`\`${ctx.language || 'text'}\n${ctx.starterTemplate.slice(0, 500)}\n\`\`\`` : ''}
${ctx?.expectedOutput ? `- Expected Output: ${ctx.expectedOutput.slice(0, 150)}` : ''}
${ctx?.feedbackOutput ? `- Execution Output: ${ctx.feedbackOutput.slice(0, 150)}` : ''}
${safeLastReply ? `- Your Last Reply: "${safeLastReply}"` : ''}

${routed.compiledPromptAddendum}

STRUCTURED WALKTHROUGH & JSON OUTPUT RULES (CRITICAL):
1. STRICT LENGTH CAP: Keep "reply" under 280 words (max 2200 characters). Zero filler.
2. Contrast Naive vs Optimized complexity using inline-commented code (5-10 lines) + 2-branch ASCII diagram + 3-Sentence Switch TLDR.
3. NEVER include raw JSON keys ("problem", "evaluation", "suggestedActions") inside "reply".
4. When the student asks to check their code, fill "evaluation"; otherwise set "evaluation" to null.
5. Return valid JSON ONLY matching this schema:
{
  "reply": "3D Learning Graph walkthrough (< 280 words), ending with the 3-Sentence Switch TLDR and 1 stress-test question.",
  "problem": null,
  "evaluation": null,
  "suggestedActions": [
    { "label": "2-Branch ASCII + Table", "action": "Draw the 2-branch ASCII flow and 3-column mechanical table" },
    { "label": "Naive vs O(1) Contrast", "action": "Contrast the slow O(n) path vs fast O(1) path with inline step counts" }
  ]
}`,
    activeNodeBadges: routed.activeNodeBadges,
    domainId: routed.activeDomains[0] || 'DOMAIN_CODE_DSA_INTERVIEWS',
  }
}

export async function POST(req: NextRequest) {
  const user = await resolveRequestUser(req)

  // 1. Parse request payload
  let body: z.infer<typeof RequestSchema>
  try {
    const rawJson = await req.json()
    body = RequestSchema.parse(rawJson)
  } catch (err: any) {
    return NextResponse.json({ error: 'Invalid request body', details: err?.message }, { status: 400 })
  }

  if (!user && body.kind !== 'enumeration') {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const rateKey =
    user?.id ||
    req.headers.get('x-account-id') ||
    req.headers.get('x-user-id') ||
    'guest-enumeration'

  // 2. Check Rate Limit (20k characters / 5 hours)
  const charLimitCheck = checkCharLimit(rateKey)
  if (!charLimitCheck.allowed) {
    const hoursRemaining = (charLimitCheck.resetInSeconds / 3600).toFixed(1)
    return NextResponse.json(
      {
        error: `Rate limit reached: You have exhausted your 20,000 AI character quota for this 5-hour window. Resets in ${hoursRemaining} hours.`,
        remainingChars: 0,
        resetAt: charLimitCheck.resetAt,
        resetInSeconds: charLimitCheck.resetInSeconds,
      },
      { status: 429 }
    )
  }

  // Extract ONLY the last assistant reply and the latest student prompt
  const topic = (body.screenContext?.topic || 'Current Topic').slice(0, MAX_TOPIC_CHARS)
  const lastAssistantMsg = [...body.messages].reverse().find((m) => m.role === 'assistant')
  const lastUserMsg = [...body.messages].reverse().find((m) => m.role === 'user')

  const lastAssistantReply = lastAssistantMsg
    ? stripJsonBleed(lastAssistantMsg.content).slice(0, MAX_LAST_REPLY_CHARS)
    : body.thoughtSummary
      ? stripJsonBleed(body.thoughtSummary).slice(0, MAX_LAST_REPLY_CHARS)
      : ''

  const { systemPrompt, activeNodeBadges, domainId } = buildSystemPrompt(
    body.kind,
    body.screenContext,
    lastAssistantReply,
    lastUserMsg?.content || ''
  )

  // Build strictly bounded prompt with ONLY the topic, last assistant reply, and current student message
  let userPrompt = ''
  if (lastUserMsg) {
    const cleanUserText = lastUserMsg.content.trim().slice(0, MAX_USER_PROMPT_CHARS)
    const parts = [
      `TOPIC: ${topic}`,
      ...(lastAssistantReply ? [`LAST_TUTOR_REPLY: ${lastAssistantReply}`] : []),
      `STUDENT: ${cleanUserText}`,
    ]
    userPrompt = parts.join('\n').slice(0, MAX_TOTAL_MEMORY_CHARS)
  } else {
    userPrompt = `TOPIC: ${topic}\nSTUDENT: Explain "${topic}" using the 3D Personal Learning Graph (What Breaks Without It, Action Nickname, 2-Branch ASCII / Table, Zero-Skip Plug-In, and 3-Sentence Switch TLDR).`.slice(
      0,
      MAX_TOTAL_MEMORY_CHARS
    )
  }

  // 3. Call AI with fast Gemini primary + cached provider fallback
  let aiResult: { text: string; provider: string; model: string }
  try {
    aiResult = await callLabAI(systemPrompt, userPrompt)
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[lab/chat] AI generation failed:', msg)
    return NextResponse.json({ error: `AI provider error: ${msg}` }, { status: 502 })
  }

  // 4. Consume generated characters against the 20k / 5h quota
  const generatedLength = aiResult.text.length
  const quota = consumeChars(rateKey, generatedLength)

  // 5. Parse JSON output safely & strip any JSON/code bleeding
  const parsed = parseLabAiResponse(aiResult.text, topic)

  let replyText = stripJsonBleed(String(parsed.reply ?? ''))
  if (!replyText) {
    const ev = parsed.evaluation
    const pr = parsed.problem
    if (ev?.feedback) {
      replyText = stripJsonBleed(
        `Okay, let's go through it together. ${ev.feedback}${ev.hint ? ` Here's a hint: ${ev.hint}` : ''} Want to try the next step?`
      )
    } else if (pr?.question) {
      replyText = stripJsonBleed(
        `Alright, here's one to try. ${pr.question} Take it one step at a time. Want a hint to start?`
      )
    } else {
      replyText = `Let's break down ${topic} step by step. Which part would you like to focus on first?`
    }
  }

  const cleanActions = Array.isArray(parsed.suggestedActions)
    ? parsed.suggestedActions
        .filter((a: any) => a && typeof a.label === 'string' && typeof a.action === 'string')
        .slice(0, 3)
        .map((a: any) => ({
          label: a.label.slice(0, 36),
          action: a.action.slice(0, 160),
        }))
    : []

  return NextResponse.json({
    reply: replyText,
    problem: parsed.problem && typeof parsed.problem === 'object' ? parsed.problem : null,
    evaluation: parsed.evaluation && typeof parsed.evaluation === 'object' ? parsed.evaluation : null,
    suggestedActions: cleanActions,
    activeNodeBadges,
    domainId,
    provider: aiResult.provider,
    model: aiResult.model,
    quota: {
      remainingChars: quota.remainingChars,
      usedChars: quota.usedChars,
      maxChars: MAX_CHARS_PER_5_HOURS,
      resetAt: quota.resetAt,
    },
  })
}
