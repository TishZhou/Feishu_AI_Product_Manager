"""
DevFlow Engine — Streamlit UI
Run:   streamlit run streamlit_app.py
需先启动后端：uvicorn devflow.main:app --reload --reload-dir devflow
"""

import json
import os
import time

import requests
import streamlit as st

from devflow.services.document_context import SUPPORTED_EXTENSIONS, extract_reference_documents

API = "http://localhost:8000"
REPO_PATH = os.path.abspath(os.path.dirname(__file__))

STAGES = [
    ("requirement_analysis", "📋 需求分析",   "理解需求背景、目标和验收标准"),
    ("solution_architecture","🏗️ 架构设计",   "分析代码库，设计技术方案"),
    ("detailed_spec",        "📝 详细规格",   "生成可直接执行的实现规格"),
    ("code_generation",      "💻 代码生成",   "按规格生成代码 diff"),
    ("test_generation",      "🧪 测试生成",   "编写并运行测试用例"),
    ("code_review",          "🔍 代码审查",   "从安全/性能/规范角度审查代码"),
    ("delivery",             "🚀 交付打包",   "生成最终 diff 和交付报告"),
]
STAGE_KEYS = [s[0] for s in STAGES]

CHECKPOINT_AFTER = {"detailed_spec": 1, "code_review": 2}
CP_ARTIFACTS = {
    1: [
        "requirement_spec.prd.md",
        "solution_design.md",
        "solution_contract.json",
        "detailed_spec.json",
        "repo_context_summary.json",
        "requirement_spec.json",
    ],
    2: ["code_diff.patch", "generated_files_manifest.json", "implementation_summary.md", "test_report.json", "review_report.md"],
}
CP_LABEL = {
    1: "方案审核 — 确认 AI 理解的需求和技术方案是否正确",
    2: "代码审核 — 确认生成的代码、测试和 review 结果",
}

STAGE_STATUS_ICON = {
    "pending":   ("⬜", "gray"),
    "running":   ("🔄", "blue"),
    "waiting_for_clarification": ("❓", "orange"),
    "succeeded": ("✅", "green"),
    "failed":    ("❌", "red"),
    "rejected":  ("↩️", "orange"),
    "skipped":   ("⏭️", "gray"),
}


# ── API helper ────────────────────────────────────────────────────────────────

def api(method: str, path: str, silent: bool = False, **kwargs):
    try:
        r = requests.request(method, f"{API}{path}", timeout=15, **kwargs)
        r.raise_for_status()
        return r.json()
    except requests.ConnectionError:
        if not silent:
            st.error("❌ 无法连接到后端服务，请确认已运行：`uvicorn devflow.main:app --reload --reload-dir devflow`")
        return None
    except requests.HTTPError as e:
        if not silent:
            st.error(f"API 错误 {e.response.status_code}：{e.response.text}")
        return None


# ── Artifact renderer ─────────────────────────────────────────────────────────

def render_artifact(filename: str, file_path: str):
    try:
        content = open(file_path, encoding="utf-8").read()
    except Exception:
        st.caption("（文件尚未生成）")
        return
    if filename.endswith(".json"):
        try:
            st.json(json.loads(content), expanded=2)
        except Exception:
            st.code(content)
    elif filename.endswith(".md"):
        st.markdown(content)
    elif filename.endswith(".patch"):
        st.code(content, language="diff")
    else:
        st.text(content)


def render_agent_contracts():
    agents = api("GET", "/api/agents", silent=True)
    if not agents:
        st.caption("后端未连接，暂无法加载契约")
        return

    for stage in agents.get("stages", []):
        st.markdown(f"**{stage['index']}. {stage['agent']}**")
        inputs = stage.get("required_inputs") or []
        if inputs:
            st.caption("Inputs")
            for item in inputs:
                st.code(f"{item['stage_key']}/{item['filename']}", language=None)
        else:
            st.caption("Inputs: none")

        st.caption("Outputs")
        for filename in stage.get("output_artifacts", []):
            st.code(filename, language=None)


# ── Page: Home ────────────────────────────────────────────────────────────────

