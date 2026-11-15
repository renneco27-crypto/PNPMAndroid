// src/lib/mathStepsEngine.ts
// Official mathsteps backend integration for step-by-step algebra operations

import mathsteps from 'mathsteps'
import { MathStep } from '@/features/math/preloadedMathDeck'

export interface GeneratedMathSolution {
  original: string
  isEquation: boolean
  steps: MathStep[]
}

/**
 * Classify a mathsteps ChangeType into an animation operation category
 */
export function classifyMathOperation(changeType: string): {
  type: 'cancel' | 'mul_div' | 'add_sub' | 'factor' | 'simplify' | 'substitute' | 'final'
  badge: string
  termClass?: string
} {
  switch (changeType) {
    case 'CANCEL_TERMS':
    case 'CANCEL_MINUSES':
    case 'CANCEL_GCD':
    case 'CANCEL_EXPONENT':
    case 'CANCEL_ROOT':
      return { type: 'cancel', badge: '✂ Cancel Terms', termClass: 'term-slash' }

    case 'DIVIDE_FROM_BOTH_SIDES':
    case 'SIMPLIFY_DIVISION':
    case 'SIMPLIFY_FRACTION':
    case 'DIVIDE_FRACTION_FOR_ADDITION':
      return { type: 'mul_div', badge: '÷ Division (Collide)', termClass: 'term-div-red' }

    case 'MULTIPLY_COEFFICIENTS':
    case 'MULTIPLY_POLYNOMIAL_TERMS':
    case 'MULTIPLY_FRACTIONS':
    case 'MULTIPLY_TO_BOTH_SIDES':
    case 'MULTIPLY_NUMERATORS':
    case 'MULTIPLY_DENOMINATORS':
      return { type: 'mul_div', badge: '× Multiply Operands', termClass: 'term-mult-glow' }

    case 'ADD_TO_BOTH_SIDES':
    case 'SUBTRACT_FROM_BOTH_SIDES':
    case 'ADD_POLYNOMIAL_TERMS':
    case 'ADD_FRACTIONS':
    case 'ADD_NUMERATORS':
    case 'COLLECT_AND_COMBINE_LIKE_TERMS':
    case 'COLLECT_LIKE_TERMS':
      return { type: 'add_sub', badge: '+/− Combine Terms', termClass: 'term-combine' }

    case 'DISTRIBUTE':
    case 'DISTRIBUTE_NEGATIVE_ONE':
    case 'FACTOR_INTO_PRIMES':
    case 'FACTOR_DIFFERENCE_OF_SQUARES':
    case 'FACTOR_SUM_PRODUCT_RULE':
      return { type: 'factor', badge: 'Factor Expression' }

    default:
      return { type: 'simplify', badge: 'Simplify Step' }
  }
}

/**
 * Convert mathsteps output into our animated MathStep structure with targeted term classes
 */
export function solveWithMathsteps(inputExpr: string): GeneratedMathSolution {
  const isEquation = inputExpr.includes('=')
  const steps: MathStep[] = []

  if (isEquation) {
    try {
      const rawSteps = mathsteps.solveEquation(inputExpr)
      if (rawSteps && rawSteps.length > 0) {
        steps.push({
          stepNumber: 1,
          latex: rawSteps[0].oldEquation.ascii(),
          explanation: 'Original equation to solve.',
          operationType: 'start',
          operationBadge: 'Start Equation',
        })

        rawSteps.forEach((s: any, idx: number) => {
          const op = classifyMathOperation(s.changeType)
          const newEq = s.newEquation ? s.newEquation.ascii() : ''
          steps.push({
            stepNumber: idx + 2,
            latex: newEq,
            explanation: `Step ${idx + 1}: ${s.changeType.replace(/_/g, ' ').toLowerCase()}.`,
            operationType: idx === rawSteps.length - 1 ? 'final' : op.type,
            operationBadge: op.badge,
          })
        })
      }
    } catch (err) {
      console.warn('mathsteps equation solve error:', err)
    }
  } else {
    try {
      const rawSteps = mathsteps.simplifyExpression(inputExpr)
      if (rawSteps && rawSteps.length > 0) {
        steps.push({
          stepNumber: 1,
          latex: inputExpr,
          explanation: 'Original expression to simplify.',
          operationType: 'start',
          operationBadge: 'Start Expression',
        })

        rawSteps.forEach((s: any, idx: number) => {
          const op = classifyMathOperation(s.changeType)
          const newStr = s.newNode ? s.newNode.toString() : ''
          steps.push({
            stepNumber: idx + 2,
            latex: newStr,
            explanation: `Step ${idx + 1}: ${s.changeType.replace(/_/g, ' ').toLowerCase()}.`,
            operationType: idx === rawSteps.length - 1 ? 'final' : op.type,
            operationBadge: op.badge,
          })
        })
      }
    } catch (err) {
      console.warn('mathsteps expression simplify error:', err)
    }
  }

  return {
    original: inputExpr,
    isEquation,
    steps,
  }
}
