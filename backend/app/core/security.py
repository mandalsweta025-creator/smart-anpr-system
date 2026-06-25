import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from slowapi import Limiter
from slowapi.util import get_remote_address

# Shared rate-limiter — imported by both main.py and auth.py
limiter = Limiter(key_func=get_remote_address)

load_dotenv()

logger = logging.getLogger(__name__)

# ── Bcrypt ────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode(), hashed_password.encode())


# ── JWT ───────────────────────────────────────────────────────
_DEFAULT_SECRET = "change-me-in-production-use-env-var"
_raw_key = os.getenv("SECRET_KEY")
if not _raw_key:
    logger.warning("SECRET_KEY not set — using insecure default. Set SECRET_KEY in .env!")
SECRET_KEY = _raw_key or _DEFAULT_SECRET

if SECRET_KEY == _DEFAULT_SECRET and os.getenv("ENVIRONMENT", "").lower() == "production":
    raise RuntimeError(
        "FATAL: SECRET_KEY is the default insecure value in ENVIRONMENT=production. "
        "Set a strong random SECRET_KEY in .env and restart."
    )

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    payload = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload["exp"] = expire
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


def get_current_user(token: str = Depends(oauth2_scheme)):
    """FastAPI dependency — raises 401 if token is missing, invalid, or invalidated."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # Validate token version — detects tokens issued before a password change.
    # Uses lazy import to avoid circular dependencies at module load time.
    tv_in_token = payload.get("tv", 0)
    try:
        from backend.app.database.connection import SessionLocal as _SL
        from backend.app.models.user import User as _User
        _db = _SL()
        try:
            _u = _db.query(_User).filter(_User.username == payload.get("sub")).first()
            if _u is not None:
                db_tv = getattr(_u, "token_version", 0) or 0
                if db_tv != tv_in_token:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Session invalidated — please log in again",
                        headers={"WWW-Authenticate": "Bearer"},
                    )
        finally:
            _db.close()
    except HTTPException:
        raise
    except Exception:
        pass  # DB unavailable — fail open to preserve availability
    return payload


def get_current_user_optional(token: str = Depends(oauth2_scheme)) -> Optional[dict]:
    """Like get_current_user but returns None instead of raising 401."""
    if not token:
        return None
    return decode_token(token)


def require_staff(current_user: dict = Depends(get_current_user)) -> dict:
    """Dependency: allows admin and operator roles; blocks vehicle owners (role='user')."""
    if current_user.get("role") not in ("admin", "operator"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Staff access required",
        )
    return current_user


def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """Dependency: allows only admin role. Blocks operators and vehicle owners."""
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required",
        )
    return current_user


def get_stream_user(
    header_token: str = Depends(oauth2_scheme),
    token: Optional[str] = Query(None),
):
    """Auth dep for MJPEG stream endpoints — accepts Bearer header OR ?token= query param
    (browser <img> tags cannot send headers, so query param is the only option there)."""
    raw = header_token or token
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(raw)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return payload
