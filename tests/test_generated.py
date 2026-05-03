import pytest
import time
from unittest.mock import Mock, patch, MagicMock
from devflow.agents.email_detection_agent import EmailDetectionAgent
from devflow.core.rule_engine import RuleEngine
from devflow.services.email_workflow_service import EmailWorkflowService
from devflow.providers.imap_provider import ImapProvider

def test_tc01_new_email_trigger_latency():
    """TC-01: Verify new email trigger latency < 10 seconds"""
    agent = EmailDetectionAgent()
    agent.imap_provider = Mock(spec=ImapProvider)
    test_email_id = "email_001"
    callback_called_time = None
    
    def mock_listen(callback):
        nonlocal callback_called_time
        time.sleep(0.1)  # Simulate small delay before new email arrives
        callback_called_time = time.time()
        callback(test_email_id)
    
    agent.imap_provider.listen_for_new_emails = mock_listen
    
    with patch.object(agent, 'process_email') as mock_process:
        start_time = time.time()
        agent.start()
        
        # Wait for processing to be triggered
        time.sleep(0.2)
        
        # Calculate latency from email arrival to processing start
        latency = mock_process.call_args[0][1] if len(mock_process.call_args[0])>1 else (time.time() - callback_called_time)
        assert latency < 10.0, f"Trigger latency {latency}s exceeds 10s requirement"
        
        agent.terminate()

def test_tc02_keyword_detection_accuracy():
    """TC-02: Verify keyword detection rule correctly matches 'invoice' in subject"""
    rule_engine = RuleEngine()
    
    test_email_data = {
        "id": "email_002",
        "subject": "Q3 Service Invoice",
        "body": "Please find attached your Q3 service invoice.",
        "from": "billing@service.com"
    }
    
    test_rules = [
        {
            "id": "rule_invoice_001",
            "rule_type": "keyword",
            "rule_config": {
                "field": "subject",
                "keyword": "invoice",
                "case_sensitive": False
            }
        }
    ]
    
    matches = rule_engine.run_rules(test_email_data, test_rules)
    
    assert len(matches) == 1, "Expected 1 rule match for invoice keyword"
    assert matches[0]["rule_id"] == "rule_invoice_001", "Matched rule ID does not match expected"
    assert "invoice" in matches[0]["match_details"].lower() if "match_details" in matches[0] else True

def test_tc03_workflow_pause_functionality():
    """TC-03: Verify paused workflow does not process new emails until resumed"""
    agent = EmailDetectionAgent()
    agent.status = "running"
    agent.imap_provider = Mock(spec=ImapProvider)
    
    # Simulate new email arrival while running
    with patch.object(agent, 'process_email') as mock_process_running:
        agent._on_new_email("email_003")
        mock_process_running.assert_called_once_with("email_003")
    
    # Pause workflow
    agent.pause()
    assert agent.status == "paused", "Workflow status not updated to paused after pause request"
    
    # Simulate new email arrival while paused
    with patch.object(agent, 'process_email') as mock_process_paused:
        agent._on_new_email("email_004")
        mock_process_paused.assert_not_called(), "Workflow processed email while paused"
    
    # Resume workflow
    agent.resume()
    assert agent.status == "running", "Workflow status not updated to running after resume request"
    
    # Simulate new email arrival after resume
    with patch.object(agent, 'process_email') as mock_process_resumed:
        agent._on_new_email("email_005")
        mock_process_resumed.assert_called_once_with("email_005")
    
    agent.terminate()

def test_tc04_invalid_credential_handling():
    """TC-04: Verify invalid credentials return authorization error and do not start workflow"""
    imap_provider = ImapProvider()
    
    # Test invalid IMAP connection
    connect_success = imap_provider.connect(
        server="imap.test.com",
        port=993,
        credentials={"username": "test@test.com", "password": "wrong_password"},
        auth_type="password"
    )
    assert connect_success == False, "IMAP connection succeeded with invalid credentials"
    
    # Test workflow start failure with invalid credentials
    workflow_service = EmailWorkflowService()
    test_workflow_id = workflow_service.create_workflow(
        user_id="user_001",
        email_account_id="account_invalid_creds",
        rule_ids=["rule_invoice_001"],
        notification_channel_id="channel_slack_001"
    )
    
    agent = EmailDetectionAgent()
    agent.workflow_id = test_workflow_id
    
    with patch.object(ImapProvider, 'connect', return_value=False):
        start_result = agent.start()
        assert agent.status == "error", "Workflow status not set to error with invalid credentials"
        assert "authorization" in str(agent.error).lower() or "credential" in str(agent.error).lower(), "No clear authorization error returned"
