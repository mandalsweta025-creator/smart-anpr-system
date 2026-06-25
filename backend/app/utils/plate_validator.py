"""
plate_validator.py — kept for backward compatibility.

All validation logic now lives in plate_validation.py.
is_valid_plate() delegates there and now includes state code whitelist checking.
"""

import re

from backend.app.utils.plate_validation import is_valid as _strict_is_valid

# Kept so any code that does `from plate_validator import INDIAN_PLATE_REGEX` still works.
INDIAN_PLATE_REGEX = re.compile(
    r"^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{3,4}$"
)


def clean_plate_text(text: str) -> str:
    if not text:
        return ""
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def is_valid_plate(text: str) -> bool:
    """Return True if text is a valid Indian plate (structural + state code check)."""
    if not text:
        return False
    return _strict_is_valid(text)


