import imaplib
import email
from typing import Tuple, List
from datetime import datetime

from devflow.db.models import DetectionRule


def verify_imap_connection(imap_server: str, imap_port: int, username: str, password: str) -> bool:
    """Tests connection to IMAP server with provided credentials, returns True if valid"""
    try:
        with imaplib.IMAP4_SSL(imap_server, imap_port, timeout=10) as imap:
            imap.login(username, password)
            return True
    except (imaplib.IMAP4.error, ConnectionError, TimeoutError):
        return False


def run_scan(account_id: str, scan_type: str) -> str:
    """Initiates scan for given email account, returns scan job ID"""
    import uuid
    from devflow.db.models import ScanJob
    from devflow.db.session import get_db

    db = next(get_db())
    job_id = str(uuid.uuid4())

    scan_job = ScanJob(
        id=job_id,
        email_account_id=account_id,
        scan_type=scan_type,
        status="pending",
        emails_scanned=0,
        matches_found=0
    )

    db.add(scan_job)
    db.commit()

    # TODO: Queue background task for actual scan execution
    return job_id


def match_email_rule(email_metadata: dict, rule: DetectionRule) -> Tuple[bool, List[str]]:
    """Checks if email matches given rule, returns (is_match, list of matched conditions)"""
    matched_conditions = []

    # Check subject keywords
    if rule.subject_keywords:
        subject = email_metadata.get("subject", "").lower()
        for keyword in rule.subject_keywords:
            if keyword.lower() in subject:
                matched_conditions.append(f"subject contains '{keyword}'")

    # Check sender addresses
    if rule.sender_addresses:
        sender = email_metadata.get("sender", "").lower()
        for allowed_sender in rule.sender_addresses:
            if allowed_sender.lower() in sender:
                matched_conditions.append(f"sender is '{allowed_sender}'")

    # Check attachment types
    if rule.attachment_types:
        has_matching_attachment = False
        email_attachments = email_metadata.get("attachment_types", [])
        for attachment_type in rule.attachment_types:
            if attachment_type.lower() in [ext.lower() for ext in email_attachments]:
                has_matching_attachment = True
                matched_conditions.append(f"attachment type '{attachment_type}' present")
                break
        if rule.attachment_types and not has_matching_attachment:
            return (False, [])

    # Check receive time range
    if rule.receive_time_start and rule.receive_time_end:
        received_at: datetime = email_metadata.get("received_at")
        if received_at:
            receive_time = received_at.time()
            start_hour, start_minute = map(int, rule.receive_time_start.split(":"))
            end_hour, end_minute = map(int, rule.receive_time_end.split(":"))
            start_time = datetime.strptime(rule.receive_time_start, "%H:%M").time()
            end_time = datetime.strptime(rule.receive_time_end, "%H:%M").time()

            if start_time <= receive_time <= end_time:
                matched_conditions.append(f"received between {rule.receive_time_start} and {rule.receive_time_end}")

    # If at least one condition matched and all required conditions are satisfied
    if len(matched_conditions) > 0:
        return (True, matched_conditions)

    return (False, [])


def fetch_email_headers(imap_server: str, imap_port: int, username: str, password: str, limit: int = 1000) -> List[dict]:
    """Fetches only email headers from IMAP server to minimize data transfer"""
    emails = []
    with imaplib.IMAP4_SSL(imap_server, imap_port, timeout=30) as imap:
        imap.login(username, password)
        imap.select("INBOX")
        _, message_numbers = imap.search(None, "ALL")
        for num in message_numbers[0].split()[-limit:]:
            _, msg_data = imap.fetch(num, "(RFC822.HEADER)")
            msg = email.message_from_bytes(msg_data[0][1])
