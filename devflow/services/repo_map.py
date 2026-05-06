from __future__ import annotations

import ast
import json
import re
from pathlib import Path
from typing import Any

MAX_FILES = 300
MAX_RELEVANT_FILES = 20

# Common builtin / dunder / collection method names — extremely high attribute
# reference counts but they almost never identify the user's actual code symbol.
# Skipping these from the reference set sharply reduces noise in PageRank scores.
_REFERENCE_STOPWORDS: frozenset[str] = frozenset({
    "add", "append", "extend", "pop", "remove", "clear", "copy", "update",
    "get", "set", "items", "keys", "values", "join", "split", "strip",
    "format", "encode", "decode", "lower", "upper", "replace", "startswith",
    "endswith", "find", "index", "count", "sort", "sorted", "reversed",
    "len", "str", "int", "float", "bool", "list", "dict", "tuple", "set",
    "print", "open", "range", "enumerate", "zip", "map", "filter", "any", "all",
    "isinstance", "issubclass", "hasattr", "getattr", "setattr", "delattr",
    "type", "super", "self", "cls", "Exception", "ValueError", "TypeError",
    "KeyError", "RuntimeError", "AttributeError", "FileNotFoundError",
    "True", "False", "None",
})


# ── Project-kind detection ──────────────────────────────────────────────────
#
# A small, deterministic heuristic that scans manifest files to label what
# kind of project this is. The output is dropped into the repomap as
# ``project_kinds`` + ``frontend_roots`` / ``backend_roots`` so the LLM doesn't
# have to "guess" the stack from file names.

_FRONTEND_FRAMEWORK_DEPS: dict[str, str] = {
    "react": "react_frontend",
    "react-dom": "react_frontend",
    "next": "nextjs_frontend",
    "vue": "vue_frontend",
    "@vue/runtime-core": "vue_frontend",
    "svelte": "svelte_frontend",
    "@sveltejs/kit": "sveltekit_frontend",
    "@angular/core": "angular_frontend",
    "solid-js": "solid_frontend",
    "preact": "preact_frontend",
    "vite": "vite_build",
    "webpack": "webpack_build",
    "tailwindcss": "tailwind_styling",
}

_PYTHON_FRAMEWORK_DEPS: dict[str, str] = {
    "fastapi": "fastapi_backend",
    "django": "django_backend",
    "flask": "flask_backend",
    "starlette": "starlette_backend",
    "tornado": "tornado_backend",
    "sanic": "sanic_backend",
    "litestar": "litestar_backend",
}


