# DevFlow Engine

> 输入一句需求，AI 自动走完从产品文档到代码交付的完整流程；在两个关键节点由人工把关。

**ByteDance Competition** — Tish, Leander

---

## 目录

1. [项目概览](#1-项目概览)
2. [核心部分代码展示](#2-核心部分代码展示)
3. [项目亮点介绍](#3-项目亮点介绍)
4. [AI 亮点介绍](#4-ai-亮点介绍)
5. [快速开始](#5-快速开始)
6. [LLM 配置 / 产物清单 / API 接口 / 项目结构](#6-参考)

---

## 1. 项目概览

### 一句话

DevFlow 是一个 **多 Agent 流水线编排引擎**：把"PM 写 PRD → 架构师设计 → 开发实现 → QA 写测试 → Code Review → 交付上线"这条原本以周为单位的研发链路，在 5–15 分钟内由 AI 端到端跑完，**只在两个产品决策点（方案审核 / 实现审核）插入强制人工 checkpoint**。

### 工作流

```
你输入一句需求
    │
    ▼
[Stage 1]  📋 需求分析        → requirement_spec.prd.md + requirement_spec.json
    ▼
[Stage 2A] 🏗️  方案设计        → repo_context_summary.json + solution_design.md + solution_contract.json
    ▼
[Stage 2B] 📝 详细规格         → detailed_spec.json
    │
⏸️  Checkpoint 1 — 审核方案（可切换 provider/model 再继续）
    │
    ▼
[Stage 3]  💻 代码生成        → code_diff.patch + generated_files/ + implementation_summary.md
    ▼
[Stage 4]  🧪 测试生成        → test_report.json
    ▼
[Stage 5]  🔍 代码审查        → review_report.json + review_report.md
    │
⏸️  Checkpoint 2 — 审核代码（可切换 provider/model）
    │
    ▼
[Stage 6]  🚀 交付集成        → delivery_summary.md + final_diff.patch
    │
⏸️  Checkpoint 3 — 交付前确认 → apply_to_source（写入源仓库 + 生成回滚快照）
    │
    ▼
🌿 Git 集成弹窗（可选）
        建分支 + commit + push 到 origin + 创建 PR/MR（独立勾选）
```

每次 run 的所有产物保存在 `artifacts/{run_id}/`。代码生成默认只写入 artifacts，**直到 Checkpoint 3 才落到源仓库**，且自动备份用于回滚。

### 我们做了什么（最近一次大版本的改动梗概）

- **流程兜底**：每个 stage 加「重试此阶段」按钮；review BLOCKER 持续不消失会触发人工介入 checkpoint（skip / 带指引重生 / 切 model）；任何 stage 在重试中硬失败也会升级到介入而不是直接 FAILED
- **Git 集成**：delivery 完成后自动弹出 modal，独立勾选「建分支 / push / 开 PR」，自动识别 delivery 写入工作树的 patch（不会被误判为 dirty 而禁用按钮）
- **AI 工程化加固**：node_modules 在 codegen / execution / test workspace 间软链共享，避免重复 `npm install`；`npx --no-install tsc/eslint/prettier/vitest` 加入 allowlist；prompt 显式告诉 LLM "npm install 是平台限制不是 BUG"
- **可视化**：Pipeline graph 显示每个 stage 的实时状态 + 第几次 attempt；patch 用 GitHub 风格 +/- 行级 diff 渲染；测试报告 / 需求文档 / 审查报告 全部走 markdown 一致渲染
- **运行时控制**：在任意 checkpoint 中可切换 provider / model，下一个 stage 立即生效，不重启 run

---

## 2. 核心部分代码展示

下面 6 段是构成 DevFlow 的关键骨架，每段都可独立复制到文档。

### 2.1 Stage 注册表 — 整条流水线的「契约」

```python
# devflow/core/pipeline_definition.py

@dataclass
class StageDefinition:
    key: str
    index: int
    agent_class_path: str           # "devflow.agents.requirement_analysis.RequirementAnalysisAgent"
    output_artifacts: list[str]     # 该 stage 必须产出的文件名（强契约）
    reads_from_stages: list[str]    # 依赖哪些上游 stage 的产物
    checkpoint_after: int | None    # 完成后是否阻塞等待人工
    checkpoint_default_retry: str = ""  # 被 reject 时默认从哪个 stage 重跑

STAGE_REGISTRY: list[StageDefinition] = [
    StageDefinition(
        key="requirement_analysis", index=1,
        agent_class_path="devflow.agents.requirement_analysis.RequirementAnalysisAgent",
        output_artifacts=["requirement_spec.prd.md", "requirement_spec.json"],
        reads_from_stages=[], checkpoint_after=None,
    ),
    # ... solution_architecture, detailed_spec, code_generation, test_generation,
    StageDefinition(
        key="code_review", index=6,
        agent_class_path="devflow.agents.code_review.CodeReviewAgent",
        output_artifacts=["review_report.json", "review_report.md"],
        reads_from_stages=["solution_architecture", "detailed_spec",
                           "code_generation", "test_generation"],
        checkpoint_after=2,
        checkpoint_default_retry="code_generation",
    ),
    StageDefinition(
        key="delivery", index=7,
        agent_class_path="devflow.agents.delivery.DeliveryAgent",
        output_artifacts=["delivery_summary.md", "final_diff.patch"],
        reads_from_stages=["code_generation", "test_generation", "code_review"],
        checkpoint_after=3,
        checkpoint_default_retry="code_review",
    ),
]
```

Agent 类启动时会做 **契约校验**：`output_artifacts` 必须和 stage 注册的一致，`required_inputs` 必须是 `reads_from_stages` 的子集，否则直接 raise — 让"我以为我产出了 X，但 stage 表里写的是 Y"这种 bug 在加载阶段就死掉。

### 2.2 Agent 基类 + Per-stage 模型覆盖

```python
# devflow/agents/base.py

class BaseAgent(ABC):
    required_inputs: ClassVar[list[tuple[str, str]]] = []   # [(stage_key, filename), ...]
    output_artifacts: ClassVar[list[str]] = []

    async def run(self, ctx: AgentContext) -> AgentResult:
        # 1. 输入门禁：上游产物缺失就提前失败，不浪费 LLM 调用
        missing = self._missing_required_inputs(ctx)
        if missing:
            return self._fail(ctx, f"Missing required input artifact(s): {missing}")

        # 2. 工具盘 + 隔离 dispatcher：每个工具的 cwd 锁在该 stage 的 workspace
        dispatcher = ToolDispatcher()
        repo = ctx.repo_path
        dispatcher.register("read_file", lambda p: read_file(p, repo))
        dispatcher.register("edit_file", lambda p, o, n: edit_file(p, o, n, repo))
        dispatcher.register("run_test",  lambda p: run_test(p, repo))
        # ...

        # 3. 调 LLM。provider/model 优先取 per-stage override，否则继承 pipeline 配置
        provider = self.provider_override(ctx) or ctx.pipeline.provider
        model    = self.model_override(ctx)    or ctx.pipeline.model or None

        raw = await ctx.provider_router.chat(
            system=self.build_system_prompt(ctx),
            user=self.build_user_prompt(ctx),
            tools=self.get_tools(),
            tool_dispatcher=dispatcher,
            json_mode=self.json_mode(),
            max_tokens=self._resolved_max_tokens(),
            max_tool_rounds=self.max_tool_rounds(),
            provider=provider, model=model,
            cache_key=f"devflow:{ctx.stage_key}",   # OpenAI prompt cache 路由
            run_id=ctx.run_id, stage_key=ctx.stage_key,
        )

        # 4. JSON 模式失败时自动 repair 一轮
        result = self.parse_response(raw, ctx)
        if result.success or not self._should_repair_json_result(result):
            return result
        repaired = await ctx.provider_router.chat(
            system="You repair malformed JSON outputs. Return one valid JSON object only.",
            user=f"Parse error:\n{result.error}\n\nMalformed:\n{raw}",
            json_mode=True,
            cache_key=f"devflow:{ctx.stage_key}:json-repair",
            ...
        )
        return self.parse_response(repaired, ctx)

    # 子类可覆盖
    def provider_override(self, ctx) -> str | None: return None
    def model_override(self, ctx)    -> str | None: return None
    def max_tokens(self) -> int | None: return None
    def max_tool_rounds(self) -> int:   return 25
```

### 2.3 主编排循环 — 7 stages + 自动重试 + 人工介入

```python
# devflow/core/orchestrator.py（简化）

async def _run_pipeline_inner(self, run_id, resume_from_stage=None):
    pipeline = ...  # snapshot to detached object
    artifact_store = ArtifactStore(run_id)
    await self._set_run_status(run_id, RunState.RUNNING)

    start_key = resume_from_stage or await self._get_resume_stage(run_id)
    stage_list = stages_from(start_key)

    i = 0
    while i < len(stage_list):
        stage_def = stage_list[i]

        # 暂停 / 终止 / 进度更新
        await self._wait_if_paused(run_id)
        if await self._is_terminated(run_id): return
        await self._update_run_stage(run_id, stage_def.key)

        # 加载上游产物 + 创建 StageResult 行
        prior = self._load_prior(artifact_store, stage_def.reads_from_stages)
        attempt = await self._get_next_attempt(run_id, stage_def.key)

        # 跑 agent
        ctx = AgentContext(run_id, pipeline, stage_def.key, attempt, prior, ...)
        result = await stage_def.get_agent_class()(stage_def).run(ctx)

        # ── 失败兜底：在重试循环里就升级到人工介入，不直接杀 run ──
        if not result.success:
            if self._should_escalate_failure_to_intervention(pipeline, stage_def.key):
                decision, guidance, retry_stage = await self._await_review_intervention(
                    run_id, attempt,
                    f"{stage_def.key} 在自动重试中失败：{result.error}",
                    {}, pipeline,
                )
                if decision == "approved":   # 用户选放弃
                    await self._set_run_status(run_id, RunState.FAILED, error=...)
                    return
                # 用户给指引重试
                pipeline.review_blocker_context += f"\nHuman guidance:\n{guidance}"
                pipeline.extra_review_attempts += _HUMAN_REVIEW_RETRY_BUDGET
                await self._reject_stages_from(run_id, retry_stage)
                stage_list = stages_from(retry_stage); i = 0; continue
            # 没在重试循环里 → 老老实实 FAILED
            await self._set_run_status(run_id, RunState.FAILED, error=result.error)
            return

        # 落盘 artifacts
        for filename, content in result.artifacts.items():
            artifact_store.save(filename, content)
            await self._register_artifact(run_id, stage_def.key, filename, ...)

        # ── Stage 4 后自动质量门禁：测试失败 → 自动重试 → 用完预算转人工 ──
        if stage_def.key == "test_generation":
            test_report = self._load_optional_artifact(artifact_store, "test_report.json")
            if not self._tests_passed(test_report):
                if attempt < _MAX_TEST_REPAIR_ATTEMPTS + pipeline.extra_test_attempts:
                    pipeline.test_failure_context = self._build_test_failure_context(test_report)
                    retry_key = self._choose_test_retry_stage(test_report)
                    await self._reject_stages_from(run_id, retry_key)
                    stage_list = stages_from(retry_key); i = 0; continue
                # 预算耗尽 → 弹 test_failure_intervention checkpoint
                decision, guidance, retry_stage = await self._await_test_intervention(...)
                # 用户决定 skip / guide retry，类似上面的 review_intervention 流程
                ...

        # ── Stage 5 后审查门禁：BLOCKER → 自动重 code_gen → 用完转人工 ──
        if stage_def.key == "code_review":
            review = self._load_optional_artifact(artifact_store, "review_report.json")
            if self._has_review_blockers(review):
                # 同样的「auto retry → human intervention」模式
                ...

        # ── Checkpoint：完成后阻塞等待人工 ──
        if stage_def.checkpoint_after is not None:
            cp_id, _ = await self._create_checkpoint(run_id, stage_def.checkpoint_after, stage_def)
            await self._set_run_status(run_id, RunState.WAITING_FOR_APPROVAL)
            cp_event = self._get_cp_event(run_id, stage_def.checkpoint_after)
            await cp_event.wait()
            decision = self._cp_decisions[run_id][stage_def.checkpoint_after]

            # 应用人工在 modal 里设置的 provider/model 切换
            if override := self._pop_provider_override(run_id):
                pipeline.provider = override["provider"] or pipeline.provider
                pipeline.model    = override["model"]    or pipeline.model

            if decision == "rejected":
                retry_stage = await self._get_cp_retry_stage(cp_id, stage_def.checkpoint_default_retry)
                await self._reject_stages_from(run_id, retry_stage)
                stage_list = stages_from(retry_stage); i = 0; continue
            elif stage_def.key == "delivery":
                await self._apply_to_source_delivery(run_id, artifact_store, pipeline)

        i += 1

    await self._set_run_status(run_id, RunState.COMPLETED)
```

### 2.4 RepoMap — 把仓库压缩成 LLM 可读的索引

```python
# devflow/services/repo_map.py（伪代码 + 核心字段）

def build_repo_context_summary(repo_path: str, requirement_spec: dict) -> dict:
    """
    遍历仓库，按文件类型抽取符号 / 路由 / 模型 / 测试，
    和需求做 keyword 相关性打分，输出结构化 map。
    """
    walker = walk(repo_path, ignore={".git", "node_modules", "dist", "__pycache__", ...})
    files = []
    for path in walker:
        kind = detect_kind(path)         # python / ts / vue / config / docs
        symbols = extract_symbols(path)  # def/class for py，export/function for ts/tsx
        relevance = score_against_requirement(path, symbols, requirement_spec)
        files.append({
            "path": path, "kind": kind, "symbols": symbols, "relevance": relevance,
            "byte_size": ..., "loc": ...,
        })

    return {
        "project_kinds": ["python", "react"],
        "files": sorted(files, key=lambda f: -f["relevance"])[:300],
        "routes": extract_routes(repo_path),       # FastAPI router decorators
        "models": extract_models(repo_path),       # SQLAlchemy / Pydantic / TS interfaces
        "test_files": find_test_files(repo_path),
        "package_managers": detect_package_managers(repo_path),
    }


def compact_repo_context_for_prompt(
    summary, max_files=30, max_symbols=60, max_routes=30,
    max_models=30, max_test_files=15, max_chars=8000,
) -> str:
    """
    分阶段压缩：
      1. 按相关性 cut top-N 文件 / 路由 / 模型
      2. 每文件最多保留 max_symbols 个符号
      3. 整体字符数仍超限 → 二次截断 + ellipsis
    """
    sections = [
        render_files_section(summary["files"][:max_files], max_symbols),
        render_routes_section(summary["routes"][:max_routes]),
        render_models_section(summary["models"][:max_models]),
        render_tests_section(summary["test_files"][:max_test_files]),
    ]
    text = "\n\n".join(sections)
    return text if len(text) <= max_chars else text[:max_chars] + "\n…(truncated)"
```

完整的 `repo_context_summary.json` 落盘留作 audit；prompt 里只塞压缩版（约 6–8K chars，节省 80%+ token）。

### 2.5 Git 集成 — Patch-aware 推送 + 独立勾选

```python
# devflow/services/git_integration.py

def inspect_repo(repo_path: str, patch_text: str = "") -> dict:
    """前端打开 git modal 时的 precheck。
    关键：区分『dirty 但都是我们自己 delivery 写进去的』vs『dirty 且有用户其它本地改动』
    """
    info = {"is_git": False, "safe_to_publish": False, ...}
    # ... git rev-parse / status / remote get-url / which gh / which glab

    if not is_clean(porcelain_output):
        dirty_paths = _porcelain_paths(porcelain_output)
        patch_paths = set(_changed_paths_from_patch(patch_text)) if patch_text else set()
        if patch_paths and dirty_paths.issubset(patch_paths):
            info["dirty_matches_patch"] = True
            info["safe_to_publish"] = True   # ← 我们自己写的，可推
        else:
            info["dirty_unrelated"] = True   # ← 用户在跑期间改了别的，先 commit/stash
    return info


def publish_run_changes(repo_path, patch_text, run_id, title,
                        body="", branch_prefix="devflow",
                        do_push=True, do_pr=True):
    """新建分支 → commit → 可选 push → 可选 gh/glab 创建 draft PR/MR"""
    # 1. 同样的 patch_already_applied 检测
    expected = set(_changed_paths_from_patch(patch_text))
    dirty    = _porcelain_paths(git_status_porcelain(repo))
    patch_already_applied = bool(expected) and bool(dirty) and dirty.issubset(expected)

    # 2. 新分支带着 dirty 走（git checkout -b 不会丢工作树改动）
    git(repo, ["checkout", "-b", branch])

    # 3. 已经在工作树就跳过 git apply，直接 stage + commit
    if patch_already_applied:
        steps.append("skip git apply — working tree already matches patch")
    else:
        git_apply(repo, patch_text)

    git(repo, ["add", "--all", "--", *expected])
    git(repo, ["commit", "-m", commit_message(title, run_id)])

    if not do_push: return result
    git(repo, ["push", "-u", "origin", branch])

    if not do_pr: return result
    if "github" in remote and shutil.which("gh"):
        gh(["pr", "create", "--draft", "--head", branch, "--title", title, "--body", body])
    elif "gitlab" in remote and shutil.which("glab"):
        glab(["mr", "create", "--draft", "--source-branch", branch, ...])
    return result
```

前端 modal 给三个独立勾选（不再是嵌套的"本地/push/PR"三档），勾掉某项就跳过对应步骤。提交按钮文案动态拼出 `新建分支 · commit · 推送 · 创建 PR` 这样的实际操作链。

### 2.6 Provider Router — 一个 ProviderRouter 同时支持 OpenAI 和 Volcano

```python
# devflow/providers/router.py（核心 chat 方法 + tool loop）

class ProviderRouter:
    async def chat(self, system, user, tools=None, model=None, provider=None,
                   tool_dispatcher=None, json_mode=False, max_tokens=None,
                   max_tool_rounds=25, cache_key=None, run_id=None, stage_key=""):
        """带 tool-use 循环的统一 chat 入口。openai 和 volcano 都用 OpenAI Python SDK，
        差别只在 base_url 和模型名。"""
        provider = provider or settings.DEFAULT_PROVIDER
        client   = self.get_client(provider)
        resolved_model = self.resolve_model(provider, model)

        messages = [{"role": "system", "content": system},
                    {"role": "user",   "content": user}]
        kwargs = {"model": resolved_model, "messages": messages}

        if tools:    kwargs |= {"tools": tools, "tool_choice": "auto"}
        if json_mode and provider != "volcano":
            kwargs["response_format"] = {"type": "json_object"}
        if max_tokens:
            kwargs[_max_tokens_param(provider, resolved_model)] = max_tokens
        if provider == "openai" and cache_key:
            kwargs["prompt_cache_key"] = cache_key   # OpenAI 自动 prompt caching

        for round_idx in range(max_tool_rounds):
            resp = await client.chat.completions.create(**kwargs)
            msg = resp.choices[0].message
            self._record_token_usage(run_id, stage_key, resp.usage)
            self._stream_log(run_id, stage_key, ...)

            if not msg.tool_calls:
                return msg.content   # 出口 1：模型答完了

            # 执行工具，结果以 tool message 回灌
            messages.append({"role": "assistant", "tool_calls": msg.tool_calls, ...})
            for call in msg.tool_calls:
                args = json.loads(call.function.arguments)
                output = await tool_dispatcher.invoke(call.function.name, **args)
                messages.append({"role": "tool", "tool_call_id": call.id,
                                 "content": json.dumps(output, ensure_ascii=False)})
            kwargs["messages"] = messages

        # 出口 2：tool 轮数耗尽，强制结束
        return last_assistant_text or ""


def _max_tokens_param(provider, model):
    """gpt-5.x / o-系列 reasoning 模型用 max_completion_tokens，其它用 max_tokens"""
    n = (model or "").lower()
    if provider == "openai" and (n.startswith("gpt-5") or n.startswith("o")):
        return "max_completion_tokens"
    return "max_tokens"
```

---

## 3. 项目亮点介绍

### 3.1 RepoMap：让 LLM 真的"懂"你的仓库

为什么要做：LLM 写代码最大的失败模式是**虚构 API**——猜你有 `User.find_by_email`，但你这工程里实际是 `get_user_by_email`。直接把所有源码塞进 prompt 又会瞬间爆 context。

我们的方案是 **"两层压缩 + 相关性排序" 的 repo map**：

| 层 | 内容 | 体量 |
|---|---|---|
| 全量 `repo_context_summary.json` | 全部文件 + 符号 + 路由 + 模型 + 测试 | 30–80 KB（落盘 audit 用） |
| Compact prompt 版 | top-N 相关文件 + 关键符号 + 路由 + 模型 | 6–8 KB（喂进 prompt） |

排序的 relevance 信号包括：路径词与需求 keyword 的覆盖率、符号名匹配、是否是 router/model 这类"高价值文件"、是否是测试文件等。完整 JSON 永远落盘，方便审计；prompt 上下文每个 stage 重新 compact 一次，避免冗余。

效果：**架构设计 stage 几乎不会要求改不存在的文件**，`solution_contract.files_to_modify` 命中率显著高于"裸喂代码"。

### 3.2 为什么选 Pipeline 而不是 Single Loop

Codex / Claude Code 这类工具是 **single-agent loop**：一个 session 里模型自己决定调哪个工具、什么时候停。我们做的是 **固定 7-stage pipeline**。两种取向的 tradeoff：

| 维度 | DevFlow Pipeline | Codex / Claude Code Loop |
|---|---|---|
| **人工审核点** | ✅ 强制 3 个 checkpoint | ❌ 全自动，无产品审核 |
| **可调试性** | ✅ 每个 stage 独立 retry，能换 model | ❌ 整体重跑 |
| **失败定位** | ✅ stage 级日志 / artifact / token 账 | 整段 trace |
| **上下文连续性** | ❌ stage 间断裂（需要重注入） | ✅ 同一 session 累积 |
| **token 成本** | ❌ 重复注入 spec/contract | ✅ 单次累积 |

**关键决策：人工 checkpoint 是这个产品的核心价值**——PM 必须能在"AI 设计完方案、还没开始写代码"的时机干预；技术负责人必须能在"代码已生成、还没合并到主仓库"的时机干预。所以我们刻意接受了上下文断裂带来的 token 浪费，换来流程上的可审、可回退、可换 model。

不是不做优化——目前在 Stage 3-5（编码三连）内部已经做了 **递归打回**：测试失败自动回 code_gen 或 test_gen，review BLOCKER 自动回 code_gen。这部分相当于"局部 single loop"，外层仍是 pipeline。

### 3.3 Workspace 隔离 — 三种 workspace 各司其职

```
源仓库  /Users/.../Feishu_AI_Product_Manager
   │
   ├── git worktree（hardlink，~10× 比 copytree 快）
   │   ↓
   ├──► artifacts/{run}/codegen_workspace_1_<hash>/    ← Stage 3 改这里
   │       └── frontend/node_modules → 源仓库 node_modules（symlink）
   │
   ├──► artifacts/{run}/execution_workspace_<hash>/    ← Stage 4-5 在这里跑测试
   │       └── frontend/node_modules → 源仓库 node_modules（symlink）
   │       └── 已 git apply patch
   │
   └──► 源仓库本身                                       ← Stage 6+Checkpoint 3 才写入这里
            └── apply_to_source 写入 + 备份到 artifacts/{run}/source_backup/
```

**关键设计**：
- `git worktree add --detach` 比 `shutil.copytree` 快 5–10x（hardlink 而非物理 copy）
- `node_modules` symlink 共享：避免每个 workspace 各自 `npm install`（200MB+ × N），同时让 `npx --no-install tsc` 直接可用
- 直到最后 checkpoint 用户点确认才动源仓库；备份保留，可一键回滚
- `data/` `dist/` `node_modules/` 等只在**根目录**忽略，**不是任意层级**——避免 `frontend/src/data/personas.ts` 这类源码被误吞（这是个真实踩过的坑）

### 3.4 Patch-as-Source-of-Truth：所有改动都走 unified diff

我们不让 LLM 自己手写 patch（容易格式坏），而是：
1. Agent 在 workspace 里用 `edit_file` / `write_file` 真实修改
2. 系统遍历 workspace 和源仓库做 diff，**自动生成 unified diff** 落到 `code_diff.patch`
3. 后续 `apply_to_source` / `git_publish` 都基于这个 patch
4. 前端用自实现的 `PatchDiffView` 解析 hunk，按文件分组展示绿/红行

这意味着**任何 stage 的产出都是结构化、可 diff、可回滚、可重放**的，不依赖工作树残留状态。

### 3.5 失败兜底体系 — 多层防御

| 失败类型 | 防御层 1 | 防御层 2 | 防御层 3 |
|---|---|---|---|
| LLM 输出不是合法 JSON | json_mode（OpenAI 强制） | `_should_repair_json_result` 自动 repair 一轮 | 最终失败 → stage failed |
| 测试不过 | 自动重试 ≤ 2 次（智能选回 code_gen 还是 test_gen） | `test_failure_intervention` checkpoint：skip / 带指引 / 切 model | 用户取消 |
| Code review BLOCKER | 自动重 code_gen ≤ 2 次（带 blocker_context） | `review_blocker_intervention` checkpoint | 用户取消 |
| Stage 在重试中硬失败（无产出） | 升级到 review intervention（不直接 FAILED） | 用户给指引 + 换 model 重跑 | 放弃 run |
| 整个 run 失败 | DetailView 「重试此阶段」按钮，可选起点 stage | 沿用前序产物，只重跑你选的部分 | 重新建 run |

任何一个 stage 都不会让 run "默默死掉"——要么自动恢复，要么把决策抛给人。

### 3.6 完整可观测性

- **SSE 事件流** `/api/runs/{run_id}/logs/stream`：实时推送 stage 状态变化、工具调用、token usage
- **每次 LLM 调用都计 token**：按 stage 聚合，前端 OverviewView 实时显示总消耗
- **Pipeline graph 显示 attempt 数**：retry 触发后实时显示「↻ 第 3 / 3 次尝试」，知道 AI 卡在哪
- **Patch / 测试报告 / 审查报告全部 light theme 渲染**：审核体验一致

---

## 4. AI 亮点介绍

### 4.1 高阶 AI 工程技巧

| 技巧 | 在哪用 / 解决什么问题 |
|---|---|
| **Tool-use 多轮 agentic loop** | 所有需要"读源码、改文件、跑测试"的 stage（3-5）都在 ProviderRouter 的 `chat()` 里跑 ≤25-30 轮工具循环，模型自己决定调用顺序 |
| **JSON mode + 自动 repair** | json_mode 强制结构化输出；如果还是坏 JSON，第二次调用专门做 repair，prompt 是"修复 JSON，别改语义" |
| **OpenAI Prompt Caching key** | 每个 stage 调 LLM 时带稳定的 `prompt_cache_key`，让 OpenAI 服务端把 system prompt + spec 这部分缓存起来，命中后只收 10% 价格 |
| **Per-stage 模型 / provider 覆盖** | `model_override(ctx)` / `provider_override(ctx)` hook：例如 detailed_spec 因为输出体量大需要长 completion，可单独锁 GPT-4o（16K completion） |
| **结构化质量门禁** | code_review 输出包含 `blocker_count` 字段，orchestrator 自动判断是否要打回；这是"用模型输出去驱动控制流"的典型 |
| **Surgical test repair protocol** | 测试失败重试时，prompt 强制 agent 走 `read_file → run_test → edit_file 只改失败的`，禁用 `write_file` 整体替换——避免"修一个 bug 推翻所有通过的测试" |
| **环境上下文显式化** | code_gen / code_review prompt 里写明"node_modules 已 symlink，禁止 npm install，要 typecheck 用 npx --no-install tsc" — 让 LLM 不会因为环境差异瞎试命令 |
| **Patch-aware 工作树识别** | git_integration 不光会推代码，会智能识别"工作树脏 == delivery 已写"vs"脏 == 用户还有别的改动"，避免误判 |

### 4.2 人和 AI 的分工

DevFlow 的核心理念是 **AI 跑流水线，人管决策点**：

| 流程节点 | AI 做什么 | 人做什么 |
|---|---|---|
| 需求分析 | 拆解、识别 open_questions、评估 confidence | 0–1 次 clarification 答疑（confidence 不够时） |
| 方案设计 | repo map、技术选型、files_to_modify 规划 | **Checkpoint 1**：审核方案是否合理，可换 model 重跑 |
| 实现/测试/审查 | 写代码、跑测试、自我审查、自动重试 | 仅在出问题时介入（intervention checkpoint） |
| 实现审核 | — | **Checkpoint 2**：审核 diff、test_report、review_report，可拒绝重跑 |
| 交付 | 生成 final_diff、汇总变更说明 | **Checkpoint 3**：确认是否写入源仓库 |
| Git 推送 | 建分支、commit、push、创建 PR | 勾选要不要做这几件事 |

人的注意力被**只投在决策上**，不在"跑测试 / 写 boilerplate / 找 bug"这些机械环节。AI 全权负责机械，但**所有有方向性的决策都要人确认**。

### 4.3 模型选型思路

我们不假设一个模型万能，而是**让每个 stage 可以独立选模型**：

| Stage | 默认模型 | 选型理由 |
|---|---|---|
| requirement_analysis | GPT-4o | 中文叙事 + 结构化 JSON 双输出，需要平衡的指令理解 |
| solution_architecture | GPT-4o | tool-use 调 read_file 探仓库，需要稳定的 function calling |
| **detailed_spec** | **GPT-4o-mini（16K completion）** | 输出最大（每个文件每个函数列签名），按 token-per-dollar 选小模型 + 大 completion 限额 |
| code_generation | GPT-4o | 写真实代码 + 调工具迭代，需要强的 reasoning |
| test_generation | GPT-4o | 同上 |
| code_review | GPT-4o | 代码审查需要全局视角 |
| delivery | GPT-4o | 总结性输出 |

**运行时切换**：在任意 checkpoint 的 modal 里都能切 provider/model（OpenAI 的 4o / 4o-mini / 5.4-mini，或 Volcano 自定义模型）。下一个 stage 立即生效。这意味着用户可以**先用便宜模型探流程**，发现某 stage 总出问题时再升级到强模型重跑。

### 4.4 引入 AI 后对原有工作流的改变

#### 之前（传统流程）
```
PM 写 PRD（1-2 天）
  → 评审会拉齐（半天）
  → 工程师认领并实现（3-5 天）
  → QA 写测试 / 跑回归（1-2 天）
  → Code Review（半天）
  → 合并 / 上线（半天）

周期：1-2 周；人工切换成本高；代码变更和 PRD 字面联系靠人记忆维护
```

#### 用 DevFlow 之后
```
PM 输入一段需求（1 分钟）
  → AI 跑 Stage 1-2 出方案（约 2 分钟）
  → ⏸️ Checkpoint 1：PM/架构师审方案，决定要不要切 model 重跑（5 分钟）
  → AI 跑 Stage 3-5 出代码 + 测试 + 审查（约 5-10 分钟）
  → ⏸️ Checkpoint 2：技术负责人审 diff，决定接受/驳回/带指引重跑（5 分钟）
  → AI 跑 Stage 6 出最终 patch（< 1 分钟）
  → ⏸️ Checkpoint 3：确认是否写入源仓库
  → 🌿 Git 集成弹窗：勾选 push / 开 PR

周期：15-25 分钟；人工只投决策时间；所有产出（PRD、方案、代码、测试、审查、commit、PR）有完整 traceability
```

#### 更深层的改变

1. **Spec 不再是文档，是机器可执行的 contract**：`requirement_spec.json` → `solution_contract.json` → `detailed_spec.json` 一路往下，**结构化字段强契约校验**，下游 agent 缺哪个字段就直接 fail。PRD 不再可能"写完没人看"——它是流水线的真实输入。
2. **Code Review 升级为质量门禁**：`review_report.json.blocker_count` 大于 0 自动打回 code_gen 重写。Review 不再是"提个 PR comment 等回复"，而是控制流的一部分。
3. **回滚成为一等公民**：每次 delivery 写入源仓库前都建 `source_backup/` 快照；UI 上一个按钮就能复原。配合 git 推送的"草稿 PR"模式，整个流水线**可以可逆地试错**。
4. **Token 成本变得可观测**：每个 stage 单独计 token，前端实时显示。这是工程化的基础——你能看清每个决策的成本。

---

## 5. 快速开始

### 推荐：React 控制台

```bash
# 终端 1：后端
pip install -r requirements.txt
cp .env.example .env                     # 填 OPENAI_API_KEY
uvicorn devflow.main:app --reload --reload-dir devflow

# 终端 2：前端
cd frontend && npm install && npm run dev
```

打开 http://localhost:5000 即可使用。
> Swagger API 文档：http://localhost:8000/docs

### 备选：Streamlit 前端

```bash
streamlit run streamlit_app.py        # http://localhost:8501
```

### CLI Demo

```bash
python demo.py
python demo.py --provider volcano --requirement "Add a health-check endpoint GET /healthz"
```

---

## 6. 参考

### LLM 配置

| Provider | 环境变量 | 默认模型 | 说明 |
|----------|---------|---------|------|
| `openai` | `OPENAI_API_KEY` | `gpt-4o` | 主推；支持 4o / 4o-mini / 5.4-mini 三档前端切换 |
| `volcano` | `VOLCANO_API_KEY` | `seed-v1.6` | 火山引擎，key 格式 `key_id:secret_key` |

`.env` 设 `DEFAULT_PROVIDER=volcano` 全局切换；创建 pipeline 或 checkpoint approve 时也可单独指定。

### 产物清单

| 文件 | 来自阶段 | 内容 |
|------|---------|------|
| `requirement_spec.prd.md` | Stage 1 | PRD 需求文档（人读） |
| `requirement_spec.json` | Stage 1 | 结构化需求数据（机器消费） |
| `repo_context_summary.json` | Stage 2A | 仓库地图（全量） |
| `solution_design.md` | Stage 2A | 技术方案（人读） |
| `solution_contract.json` | Stage 2A | 方案 contract（机器消费） |
| `detailed_spec.json` | Stage 2B | 可执行实现规格 |
| `code_diff.patch` | Stage 3 | unified diff |
| `generated_files_manifest.json` | Stage 3 | 生成文件清单 |
| `implementation_summary.md` | Stage 3 | 实现说明 |
| `test_report.json` | Stage 4 | 测试执行报告 |
| `review_report.json` / `.md` | Stage 5 | 结构化 / 中文双产物 |
| `delivery_summary.md` | Stage 6 | 交付总结 |
| `final_diff.patch` | Stage 6 | 最终 diff（直接 `git apply`） |
| `source_backup/` | Stage 6 + CP3 | 源仓库回滚快照 |
| `git_publication.json` | Git 推送 | push / PR 结果存档 |

### 主要 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/pipelines` | 创建 pipeline |
| POST | `/api/pipelines/{id}/runs` | 启动运行 |
| GET | `/api/runs/{run_id}` | 查询运行状态 |
| GET | `/api/runs/{run_id}/stages` | 查询各阶段 / attempt |
| GET | `/api/runs/{run_id}/artifacts` | 列出所有产物 |
| GET | `/api/runs/{run_id}/logs/stream` | SSE 阶段事件流 |
| POST | `/api/runs/{run_id}/pause` / `resume` / `terminate` | 运行控制 |
| POST | `/api/runs/{run_id}/retry` | **从指定 stage 重跑（带前序产物）** |
| POST | `/api/checkpoints/{id}/approve` | 通过（可携带 `next_provider`/`next_model`） |
| POST | `/api/checkpoints/{id}/reject` | 拒绝并指定重跑起点 |
| GET | `/api/runs/{run_id}/source-application` | 查应用 / 回滚状态 |
| POST | `/api/runs/{run_id}/rollback` | 回滚源仓库 |
| GET | `/api/runs/{run_id}/git-status` | **Git 模态 precheck**（含 patch-aware safe 判定） |
| POST | `/api/runs/{run_id}/git-publish` | **建分支/push/PR**（独立 toggle） |

### 项目结构

```
devflow/
├── main.py                       # FastAPI 入口
├── config.py
├── db/                           # SQLAlchemy async + SQLite
├── api/                          # FastAPI 路由
│   ├── pipelines.py / runs.py / checkpoints.py / meta.py
│   ├── reference_documents.py
│   └── ui_canvas.py              # UI Canvas 子系统
├── core/
│   ├── pipeline_definition.py    # 7 stage 注册表
│   ├── orchestrator.py           # 主循环 + checkpoint + 介入 + 质量门禁
│   ├── state_machine.py
│   └── background.py
├── agents/                       # 7 个 Agent + prompts
│   ├── base.py                   # provider/model override hook
│   ├── requirement_analysis.py
│   ├── solution_architecture.py
│   ├── detailed_spec.py
│   ├── code_generation.py        # 30 轮 tool loop
│   ├── test_generation.py        # surgical repair
│   ├── code_review.py            # JSON + MD 双产物
│   └── delivery.py
├── artifacts/                    # store + patch_materializer
├── providers/router.py           # 统一 chat + tool loop + token 计量
├── services/
│   ├── repo_map.py               # 仓库地图
│   ├── source_apply.py           # 写入源仓库 + 备份
│   ├── git_integration.py        # 推送 / PR / patch-aware precheck
│   ├── token_usage.py
│   └── test_progress.py
└── tools/
    ├── repo_tools.py             # list_dir / read_file / search_code / write/edit
    ├── patch_tools.py
    ├── command_runner.py         # 安全 allowlist：pytest / npm / npx / ruff / mypy
    ├── test_runner.py
    ├── test_selector.py
    └── workspace.py              # git worktree + node_modules symlink

artifacts/         运行时产物（gitignored）
data/devflow.db    SQLite（gitignored）
frontend/          React/Vite 控制台
```

---

**License**: MIT  ·  **Status**: Active competition entry  ·  **Authors**: Tish, Leander
