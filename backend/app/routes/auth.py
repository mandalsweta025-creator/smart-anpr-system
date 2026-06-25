from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from typing import Optional

from backend.app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    get_current_user_optional,
    limiter,
)
from backend.app.database.connection import SessionLocal
from backend.app.models.user import User

router = APIRouter()

_VALID_ROLES = ("admin", "operator", "user")


# ── Request / Response models ─────────────────────────────────

class UserRegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    role: Optional[str] = None   # only respected when caller is admin


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str


class RoleUpdateRequest(BaseModel):
    role: str


class PasswordChangeRequest(BaseModel):
    password: str


# ── Status ────────────────────────────────────────────────────

@router.get("/auth")
def auth_status():
    return {"success": True, "message": "Authentication API active"}


# ── Register ──────────────────────────────────────────────────

@router.post("/auth/register", status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
def register_user(
    http_request: Request,
    request: UserRegisterRequest,
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    """
    Registration rules:
      • First user ever → admin (bootstrap).
      • Authenticated admin registering → respects request.role field.
      • Public (no token) → always creates 'user' (vehicle-owner) role.
    """
    if len(request.password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters",
        )

    db = SessionLocal()
    try:
        user_count = db.query(User).count()
        is_admin_caller = current_user is not None and current_user.get("role") == "admin"

        if user_count == 0:
            role = "admin"
        elif is_admin_caller:
            requested = (request.role or "user").lower()
            role = requested if requested in _VALID_ROLES else "user"
        else:
            role = "user"

        existing = db.query(User).filter(User.username == request.username).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username already taken",
            )
        email_existing = db.query(User).filter(User.email == request.email).first()
        if email_existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already registered",
            )

        user = User(
            username=request.username,
            email=request.email,
            hashed_password=hash_password(request.password),
            role=role,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        try:
            from backend.app.services.audit_service import log_action
            caller = current_user.get("sub") if current_user else "public"
            ip = http_request.client.host if http_request.client else None
            log_action(
                action="USER_CREATE",
                username=caller,
                resource_type="user",
                resource_id=user.username,
                details={"role": role, "email": request.email},
                ip_address=ip,
            )
        except Exception:
            pass

        return {"success": True, "username": user.username, "id": user.id, "role": user.role}
    finally:
        db.close()


# ── Login  ────────────────────────────────────────────────────

@router.post("/auth/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def login(request: Request, form: OAuth2PasswordRequestForm = Depends()):
    """Standard OAuth2 password flow. Returns a JWT bearer token + role."""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == form.username).first()
        role = user.role if user else None
    finally:
        db.close()

    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    tv = getattr(user, "token_version", 0) or 0
    token = create_access_token({"sub": user.username, "role": role, "tv": tv})
    try:
        from backend.app.services.audit_service import log_action
        ip = request.client.host if request.client else None
        log_action(action="LOGIN", username=user.username, ip_address=ip)
    except Exception:
        pass
    return TokenResponse(access_token=token, role=role)


# ── Own profile ───────────────────────────────────────────────

@router.get("/users/me")
def get_own_user(current_user: dict = Depends(get_current_user)):
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == current_user["sub"]).first()
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        return {"id": user.id, "username": user.username, "email": user.email, "role": user.role}
    finally:
        db.close()


# ── User management (admin) ───────────────────────────────────

@router.get("/users")
def list_users(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    db = SessionLocal()
    try:
        users = db.query(User).all()
        return [{"id": u.id, "username": u.username, "email": u.email, "role": u.role} for u in users]
    finally:
        db.close()


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        if user.username == current_user.get("sub"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete your own account")
        deleted_username = user.username
        db.delete(user)
        db.commit()
        try:
            from backend.app.services.audit_service import log_action
            log_action(
                action="USER_DELETE",
                username=current_user.get("sub"),
                resource_type="user",
                resource_id=deleted_username,
            )
        except Exception:
            pass
    finally:
        db.close()


@router.patch("/users/{user_id}/role")
def update_user_role(user_id: int, req: RoleUpdateRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    if req.role not in _VALID_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Role must be one of: {', '.join(_VALID_ROLES)}",
        )
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        if user.username == current_user.get("sub") and req.role != "admin":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot demote your own admin account")
        old_role = user.role
        user.role = req.role
        db.commit()
        try:
            from backend.app.services.audit_service import log_action
            log_action(
                action="USER_ROLE_CHANGE",
                username=current_user.get("sub"),
                resource_type="user",
                resource_id=user.username,
                details={"old_role": old_role, "new_role": req.role},
            )
        except Exception:
            pass
        return {"success": True, "id": user.id, "role": user.role}
    finally:
        db.close()


@router.patch("/users/{user_id}/password")
def change_password(user_id: int, req: PasswordChangeRequest, current_user: dict = Depends(get_current_user)):
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        is_admin = current_user.get("role") == "admin"
        is_own = user.username == current_user.get("sub")
        if not is_admin and not is_own:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only change your own password")
        if len(req.password) < 6:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 6 characters")
        user.hashed_password = hash_password(req.password)
        # Increment token_version to invalidate all existing tokens for this user
        user.token_version = (getattr(user, "token_version", 0) or 0) + 1
        db.commit()
        try:
            from backend.app.services.audit_service import log_action
            log_action(
                action="PASSWORD_CHANGE",
                username=current_user.get("sub"),
                resource_type="user",
                resource_id=user.username,
            )
        except Exception:
            pass
        return {"success": True}
    finally:
        db.close()