def page_home():
    st.markdown("## 描述你的需求，AI 来完成剩下的一切")
    st.markdown(
        "输入一句话或一段描述，系统会自动走完 **需求分析 → 架构设计 → 写代码 → 跑测试 → 代码审查 → 交付** 的完整流程，"
        "并在关键节点暂停让你确认。"
    )
    st.divider()

    requirement = st.text_area(
        "需求描述",
        placeholder=(
            "例如：\n"
            "给这个项目的 /api/runs 接口加一个分页功能，"
            "支持 page 和 page_size 参数，默认每页 20 条，按创建时间倒序排列。"
        ),
        height=150,
        label_visibility="collapsed",
    )

    uploaded_docs = st.file_uploader(
        "参考文档（可选，支持 PDF / DOCX / DOC / TXT / MD）",
        type=[ext.lstrip(".") for ext in sorted(SUPPORTED_EXTENSIONS)],
        accept_multiple_files=True,
        help="上传 PRD、会议纪要、调研材料或相关说明，需求分析 Agent 会把这些内容作为参考上下文。",
    )

    col1, col2 = st.columns([2, 3])
    with col1:
        provider = st.selectbox(
            "AI 模型",
            ["openai", "volcano"],
            format_func=lambda x: "OpenAI (GPT-4o)" if x == "openai" else "火山引擎 (Seed-v1.6)",
        )
    with col2:
        model = st.text_input(
            "自定义模型名（可选，留空用默认）",
            placeholder="gpt-4o-mini  /  seed-v1.6",
        )

    st.write("")
    if st.button("▶ 开始运行", type="primary", use_container_width=True, disabled=not requirement.strip()):
        with st.status("正在创建任务...", expanded=True) as s:
            reference_context = ""
            reference_sources = ""
            if uploaded_docs:
                st.write("解析参考文档...")
                try:
                    reference_context, reference_sources = extract_reference_documents(
                        [(doc.name, doc.getvalue()) for doc in uploaded_docs]
                    )
                    st.write(f"✅ 已解析 {len(uploaded_docs)} 个参考文档")
                except Exception as e:
                    st.error(f"参考文档解析失败：{e}")
                    return

            st.write("创建 Pipeline...")
            pipeline = api("POST", "/api/pipelines", json={
                "name": requirement.strip()[:60],
                "description": requirement.strip(),
                "task_type": "feature",
                "repo_path": REPO_PATH,
                "reference_context": reference_context,
                "reference_sources": reference_sources,
                "provider": provider,
                "model": model.strip(),
            })
            if not pipeline:
                return
            st.write(f"✅ pipeline_id: `{pipeline['id']}`")

            st.write("启动 Run...")
            run = api("POST", f"/api/pipelines/{pipeline['id']}/runs")
            if not run:
                return
            st.write(f"✅ run_id: `{run['id']}`")
            s.update(label="任务已启动！", state="complete")

        st.session_state.pipeline_id = pipeline["id"]
        st.session_state.run_id = run["id"]
        st.session_state.page = "running"
        time.sleep(0.8)
        st.rerun()


# ── Page: Running ─────────────────────────────────────────────────────────────

