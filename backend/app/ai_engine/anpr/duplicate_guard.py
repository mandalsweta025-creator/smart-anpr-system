import logging
import time

logger = logging.getLogger(__name__)


def _edit_distance(a: str, b: str) -> int:
    """Standard Levenshtein edit distance. Returns early when > 2 (fast path)."""
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if abs(la - lb) > 2:
        return abs(la - lb)
    dp = list(range(lb + 1))
    for ca in a:
        ndp = [dp[0] + 1] + [0] * lb
        for j, cb in enumerate(b):
            ndp[j + 1] = min(
                dp[j + 1] + 1,      # deletion
                ndp[j] + 1,         # insertion
                dp[j] + (ca != cb), # substitution
            )
        dp = ndp
    return dp[lb]


def plate_edit_distance(a: str, b: str) -> int:
    """Public: Levenshtein distance between two plate strings."""
    return _edit_distance(a, b)


class DuplicateGuard:
    """
    Prevent the same physical vehicle from being saved multiple times.

    Two mechanisms:
    1. Exact cooldown  — exact plate string seen within COOLDOWN seconds → suppress.
    2. Fuzzy cooldown  — plate within Levenshtein distance 1 seen within COOLDOWN
                         seconds → suppress (treats OCR variants as the same vehicle).
    """

    COOLDOWN = 120  # seconds

    def __init__(self):
        self._seen: dict[str, dict] = {}

    def _fuzzy_neighbor(self, plate: str, now: float) -> str | None:
        """Return a recently-seen plate within edit distance 1, or None."""
        for seen_plate, entry in self._seen.items():
            if seen_plate == plate:
                continue
            if now - entry["time"] > self.COOLDOWN:
                continue
            if _edit_distance(plate, seen_plate) <= 1:
                return seen_plate
        return None

    def should_save(self, plate: str, confidence: float) -> bool:
        now = time.time()

        # Exact match within cooldown
        if plate in self._seen:
            if now - self._seen[plate]["time"] <= self.COOLDOWN:
                return False
            self._seen[plate] = {"time": now, "conf": confidence}
            return True

        # Fuzzy match — different OCR reading of the same physical plate
        neighbor = self._fuzzy_neighbor(plate, now)
        if neighbor:
            logger.debug(
                f"DupGuard: suppressed '{plate}' "
                f"(fuzzy match '{neighbor}', dist=1, within cooldown)"
            )
            return False

        self._seen[plate] = {"time": now, "conf": confidence}
        return True

    def canonical_for(self, plate: str) -> str:
        """
        Return the previously-seen canonical plate string for a fuzzy match,
        or the input plate itself if no match exists.
        """
        now = time.time()
        neighbor = self._fuzzy_neighbor(plate, now)
        return neighbor if neighbor else plate

    def cleanup(self) -> None:
        cutoff = time.time() - self.COOLDOWN * 2
        self._seen = {k: v for k, v in self._seen.items() if v["time"] > cutoff}
