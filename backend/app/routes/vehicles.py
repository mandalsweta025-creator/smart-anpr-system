import csv
import io
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel

from backend.app.core.security import get_current_user
from backend.app.database.connection import SessionLocal
from backend.app.models.vehicle import Vehicle
from backend.app.schemas.vehicle_schema import VehicleResponse

logger = logging.getLogger(__name__)
router = APIRouter()


class VehicleCreateRequest(BaseModel):
    plate_number: str
    owner_name: Optional[str] = None
    vehicle_type: Optional[str] = None


class WatchlistRequest(BaseModel):
    enabled: bool = True
    reason: Optional[str] = None


@router.get("/vehicles", response_model=List[VehicleResponse])
def get_all_vehicles():
    db: Session = SessionLocal()
    try:
        return db.query(Vehicle).order_by(Vehicle.id.desc()).all()
    finally:
        db.close()


@router.get("/vehicles/authorized", response_model=List[VehicleResponse])
def get_authorized_vehicles():
    db: Session = SessionLocal()
    try:
        return db.query(Vehicle).filter(Vehicle.is_authorized == True).all()
    finally:
        db.close()


@router.get("/vehicles/blacklisted", response_model=List[VehicleResponse])
def get_blacklisted_vehicles():
    db: Session = SessionLocal()
    try:
        return db.query(Vehicle).filter(Vehicle.is_blacklisted == True).all()
    finally:
        db.close()


@router.get("/vehicles/{plate_number}")
def get_vehicle_by_plate(plate_number: str):
    db: Session = SessionLocal()
    try:
        vehicle = db.query(Vehicle).filter(Vehicle.plate_number == plate_number).first()
        if not vehicle:
            return {"success": False, "message": "Vehicle not found"}
        return vehicle
    finally:
        db.close()


@router.post("/vehicles", response_model=VehicleResponse, status_code=status.HTTP_201_CREATED)
def register_vehicle(request: VehicleCreateRequest, current_user: dict = Depends(get_current_user)):
    db: Session = SessionLocal()
    try:
        existing = db.query(Vehicle).filter(Vehicle.plate_number == request.plate_number).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Vehicle already registered")
        vehicle = Vehicle(
            plate_number=request.plate_number,
            owner_name=request.owner_name,
            vehicle_type=request.vehicle_type,
        )
        db.add(vehicle)
        db.commit()
        db.refresh(vehicle)
        try:
            from backend.app.services.audit_service import log_action
            log_action(
                action="VEHICLE_ADD",
                username=current_user.get("sub"),
                resource_type="vehicle",
                resource_id=vehicle.plate_number,
            )
        except Exception:
            pass
        return vehicle
    finally:
        db.close()


@router.post("/vehicles/{plate_number}/blacklist")
def blacklist_vehicle(plate_number: str, current_user: dict = Depends(get_current_user)):
    db: Session = SessionLocal()
    try:
        vehicle = db.query(Vehicle).filter(Vehicle.plate_number == plate_number).first()
        if not vehicle:
            vehicle = Vehicle(plate_number=plate_number, is_blacklisted=True, is_authorized=False)
            db.add(vehicle)
        else:
            vehicle.is_blacklisted = True
            vehicle.is_authorized = False
        db.commit()
        try:
            from backend.app.services.audit_service import log_action
            log_action(
                action="BLACKLIST_ADD",
                username=current_user.get("sub"),
                resource_type="vehicle",
                resource_id=plate_number,
            )
        except Exception:
            pass
        return {"success": True, "plate_number": plate_number, "is_blacklisted": True}
    finally:
        db.close()


@router.delete("/vehicles/{plate_number}/blacklist")
def remove_from_blacklist(plate_number: str, current_user: dict = Depends(get_current_user)):
    db: Session = SessionLocal()
    try:
        vehicle = db.query(Vehicle).filter(Vehicle.plate_number == plate_number).first()
        if not vehicle:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
        vehicle.is_blacklisted = False
        db.commit()
        try:
            from backend.app.services.audit_service import log_action
            log_action(
                action="BLACKLIST_REMOVE",
                username=current_user.get("sub"),
                resource_type="vehicle",
                resource_id=plate_number,
            )
        except Exception:
            pass
        return {"success": True, "plate_number": plate_number, "is_blacklisted": False}
    finally:
        db.close()