def page_running():
    run_id = st.session_state.run_id
    run = api("GET", f"/api/runs/{run_id}")
    if not run:
        return

    status = run["status"]
    current_stage = run.get("current_stage", "")

    # ── Status banner ────────────────────────────────────────────────────────
    STATUS_MSG = {
        "created":              ("🟡", "正在初始化 AI 引擎..."),
        "running":              ("🔵", "AI 正在工作中..."),
        "waiting_for_approval": ("🟠", "等待你的审核"),
        "waiting_for_clarification": ("🟠", "需求需要你补充澄清"),
        "paused":               ("🟠", "已暂停"),
        "failed":               ("🔴", "运行失败"),
        "completed":            ("🟢", "全部完成！"),
        "terminated":           ("⚫", "已终止"),
    }
    icon, msg = STATUS_MSG.get(status, ("⚪", status))
    st.markdown(f"## {icon} {msg}")
    st.caption(f"run_id: `{run_id}`")
    st.divider()

    # ── Stage list ───────────────────────────────────────────────────────────
    stages_data = api("GET", f"/api/runs/{run_id}/stages", silent=True) or []

    # Build: stage_key → {status, attempt}
    stage_map: dict[str, dict] = {}
    for sr in stages_data:
        k = sr["stage_key"]
        if k not in stage_map or sr["attempt"] > stage_map[k]["attempt"]:
            stage_map[k] = {"status": sr["status"], "attempt": sr["attempt"]}

    # Count successes for progress bar
    done = sum(1 for k, *_ in STAGES if stage_map.get(k, {}).get("status") == "succeeded")
    st.progress(done / len(STAGES), text=f"{done} / {len(STAGES)} 阶段完成")
    st.write("")

    # Fetch all artifacts once, grouped by stage_key
    all_artifacts = api("GET", f"/api/runs/{run_id}/artifacts", silent=True) or []
    artifacts_by_stage: dict[str, list] = {}
    for art in all_artifacts:
        artifacts_by_stage.setdefault(art["stage_key"], []).append(art)

    for key, label, desc in STAGES:
        info = stage_map.get(key, {})
        s = info.get("status", "pending")
        attempt = info.get("attempt", 0)
        icon_s, _ = STAGE_STATUS_ICON.get(s, ("⬜", "gray"))

        is_active = (key == current_stage and status == "running")
        label_md = f"**{label}**" if is_active else label
        active_suffix = " &nbsp;← *正在执行...*" if is_active else ""
        retry_badge = f" &nbsp;<sub>第 {attempt} 次</sub>" if attempt > 1 else ""

        st.markdown(
            f"{icon_s} {label_md}{active_suffix}{retry_badge}  \n"
            f"<span style='color:gray;font-size:12px;margin-left:28px'>{desc}</span>",
            unsafe_allow_html=True,
        )

        # Show artifacts inline when stage succeeded
        if s == "succeeded":
            for art in artifacts_by_stage.get(key, []):
                fname = art["filename"]
                short = fname.replace("_", " ").replace(".json","").replace(".md","").replace(".patch","").strip()
                with st.expander(f"　　📄 {short}  —  `{fname}`", expanded=False):
                    render_artifact(fname, art["file_path"])

        # Checkpoint notice
        if key in CHECKPOINT_AFTER and status == "waiting_for_approval":
            cp_num = CHECKPOINT_AFTER[key]
            st.markdown(
                f"<div style='margin-left:28px;padding:6px 12px;background:#fff3cd;"
                f"border-left:3px solid #ffc107;border-radius:4px;font-size:13px'>"
                f"⏸️ <b>Checkpoint {cp_num}</b> — 请向下滚动审核</div>",
                unsafe_allow_html=True,
            )

    st.divider()

    # ── Terminal states ──────────────────────────────────────────────────────
    if status == "failed":
        st.error(f"运行失败：{run.get('error_message') or '未知错误'}")
        if st.button("🔄 返回重新开始"):
            st.session_state.page = "home"
            st.rerun()
        return

    if status == "completed":
        st.session_state.page = "done"
        st.rerun()
        return

    if status == "terminated":
        st.warning("运行已终止")
        if st.button("← 返回首页"):
            st.session_state.page = "home"
            st.rerun()
        return

    # ── Checkpoint UI (inline) ────────────────────────────────────────────────
    if status == "waiting_for_approval":
        checkpoints = api("GET", f"/api/runs/{run_id}/checkpoints", silent=True) or []
        waiting_cp = next((c for c in checkpoints if c["status"] == "waiting"), None)
        if waiting_cp:
            _render_checkpoint(run_id, waiting_cp)
        return

    if status == "waiting_for_clarification":
        _render_clarification(run_id)
        return

    # ── Pause / Stop controls ────────────────────────────────────────────────
    col_pause, col_stop, _ = st.columns([1, 1, 3])
    with col_pause:
        if status == "running":
            if st.button("⏸ 暂停", use_container_width=True):
                api("POST", f"/api/runs/{run_id}/pause")
                st.rerun()
        elif status == "paused":
            if st.button("▶ 继续", use_container_width=True):
                api("POST", f"/api/runs/{run_id}/resume")
                st.rerun()
    with col_stop:
        if st.button("⏹ 终止", use_container_width=True):
            api("POST", f"/api/runs/{run_id}/terminate")
            st.rerun()

    # ── Auto-refresh countdown ────────────────────────────────────────────────
    if status in ("running", "created", "paused"):
        placeholder = st.empty()
        for i in range(5, 0, -1):
            placeholder.caption(f"🔄 {i} 秒后自动刷新...")
            time.sleep(1)
        placeholder.empty()
        st.rerun()


