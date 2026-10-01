import { z } from 'zod'

import { toResponseFormat } from './common.ts'

/** Contract for `POST /api/propose-structure`: a blank-page outline from a short brief. */

export const structureRequestSchema = z.object({
  /** What the document is for, in the user's words. */
  brief: z.string().trim().min(1, 'Describe what you are writing first.').max(2000),
})

export const structureSectionSchema = z.object({
  level: z.number().int().min(1).max(3).describe('Heading level: 1 for the title, 2 for sections, 3 for subsections.'),
  heading: z.string().describe('The heading text, without any leading # characters.'),
  intent: z
    .string()
    .describe('One sentence on what this section should cover. Empty string for the title.'),
})

/** The outline the model must return. The client turns it into markdown and proposes it. */
export const structureResponseSchema = z.object({
  sections: z
    .array(structureSectionSchema)
    .min(1)
    .describe('The outline in document order, starting with one level-1 title.'),
})

export const STRUCTURE_RESPONSE_JSON_SCHEMA = toResponseFormat('document_structure', structureResponseSchema)

export type StructureRequest = z.infer<typeof structureRequestSchema>
export type StructureSection = z.infer<typeof structureSectionSchema>
export type StructureResponse = z.infer<typeof structureResponseSchema>

/** Renders an outline as markdown: headings, each followed by its intent as placeholder prose. */
export function structureToMarkdown(sections: readonly StructureSection[]): string {
  return sections
    .flatMap(({ level, heading, intent }) => {
      const lines = [`${'#'.repeat(level)} ${heading.replace(/^#+\s*/, '').trim()}`]
      if (intent.trim()) lines.push(intent.trim())
      return lines
    })
    .join('\n\n')
}
