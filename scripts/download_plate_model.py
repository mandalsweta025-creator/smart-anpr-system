"""
Download a YOLOv8 license-plate detection model for the ANPR system.

Usage:
    venv/bin/python3 scripts/download_plate_model.py

The script tries several HuggingFace repos in order.  If all fail (e.g. no
internet or the repo requires auth) it prints manual download instructions.

The downloaded weights are saved to:
    models/weights/yolov8n_plate.pt

Once the file exists, the ANPR pipeline uses it automatically as Stage 1
(replacing contour detection).  No restart needed if the backend is run with
--reload; otherwise restart the backend after downloading.
"""

import sys
import shutil
from pathlib import Path

DEST = Path(__file__).resolve().parents[1] / "backend" / "models" / "weights" / "yolov8n_plate.pt"

CANDIDATES = [
    ("Koushim/yolov8-license-plate-detection",        "best.pt"),
    ("yasirfaizahmed/license-plate-object-detection",  "best.pt"),
    ("morsetechlab/yolov11-license-plate-detection",   "license-plate-finetune-v1n.pt"),
]


def try_huggingface():
    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        print("huggingface_hub not installed — skipping HF download")
        return False

    DEST.parent.mkdir(parents=True, exist_ok=True)
    for repo_id, filename in CANDIDATES:
        try:
            print(f"Trying {repo_id} …", end=" ", flush=True)
            downloaded = hf_hub_download(
                repo_id=repo_id,
                filename=filename,
                local_dir=str(DEST.parent),
            )
            if Path(downloaded) != DEST:
                shutil.copy2(downloaded, str(DEST))
            print("OK")
            return True
        except Exception as exc:
            print(f"FAILED ({exc})")
    return False


def print_manual_instructions():
    print("\n" + "=" * 60)
    print("Automatic download failed.  Manual options:")
    print("=" * 60)
    print()
    print("Option 1 — Roboflow Universe (free account required):")
    print("  1. Sign up at https://roboflow.com")
    print("  2. Search for 'license plate detection yolov8'")
    print("  3. Export as 'YOLOv8 PyTorch' and download best.pt")
    print(f"  4. Place it at: {DEST}")
    print()
    print("Option 2 — GitHub community weights:")
    print("  Search GitHub for 'yolov8 license plate detection best.pt'")
    print("  Many repos include pre-trained weights in their releases.")
    print(f"  Rename the downloaded file to: {DEST.name}")
    print(f"  Place it at: {DEST}")
    print()
    print("Option 3 — Train your own:")
    print("  Use Roboflow or any labeled dataset with ultralytics:")
    print("    pip install ultralytics")
    print("    yolo train model=yolov8n.pt data=<your_data.yaml>")
    print(f"  Copy runs/detect/train/weights/best.pt → {DEST}")
    print()
    print("Until the model file exists, the system falls back to contour")
    print("detection automatically — no code changes needed.")


def main():
    if DEST.exists():
        print(f"Model already present: {DEST}")
        print("Delete it and re-run this script to re-download.")
        sys.exit(0)

    print(f"Destination: {DEST}")
    print()

    if try_huggingface():
        print(f"\nModel saved to: {DEST}")
        print("Restart the backend to load the new model.")
    else:
        print_manual_instructions()
        sys.exit(1)


if __name__ == "__main__":
    main()
