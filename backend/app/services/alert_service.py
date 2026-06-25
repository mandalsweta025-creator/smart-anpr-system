

"""
Alert Service
=============
Handles blacklisted vehicle detection and alert generation.
"""

from backend.app.models.detections import Detection
from backend.app.models.vehicle import Vehicle
from backend.app.database.connection import SessionLocal


class AlertService:
    """
    Handles ANPR alert logic.
    """

    def check_blacklist(self, plate: str):
        """
        Query the vehicles table to check if the plate is blacklisted.
        Falls back to False if the plate is not in the vehicles table at all.
        """
        if not plate:
            return None

        normalized = plate.strip().replace(" ", "").upper()

        db = SessionLocal()
        try:
            vehicle = (
                db.query(Vehicle)
                .filter(
                    Vehicle.plate_number == normalized,
                    Vehicle.is_blacklisted == True,  # noqa: E712
                )
                .first()
            )
        finally:
            db.close()

        if vehicle:
            return {
                "alert": True,
                "plate": normalized,
                "reason": "Blacklisted vehicle",
                "priority": "HIGH",
            }

        return {"alert": False, "plate": normalized}

    def generate_vehicle_alert(
        self,
        vehicle,
    ):

        if not vehicle:

            return {
                "alert": True,
                "level": "INFO",
                "message": (
                    "Unknown vehicle detected"
                ),
            }

        if vehicle.is_blacklisted:

            return {
                "alert": True,
                "level": "CRITICAL",
                "message": (
                    "Blacklisted vehicle detected"
                ),
            }

        if not vehicle.is_authorized:

            return {
                "alert": True,
                "level": "WARNING",
                "message": (
                    "Unauthorized vehicle"
                ),
            }

        return {
            "alert": False,
            "level": "NORMAL",
            "message": (
                "Authorized vehicle"
            ),
        }

    def process_detection_alert(
        self,
        detection: Detection,
    ):
        """
        Processes a saved detection for alert generation.
        """

        if not detection:
            return None

        return self.check_blacklist(
            detection.plate_number
        )


# ==========================================
# GLOBAL ALERT SERVICE INSTANCE
# ==========================================

alert_service = AlertService()