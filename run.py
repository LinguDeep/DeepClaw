#!/usr/bin/env python3
"""LinguClaw entry point with UTF-8 encoding fix."""
import sys
import io

# Force UTF-8 encoding for stdout/stderr to handle Turkish characters
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from src.cli import cli_entry

if __name__ == "__main__":
    cli_entry()
