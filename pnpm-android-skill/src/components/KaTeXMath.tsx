'use client'

import React, { useMemo } from 'react'
import katex from 'katex'

export function isValidLatex(s: string): boolean {
  if (!s || typeof s !== 'string') return false
  try {
    katex.renderToString(toLatex(s), { throwOnError: true, strict: false })
    return true
  } catch {
    return false
  }
}

export const CLOSED_MATH_TOKENS = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'lim', 'max', 'min', 'sup',
  'inf', 'mod', 'det', 'dim', 'gcd', 'lcm', 'ker', 'deg', 'exp',
  'tau', 'theta', 'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta',
  'eta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho',
  'sigma', 'upsilon', 'phi', 'chi', 'psi', 'omega',
  'gamma', 'delta', 'theta', 'lambda', 'xi', 'pi', 'sigma', 'upsilon', 'phi', 'psi', 'omega',
  'sum', 'int', 'prod', 'sqrt', 'frac', 'cdot', 'times', 'pm', 'mp', 'le', 'ge', 'leq', 'geq',
  'neq', 'approx', 'infty', 'text', 'left', 'right', 'middle', 'big', 'bigg',
  'exists', 'forall', 'in', 'notin', 'subset', 'supset', 'cup', 'cap',
  'choose',
  'such', 'that', 'candidate', 'where', 'iff', 'let', 'given',
  'kg', 'rad', 'mol', 'hz', 'pa', 'cm', 'mm', 'km', 'ms', 'ns',
])

