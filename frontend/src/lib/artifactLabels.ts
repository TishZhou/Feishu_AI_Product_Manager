export const ARTIFACT_LABEL: Record<string, string> = {
  'requirement_spec.prd.md':       '需求分析报告',
  'requirement_spec.json':         '需求结构化数据',
  'solution_design.md':            '技术架构方案',
  'solution_contract.json':        '架构执行契约',
  'repo_context_summary.json':     '仓库上下文摘要',
  'detailed_spec.json':            '详细规格文档',
  'code_diff.patch':               '代码变更补丁',
  'implementation_summary.md':     '实现说明摘要',
  'test_report.json':              '测试报告',
  'review_report.md':              '代码审查报告',
  'review_report.json':            '审查结构化数据',
  'delivery_summary.md':           '交付总结',
  'final_diff.patch':              '最终代码补丁',
  'generated_files_manifest.json': '生成文件清单',
  'clarification_needed.json':     '待澄清问题',
}

export function artifactLabel(filename: string): string {
  return ARTIFACT_LABEL[filename] ?? filename
}
