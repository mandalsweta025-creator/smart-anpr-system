"""
plate_validation.py
===================
Comprehensive Indian vehicle registration plate validator.

Public API
----------
correct_plate(raw)          -> str                  OCR-error correction
is_valid(text)              -> bool                 quick True/False
validate(text)              -> PlateValidationResult  full result with reason
correct_and_validate(raw)   -> PlateValidationResult  correct then validate
"""

import re
from typing import NamedTuple

from backend.app.core.config import ALLOW_INTERNATIONAL


# ── Valid Indian state / UT registration codes ────────────────────────────────
# Source: Ministry of Road Transport & Highways vehicle registration marks (2024).
# These 39 codes are the only legal prefixes on Indian number plates.
VALID_STATE_CODES: frozenset[str] = frozenset({
    # States
    "AP",   # Andhra Pradesh
    "AR",   # Arunachal Pradesh
    "AS",   # Assam
    "BR",   # Bihar
    "CG",   # Chhattisgarh
    "GA",   # Goa
    "GJ",   # Gujarat
    "HR",   # Haryana
    "HP",   # Himachal Pradesh
    "JH",   # Jharkhand
    "KA",   # Karnataka
    "KL",   # Kerala
    "MP",   # Madhya Pradesh
    "MH",   # Maharashtra
    "MN",   # Manipur
    "ML",   # Meghalaya
    "MZ",   # Mizoram
    "NL",   # Nagaland
    "OD",   # Odisha (current code)
    "OR",   # Odisha (legacy code — still on roads)
    "PB",   # Punjab
    "RJ",   # Rajasthan
    "SK",   # Sikkim
    "TN",   # Tamil Nadu
    "TS",   # Telangana
    "TR",   # Tripura
    "UP",   # Uttar Pradesh
    "UA",   # Uttarakhand (legacy)
    "UK",   # Uttarakhand (current)
    "WB",   # West Bengal
    # Union Territories
    "AN",   # Andaman & Nicobar Islands
    "CH",   # Chandigarh
    "DD",   # Daman & Diu (legacy)
    "DL",   # Delhi
    "DN",   # Dadra & Nagar Haveli and Daman & Diu (merged UT)
    "JK",   # Jammu & Kashmir
    "LA",   # Ladakh
    "LD",   # Lakshadweep
    "PY",   # Puducherry
})


# ── Structural format regex ───────────────────────────────────────────────────
# [STATE 2 letters] [DISTRICT 1–2 digits] [SERIES 1–3 letters] [NUMBER 3–4 digits]
_FORMAT_RE = re.compile(
    r"^(?P<state>[A-Z]{2})(?P<district>[0-9]{1,2})(?P<series>[A-Z]{1,3})(?P<number>[0-9]{3,4})$"
)


# ── OCR confusion maps ────────────────────────────────────────────────────────
# Applied section-by-section so corrections are contextually correct
# (e.g. 'O' in the state section → '0' would be wrong; it's a letter context).

# Letter that looks like a digit → its digit equivalent
_TO_DIGIT: dict[str, str] = {
    "O": "0", "Q": "0", "D": "0",
    "I": "1", "L": "1",
    "Z": "2",
    "S": "5",
    "B": "8",
    "G": "6",
}

# Digit that looks like a letter → its letter equivalent
_TO_LETTER: dict[str, str] = {
    "0": "O", "1": "I", "2": "Z",
    "5": "S", "6": "G", "8": "B",
}

# Wider map for the series section (also handles 4→A, 3→E misreads)
_TO_SERIES: dict[str, str] = {**_TO_LETTER, "4": "A", "3": "E"}

# Full table for the single-char fallback sweep
_ALL_SUBS: dict[str, str] = {**_TO_DIGIT, **_TO_LETTER, "4": "A", "3": "E"}


# ── Internal helpers ──────────────────────────────────────────────────────────

