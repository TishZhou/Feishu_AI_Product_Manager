import io
import zipfile

from devflow.services.document_context import extract_reference_documents, extract_text


def _minimal_docx(text: str) -> bytes:
    body = "".join(
        f"<w:p><w:r><w:t>{part}</w:t></w:r></w:p>"
        for part in text.splitlines()
    )
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body></w:document>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("word/document.xml", document_xml)
    return buf.getvalue()


def test_extract_docx_text():
    content = _minimal_docx("第一段\n第二段")

    text = extract_text("需求.docx", content)

    assert "第一段" in text
    assert "第二段" in text


def test_extract_reference_documents_builds_context_and_sources():
    context, sources = extract_reference_documents([
        ("notes.md", "需求背景".encode("utf-8")),
    ])

    assert "## 来源文档：notes.md" in context
    assert "需求背景" in context
    assert "notes.md" in sources