@router.patch("/vehicles/{plate_number}/watchlist")
def toggle_watchlist(plate_number: str, req: WatchlistRequest, current_user: dict = Depends(get_current_user)):
    db: Session = SessionLocal()
    try:
        vehicle = db.query(Vehicle).filter(Vehicle.plate_number == plate_number).first()
        if not vehicle:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
        vehicle.is_watchlisted = req.enabled
        vehicle.watchlist_reason = req.reason if req.enabled else None
        db.commit()
        try:
            from backend.app.services.audit_service import log_action
            log_action(
                action="WATCHLIST_ADD" if req.enabled else "WATCHLIST_REMOVE",
                username=current_user.get("sub"),
                resource_type="vehicle",
                resource_id=plate_number,
                details={"reason": req.reason} if req.reason else None,
            )
        except Exception:
            pass
        return {"success": True, "plate_number": plate_number, "is_watchlisted": req.enabled}
    finally:
        db.close()


@router.delete("/vehicles/{plate_number}")
def delete_vehicle(plate_number: str, current_user: dict = Depends(get_current_user)):
    db: Session = SessionLocal()
    try:
        vehicle = db.query(Vehicle).filter(Vehicle.plate_number == plate_number).first()
        if not vehicle:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
        db.delete(vehicle)
        db.commit()
        try:
            from backend.app.services.audit_service import log_action
            log_action(
                action="VEHICLE_DELETE",
                username=current_user.get("sub"),
                resource_type="vehicle",
                resource_id=plate_number,
            )
        except Exception:
            pass
        return {"success": True}
    finally:
        db.close()


# ── POST /vehicles/import-csv ─────────────────────────────────────────────────

@router.post("/vehicles/import-csv")
async def import_vehicles_csv(
    file: UploadFile = File(...),
    update_existing: bool = False,
    current_user: dict = Depends(get_current_user),
):
    """
    Bulk-import vehicles from a CSV file.

    Expected columns (header row required):
        plate_number  — required
        owner_name    — optional
        vehicle_type  — optional
        is_blacklisted — optional (0/1 or true/false)
        is_watchlisted — optional (0/1 or true/false)
        watchlist_reason — optional

    Set update_existing=true to overwrite records for plates already in the DB.
    Duplicate plates within the same CSV are silently deduplicated (last row wins).
    """
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")   # utf-8-sig strips BOM from Excel exports
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))

    def _bool(val: str) -> bool:
        return str(val).strip().lower() in ("1", "true", "yes", "y")

    rows: dict[str, dict] = {}
    parse_errors: list[str] = []

    for i, row in enumerate(reader, start=2):   # start=2 because row 1 is the header
        plate = row.get("plate_number", "").strip().upper()
        if not plate:
            parse_errors.append(f"Row {i}: missing plate_number — skipped")
            continue
        rows[plate] = {
            "plate_number":   plate,
            "owner_name":     row.get("owner_name", "").strip() or None,
            "vehicle_type":   row.get("vehicle_type", "").strip() or None,
            "is_blacklisted": _bool(row.get("is_blacklisted", "0")),
            "is_watchlisted": _bool(row.get("is_watchlisted", "0")),
            "watchlist_reason": row.get("watchlist_reason", "").strip() or None,
        }

    if not rows and not parse_errors:
        raise HTTPException(status_code=400, detail="CSV is empty or has no valid plate_number column")

    db = SessionLocal()
    added = updated = skipped = 0
    try:
        for plate, data in rows.items():
            existing = db.query(Vehicle).filter(Vehicle.plate_number == plate).first()
            if existing:
                if update_existing:
                    existing.owner_name      = data["owner_name"]      or existing.owner_name
                    existing.vehicle_type    = data["vehicle_type"]    or existing.vehicle_type
                    existing.is_blacklisted  = data["is_blacklisted"]
                    existing.is_watchlisted  = data["is_watchlisted"]
                    existing.watchlist_reason = data["watchlist_reason"] or existing.watchlist_reason
                    if data["is_blacklisted"]:
                        existing.is_authorized = False
                    updated += 1
                else:
                    skipped += 1
            else:
                v = Vehicle(
                    plate_number   = plate,
                    owner_name     = data["owner_name"],
                    vehicle_type   = data["vehicle_type"],
                    is_blacklisted = data["is_blacklisted"],
                    is_watchlisted = data["is_watchlisted"],
                    watchlist_reason = data["watchlist_reason"],
                    is_authorized  = not data["is_blacklisted"],
                )
                db.add(v)
                added += 1
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"DB error: {exc}")
    finally:
        db.close()

    try:
        from backend.app.services.audit_service import log_action
        log_action(
            action="VEHICLE_CSV_IMPORT",
            username=current_user.get("sub"),
            resource_type="vehicle",
            details={"added": added, "updated": updated, "skipped": skipped, "parse_errors": len(parse_errors)},
        )
    except Exception:
        pass

    logger.info("CSV import: added=%d updated=%d skipped=%d parse_errors=%d by %s",
                added, updated, skipped, len(parse_errors), current_user.get("sub"))

    return {
        "success": True,
        "added":        added,
        "updated":      updated,
        "skipped":      skipped,
        "parse_errors": parse_errors,
        "total_in_file": len(rows),
    }