# ── Checkpoint panel ──────────────────────────────────────────────────────────

def _render_clarification(run_id: str):
    st.markdown("### ❓ 需求澄清")
    st.info("Stage 1 发现部分需求会影响后续架构或验收判断。请补充说明，系统会重新执行需求分析。")

    artifacts = api("GET", f"/api/runs/{run_id}/artifacts", silent=True) or []
    artifact_map = {a["filename"]: a["file_path"] for a in artifacts}
    payload = {}
    path = artifact_map.get("requirement_clarification.json")
    if path:
        try:
            payload = json.loads(open(path, encoding="utf-8").read())
        except Exception:
            payload = {}

    if payload.get("summary"):
        st.markdown("**当前理解：**")
        st.write(payload["summary"])

    questions = payload.get("open_questions") or []
    missing = payload.get("missing_critical_info") or []
    ambiguities = payload.get("ambiguities") or []

    if questions:
        st.markdown("**待确认问题**")
        for item in questions:
            st.markdown(f"- {item}")
    if missing:
        st.markdown("**缺失的关键信息**")
        for item in missing:
            st.markdown(f"- {item}")
    if ambiguities:
        st.markdown("**当前歧义**")
        for item in ambiguities:
            st.markdown(f"- {item}")

    answer = st.text_area(
        "你的补充说明",
        placeholder="逐条回答上面的问题。也可以补充范围、优先级、边界条件、验收标准等信息。",
        height=180,
        key="clarification_answers",
    )
    if st.button("提交澄清并重新分析", type="primary", use_container_width=True):
        if not answer.strip():
            st.warning("请先填写补充说明")
            return
        res = api("POST", f"/api/runs/{run_id}/clarifications", json={
            "answered_by": "user",
            "answers": answer.strip(),
        })
        if res:
            st.success("已提交澄清，正在重新分析需求...")
            time.sleep(1)
            st.rerun()


def _safe_widget_key(text: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in text)


def _render_code_change_review(run_id: str):
    st.markdown("### 💻 文件级代码审查")
    payload = api("GET", f"/api/runs/{run_id}/code-review-files", silent=True) or {}
    files = payload.get("files") or []

    review_state_key = f"code_file_review_state_{run_id}"
    can_approve_key = f"code_file_review_can_approve_{run_id}"
    reject_summary_key = f"code_file_review_reject_summary_{run_id}"

    st.session_state[can_approve_key] = False
    st.session_state[reject_summary_key] = ""

    if not files:
        st.warning("还没有可审查的代码文件。请确认 code_generation 阶段已经生成 `code_diff.patch`。")
        st.session_state[review_state_key] = {}
        return

    patch_ok = payload.get("patch_applied_to_workspace") is True
    if patch_ok:
        st.success("Patch 已成功应用到隔离 execution workspace，可以进入人工代码审查。")
    else:
        error = payload.get("workspace_apply_error") or "Patch 未成功应用到隔离 execution workspace。"
        st.error(f"Patch 应用失败，不能通过本次代码审核：\n\n{error}")

    total_additions = sum(int(f.get("additions") or 0) for f in files)
    total_deletions = sum(int(f.get("deletions") or 0) for f in files)
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("文件数", len(files))
    c2.metric("新增行", total_additions)
    c3.metric("删除行", total_deletions)
    c4.metric("执行模式", payload.get("mode", "artifact_only"))

    decisions = {}
    for file_info in files:
        path = file_info.get("path", "")
        action = file_info.get("action", "modify")
        additions = file_info.get("additions", 0)
        deletions = file_info.get("deletions", 0)
        key_base = _safe_widget_key(f"{run_id}_{path}")

        with st.expander(
            f"{action.upper()}  `{path}`  (+{additions} / -{deletions})",
            expanded=not patch_ok,
        ):
            diff_tab, file_tab = st.tabs(["Diff", "生成后的文件"])
            with diff_tab:
                st.code(file_info.get("diff", ""), language="diff")
            with file_tab:
                if file_info.get("generated_exists"):
                    st.code(file_info.get("generated_content", ""), language=path.rsplit(".", 1)[-1] if "." in path else None)
                    st.caption(f"artifact: `{file_info.get('generated_file', '')}`")
                else:
                    st.warning("没有找到生成后的完整文件快照。")

            decision = st.radio(
                "审查结论",
                ["pending", "approved", "rejected"],
                format_func={
                    "pending": "未决定",
                    "approved": "Approve",
                    "rejected": "Reject",
                }.get,
                horizontal=True,
                key=f"file_decision_{key_base}",
            )
            note = st.text_area(
                "文件级备注",
                placeholder="指出需要修改的函数、接口、测试或风格问题。Reject 时建议写清楚。",
                key=f"file_note_{key_base}",
                height=80,
            )
            decisions[path] = {
                "path": path,
                "action": action,
                "decision": decision,
                "note": note.strip(),
                "additions": additions,
                "deletions": deletions,
            }

    approved_count = sum(1 for d in decisions.values() if d["decision"] == "approved")
    rejected = [d for d in decisions.values() if d["decision"] == "rejected"]
    pending = [d for d in decisions.values() if d["decision"] == "pending"]

    st.session_state[review_state_key] = decisions
    st.session_state[can_approve_key] = patch_ok and not rejected and not pending and len(decisions) == len(files)

    reject_lines = []
    if not patch_ok:
        reject_lines.append(f"Patch 应用失败：{payload.get('workspace_apply_error') or 'unknown error'}")
    for item in rejected:
        suffix = f"：{item['note']}" if item["note"] else ""
        reject_lines.append(f"- {item['path']} 被拒绝{suffix}")
    st.session_state[reject_summary_key] = "\n".join(reject_lines)

    st.caption(f"审查进度：{approved_count} approved / {len(rejected)} rejected / {len(pending)} pending")