def _clean(text: str) -> str:
    """Strip non-alphanumeric characters and uppercase."""
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def _fix_state(raw: str) -> str | None:
    """Two chars, must become letters."""
    fixed = "".join(_TO_LETTER.get(c, c) for c in raw)
    return fixed if fixed.isalpha() else None


def _fix_district(raw: str) -> str | None:
    """1–2 chars, must become digits."""
    fixed = "".join(_TO_DIGIT.get(c, c) for c in raw)
    return fixed if fixed.isdigit() else None


def _fix_series(raw: str) -> str | None:
    """1–3 chars, must become letters (uses wider series map)."""
    fixed = "".join(_TO_SERIES.get(c, c) for c in raw)
    return fixed if fixed.isalpha() else None


def _fix_number(raw: str) -> str | None:
    """3–4 chars, must become digits."""
    fixed = "".join(_TO_DIGIT.get(c, c) for c in raw)
    return fixed if fixed.isdigit() else None


def _structural_parse(text: str) -> str | None:
    """
    Try every valid section-length combination (2 × 3 × 2 = 12 paths),
    collect all matching candidates, and return the best one.

    Scoring: prefer 4-digit numbers (most Indian plates) over 3-digit,
    and shorter series on a tie.  This prevents greedy ser_len=3 matches
    from consuming a digit that belongs in the number segment
    (e.g. 'TN6OAPI222' → 'TN60AP1222' not 'TN60API222').
    """
    state = _fix_state(text[:2])
    if state is None:
        return None
    rest = text[2:]

    candidates: list[tuple[int, str]] = []   # (score, plate)

    for dist_len in (2, 1):
        dist = _fix_district(rest[:dist_len])
        if dist is None:
            continue
        after_dist = rest[dist_len:]

        for ser_len in (3, 2, 1):
            ser = _fix_series(after_dist[:ser_len])
            if ser is None:
                continue
            after_ser = after_dist[ser_len:]

            for num_len in (4, 3):
                if len(after_ser) != num_len:
                    continue
                num = _fix_number(after_ser)
                if num is None:
                    continue
                candidate = state + dist + ser + num
                if _FORMAT_RE.match(candidate):
                    # Higher score = better: reward long number, penalise long series
                    score = num_len * 10 - ser_len
                    candidates.append((score, candidate))

    if not candidates:
        return None
    candidates.sort(reverse=True)
    return candidates[0][1]


# ── Public correction function ────────────────────────────────────────────────

def correct_plate(raw: str) -> str:
    """
    Best-effort OCR correction for Indian plates.

    Strategy 1 — structural parse
        Splits the cleaned string into the four plate sections and applies the
        appropriate confusion map to each section independently.  This is the
        strongest strategy: it recovers plates where entire sections were
        misread (e.g. state 'MH' OCR'd as 'M4', district '06' read as 'O6').

    Strategy 2 — single-character sweep
        Tries substituting each character in the full string with its confusion-
        table equivalent and accepts the first result that matches _FORMAT_RE.
        Catches simple single-char errors that survive the structural parse.

    Returns the corrected string if a valid format is reached, otherwise
    returns the cleaned input unchanged (never raises).
    """
    text = _clean(raw)
    if not (6 <= len(text) <= 12):
        return text

    # Always try Indian structural correction first — works even when
    # ALLOW_INTERNATIONAL is on, so Indian plates are still cleaned up.
    parsed = _structural_parse(text)
    if parsed:
        return parsed

    # In Indian-only mode also attempt the single-character sweep.
    if not ALLOW_INTERNATIONAL:
        chars = list(text)
        for i, ch in enumerate(chars):
            if ch in _ALL_SUBS:
                orig    = chars[i]
                chars[i] = _ALL_SUBS[ch]
                candidate = "".join(chars)
                if _FORMAT_RE.match(candidate):
                    return candidate
                chars[i] = orig

    return text


# ── Validation result type ────────────────────────────────────────────────────

class PlateValidationResult(NamedTuple):
    valid:  bool
    plate:  str     # cleaned / corrected plate text
    reason: str     # empty string when valid; human-readable rejection reason otherwise


