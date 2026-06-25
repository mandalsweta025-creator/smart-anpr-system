from database.crud import get_all_detections


detections = get_all_detections()

print("\n===== ALL DETECTIONS =====\n")

for detection in detections:

    print(f"ID: {detection.id}")

    print(f"Plate: {detection.plate_text}")

    print(f"Confidence: {detection.confidence}")

    print(f"Image: {detection.image_path}")

    print(f"Timestamp: {detection.timestamp}")

    print("-" * 40)