export type DiagramSpec = {
  version: '1.0'
  name: string
  pipelines: string[]
}

const DEFAULT_SPEC: DiagramSpec = {
  version: '1.0',
  name: 'Flow2Go Diagram Spec',
  pipelines: ['auto', 'flowchart', 'mind-map', 'swimlane-text', 'swimlane-image'],
}

export function getDiagramSpec(): DiagramSpec {
  return DEFAULT_SPEC
}

export function validateDiagramSpec(spec: DiagramSpec) {
  const errors: string[] = []
  if (!spec || spec.version !== '1.0') errors.push('invalid version')
  if (!spec.name?.trim()) errors.push('missing name')
  if (!Array.isArray(spec.pipelines)) errors.push('pipelines must be array')
  return { ok: errors.length === 0, errors }
}

