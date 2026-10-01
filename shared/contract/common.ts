import { z } from 'zod'

/**
 * Pieces every endpoint contract shares. Each endpoint has its own file next to this one.
 *
 * The Zod schemas in this directory are the only source of truth: the TypeScript types are
 * inferred from them, both sides validate against them, and the JSON Schema the model is held
 * to is generated from them. There is no second copy to keep in sync.
 */

/** The body of every non-2xx response from the proxy. */
export const aiErrorResponseSchema = z.object({ error: z.string() })

export type AiErrorResponse = z.infer<typeof aiErrorResponseSchema>

/**
 * The value handed to OpenRouter as `response_format.json_schema`, generated from a response
 * schema. Zod emits `additionalProperties: false` and lists every property as required, which
 * is exactly what OpenRouter's strict mode requires — so the model is constrained by the same
 * schema the client validates against.
 */
export function toResponseFormat(name: string, schema: z.ZodType) {
  // The generated schema carries a $schema key that strict validators reject, so it is dropped.
  const { $schema: _jsonSchemaDialect, ...jsonSchema } = z.toJSONSchema(schema, { target: 'draft-07' })
  return { name, strict: true, schema: jsonSchema }
}

export type ResponseFormat = ReturnType<typeof toResponseFormat>

/** Flattens a Zod failure into the one-line message the UI shows. */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}
