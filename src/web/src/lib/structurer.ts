/**
 * Stand-in for the LLM structuring call (src/llm-client.ts). Produces the same
 * `StructuredReport` + canonical summary pair, but from keyword rules instead
 * of a model, so the simulation runs offline and deterministically.
 */

import type { Sentiment, StructuredReport } from '../types'
import { tokenize } from './embedding'

export interface StructuringResult {
  structuredReport: StructuredReport
  canonicalSummary: string
}

interface CategoryRule {
  category: string
  keywords: string[]
  /** Neutral restatement of the issue, used to seed the canonical summary. */
  theme: string
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'Billing',
    keywords: ['charge', 'charged', 'billing', 'invoice', 'refund', 'payment', 'card', 'subscription', 'price', 'double'],
    theme: 'billing and payment handling',
  },
  {
    category: 'Authentication',
    keywords: ['login', 'log', 'password', 'signin', 'sign', 'account', 'locked', 'otp', 'verification', 'authenticate'],
    theme: 'account sign-in',
  },
  {
    category: 'Performance',
    keywords: ['slow', 'lag', 'laggy', 'timeout', 'loading', 'freeze', 'frozen', 'crash', 'crashes', 'hangs', 'unresponsive'],
    theme: 'application responsiveness',
  },
  {
    category: 'Delivery',
    keywords: ['delivery', 'shipping', 'shipment', 'courier', 'package', 'parcel', 'arrived', 'late', 'tracking'],
    theme: 'order delivery',
  },
  {
    category: 'Support',
    keywords: ['support', 'agent', 'ticket', 'response', 'replied', 'chat', 'helpdesk', 'waiting', 'ignored'],
    theme: 'customer support responsiveness',
  },
  {
    category: 'Data Integrity',
    keywords: ['missing', 'lost', 'deleted', 'disappeared', 'sync', 'duplicate', 'wrong', 'incorrect', 'corrupted'],
    theme: 'data correctness',
  },
]

const NEGATIVE_WORDS = new Set([
  'angry', 'awful', 'bad', 'broken', 'cancel', 'disappointed', 'frustrating',
  'frustrated', 'horrible', 'never', 'ridiculous', 'terrible', 'unacceptable',
  'useless', 'worst', 'failed', 'failing', 'annoying', 'again',
])

const POSITIVE_WORDS = new Set([
  'great', 'good', 'love', 'nice', 'thanks', 'thank', 'helpful', 'happy',
  'appreciate', 'excellent', 'smooth',
])

function classify(tokens: string[]): CategoryRule {
  let best: CategoryRule | null = null
  let bestScore = 0

  for (const rule of CATEGORY_RULES) {
    const score = tokens.filter((token) => rule.keywords.includes(token)).length
    if (score > bestScore) {
      best = rule
      bestScore = score
    }
  }

  return best ?? { category: 'General', keywords: [], theme: 'the reported product issue' }
}

function detectSentiment(tokens: string[]): Sentiment {
  let score = 0
  for (const token of tokens) {
    if (NEGATIVE_WORDS.has(token)) score -= 1
    if (POSITIVE_WORDS.has(token)) score += 1
  }
  if (score < 0) return 'negative'
  if (score > 0) return 'positive'
  return 'neutral'
}

function firstSentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  const match = trimmed.match(/^.{0,140}?[.!?](\s|$)/)
  return (match ? match[0] : trimmed.slice(0, 140)).trim()
}

function toTitle(text: string, category: string): string {
  const sentence = firstSentence(text).replace(/[.!?]+$/, '')
  if (sentence.length < 12) return `${category} issue reported`
  const clipped = sentence.length > 68 ? `${sentence.slice(0, 65).trimEnd()}…` : sentence
  return clipped.charAt(0).toUpperCase() + clipped.slice(1)
}

export function structureComplaint(rawText: string): StructuringResult {
  const tokens = tokenize(rawText)
  const rule = classify(tokens)
  const sentiment = detectSentiment(tokens)

  // Keep the salient nouns/verbs so the canonical summary embeds near future
  // complaints about the same underlying issue rather than near its phrasing.
  const salient = Array.from(new Set(tokens))
    .filter((token) => !['please', 'still', 'just', 'like', 'really'].includes(token))
    .slice(0, 12)
    .join(' ')

  return {
    structuredReport: {
      title: toTitle(rawText, rule.category),
      category: rule.category,
      sentiment,
      description: firstSentence(rawText),
    },
    canonicalSummary: `Customer reports a problem with ${rule.theme}: ${salient}.`,
  }
}