def _render_checkpoint(run_id: str, cp: dict):
    cp_num = cp["checkpoint_number"]

    st.markdown(f"### ⏸️ Checkpoint {cp_num} — 需要你来决定")
    st.info(CP_LABEL[cp_num])

    artifacts = api("GET", f"/api/runs/{run_id}/artifacts", silent=True) or []
    artifact_map = {a["filename"]: a["file_path"] for a in artifacts}

    if cp_num == 2:
        _render_code_change_review(run_id)
        st.divider()
        st.markdown("### 阶段产物")

    tab_names = CP_ARTIFACTS[cp_num]
    tabs = st.tabs(tab_names)
    for tab, filename in zip(tabs, tab_names):
        with tab:
            if filename in artifact_map:
                render_artifact(filename, artifact_map[filename])
            else:
                st.caption("（文件尚未生成）")

    st.divider()
    st.markdown("**你的决定：**")

    col_approve, col_reject = st.columns(2)

    with col_approve:
        st.markdown("##### ✅ 通过")
        note = st.text_input("备注（可选）", key="cp_note")
        approve_disabled = False
        if cp_num == 2:
            approve_disabled = not st.session_state.get(f"code_file_review_can_approve_{run_id}", False)
            if approve_disabled:
                st.caption("代码审核需要所有文件都 Approve，且 patch 成功应用到 execution workspace。")
        if st.button("✅ 通过，继续执行", type="primary", use_container_width=True, key="btn_approve", disabled=approve_disabled):
            res = api("POST", f"/api/checkpoints/{cp['id']}/approve",
                      json={"decided_by": "reviewer", "reason": note})
            if res:
                st.success("已通过！继续执行...")
                time.sleep(1)
                st.rerun()

    with col_reject:
        st.markdown("##### ❌ 拒绝并重新生成")
        reason = st.text_input("拒绝原因 *", key="cp_reason")

        # Retry stage options depend on which checkpoint
        if cp_num == 1:
            retry_choices = {
                "从头重新分析需求": "requirement_analysis",
                "重新做架构设计": "solution_architecture",
                "只重新写详细规格": "detailed_spec",
            }
        else:
            retry_choices = {
                "重新生成代码": "code_generation",
                "只重新跑测试": "test_generation",
                "只重新做 Review": "code_review",
            }

        retry_label = st.selectbox("从哪步重新开始", list(retry_choices.keys()), key="cp_retry")

        if st.button("❌ 拒绝，重新生成", use_container_width=True, key="btn_reject"):
            generated_reason = st.session_state.get(f"code_file_review_reject_summary_{run_id}", "") if cp_num == 2 else ""
            final_reason = reason.strip() or generated_reason
            if not final_reason.strip():
                st.warning("请填写拒绝原因")
            else:
                res = api("POST", f"/api/checkpoints/{cp['id']}/reject", json={
                    "decided_by": "reviewer",
                    "reason": final_reason,
                    "retry_stage_key": retry_choices[retry_label],
                })
                if res:
                    st.warning(f"已拒绝，从「{retry_label}」重新开始...")
                    time.sleep(1)
                    st.rerun()


