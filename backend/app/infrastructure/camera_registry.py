import json
from pathlib import Path

_SOURCES_FILE = Path(__file__).resolve().parents[2] / "configs" / "camera_sources.json"

# Camera roles:
# "entry"  → all detections are ENTRY events; session created immediately
# "exit"   → all detections are EXIT  events; active session closed immediately
# "smart"  → first detection of a plate = ENTRY; next detection = EXIT (single-gate mode)
# "mixed"  → legacy: timeout-based behaviour (not recommended for production)
VALID_ROLES = {"entry", "exit", "smart", "mixed"}


class CameraRegistry:
    def __init__(self):
        self.sources: dict[str, str] = {}
        self.roles:   dict[str, str] = {}
        self._load()

    def _load(self) -> None:
        try:
            if _SOURCES_FILE.exists():
                data = json.loads(_SOURCES_FILE.read_text())
                # Support both old flat format {cam_id: source} and new format
                # with a top-level "_roles" key.
                self.roles   = data.pop("_roles", {})
                self.sources = data
        except Exception:
            self.sources = {}
            self.roles   = {}

    def _save(self) -> None:
        try:
            data = dict(self.sources)
            if self.roles:
                data["_roles"] = self.roles
            _SOURCES_FILE.write_text(json.dumps(data, indent=2))
        except Exception:
            pass

    # ── Source ────────────────────────────────────────────────────

    def set_source(self, cam_id: str, source: str) -> None:
        self.sources[cam_id] = source
        self._save()

    def get_source(self, cam_id: str) -> str | None:
        return self.sources.get(cam_id)

    def get_all(self) -> dict:
        return self.sources

    # ── Role ──────────────────────────────────────────────────────

    def set_role(self, cam_id: str, role: str) -> None:
        role = role.lower()
        if role not in VALID_ROLES:
            raise ValueError(f"Invalid role '{role}'. Valid: {VALID_ROLES}")
        self.roles[cam_id] = role
        self._save()

    def get_role(self, cam_id: str) -> str:
        return self.roles.get(cam_id, "mixed")

    def get_all_roles(self) -> dict:
        return dict(self.roles)
