from fastapi import APIRouter, File, HTTPException, UploadFile

from devflow.services.document_context import SUPPORTED_EXTENSIONS, extract_reference_documents

router = APIRouter(tags=["Reference Documents"])


@router.post("/reference-documents/extract")
async def extract_reference_document_context(files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(400, "No reference documents uploaded")

    uploaded: list[tuple[str, bytes]] = []
    for file in files:
        filename = file.filename or "untitled"
        if not any(filename.lower().endswith(ext) for ext in SUPPORTED_EXTENSIONS):
            supported = ", ".join(sorted(SUPPORTED_EXTENSIONS))
            raise HTTPException(400, f"Unsupported reference document type: {filename}. Supported: {supported}")
        uploaded.append((filename, await file.read()))

    try:
        reference_context, reference_sources = extract_reference_documents(uploaded)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    return {
        "reference_context": reference_context,
        "reference_sources": reference_sources,
    }
