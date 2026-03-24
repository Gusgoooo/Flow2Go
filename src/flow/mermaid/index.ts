import { parseMermaidFlowchart } from './parser'
import { transpileMermaidFlowIR } from './transpiler.ts'
import { applyGraphBatchPayload, type ApplyMermaidContext } from './apply.ts'
import type { MermaidToGraphResult } from './types'

export async function applyMermaidFlowchart(
  input: string,
  ctx: ApplyMermaidContext
): Promise<MermaidToGraphResult> {
  const parsed = parseMermaidFlowchart(input)

  if (!parsed.success || !parsed.ir) {
    return {
      success: false,
      data: null,
      warnings: parsed.warnings,
      errors: parsed.errors,
    }
  }

  const transpiled = transpileMermaidFlowIR(parsed.ir, input, parsed.warnings)

  if (!transpiled.success || !transpiled.data) {
    return transpiled
  }

  await applyGraphBatchPayload(transpiled.data, ctx)

  return transpiled
}

export { parseMermaidFlowchart } from './parser'
export { transpileMermaidFlowIR } from './transpiler.ts'
export {
  applyGraphBatchPayload,
  applyGraphBatchPayloadToFlow2Go,
  materializeGraphBatchPayloadToSnapshot,
} from './apply.ts'
export type { ApplyMermaidContext, ApplyToFlow2GoContext } from './apply.ts'
export * from './types'