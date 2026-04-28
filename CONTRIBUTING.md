# Contributing Guide

## 分工

| 负责人 | 文件 / 目录 |
|--------|------------|
| Tish（后端） | `devflow/` `tests/` `demo.py` `pyproject.toml` `requirements.txt` |
| Leander（前端） | `streamlit_app.py` |

**请严格遵守分工，不要跨区域修改。** GitHub 的 CODEOWNERS 会在 PR 里自动 enforce：改了后端文件的 PR 必须经过 Tish review 才能合并。

---

## 本地启动

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 API Key

# 3. 启动后端（终端 1）
uvicorn devflow.main:app --reload --reload-dir devflow

# 4. 启动前端（终端 2）
streamlit run streamlit_app.py
```

---

## 前端开发指引（Leander）

### 你只需要改这一个文件
```
streamlit_app.py
```

### 后端 API

后端跑在 `http://localhost:8000`。所有接口文档（含参数、响应格式、在线调试）见：

> **http://localhost:8000/docs**

### 常用接口速查

| 用途 | 方法 | 路径 |
|------|------|------|
| 创建 pipeline | POST | `/api/pipelines` |
| 启动运行 | POST | `/api/pipelines/{id}/runs` |
| 查询运行状态 | GET | `/api/runs/{run_id}` |
| 查询各阶段结果 | GET | `/api/runs/{run_id}/stages` |
| 查看产物列表 | GET | `/api/runs/{run_id}/artifacts` |
| 查看检查点 | GET | `/api/runs/{run_id}/checkpoints` |
| 通过检查点 | POST | `/api/checkpoints/{id}/approve` |
| 拒绝检查点 | POST | `/api/checkpoints/{id}/reject` |
| 终止运行 | POST | `/api/runs/{run_id}/terminate` |

### 运行状态说明

| status | 含义 |
|--------|------|
| `created` | 刚创建，还没开始 |
| `running` | 正在执行某个阶段 |
| `waiting_for_approval` | 在 Checkpoint 暂停，等待人工审核 |
| `paused` | 手动暂停 |
| `completed` | 全部完成 |
| `failed` | 出错终止 |
| `terminated` | 手动终止 |

### 注意事项

- **不要** 修改 `devflow/` 目录下的任何文件
- **不要** 修改 `requirements.txt`（如需加前端依赖，先和 Tish 商量）
- 产物文件（图片、patch、report）路径在 artifact 对象的 `file_path` 字段，直接读取本地文件即可

---

## 后端开发指引（Tish）

- 所有后端改动限定在 `devflow/` 目录
- 启动时加 `--reload-dir devflow`，避免 uvicorn 监听到 `artifacts/` 写入后自动重启（会杀掉正在跑的 pipeline）
- 测试：`pytest tests/`
