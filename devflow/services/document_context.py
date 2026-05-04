from __future__ import annotations

import io
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


MAX_DOCUMENT_CHARS = 30_000
SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".doc", ".txt", ".md"}


def extract_reference_documents(files: list[tuple[str, bytes]], max_chars: int = MAX_DOCUMENT_CHARS) -> tuple[str, str]:
    chunks = []
    sources = []
    remaining = max_chars

    for filename, content in files:
        if remaining <= 0:
            break
        text = extract_text(filename, content).strip()
        if not text:
            continue
        clipped = text[:remaining]
        chunks.append(f"## 来源文档：{filename}\n{clipped}")
        sources.append({
            "filename": filename,
            "characters_extracted": len(text),
            "characters_used": len(clipped),
            "truncated": len(text) > len(clipped),
        })
        remaining -= len(clipped)

    return "\n\n".join(chunks).strip(), json.dumps(sources, ensure_ascii=False)


def extract_text(filename: str, content: bytes) -> str:
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported reference document type: {ext or filename}")
    if ext in {".txt", ".md"}:
        return content.decode("utf-8", errors="replace")
    if ext == ".docx":
        return _extract_docx_text(content)
    if ext == ".pdf":
        return _extract_pdf_text(content)
    if ext == ".doc":
        return _extract_legacy_doc_text(content)
    return ""


def _extract_docx_text(content: bytes) -> str:
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    with zipfile.ZipFile(io.BytesIO(content)) as docx:
        root = ET.fromstring(docx.read("word/document.xml"))

    paragraphs = []
    for p in root.findall(".//w:p", ns):
        text = "".join(t.text for t in p.findall(".//w:t", ns) if t.text).strip()
        if text:
            paragraphs.append(text)
    return "\n".join(paragraphs)


def _extract_pdf_text(content: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise ValueError("PDF extraction requires the pypdf package. Install dependencies from requirements.txt.") from exc

    reader = PdfReader(io.BytesIO(content))
    pages = []
    for index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        if text.strip():
            pages.append(f"[Page {index}]\n{text.strip()}")
    return "\n\n".join(pages)


def _extract_legacy_doc_text(content: bytes) -> str:
    # macOS textutil can read many legacy .doc files. If unavailable, fall back
    # to a lossy decode so uploads do not hard-fail on plain-text-ish files.
    with tempfile.NamedTemporaryFile(suffix=".doc") as tmp:
        tmp.write(content)
        tmp.flush()
        try:
            result = subprocess.run(
                ["textutil", "-convert", "txt", "-stdout", tmp.name],
                capture_output=True,
                text=True,
                timeout=20,
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass
    return content.decode("utf-8", errors="ignore")
