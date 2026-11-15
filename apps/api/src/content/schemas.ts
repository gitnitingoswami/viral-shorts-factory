import { z } from 'zod';

/** Structured output contracts for each LLM task (docs/AI_ARCHITECTURE.md §4). Constraints are enforced here. */

export const IDEA_FORMATS = ['quick-tip', 'how-to', 'myth-vs-fact', 'comparison', 'quick-fix', 'explainer'] as const;

export const IdeasSchema = z.object({
  ideas: z
    .array(
      z.object({
        title: z.string().min(5).max(90),
        audience: z.string().min(3).max(120),
        angle: z.string().min(5).max(200),
        hook: z.string().min(5).max(140),
        valueProposition: z.string().min(5).max(200),
        format: z.enum(IDEA_FORMATS),
        targetDurationSec: z.number().int().min(20).max(60),
        /** Must be URLs from the supplied sources; anything else is dropped. */
        sourceUrls: z.array(z.string()).max(5),
      }),
    )
    .length(5),
});
export type IdeasOutput = z.infer<typeof IdeasSchema>;

export const CODE_LANGUAGES = ['javascript', 'typescript', 'shell', 'sql', 'other'] as const;
export const TRANSITIONS = ['cut', 'fade', 'slide', 'zoom'] as const;

export const SceneSchema = z.object({
  durationSec: z.number().int().min(1).max(30),
  narration: z.string().min(1).max(400),
  onScreenText: z.string().max(80),
  visualConcept: z.string().min(3).max(300),
  code: z
    .object({
      language: z.enum(CODE_LANGUAGES),
      source: z.string().min(1).max(1200),
      highlightLines: z.array(z.number().int().min(1).max(12)).max(12),
    })
    .nullable(),
  transition: z.enum(TRANSITIONS),
  assetBrief: z.string().min(3).max(300),
});

export const ScriptSchema = z.object({
  title: z.string().min(5).max(100),
  scenes: z.array(SceneSchema).min(2).max(10),
});
export type ScriptOutput = z.infer<typeof ScriptSchema>;

export const FactCheckSchema = z.object({
  claims: z
    .array(
      z.object({
        sceneIndex: z.number().int().min(0),
        text: z.string().min(3).max(300),
        verdict: z.enum(['supported', 'unsupported', 'contradicted']),
        /** Exact quote from a supplied source; null when unsupported. */
        evidence: z.string().max(400).nullable(),
        sourceUrl: z.string().nullable(),
      }),
    )
    .max(30),
});
export type FactCheckOutput = z.infer<typeof FactCheckSchema>;

const score = z.number().int().min(1).max(5);
export const QualitySchema = z.object({
  scores: z.object({
    originality: score,
    repetition: score,
    clarity: score,
    pacing: score,
    accessibility: score,
    platform: score,
    policyRisk: score,
  }),
  issues: z.array(z.string().min(3).max(300)).max(15),
});
export type QualityOutput = z.infer<typeof QualitySchema>;

/** Speaking rate used to estimate narration length. */
export const WORDS_PER_SECOND = 2.5;
export const MIN_DURATION_SEC = 20;
export const MAX_DURATION_SEC = 60;
export const MAX_CODE_LINES = 12;
