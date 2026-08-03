/**
 * Starting corpus for the simulation. Built by running the same pipeline used
 * at runtime, so seeded rows are indistinguishable from ones the user submits.
 */

import type { PipelineState } from './pipeline'
import { runPipeline } from './pipeline'

/** Sample complaints offered as one-click inputs in the composer. */
export const SAMPLE_COMPLAINTS = [
  'I was charged twice for my subscription this month and the refund never arrived.',
  'Your app is incredibly slow since the last update, every screen takes forever to load.',
  'Billing charged my card a second time for the same monthly plan. Where is my refund?',
  'I cannot log in anymore, the password reset email never shows up in my inbox.',
  'The parcel was supposed to arrive on Tuesday and tracking has not moved in four days.',
  'Support ticket opened five days ago and nobody has replied, this is unacceptable.',
]

const SEED_COMPLAINTS = [
  'I was charged twice for my premium subscription in March and no refund has been issued.',
  'The dashboard is extremely slow to load since the update, it freezes for ten seconds.',
  'Cannot log in to my account, the verification code email never arrives.',
  'My order was marked delivered but the package never arrived at my address.',
  'Getting billed for a subscription I cancelled last month, the charge went through again.',
]

/**
 * Threshold used for both the seed run and the initial UI state. Tuned against
 * the samples above for the hashed-bag-of-words stand-in in ./embedding: real
 * duplicates score 0.41-0.56 there, unrelated complaints stay under 0.26. Real
 * embeddings sit in a different range, so SIMILARITY_THRESHOLD in .env needs
 * its own empirical tuning.
 */
export const DEFAULT_THRESHOLD = 0.4

export async function buildSeedState(): Promise<PipelineState> {
  let state: PipelineState = { complaints: [], reports: [] }

  for (const text of SEED_COMPLAINTS) {
    const run = await runPipeline(text, state, {
      similarityThreshold: DEFAULT_THRESHOLD,
      stepDelayMs: 0,
    })
    state = run.state
  }

  return state
}