// Structural check: flags any standalone 2+ letter word that is not a closed-set math token or function call
export const hasProse = (s: string): boolean => {
  if (!s || typeof s !== 'string') return false
  const stripped = s
    .replace(/\\text\{[^}]*\}/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ')
  const wordRegex = /\b([A-Za-z]{2,})\b(?!\s*[\(_^])/g
  let m: RegExpExecArray | null
  while ((m = wordRegex.exec(stripped)) !== null) {
    if (!CLOSED_MATH_TOKENS.has(m[1].toLowerCase())) {
      return true
    }
  }
  return false
}

export function toLatex(raw: any): string {
  if (raw === null || raw === undefined) return ''

  let tex = (typeof raw === 'string' ? raw : String(raw)).trim()

  // 1. Recover control characters corrupted by JSON escaping/unescaping (\f, \t, \b, \r)
  tex = tex.replace(/[\x0C\u000c]rac(?=\{|\b)/g, '\\frac')
  tex = tex.replace(/[\x0C\u000c]orall(?=\b|[^a-zA-Z])/g, '\\forall')
  tex = tex.replace(/[\x0C\u000c]/g, '\\f')
  tex = tex.replace(/[\x09\t]imes(?=\b|[^a-zA-Z])/g, '\\times')
  tex = tex.replace(/[\x09\t]ext(?=\{|\b)/g, '\\text')
  tex = tex.replace(/[\x09\t]heta(?=\b|[^a-zA-Z])/g, '\\theta')
  tex = tex.replace(/[\x09\t]au(?=\b|[^a-zA-Z])/g, '\\tau')
  tex = tex.replace(/[\x08\b]eta(?=\b|[^a-zA-Z])/g, '\\beta')
  tex = tex.replace(/[\x0D\r]ho(?=\b|[^a-zA-Z])/g, '\\rho')

  // 2. Recover unescaped 'orall' and 'rac' (e.g. \forall mangled into orall, \frac into rac)
  tex = tex.replace(/(^|[^a-zA-Z\\])orall\b/g, '$1\\forall ')
  tex = tex.replace(/(^|[^a-zA-Z\\])rac\s*\{/g, '$1\\frac{')

  // 3. Recover missing backslash on frac
  tex = tex.replace(/(^|[^\\])\bfrac\s*\{/g, '$1\\frac{')

  // 4. Recover unbraced single-character denominators: e.g. \frac{1}3 -> \frac{1}{3}, \frac{2n + 7}3 -> \frac{2n + 7}{3}
  tex = tex.replace(/\\frac\s*\{([^}]+)\}\s*([0-9a-zA-Z])(?![0-9a-zA-Z_{])/g, (_m, n, d) => `\\frac{${n}}{${d}}`)

  // 5. Fix invalid nested \text{ \frac{...}{...} }^2 which breaks KaTeX parser
  tex = tex.replace(/\\text\{\s*\\frac\{([^}]+)\}\{([^}]+)\}\s*\}\^?(\d+|\{[^}]+\})?/g, (_m, num, den, exp) => {
    const expStr = exp ? `^{${String(exp).replace(/[{}]/g, '')}}` : ''
    return `\\frac{\\text{${num}}}{\\text{${den}}}${expStr}`
  })
  tex = tex.replace(/\\text\{\s*\\frac\{([^}]+)\}\{([^}]+)\}\s*\}/g, '\\frac{\\text{$1}}{\\text{$2}}')

  // Flatten any nested or corrupted \text{ \text{...}}
  tex = tex.replace(/\\text\{\s*\\text\{([^}]+)\}\s*\}/g, '\\text{$1}')
  tex = tex.replace(/\\text\{\s*\\text\{([^}]+)\}\s*\}/g, '\\text{$1}')

  // 6. Fix unescaped Greek letters (only when not part of a multi-word English phrase)
  tex = tex.replace(/(^|[^\\])\b(tau|theta|alpha|beta|gamma|delta|epsilon|zeta|eta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|upsilon|phi|chi|psi|omega)\b(?![\s]+[A-Za-z]{3,})/g, '$1\\$2')
  tex = tex.replace(/(^|[^\\])\b(Theta|Gamma|Delta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)\b(?![\s]+[A-Za-z]{3,})/g, '$1\\$2')

  // 7. Fix unescaped quantifiers and relations
  tex = tex.replace(/(^|[^\\])\b(exists|forall)\b/g, '$1\\$2 ')
  tex = tex.replace(/(^|[^\\])\b(ge|le|leq|geq|neq|approx|cdot|times)\b(?![\s]+[A-Za-z]{3,})/g, '$1\\$2 ')
  tex = tex.replace(/\\text\{\s*such\s+that\s*\}/gi, '\\text{ such that }')
  tex = tex.replace(/(^|[^\\])\bsuch\s+that\b/gi, '$1\\text{ such that }')
  tex = tex.replace(/(^|[^\\])\bcandidate\s*([a-zA-Z]\b|\([a-zA-Z0-9]\)|[a-zA-Z]\s*\()/gi, '$1\\text{candidate } $2')
  tex = tex.replace(/\\text\{\s*\\text\{([^}]+)\}\s*\}/g, '\\text{$1}')
  tex = tex.replace(/\\text\{\s*\\text\{([^}]+)\}\s*\}/g, '\\text{$1}')

  // 8. Fix subscripts like \tau_net or \tau_{net} -> \tau_{\text{net}}
  tex = tex.replace(/(\\[a-zA-Z]+|[a-zA-Z])_\{?([a-zA-Z]{2,})\}?/g, '$1_{\\text{$2}}')

  // Fix degree notation (e.g. 90 deg, 90 degrees -> 90^\circ)
  tex = tex.replace(/(\d+)\s*(?:deg|degrees)\b/gi, '$1^\\circ')

  // Fix unit notations
  tex = tex.replace(/(\d+(?:\.\d+)?)\s*N\s*\*\s*m\b/g, '$1\\text{ N}\\cdot\\text{m}')
  tex = tex.replace(/(\d+(?:\.\d+)?)\s*kg\s*\*\s*m\^2\b/g, '$1\\text{ kg}\\cdot\\text{m}^2')
  tex = tex.replace(/\brad\/s\^2\b/g, '\\text{rad/s}^2')
  tex = tex.replace(/\brad\/s\b/g, '\\text{rad/s}')

  // If already standard LaTeX containing HTML classes or cancel, return as-is
  if (tex.includes('\\htmlClass') || tex.includes('\\cancel')) {
    return tex
  }

  // Replace &*(sigma), &*(theta), &*(sqrt{...}), etc.
  tex = tex.replace(/&\*\(([^)]+)\)/g, (_match, token) => {
    const trimmed = token.trim()
    const sqrtMatch = trimmed.match(/^sqrt\{([^}]+)\}$/)
    if (sqrtMatch) return `\\sqrt{${toLatex(sqrtMatch[1])}}`

    const greekMap: Record<string, string> = {
      sigma: '\\sigma', Sigma: '\\Sigma', sum: '\\sum', prod: '\\prod',
      int: '\\int', theta: '\\theta', Theta: '\\Theta', pi: '\\pi',
      alpha: '\\alpha', beta: '\\beta', gamma: '\\gamma', delta: '\\delta',
      mu: '\\mu', phi: '\\phi', lambda: '\\lambda', infty: '\\infty',
      tau: '\\tau', Tau: '\\Tau', omega: '\\omega', Omega: '\\Omega',
      rho: '\\rho', epsilon: '\\epsilon', eta: '\\eta', zeta: '\\zeta',
      pm: '\\pm', neq: '\\neq', approx: '\\approx', le: '\\le', ge: '\\ge',
      sin: '\\sin', cos: '\\cos', tan: '\\tan', sec: '\\sec', csc: '\\csc',
      cot: '\\cot', log: '\\log', ln: '\\ln', lim: '\\lim',
    }
    if (greekMap[trimmed]) return greekMap[trimmed]
    return trimmed
  })

  // Replace simple &*token
  tex = tex.replace(/&\*([a-zA-Z]+)/g, (_m, token) => `\\${token}`)

  // Replace +- with \pm
  tex = tex.replace(/\+-/g, '\\pm ')

  // Convert (a+b)/(c+d) or a/b into \frac{a+b}{c+d} if not already LaTeX
  if (!tex.includes('\\frac')) {
    tex = tex.replace(/(\([^)]+\)|[a-zA-Z0-9^_+.-]+)\s*\/\s*(\([^)]+\)|[a-zA-Z0-9^_+.-]+)/g, (_m, num, den) => {
      const cleanNum = num.replace(/^\((.+)\)$/, '$1').trim()
      const cleanDen = den.replace(/^\((.+)\)$/, '$1').trim()
      return `\\frac{${cleanNum}}{${cleanDen}}`
    })
  }

  // Replace * with \cdot
  tex = tex.replace(/(?<=[0-9a-zA-Z\)])\s*\*\s*(?=[0-9a-zA-Z\(])/g, ' \\cdot ')

  return tex
}