# ── Page: Done ────────────────────────────────────────────────────────────────

def page_done():
    run_id = st.session_state.run_id
    st.balloons()
    st.markdown("## 🎉 全部完成！")
    st.success("所有阶段执行完毕，代码已就绪。")

    artifacts = api("GET", f"/api/runs/{run_id}/artifacts") or []
    artifact_map = {a["filename"]: a for a in artifacts}

    # Delivery summary at the top
    if "delivery_summary.md" in artifact_map:
        with st.container(border=True):
            st.markdown("### 📋 交付报告")
            try:
                content = open(artifact_map["delivery_summary.md"]["file_path"], encoding="utf-8").read()
                st.markdown(content)
            except Exception:
                pass

    st.divider()
    st.markdown("### 📁 查看所有产物")

    file_order = [
        ("requirement_spec.prd.md",  "📋 PRD 需求文档"),
        ("requirement_spec.json",    "📋 需求规格 JSON"),
        ("repo_context_summary.json","🧭 Repo 上下文"),
        ("solution_design.md",       "🏗️ 架构设计"),
        ("solution_contract.json",   "🧾 方案 Contract"),
        ("detailed_spec.json",       "📝 详细规格"),
        ("code_diff.patch",          "💻 代码变更"),
        ("generated_files_manifest.json", "📦 生成文件清单"),
        ("implementation_summary.md","📄 实现说明"),
        ("test_report.json",         "🧪 测试报告"),
        ("review_report.md",         "🔍 Review 报告"),
        ("final_diff.patch",         "🚀 最终 Diff"),
    ]
    for filename, display_name in file_order:
        if filename not in artifact_map:
            continue
        art = artifact_map[filename]
        size = art["size_bytes"]
        with st.expander(f"{display_name}   `{filename}`   ({size:,} bytes)"):
            render_artifact(filename, art["file_path"])

    st.divider()
    if st.button("🔄 开始新任务", type="primary", use_container_width=True):
        for k in ("pipeline_id", "run_id"):
            st.session_state.pop(k, None)
        st.session_state.page = "home"
        st.rerun()


# ── App shell ─────────────────────────────────────────────────────────────────

def main():
    st.set_page_config(page_title="DevFlow Engine", page_icon="⚙️", layout="wide")

    if "page" not in st.session_state:
        st.session_state.page = "home"

    with st.sidebar:
        st.markdown("# ⚙️ DevFlow Engine")
        st.caption("AI 驱动的全流程开发助手")
        st.divider()

        with st.expander("Agent I/O Contracts", expanded=False):
            render_agent_contracts()

        st.divider()

        if st.session_state.page != "home":
            if st.button("← 返回首页", use_container_width=True):
                st.session_state.page = "home"
                st.rerun()
            if "run_id" in st.session_state:
                st.markdown("**当前任务**")
                st.code(st.session_state.run_id[:18] + "...", language=None)
            st.divider()

        st.markdown("**流程说明**")
        for _, label, desc in STAGES:
            st.markdown(f"**{label}**  \n<span style='font-size:11px;color:gray'>{desc}</span>", unsafe_allow_html=True)
            st.write("")

        st.divider()
        st.caption("后端地址：`http://localhost:8000`")

    page = st.session_state.page
    if page == "home":
        page_home()
    elif page == "running":
        page_running()
    elif page == "done":
        page_done()


if __name__ == "__main__":
    main()
