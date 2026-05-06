import type { TestReport } from '../types/api'

export function parseTestReport(content: string): TestReport | null {
  if (!content.trim()) return null
  try {
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const candidate = parsed as TestReport
    if (
      'test_file' in candidate ||
      'test_files' in candidate ||
      'test_cases' in candidate ||
      'runner_validation' in candidate ||
      'generated_test_files' in candidate
    ) {
      return candidate
    }
  } catch {
    return null
  }
  return null
}
