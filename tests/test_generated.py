import subprocess
import pytest

def test_print_one():
    result = subprocess.run(['python', 'print_one.py'], capture_output=True, text=True)
    assert result.stdout.strip() == '1', 'Output should be 1'