# ── Public validation function ────────────────────────────────────────────────

def validate(text: str) -> PlateValidationResult:
    """
    Full structural + semantic validation.

    When ALLOW_INTERNATIONAL=true: accepts any 4–20-char alphanumeric string
    that doesn't contain a run of 4+ identical characters (OCR artefact guard).
    Indian plates are always validated strictly regardless of this flag.

    Indian checks applied in order:
      1. Length       7–11 characters after stripping non-alphanumerics
      2. Format       [SS][DD][CCC][NNNN] structural regex
      3. State code   must be in VALID_STATE_CODES (39-code MoRTH whitelist)
      4. District     district 00 is never allocated
      5. Series       all-identical chars (e.g. 'AAA') are OCR artefacts
      6. Number       vehicle number 0000 / 000 is unissued

    Returns PlateValidationResult(valid, plate, reason).
    """
    plate = _clean(text)

    if ALLOW_INTERNATIONAL and not _FORMAT_RE.match(plate):
        # International mode: relaxed check for non-Indian-format plates.
        if not (4 <= len(plate) <= 20):
            return PlateValidationResult(
                False, plate,
                f"international mode: length {len(plate)} outside 4–20",
            )
        # Reject 4+ consecutive identical characters — clear OCR artefact
        for i in range(len(plate) - 3):
            if len(set(plate[i : i + 4])) == 1:
                return PlateValidationResult(
                    False, plate,
                    f"international mode: run of 4+ identical chars at pos {i} (OCR artefact)",
                )
        return PlateValidationResult(True, plate, "")

    # 1. Length
    if not (7 <= len(plate) <= 11):
        return PlateValidationResult(
            False, plate,
            f"length {len(plate)} is outside valid range 7–11",
        )

    # 2. Format
    m = _FORMAT_RE.match(plate)
    if not m:
        return PlateValidationResult(
            False, plate,
            "does not match [STATE][DISTRICT][SERIES][NUMBER] pattern",
        )

    state    = m.group("state")
    district = m.group("district")
    series   = m.group("series")
    number   = m.group("number")

    # 3. State code whitelist — the most impactful new check
    if state not in VALID_STATE_CODES:
        return PlateValidationResult(
            False, plate,
            f"'{state}' is not a recognised Indian state/UT registration code",
        )

    # 4. District number
    if int(district) == 0:
        return PlateValidationResult(
            False, plate,
            "district number 00 is never allocated",
        )

    # 5. Series plausibility — only flag 3-char all-same (e.g. "AAA").
    # 2-char repeated series ("AA", "BB", "EE") are legitimate Indian allocations.
    if len(series) > 2 and len(set(series)) == 1:
        return PlateValidationResult(
            False, plate,
            f"series '{series}' consists of a single repeated character (OCR artefact)",
        )

    # 6. Vehicle number — 0000/000 is not issued
    if int(number) == 0:
        return PlateValidationResult(
            False, plate,
            "vehicle number 0000/000 is not issued",
        )

    # 7. Vehicle number — all-same digit (e.g. 1111, 2222, 9999) is an OCR artefact.
    # Real plates start numbering from 0001 and each digit series progresses
    # non-trivially; runs like "1111" arise from character-confusion cascades
    # (e.g. 'I'→1 repeated four times) not real registrations.
    if len(set(number)) == 1:
        return PlateValidationResult(
            False, plate,
            f"vehicle number '{number}' is all-same digit (OCR artefact)",
        )

    return PlateValidationResult(True, plate, "")


def is_valid(text: str) -> bool:
    """Quick True/False validity check (no reason string)."""
    return validate(text).valid


def correct_and_validate(raw: str) -> PlateValidationResult:
    """
    Single entry-point for the OCR pipeline: correct OCR errors then validate.
    Returns PlateValidationResult with the corrected plate text.
    """
    corrected = correct_plate(raw)
    return validate(corrected)