def detect_project_kinds(root: Path) -> dict[str, Any]:
    """Scan manifest files at ``root`` and any first-level subdirs.

    Returns a dict with three keys:
        project_kinds:    sorted list of stack labels (e.g. ``["fastapi_backend", "react_frontend"]``)
        frontend_roots:   relative dirs containing a frontend ``package.json``
        backend_roots:    relative dirs containing a backend manifest (pyproject.toml, ...)
    """
    kinds: set[str] = set()
    frontend_roots: list[str] = []
    backend_roots: list[str] = []

    candidates: list[Path] = [root]
    try:
        for child in sorted(root.iterdir()):
            if child.is_dir() and child.name not in {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build"}:
                candidates.append(child)
    except OSError:
        pass

    for candidate in candidates:
        rel = "." if candidate == root else str(candidate.relative_to(root)) + "/"

        pkg = candidate / "package.json"
        if pkg.exists():
            kinds.update(_kinds_from_package_json(pkg))
            frontend_roots.append(rel)

        if (candidate / "pyproject.toml").exists():
            kinds.update(_kinds_from_pyproject(candidate / "pyproject.toml"))
            backend_roots.append(rel)
        elif (candidate / "requirements.txt").exists():
            kinds.update(_kinds_from_requirements(candidate / "requirements.txt"))
            backend_roots.append(rel)
        elif (candidate / "setup.py").exists() or (candidate / "setup.cfg").exists():
            kinds.add("python_package")
            backend_roots.append(rel)

        if (candidate / "Cargo.toml").exists():
            kinds.add("rust_crate")
            backend_roots.append(rel)
        if (candidate / "go.mod").exists():
            kinds.add("go_module")
            backend_roots.append(rel)
        if (candidate / "Gemfile").exists():
            kinds.add("ruby_project")
            backend_roots.append(rel)
        if (candidate / "pom.xml").exists() or (candidate / "build.gradle").exists() or (candidate / "build.gradle.kts").exists():
            kinds.add("jvm_project")
            backend_roots.append(rel)

    # Dedupe while preserving discovery order.
    return {
        "project_kinds": sorted(kinds),
        "frontend_roots": list(dict.fromkeys(frontend_roots)),
        "backend_roots": list(dict.fromkeys(backend_roots)),
    }


def _kinds_from_package_json(path: Path) -> set[str]:
    out: set[str] = set()
    try:
        pkg = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
    except (OSError, json.JSONDecodeError):
        return out
    deps: dict[str, str] = {}
    for key in ("dependencies", "devDependencies", "peerDependencies"):
        section = pkg.get(key) or {}
        if isinstance(section, dict):
            deps.update({str(k): str(v) for k, v in section.items()})
    matched = False
    for dep_name, label in _FRONTEND_FRAMEWORK_DEPS.items():
        if dep_name in deps:
            out.add(label)
            matched = True
    if not matched and deps:
        # Some frontend project, but no framework we recognise — still useful signal.
        out.add("node_project")
    return out


def _kinds_from_pyproject(path: Path) -> set[str]:
    out: set[str] = {"python_package"}
    try:
        text = path.read_text(encoding="utf-8", errors="ignore").lower()
    except OSError:
        return out
    for dep_name, label in _PYTHON_FRAMEWORK_DEPS.items():
        if re.search(rf"\b{re.escape(dep_name)}\b", text):
            out.add(label)
    return out


def _kinds_from_requirements(path: Path) -> set[str]:
    out: set[str] = {"python_package"}
    try:
        text = path.read_text(encoding="utf-8", errors="ignore").lower()
    except OSError:
        return out
    for dep_name, label in _PYTHON_FRAMEWORK_DEPS.items():
        if re.search(rf"^\s*{re.escape(dep_name)}\b", text, flags=re.MULTILINE):
            out.add(label)
    return out


def build_repo_context_summary(repo_path: str, requirement_spec: Any) -> dict[str, Any]:
    """Build an Aider-style repomap of ``repo_path``.

    Files are ranked using personalised PageRank over the symbol-reference
    graph (file A → file B if A references a symbol defined in B). The
    personalisation vector is biased toward files whose path or content
    matches the requirement keywords. Within a file, individual symbols are
    ranked by how many other files reference them.
    """
    root = Path(repo_path)
    query = _requirement_query(requirement_spec)

    # Phase 1 — scan files, extract per-file metadata + Python defs/refs.
    file_records: list[dict[str, Any]] = []
    api_routes: list[dict[str, Any]] = []
    data_models: list[dict[str, Any]] = []
    test_files: list[str] = []

    for path in _iter_source_files(root):
        rel = str(path.relative_to(root))
        text = _safe_read(path)
        if rel.startswith("tests/") or "/tests/" in rel or path.name.startswith("test_"):
            test_files.append(rel)

        if path.suffix == ".py":
            py_info = _python_extract(rel, text)
            api_routes.extend(py_info["api_routes"])
            data_models.extend(py_info["data_models"])
            symbols = py_info["symbols"]
            references = py_info["references"]
        elif path.suffix in {".ts", ".tsx", ".js", ".jsx", ".mjs"}:
            ts_info = _ts_extract(rel, text)
            symbols = ts_info["symbols"]
            references = ts_info["references"]
        else:
            symbols = []
            references = set()

        file_records.append({
            "path": rel,
            "size_bytes": path.stat().st_size,
            "language": _language_for(path),
            "text": text,
            "symbols": symbols,
            "references": references,
        })

    # Phase 2 — index symbol_name → defining files (multiple defs allowed).
    symbol_owners: dict[str, list[str]] = {}
    for rec in file_records:
        for sym in rec["symbols"]:
            symbol_owners.setdefault(sym["name"], []).append(rec["path"])

    # Phase 3 — build weighted directed graph; record inbound refs per symbol.
    nodes = [rec["path"] for rec in file_records]
    edges: dict[str, dict[str, float]] = {n: {} for n in nodes}
    inbound_refs: dict[tuple[str, str], int] = {}

    for rec in file_records:
        src = rec["path"]
        for ref_name in rec["references"]:
            owners = symbol_owners.get(ref_name, [])
            if not owners:
                continue
            weight = 1.0 / len(owners)  # split weight when multiple files define the same symbol
            for dst in owners:
                if dst == src:
                    continue
                edges[src][dst] = edges[src].get(dst, 0.0) + weight
                inbound_refs[(dst, ref_name)] = inbound_refs.get((dst, ref_name), 0) + 1

    # Phase 4 — personalisation vector from keyword overlap; path matches weighted higher.
    personalisation = _build_personalisation(file_records, query)

    # Phase 5 — power-iteration PageRank.
    ranks = _pagerank(nodes, edges, personalisation, damping=0.85, iterations=40, tolerance=1e-6)

    # Phase 6 — assemble output. Scale ranks to ints so downstream filters
    # ("relevance_score > 0") still work without knowing about floats.
    max_rank = max(ranks.values()) if ranks else 1.0
    scale = 1000.0 / max_rank if max_rank > 0 else 0.0

    files = [
        {
            "path": rec["path"],
            "size_bytes": rec["size_bytes"],
            "language": rec["language"],
            "relevance_score": int(round(ranks.get(rec["path"], 0.0) * scale)),
        }
        for rec in file_records
    ]
    files.sort(key=lambda item: (-item["relevance_score"], item["path"]))
    relevant_files = [
        item["path"] for item in files[:MAX_RELEVANT_FILES] if item["relevance_score"] > 0
    ]

    # Phase 7 — rank key_symbols by inbound reference count, restricted to the
    # top-ranked files so the LLM sees what actually matters.
    relevant_set = set(relevant_files) or {item["path"] for item in files[:MAX_RELEVANT_FILES]}
    record_by_path = {rec["path"]: rec for rec in file_records}
    ranked_symbols: list[dict[str, Any]] = []
    for path in (item["path"] for item in files):
        if path not in relevant_set:
            continue
        rec = record_by_path[path]
        for sym in rec["symbols"]:
            ranked_symbols.append({
                **sym,
                "references": inbound_refs.get((path, sym["name"]), 0),
            })
    ranked_symbols.sort(key=lambda s: (-s["references"], s["file"], s["line"]))

    project_meta = detect_project_kinds(root)

    return {
        "repo_root": str(root.resolve()),
        "file_count": len(files),
        "project_kinds": project_meta["project_kinds"],
        "frontend_roots": project_meta["frontend_roots"],
        "backend_roots": project_meta["backend_roots"],
        "files": files[:MAX_FILES],
        "relevant_files": relevant_files,
        "key_symbols": ranked_symbols[:500],
        "api_routes": api_routes[:200],
        "data_models": data_models[:200],
        "test_files": sorted(test_files)[:200],
        "query_terms": query,
    }


def _build_personalisation(
    file_records: list[dict[str, Any]], query: list[str]
) -> dict[str, float]:
    """Score each file by keyword overlap; path matches weigh more than body."""
    if not file_records:
        return {}
    scores: dict[str, float] = {}
    for rec in file_records:
        path_lower = rec["path"].lower()
        body_lower = rec["text"][:20_000].lower()
        path_hits = sum(path_lower.count(t.lower()) for t in query)
        body_hits = sum(body_lower.count(t.lower()) for t in query)
        scores[rec["path"]] = float(path_hits * 5 + body_hits)

    total = sum(scores.values())
    if total <= 0:
        # No query signal — uniform personalisation (degenerates to plain PageRank).
        n = len(file_records)
        return {rec["path"]: 1.0 / n for rec in file_records}
    return {p: s / total for p, s in scores.items()}


def _pagerank(
    nodes: list[str],
    edges: dict[str, dict[str, float]],
    personalisation: dict[str, float],
    *,
    damping: float = 0.85,
    iterations: int = 40,
    tolerance: float = 1e-6,
) -> dict[str, float]:
    """Personalised PageRank via power iteration. Pure Python, no numpy."""
    n = len(nodes)
    if n == 0:
        return {}
    if n == 1:
        return {nodes[0]: 1.0}

    # Normalise outgoing edge weights so each row sums to 1 (or 0 if dangling).
    out_weight: dict[str, float] = {}
    for src, dsts in edges.items():
        out_weight[src] = sum(dsts.values())

    # Reverse adjacency for fast inbound lookup.
    inbound: dict[str, list[tuple[str, float]]] = {n: [] for n in nodes}
    for src, dsts in edges.items():
        if out_weight.get(src, 0.0) <= 0:
            continue
        for dst, weight in dsts.items():
            if dst in inbound:
                inbound[dst].append((src, weight))

    teleport = {n: personalisation.get(n, 1.0 / n_total(nodes)) for n in nodes}
    rank = {n: teleport[n] for n in nodes}

    for _ in range(iterations):
        # Mass from dangling nodes (no outgoing edges) is redistributed via teleport.
        dangling_mass = sum(rank[n] for n in nodes if out_weight.get(n, 0.0) <= 0)
        new_rank: dict[str, float] = {}
        for n in nodes:
            inbound_mass = sum(
                rank[src] * (weight / out_weight[src])
                for src, weight in inbound[n]
            )
            new_rank[n] = (
                (1 - damping) * teleport[n]
                + damping * (inbound_mass + dangling_mass * teleport[n])
            )
        delta = sum(abs(new_rank[n] - rank[n]) for n in nodes)
        rank = new_rank
        if delta < tolerance:
            break
    return rank


def n_total(nodes: list[str]) -> int:
    return len(nodes) or 1


def repo_context_to_json(context: dict[str, Any]) -> str:
    return json.dumps(context, ensure_ascii=False, indent=2)


_LANG_QUOTAS_DEFAULT: dict[str, int] = {
    # Per-language minimum number of files preserved in compact output.
    # PageRank often biases toward whichever stack has densest cross-references
    # (typically backend Python), so without quotas frontend can vanish.
    "python": 10,
    "typescript": 6,
    "javascript": 6,
    "html": 2,
    "json": 2,
    "markdown": 2,
}


def compact_repo_context_for_prompt(
    context: Any,
    *,
    max_files: int = 25,
    max_symbols: int = 60,
    max_routes: int = 30,
    max_models: int = 30,
    max_test_files: int = 15,
    max_chars: int = 8000,
    lang_quotas: dict[str, int] | None = None,
) -> str:
    """Return a JSON string of repo_context_summary trimmed for LLM prompts.

    The on-disk artifact stays full; this drops noise for the LLM by keeping
    only top-relevance items and entries tied to relevant files. A
    per-language quota guarantees minority languages (typically frontend)
    survive even when PageRank ranks backend code higher.
    """
    if isinstance(context, str):
        try:
            context = json.loads(context)
        except json.JSONDecodeError:
            return context[:max_chars]
    if not isinstance(context, dict):
        return "{}"

    quotas = {**_LANG_QUOTAS_DEFAULT, **(lang_quotas or {})}

    files_in = [f for f in (context.get("files") or []) if isinstance(f, dict)]

    # ── Pick files: top-N overall + per-language quota top-up ────────────────
    by_score = sorted(
        files_in,
        key=lambda item: (-int(item.get("relevance_score") or 0), str(item.get("path") or "")),
    )
    chosen: list[dict[str, Any]] = []
    chosen_paths: set[str] = set()

    def _add(file_item: dict[str, Any]) -> None:
        path = str(file_item.get("path") or "")
        if not path or path in chosen_paths:
            return
        chosen.append(file_item)
        chosen_paths.add(path)

    for f in by_score[:max_files]:
        _add(f)

    # Top-up under-represented languages from the global ranking.
    if quotas:
        per_lang_count: dict[str, int] = {}
        for f in chosen:
            per_lang_count[str(f.get("language") or "")] = per_lang_count.get(str(f.get("language") or ""), 0) + 1
        for lang, quota in quotas.items():
            if per_lang_count.get(lang, 0) >= quota:
                continue
            for f in by_score:
                if per_lang_count.get(lang, 0) >= quota:
                    break
                if str(f.get("language") or "") != lang:
                    continue
                if f.get("path") in chosen_paths:
                    continue
                _add(f)
                per_lang_count[lang] = per_lang_count.get(lang, 0) + 1

    chosen.sort(key=lambda item: (-int(item.get("relevance_score") or 0), str(item.get("path") or "")))
    relevant_paths = {f.get("path") for f in chosen}
    relevant_files = [f.get("path") for f in chosen if int(f.get("relevance_score") or 0) > 0]
    if not relevant_files:
        relevant_files = [f.get("path") for f in chosen]
    relevant_files = relevant_files[:max_files]

    def _filter_by_file(items: list, key: str = "file", limit: int = 50) -> list:
        scoped = [it for it in items if isinstance(it, dict) and it.get(key) in relevant_paths]
        return (scoped or items)[:limit]

    compact = {
        "repo_root": context.get("repo_root", ""),
        "file_count": context.get("file_count"),
        "project_kinds": context.get("project_kinds") or [],
        "frontend_roots": context.get("frontend_roots") or [],
        "backend_roots": context.get("backend_roots") or [],
        "files": [
            {
                "path": f.get("path"),
                "language": f.get("language"),
                "relevance_score": f.get("relevance_score"),
            }
            for f in chosen
        ],
        "relevant_files": relevant_files,
        "key_symbols": _filter_by_file(list(context.get("key_symbols") or []), "file", max_symbols),
        "api_routes": _filter_by_file(list(context.get("api_routes") or []), "file", max_routes),
        "data_models": _filter_by_file(list(context.get("data_models") or []), "file", max_models),
        "test_files": list(context.get("test_files") or [])[:max_test_files],
    }

    text = json.dumps(compact, ensure_ascii=False, indent=2)
    if len(text) <= max_chars:
        return text

    # Drop heavy sections progressively, keeping ``project_kinds`` /
    # ``relevant_files`` to the very end so the LLM never loses the stack hint.
    for drop_key in ("api_routes", "data_models", "test_files", "key_symbols", "files"):
        compact.pop(drop_key, None)
        text = json.dumps(compact, ensure_ascii=False, indent=2)
        if len(text) <= max_chars:
            return text
    # If even the minimal structure overflows, prefer a still-valid JSON over
    # a chopped string. Drop everything except the minimum.
    compact = {
        "repo_root": compact.get("repo_root", ""),
        "project_kinds": compact.get("project_kinds") or [],
        "relevant_files": (compact.get("relevant_files") or [])[:max_files],
    }
    return json.dumps(compact, ensure_ascii=False, indent=2)[:max_chars]


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


def _python_extract(rel_path: str, text: str) -> dict[str, Any]:
    """Extract Python definitions, API routes, ORM models, AND references.

    The reference set powers the PageRank graph: any name this file imports,
    instantiates, calls or extends counts as a directed edge to whichever file
    defines that symbol.
    """
    symbols: list[dict[str, Any]] = []
    api_routes: list[dict[str, Any]] = []
    data_models: list[dict[str, Any]] = []
    references: set[str] = set()
    defined_names: set[str] = set()

    try:
        tree = ast.parse(text)
    except SyntaxError:
        return {
            "symbols": symbols,
            "api_routes": api_routes,
            "data_models": data_models,
            "references": references,
        }

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            symbols.append({
                "file": rel_path,
                "type": "function",
                "name": node.name,
                "line": node.lineno,
                "signature": _function_signature(node),
            })
            defined_names.add(node.name)
            route = _route_from_decorators(node.decorator_list)
            if route:
                api_routes.append({"file": rel_path, "function": node.name, "line": node.lineno, **route})
        elif isinstance(node, ast.ClassDef):
            bases = [_name_for(base) for base in node.bases]
            symbols.append({"file": rel_path, "type": "class", "name": node.name, "line": node.lineno, "bases": bases})
            defined_names.add(node.name)
            for base in bases:
                if base:
                    references.add(base.split(".")[-1])
            if any(base in {"Base", "BaseModel"} or base.endswith("Base") for base in bases):
                data_models.append({"file": rel_path, "name": node.name, "line": node.lineno, "bases": bases})
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name and alias.name != "*":
                    references.add(alias.name)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name:
                    # For "import a.b.c" the most useful symbol to track is the leaf module name.
                    references.add(alias.name.split(".")[-1])
        elif isinstance(node, ast.Call):
            target = node.func
            if isinstance(target, ast.Name):
                references.add(target.id)
            elif isinstance(target, ast.Attribute):
                references.add(target.attr)
        elif isinstance(node, ast.Attribute):
            references.add(node.attr)

    # A symbol defined inside this file is not a "reference" to itself.
    references -= defined_names
    references -= _REFERENCE_STOPWORDS
    return {
        "symbols": symbols,
        "api_routes": api_routes,
        "data_models": data_models,
        "references": references,
    }


# ── TypeScript / JavaScript / JSX extraction ────────────────────────────────
#
# We can't run a full parser without adding a tree-sitter dependency, so we
# use a small set of regexes that catch the dominant patterns:
#   - imports (path + named exports being pulled in)
#   - top-level definitions (export function/class/const/interface/type)
#   - JSX component usage (`<ComponentName ...>`)
# This is enough to make frontend files participate in the PageRank graph;
# it doesn't have to be syntactically perfect.

_TS_IMPORT_RE = re.compile(
    r"""import\s+
        (?:
            (?:type\s+)?
            (?P<braced>\{[^}]*\}|\*\s+as\s+\w+|\w+)
            (?:\s*,\s*\{[^}]*\})?
            \s+from\s+
        )?
        ['"](?P<module>[^'"]+)['"]
    """,
    re.VERBOSE,
)

_TS_EXPORT_RE = re.compile(
    r"export\s+(?:default\s+)?(?:async\s+)?(?P<kind>function|class|const|let|var|interface|type|enum)\s+(?P<name>[A-Za-z_]\w*)"
)

_TS_TOP_FN_RE = re.compile(
    r"(?:^|\n)(?:async\s+)?function\s+(?P<name>[A-Za-z_]\w*)"
)

_TS_JSX_RE = re.compile(r"<([A-Z][A-Za-z0-9_]*)")


def _ts_extract(rel_path: str, text: str) -> dict[str, Any]:
    """Extract definitions and references from TS/JS/JSX/TSX source.

    Definitions feed ``symbols`` (used for ranking display); references feed
    the cross-file graph that powers PageRank. Returns the same dict shape as
    ``_python_extract``: ``{symbols, api_routes, data_models, references}``.
    """
    symbols: list[dict[str, Any]] = []
    references: set[str] = set()
    defined: set[str] = set()

    # Imports — both the module's leaf segment AND the named bindings inside { }.
    for m in _TS_IMPORT_RE.finditer(text):
        module = (m.group("module") or "").strip()
        if module:
            leaf = module.rsplit("/", 1)[-1]
            leaf = re.sub(r"\.(tsx?|jsx?|mjs)$", "", leaf)
            if leaf and leaf not in {"react", "react-dom"}:
                references.add(leaf)
        braced = (m.group("braced") or "").strip()
        if braced.startswith("{"):
            inner = braced.strip("{} \n")
            for raw in inner.split(","):
                name = raw.strip().split(" as ")[0].strip()
                # drop leading "type "
                if name.startswith("type "):
                    name = name[5:].strip()
                if name and re.fullmatch(r"[A-Za-z_]\w*", name):
                    references.add(name)
        elif braced and re.fullmatch(r"[A-Za-z_]\w*", braced):
            references.add(braced)

    # Top-level exports.
    for m in _TS_EXPORT_RE.finditer(text):
        name = m.group("name")
        kind = m.group("kind")
        symbol_type = "class" if kind in {"class", "interface", "type", "enum"} else "function"
        symbols.append({
            "file": rel_path,
            "type": symbol_type,
            "name": name,
            "line": text[: m.start()].count("\n") + 1,
            "signature": f"{kind} {name}",
        })
        defined.add(name)

    # Top-level function declarations without `export`.
    for m in _TS_TOP_FN_RE.finditer(text):
        name = m.group("name")
        if name not in defined:
            symbols.append({
                "file": rel_path,
                "type": "function",
                "name": name,
                "line": text[: m.start()].count("\n") + 1,
                "signature": f"function {name}",
            })
            defined.add(name)

    # JSX component usage. ``<App />`` → reference to component named ``App``.
    for m in _TS_JSX_RE.finditer(text):
        references.add(m.group(1))

    references -= defined
    references -= _REFERENCE_STOPWORDS
    return {
        "symbols": symbols,
        "api_routes": [],
        "data_models": [],
        "references": references,
    }


# Backwards-compatible alias for any external consumer of the old helper.
def _python_symbols(rel_path: str, text: str) -> dict[str, list[dict[str, Any]]]:
    info = _python_extract(rel_path, text)
    return {
        "symbols": info["symbols"],
        "api_routes": info["api_routes"],
        "data_models": info["data_models"],
    }


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
