# 2026-05-06 Version Update

本文记录当前版本相对上一版 `origin/main` 的主要改动，覆盖后端流水线、Agent prompt、前端审核体验、交付与验证能力。

## 总览

本次更新把 DevFlow 从“固定阶段串行生成”推进到更接近 Claude Code / Codex 的工程闭环：

- 代码生成、测试生成、代码审查都可以使用仓库工具读取文件、搜索代码、运行测试和项目级验证命令。
- 测试失败和 review BLOCKER 会自动打回对应阶段，并携带结构化失败证据。
- 需求分析和方案设计都开始依赖 repomap，避免脱离真实代码库做分析。
- 前端加入更强的 diff、markdown、测试报告和交付状态查看能力。
- Delivery 阶段可以把最终 patch 应用回源仓库，并生成可回滚记录。

## Pipeline 与 Orchestrator

- 增加测试失败自动分流：collection/import/syntax 类失败打回 `test_generation`，可运行断言失败打回 `code_generation`。
- 增加结构化 `test_failure_context`，包含失败命令、测试文件、失败用例、runner 证据和生成测试源码片段。
- 增加 review BLOCKER 自动质量门禁：`review_report.json` 中存在 BLOCKER 时自动回到 Stage 3 修复。
- 增加人工测试失败 intervention checkpoint，允许用户选择跳过失败测试或带 guidance 重试。
- 增加 checkpoint 时切换 provider/model 的运行时能力。
- Delivery 通过前会检查测试结果，防止失败测试情况下应用 patch。

## Agent 与 Prompt

- `code_generation` 改为在隔离 workspace 中运行，可使用 `read_file`、`search_code`、`edit_file`、`write_file`、`run_command`、`run_test`。
- `test_generation` 增加 surgical repair 协议：retry 时必须先读现有测试、运行测试、只修失败测试，避免重写已通过用例。
- 纯前端变更不再强行生成 pytest，而是使用 TypeScript/build 验证作为前端门禁。
- `code_review` 改为结构化 JSON + Markdown 双产物，支持质量门禁消费。
- review/test prompt 从 checklist 改成自适应 thinking framework：
  - 首轮或宽范围变更做风险假设。
  - 小范围变更只列相关风险。
  - retry 重点验证上一轮问题是否解决，不重新凑风险数量。
- `requirement_analysis` 现在接入 compact repomap，Stage 1 会根据真实项目结构判断产品边界。
- `solution_architecture` 强化仓库探索协议，要求基于 `project_kinds`、入口文件和搜索结果定位方案。

## Repomap 与仓库上下文

- 新版 repomap 使用 symbol reference graph 和 personalised PageRank 排序文件。
- 输出包含 `project_kinds`、frontend/backend roots、相关文件、关键 symbols、API routes、data models、测试文件。
- compact repomap 增加语言配额，避免前端在后端引用关系更密时被挤出上下文。
- Detailed spec 也消费 compact repo context，使实现规格更贴近真实代码。

## 测试与验证工具

- 新增 `command_runner`，允许安全执行 `pytest`、`ruff`、`mypy`、`npm run build/typecheck/test` 等验证命令。
- 新增 `test_selector`，根据 diff 自动推荐相关测试。
- `test_runner` 增强实时输出和 pytest 计数解析。
- 新增 `test_progress` 服务，用于前端展示测试执行进度。
- 新增多组回归测试，覆盖 command runner、git/source apply、orchestrator quality gate、test progress、prompt 合同等。

## 交付与源仓库保护

- 新增 `source_apply`，Delivery 通过后可把最终 diff 应用到源仓库。
- 应用前会创建 `source_backup`，记录 `source_application.json`，便于回滚和审计。
- 新增 `repo_safety`，检测是否正在修改 DevFlow 自身仓库，需要前端二次确认。
- 新增 `git_integration` 基础能力，用于后续 git 分支、提交和 PR/MR 工作流。

## 前端体验

- Checkpoint 审核界面支持逐文件 diff 和完整文件快照。
- 新增 `DiffFileExplorer`，复用在 artifact viewer 和 checkpoint modal。
- 新增 `MarkdownReportView`，更易读地展示 PRD、方案、review、delivery markdown。
- 新增 `TestReportView` 增强版，展示测试用例、生成测试源码、pytest 输出和项目级验证命令。
- 新增 `TestProgressWindow`，展示测试运行中状态、日志和活跃测试文件。
- Console 支持 delivery/source apply 状态与回滚入口。
- Pipeline/Stage 展示改为使用每个 stage 的最新 attempt，避免旧失败状态干扰当前视图。
- Setup 页增加仓库路径检查和自修改确认弹窗。
- 移除了主页背景图片，改为纯深色底，避免背景图干扰可读性。

## 配置与模型

- OpenAI 默认模型从旧配置切换为 `gpt-5.4`。
- README LLM 配置表同步更新。
- `.env` 本地也需要保持 `OPENAI_DEFAULT_MODEL=gpt-5.4` 才会覆盖运行时默认。

## 已回滚/修正的实验改动

- `0bc7d8c3` run 曾新增 `usePathPicker.ts` 和 `Select Folder` 按钮，但该 hook 是实验生成的新文件，且曾导致 Vite parse error。
- 已撤回这部分路径选择器改动，保留原始手动输入仓库路径方式。
- 修正了主页左上角 `Hello` 被整屏 `SetupView` 覆盖的问题分析；该类问题后续应通过浏览器/截图验证闭环解决。

## 验证记录

当前版本已执行：

- `pytest -q`
- `npm run build`（frontend）

两者均通过。
