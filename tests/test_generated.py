import os
import subprocess
import sys

def test_file_exists():
    """TC-02: Verify script exists in target directory"""
    assert os.path.exists("print_integer_1.py"), "print_integer_1.py not found in repository root"

def test_output_correct():
    """TC-01: Verify script outputs correct value on execution"""
    result = subprocess.run(
        [sys.executable, "print_integer_1.py"],
        capture_output=True,
        text=True
    )
    assert result.returncode == 0, "Script exited with non-zero code"
    assert result.stdout == "1\n", f"Expected output '1\\n', got '{result.stdout}'"
    assert result.stderr == "", f"Unexpected stderr output: {result.stderr}"

def test_file_size_meets_requirement():
    """TC-04: Verify file size meets requirement (<1KB)"""
    file_size = os.path.getsize("print_integer_1.py")
    assert file_size < 1024, f"File size {file_size} bytes exceeds 1KB limit"
    assert file_size == 9, f"Expected file size 9 bytes, got {file_size} bytes"
