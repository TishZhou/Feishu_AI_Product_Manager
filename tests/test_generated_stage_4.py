import pytest
import os
import sys

# Set the path to the greet module
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from greet import greet


def test_greet_world():
    assert greet('World') == 'Hello World'


def test_greet_alice():
    assert greet('Alice') == 'Hello Alice'