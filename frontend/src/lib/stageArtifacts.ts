import type { Artifact } from '../types/api'

// .md is preferred where available — those are the polished, user-facing
// renderings. The .json files are the structured contracts the next agent
// in the pipeline consumes; they're shown as additional artifacts but never
// as the primary preview.
const PRIMARY_ARTIFACT_BY_STAGE: Record<string, string[]> = {
  requirement_analysis: ['requirement_spec.prd.md', 'requirement_spec.json'],
  solution_architecture: ['solution_design.md', 'solution_contract.json', 'repo_context_summary.json'],
  detailed_spec: ['detailed_spec.json'],
  code_generation: ['implementation_summary.md', 'code_diff.patch', 'generated_files_manifest.json'],
  test_generation: ['test_report.json'],
  code_review: ['review_report.md', 'review_report.json'],
  delivery: ['delivery_summary.md', 'final_diff.patch'],
  ui_canvas: ['ui_design.html', 'ui_design_react.html'],
}

export function primaryArtifactForStage(stageKey: string | undefined, artifacts: Artifact[]): Artifact | null {
  if (!stageKey || artifacts.length === 0) return null
  const order = PRIMARY_ARTIFACT_BY_STAGE[stageKey] || []
  for (const filename of order) {
    const found = artifacts.find(artifact => artifact.filename === filename)
    if (found) return found
  }
  return artifacts[0] ?? null
}

export function isMarkdownArtifact(filename: string) {
  return filename.endsWith('.md') || filename.endsWith('.markdown')
}

export function isJsonArtifact(filename: string) {
  return filename.endsWith('.json')
}

export function isPatchOrCodeArtifact(filename: string) {
  return filename.endsWith('.patch')
    || filename.endsWith('.diff')
    || filename.endsWith('.py')
    || filename.endsWith('.ts')
    || filename.endsWith('.tsx')
    || filename.endsWith('.js')
    || filename.endsWith('.jsx')
    || filename.endsWith('.css')
    || filename.endsWith('.html')
}
