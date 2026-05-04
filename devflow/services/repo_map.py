from __future__ import annotations

import ast
import json
import re
from pathlib import Path
from typing import Any

MAX_FILES = 300
MAX_RELEVANT_FILES = 20


def build_repo_context_summary(repo_path: str, requirement_spec: Any) -> dict[str, Any]:
    root = Path(repo_path)
    query = _requirement_query(requirement_spec)
    files = []
    key_symbols = []
    api_routes = []
    data_models = []
    test_files = []

    for path in _iter_source_files(root):
        rel = str(path.relative_to(root))
        text = _safe_read(path)
        score = _score_relevance(rel, text, query)
        file_info = {
            "path": rel,
            "size_bytes": path.stat().st_size,
            "language": _language_for(path),
            "relevance_score": score,
        }
        files.append(file_info)

        if rel.startswith("tests/") or "/tests/" in rel or path.name.startswith("test_"):
            test_files.append(rel)

        if path.suffix == ".py":
            py_info = _python_symbols(rel, text)
            key_symbols.extend(py_info["symbols"])
            api_routes.extend(py_info["api_routes"])
            data_models.extend(py_info["data_models"])

    files = sorted(files, key=lambda item: (-item["relevance_score"], item["path"]))
    relevant_files = [item["path"] for item in files[:MAX_RELEVANT_FILES] if item["relevance_score"] > 0]

    return {
        "repo_root": str(root.resolve()),
        "file_count": len(files),
        "files": files[:MAX_FILES],
        "relevant_files": relevant_files,
        "key_symbols": key_symbols[:500],
        "api_routes": api_routes[:200],
        "data_models": data_models[:200],
        "test_files": sorted(test_files)[:200],
        "query_terms": query,
    }


def repo_context_to_json(context: dict[str, Any]) -> str:
    return json.dumps(context, ensure_ascii=False, indent=2)


def _iter_source_files(root: Path):
    skip_dirs = {
        ".git",
        ".venv",
        "venv",
        "__pycache__",
        ".pytest_cache",
        "artifacts",
        "data",
        "uploads",
        "node_modules",
        "dist",
        "build",
        ".vite",
        "coverage",
    }
    suffixes = {".py", ".js", ".ts", ".tsx", ".jsx", ".json", ".toml", ".yaml", ".yml", ".md"}
    count = 0
    for path in root.rglob("*"):
        if count >= MAX_FILES:
            break
        if any(part in skip_dirs for part in path.parts):
            continue
        if path.is_file() and path.suffix.lower() in suffixes:
            count += 1
            yield path


def _safe_read(path: Path, max_chars: int = 80_000) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")[:max_chars]
    except OSError:
        return ""


def _requirement_query(requirement_spec: Any) -> list[str]:
    if isinstance(requirement_spec, str):
        try:
            requirement_spec = json.loads(requirement_spec)
        except json.JSONDecodeError:
            return _tokens(requirement_spec)
    if not isinstance(requirement_spec, dict):
        return []
    parts = [
        requirement_spec.get("title", ""),
        requirement_spec.get("summary", ""),
        requirement_spec.get("problem_statement", ""),
        " ".join(map(str, requirement_spec.get("functional_requirements", []))),
        " ".join(map(str, requirement_spec.get("acceptance_criteria", []))),
    ]
    return _tokens(" ".join(parts))


def _tokens(text: str) -> list[str]:
    words = re.findall(r"[A-Za-z_][A-Za-z0-9_]{2,}|[\u4e00-\u9fff]{2,}", text)
    stop = {"the", "and", "for", "with", "this", "that", "需求", "功能", "用户", "系统"}
    seen = []
    for word in words:
        lowered = word.lower()
        if lowered not in stop and lowered not in seen:
            seen.append(lowered)
    return seen[:40]


def _score_relevance(path: str, text: str, query: list[str]) -> int:
    haystack = f"{path}\n{text[:20_000]}".lower()
    return sum(haystack.count(term.lower()) for term in query)


def _language_for(path: Path) -> str:
    return {
        ".py": "python",
        ".js": "javascript",
        ".jsx": "javascript",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".json": "json",
        ".md": "markdown",
    }.get(path.suffix.lower(), path.suffix.lower().lstrip("."))


def _python_symbols(rel_path: str, text: str) -> dict[str, list[dict[str, Any]]]:
    symbols = []
    api_routes = []
    data_models = []
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return {"symbols": symbols, "api_routes": api_routes, "data_models": data_models}

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            symbols.append({
                "file": rel_path,
                "type": "function",
                "name": node.name,
                "line": node.lineno,
                "signature": _function_signature(node),
            })
            route = _route_from_decorators(node.decorator_list)
            if route:
                api_routes.append({"file": rel_path, "function": node.name, "line": node.lineno, **route})
        elif isinstance(node, ast.ClassDef):
            bases = [_name_for(base) for base in node.bases]
            symbols.append({"file": rel_path, "type": "class", "name": node.name, "line": node.lineno, "bases": bases})
            if any(base in {"Base", "BaseModel"} or base.endswith("Base") for base in bases):
                data_models.append({"file": rel_path, "name": node.name, "line": node.lineno, "bases": bases})
    return {"symbols": symbols, "api_routes": api_routes, "data_models": data_models}


def _function_signature(node: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
    args = [arg.arg for arg in node.args.args]
    prefix = "async " if isinstance(node, ast.AsyncFunctionDef) else ""
    return f"{prefix}{node.name}({', '.join(args)})"


def _route_from_decorators(decorators: list[ast.expr]) -> dict[str, str] | None:
    for dec in decorators:
        call = dec if isinstance(dec, ast.Call) else None
        func = call.func if call else dec
        method = ""
        if isinstance(func, ast.Attribute):
            method = func.attr.upper()
        if method not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
            continue
        route_path = ""
        if call and call.args and isinstance(call.args[0], ast.Constant):
            route_path = str(call.args[0].value)
        return {"method": method, "path": route_path}
    return None


def _name_for(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _name_for(node.value)
        return f"{parent}.{node.attr}" if parent else node.attr
    return ""