/**
 * Strips incomplete/truncated LaTeX commands from the end of a string.
 * Handles cases like "\Big" (no following delimiter) which causes KaTeX
 * to render the remainder in red as a parse error.
 */
function sanitizeLatex(tex: string): string {
  return tex
    // Strip trailing incomplete \Big/\big/\Bigg/\bigl/\bigr + optional delimiter
    .replace(/\\[Bb]igg?[lrm]?\s*[([{|.]?\s*$/, '')
    .trim()
}

interface KaTeXMathProps {
  math: string
  displayMode?: boolean
  className?: string
}

export default function KaTeXMath({ math, displayMode = false, className = '' }: KaTeXMathProps) {
  const html = useMemo(() => {
    if (!math) return ''
    const cleanTex = sanitizeLatex(toLatex(math))

    try {
      let res = katex.renderToString(cleanTex, {
        throwOnError: false,
        displayMode,
        strict: false,
        trust: true,
      })

      // Guard: KaTeX wraps syntax/unrecognized tokens in <span class="katex-error" style="color:#cc0000">
      // Never let it turn the entire paragraph red. Override red error color to inherit.
      if (res.includes('class="katex-error"')) {
        res = res
          .replace(/style="color:#cc0000"/gi, 'style="color:inherit"')
          .replace(/class="katex-error"/gi, 'class="katex-fallback text-inherit"')
      }

      return res
    } catch {
      return `<span class="font-mono text-inherit">${cleanTex}</span>`
    }
  }, [math, displayMode])

  return (
    <span
      className={`${displayMode ? 'block w-full' : 'inline-block align-middle'} select-text max-w-full overflow-x-auto overflow-y-hidden [overflow-wrap:anywhere] ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
