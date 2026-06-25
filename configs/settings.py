from dataclasses import dataclass


@dataclass
class Settings:

    USE_GPU = False

    YOLO_MODEL_PATH = "license_plate_detector.pt"

    YOLO_CONFIDENCE_THRESHOLD = 0.25


settings = Settings()