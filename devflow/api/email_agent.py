import uuid
from typing import Optional, List
from fastapi import APIRouter, FastAPI, HTTPException, Depends
from pydantic import BaseModel
from datetime import datetime

from devflow.config import get_config
from devflow.core.encryption import encrypt, decrypt
from devflow.core.email_scanner import verify_imap_connection, run_scan
from devflow.core.scheduler import add_scheduled_scan
from devflow.db.models import EmailAccount, DetectionRule, ScanJob, DetectionResult
from devflow.db.session import get_db

router = APIRouter(prefix="/api/email-agent", tags=["email-agent"])


# Request Models
class CreateEmailAccountRequest(BaseModel):
    imap_server: str
    imap_port: int = 993
    username: str
    app_password: str


class CreateDetectionRuleRequest(BaseModel):
    email_account_id: str
    name: str
    subject_keywords: List[str] = []
    sender_addresses: List[str] = []
    attachment_types: List[str] = []
    receive_time_start: Optional[str] = None
    receive_time_end: Optional[str] = None


class ManualScanRequest(BaseModel):
    email_account_id: str


class CreateScheduledScanRequest(BaseModel):
    email_account_id: str
    cron_expression: str


# Response Models
class CreateEmailAccountResponse(BaseModel):
    account_id: str
    is_verified: bool


class VerifyAccountResponse(BaseModel):
    success: bool
    message: str


class CreateRuleResponse(BaseModel):
    rule_id: str


class ManualScanResponse(BaseModel):
    job_id: str
    status: str = "pending"


class ScanResultResponse(BaseModel):
    job_id: str
    status: str
    matches: List[dict]


class CreateScheduledScanResponse(BaseModel):
    schedule_id: str


# Endpoints
@router.post("/accounts", response_model=CreateEmailAccountResponse)
def create_email_account(request: CreateEmailAccountRequest, db = Depends(get_db)):
    """Creates new email account configuration, encrypts password before storage"""
    # Validate encryption key exists
    config = get_config()
    if not config.encryption_key:
        raise HTTPException(status_code=500, detail="Encryption key not configured")

    # Verify connection first
    is_verified = verify_imap_connection(
        request.imap_server,
        request.imap_port,
        request.username,
        request.app_password
    )

    # Encrypt password
    encrypted_password, iv = encrypt(request.app_password, config.encryption_key)

    # Create account
    account_id = str(uuid.uuid4())
    account = EmailAccount(
        id=account_id,
        user_id="default",  # TODO: Replace with actual user ID from auth context
        imap_server=request.imap_server,
        imap_port=request.imap_port,
        username=request.username,
        encrypted_password=encrypted_password,
        encryption_iv=iv,
        is_verified=is_verified,
        last_verified_at=datetime.utcnow() if is_verified else None
    )

    db.add(account)
    db.commit()

    return CreateEmailAccountResponse(account_id=account_id, is_verified=is_verified)


@router.post("/accounts/{account_id}/verify", response_model=VerifyAccountResponse)
def verify_email_account(account_id: str, db = Depends(get_db)):
    """Verifies IMAP connection for existing account, updates verification status if successful"""
    account = db.query(EmailAccount).filter(EmailAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Email account not found")

    config = get_config()
    password = decrypt(account.encrypted_password, account.encryption_iv, config.encryption_key)

    success = verify_imap_connection(account.imap_server, account.imap_port, account.username, password)

    if success:
        account.is_verified = True
        account.last_verified_at = datetime.utcnow()
        db.commit()
        return VerifyAccountResponse(success=True, message="Connection verified successfully")
    else:
        return VerifyAccountResponse(success=False, message="Failed to connect to IMAP server. Check credentials.")


@router.post("/rules", response_model=CreateRuleResponse)
def create_detection_rule(request: CreateDetectionRuleRequest, db = Depends(get_db)):
    """Creates new custom detection rule associated with specified email account"""
    # Validate at least one condition is provided
    if not any([request.subject_keywords, request.sender_addresses, request.attachment_types]):
        raise HTTPException(status_code=400, detail="At least one rule condition must be specified")

    rule_id = str(uuid.uuid4())
    rule = DetectionRule(
        id=rule_id,
        email_account_id=request.email_account_id,
        name=request.name,
        subject_keywords=request.subject_keywords,
        sender_addresses=request.sender_addresses,
        attachment_types=request.attachment_types,
        receive_time_start=request.receive_time_start,
        receive_time_end=request.receive_time_end,
        is_active=True
    )

    db.add(rule)
    db.commit()

    return CreateRuleResponse(rule_id=rule_id)
