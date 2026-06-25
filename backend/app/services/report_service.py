"""
Report generation service — PDF (fpdf2) and XLSX (openpyxl/pandas).

Three report types:
  traffic_summary  — hourly detection chart, KPIs, top plates, session stats
  anomaly_log      — anomaly table by severity, type breakdown, resolution stats
  session_export   — raw sessions as XLSX (also supports PDF summary)

Call build_report(type, format, from_dt, to_dt) → Path to the generated file.
"""

from __future__ import annotations

import io
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from backend.app.core.config import REPORTS_DIR
from backend.app.database.connection import SessionLocal
from backend.app.models.detections import Detection
from backend.app.models.vehicle_sessions import VehicleSession
from backend.app.models.anomaly import AnomalyEvent


# ── Palette (dark-theme accent colours translated to print-friendly tones) ───

_CYAN   = (0,   180, 216)
_AMBER  = (255, 176,  0)
_RED    = (220,  53, 69)
_GREEN  = (40,  167, 69)
_DARK   = (30,   30, 40)
_LIGHT  = (245, 245, 250)
_MID    = (100, 110, 130)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _fmt(dt: Optional[datetime]) -> str:
    if dt is None:
        return "—"
    return dt.strftime("%Y-%m-%d %H:%M")


# ══════════════════════════════════════════════════════════════
#  PDF HELPERS
# ══════════════════════════════════════════════════════════════

def _make_pdf():
    from fpdf import FPDF

    class _PDF(FPDF):
        def header(self):
            self.set_font("Helvetica", "B", 9)
            self.set_text_color(*_MID)
            self.cell(0, 6, "SMART ANPR SYSTEM  ·  CONFIDENTIAL", align="R")
            self.ln(8)

        def footer(self):
            self.set_y(-12)
            self.set_font("Helvetica", "", 7)
            self.set_text_color(*_MID)
            self.cell(0, 5, f"Page {self.page_no()}", align="C")

    pdf = _PDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.set_margins(14, 14, 14)
    return pdf


def _pdf_title(pdf, title: str, subtitle: str = ""):
    pdf.add_page()
    pdf.set_fill_color(*_DARK)
    pdf.rect(0, 0, 210, 34, "F")
    pdf.set_y(8)
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(*_CYAN)
    pdf.cell(0, 10, title, align="C")
    pdf.ln(8)
    if subtitle:
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(*_LIGHT)
        pdf.cell(0, 6, subtitle, align="C")
    pdf.set_y(40)
    pdf.set_text_color(0, 0, 0)


def _pdf_section(pdf, heading: str):
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(*_CYAN)
    pdf.cell(0, 7, heading)
    pdf.ln(1)
    pdf.set_draw_color(*_CYAN)
    pdf.set_line_width(0.4)
    pdf.line(14, pdf.get_y(), 196, pdf.get_y())
    pdf.ln(4)
    pdf.set_text_color(0, 0, 0)


def _pdf_kpi_row(pdf, kpis: list[tuple[str, str]]):
    """Render a row of KPI boxes across the page."""
    n = len(kpis)
    w = 182 / n
    for label, value in kpis:
        x, y = pdf.get_x(), pdf.get_y()
        pdf.set_fill_color(240, 242, 248)
        pdf.rect(x, y, w - 2, 18, "F")
        pdf.set_xy(x + 1, y + 2)
        pdf.set_font("Helvetica", "", 7)
        pdf.set_text_color(*_MID)
        pdf.cell(w - 4, 5, label.upper())
        pdf.set_xy(x + 1, y + 8)
        pdf.set_font("Helvetica", "B", 13)
        pdf.set_text_color(*_DARK)
        pdf.cell(w - 4, 8, str(value))
        pdf.set_xy(x + w, y)
    pdf.ln(22)
    pdf.set_text_color(0, 0, 0)


def _pdf_table(pdf, headers: list[str], rows: list[list[str]], col_widths: Optional[list[float]] = None):
    if col_widths is None:
        col_widths = [182 / len(headers)] * len(headers)

    pdf.set_font("Helvetica", "B", 8)
    pdf.set_fill_color(*_DARK)
    pdf.set_text_color(*_CYAN)
    for h, w in zip(headers, col_widths):
        pdf.cell(w, 6, h, border=0, fill=True, align="C")
    pdf.ln()

    pdf.set_font("Helvetica", "", 8)
    for i, row in enumerate(rows):
        pdf.set_fill_color(245, 246, 250) if i % 2 == 0 else pdf.set_fill_color(255, 255, 255)
        pdf.set_text_color(30, 30, 40)
        for cell, w in zip(row, col_widths):
            pdf.cell(w, 5.5, str(cell)[:40], border=0, fill=True)
        pdf.ln()
    pdf.set_text_color(0, 0, 0)
    pdf.ln(2)


# ══════════════════════════════════════════════════════════════
#  TRAFFIC SUMMARY  (PDF)
# ══════════════════════════════════════════════════════════════

def _traffic_summary_pdf(from_dt: datetime, to_dt: datetime) -> Path:
    db = SessionLocal()
    try:
        detections = (
            db.query(Detection)
            .filter(Detection.timestamp >= from_dt, Detection.timestamp <= to_dt)
            .all()
        )
        sessions = (
            db.query(VehicleSession)
            .filter(VehicleSession.entry_time >= from_dt, VehicleSession.entry_time <= to_dt)
            .all()
        )

        total_det = len(detections)
        total_ses = len(sessions)
        exited = [s for s in sessions if s.status == "EXITED" and s.duration_minutes]
        avg_dwell = round(sum(s.duration_minutes for s in exited) / len(exited), 1) if exited else 0

        # hourly bucket (hour 0-23)
        hourly: dict[int, int] = {h: 0 for h in range(24)}
        for d in detections:
            hourly[d.timestamp.hour] = hourly.get(d.timestamp.hour, 0) + 1

        # top 10 plates
        plate_counts: dict[str, int] = {}
        for d in detections:
            plate_counts[d.plate_number] = plate_counts.get(d.plate_number, 0) + 1
        top_plates = sorted(plate_counts.items(), key=lambda x: x[1], reverse=True)[:10]

    finally:
        db.close()

    pdf = _make_pdf()
    _pdf_title(
        pdf, "TRAFFIC SUMMARY REPORT",
        f"{_fmt(from_dt)}  →  {_fmt(to_dt)}"
    )

    _pdf_section(pdf, "KEY PERFORMANCE INDICATORS")
    _pdf_kpi_row(pdf, [
        ("Total Detections", str(total_det)),
        ("Sessions", str(total_ses)),
        ("Completed Sessions", str(len(exited))),
        ("Avg Dwell (min)", str(avg_dwell)),
    ])

    _pdf_section(pdf, "DETECTIONS BY HOUR")
    bar_data = [(f"{h:02d}h", hourly[h]) for h in range(24)]
    max_h = max(hourly.values(), default=1) or 1
    bar_w = 182 / 24
    y0 = pdf.get_y()
    pdf.set_font("Helvetica", "", 6)
    pdf.set_text_color(*_MID)
    for i, (label, cnt) in enumerate(bar_data):
        x = 14 + i * bar_w
        bar_h = max(1, (cnt / max_h) * 28)
        pdf.set_fill_color(*_CYAN)
        pdf.rect(x, y0 + 30 - bar_h, bar_w - 0.5, bar_h, "F")
        pdf.set_xy(x, y0 + 30)
        pdf.cell(bar_w, 4, label, align="C")
    pdf.ln(38)

    _pdf_section(pdf, "TOP 10 PLATES")
    if top_plates:
        _pdf_table(
            pdf,
            ["Rank", "Plate Number", "Detection Count"],
            [[str(i+1), p, str(c)] for i, (p, c) in enumerate(top_plates)],
            col_widths=[20, 100, 62],
        )
    else:
        pdf.set_font("Helvetica", "I", 9)
        pdf.cell(0, 6, "No detections in this period.")
        pdf.ln()

    _pdf_section(pdf, "SESSION STATISTICS")
    _pdf_table(
        pdf,
        ["Metric", "Value"],
        [
            ["Total Sessions", str(total_ses)],
            ["Completed (EXITED)", str(len(exited))],
            ["Average Dwell Time", f"{avg_dwell} min"],
            ["Max Dwell Time", f"{max((s.duration_minutes for s in exited), default=0):.1f} min"],
        ],
        col_widths=[100, 82],
    )

    pdf.set_font("Helvetica", "I", 7)
    pdf.set_text_color(*_MID)
    pdf.cell(0, 5, f"Generated: {_fmt(_utcnow())}  ·  Smart ANPR System", align="R")

    out = REPORTS_DIR / f"traffic_summary_{from_dt.strftime('%Y%m%d')}_{to_dt.strftime('%Y%m%d')}.pdf"
    pdf.output(str(out))
    return out


# ══════════════════════════════════════════════════════════════
#  ANOMALY LOG  (PDF)
# ══════════════════════════════════════════════════════════════

def _anomaly_log_pdf(from_dt: datetime, to_dt: datetime) -> Path:
    db = SessionLocal()
    try:
        events = (
            db.query(AnomalyEvent)
            .filter(AnomalyEvent.created_at >= from_dt, AnomalyEvent.created_at <= to_dt)
            .order_by(AnomalyEvent.created_at.desc())
            .all()
        )
    finally:
        db.close()

    severity_counts: dict[str, int] = {}
    type_counts: dict[str, int] = {}
    resolved = sum(1 for e in events if e.status == "RESOLVED")
    for e in events:
        severity_counts[e.severity] = severity_counts.get(e.severity, 0) + 1
        type_counts[e.anomaly_type] = type_counts.get(e.anomaly_type, 0) + 1

    pdf = _make_pdf()
    _pdf_title(
        pdf, "ANOMALY LOG REPORT",
        f"{_fmt(from_dt)}  →  {_fmt(to_dt)}"
    )

    _pdf_section(pdf, "SUMMARY")
    _pdf_kpi_row(pdf, [
        ("Total Anomalies", str(len(events))),
        ("CRITICAL", str(severity_counts.get("CRITICAL", 0))),
        ("HIGH", str(severity_counts.get("HIGH", 0))),
        ("Resolved", str(resolved)),
    ])

    _pdf_section(pdf, "BREAKDOWN BY TYPE")
    if type_counts:
        _pdf_table(
            pdf,
            ["Anomaly Type", "Count"],
            [[t, str(c)] for t, c in sorted(type_counts.items(), key=lambda x: x[1], reverse=True)],
            col_widths=[130, 52],
        )
    else:
        pdf.set_font("Helvetica", "I", 9)
        pdf.cell(0, 6, "No anomalies in this period.")
        pdf.ln()

    _pdf_section(pdf, "ANOMALY EVENTS")
    if events:
        _pdf_table(
            pdf,
            ["Date/Time", "Type", "Severity", "Plate", "Status"],
            [
                [
                    _fmt(e.created_at),
                    e.anomaly_type[:22],
                    e.severity,
                    e.plate_number or "—",
                    e.status,
                ]
                for e in events[:100]
            ],
            col_widths=[38, 56, 22, 36, 30],
        )
        if len(events) > 100:
            pdf.set_font("Helvetica", "I", 8)
            pdf.cell(0, 5, f"… and {len(events) - 100} more events (truncated to 100 rows).")
            pdf.ln()

    pdf.set_font("Helvetica", "I", 7)
    pdf.set_text_color(*_MID)
    pdf.cell(0, 5, f"Generated: {_fmt(_utcnow())}  ·  Smart ANPR System", align="R")

    out = REPORTS_DIR / f"anomaly_log_{from_dt.strftime('%Y%m%d')}_{to_dt.strftime('%Y%m%d')}.pdf"
    pdf.output(str(out))
    return out


# ══════════════════════════════════════════════════════════════
#  SESSION EXPORT  (XLSX)
# ══════════════════════════════════════════════════════════════

def _session_export_xlsx(from_dt: datetime, to_dt: datetime) -> Path:
    import pandas as pd

    db = SessionLocal()
    try:
        rows = (
            db.query(VehicleSession)
            .filter(VehicleSession.entry_time >= from_dt, VehicleSession.entry_time <= to_dt)
            .order_by(VehicleSession.entry_time.desc())
            .all()
        )
        data = [
            {
                "Session ID":       s.id,
                "Plate Number":     s.plate_number,
                "Entry Time":       _fmt(s.entry_time),
                "Exit Time":        _fmt(s.exit_time),
                "Duration (min)":   round(s.duration_minutes, 1) if s.duration_minutes else "",
                "Status":           s.status,
                "Entry Camera":     s.camera_id or "",
                "Exit Camera":      s.exit_camera_id or "",
            }
            for s in rows
        ]
    finally:
        db.close()

    out = REPORTS_DIR / f"session_export_{from_dt.strftime('%Y%m%d')}_{to_dt.strftime('%Y%m%d')}.xlsx"

    df = pd.DataFrame(data) if data else pd.DataFrame(columns=[
        "Session ID", "Plate Number", "Entry Time", "Exit Time",
        "Duration (min)", "Status", "Entry Camera", "Exit Camera",
    ])

    with pd.ExcelWriter(str(out), engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Sessions")
        ws = writer.sheets["Sessions"]
        # Auto-fit column widths
        for col in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in col)
            ws.column_dimensions[col[0].column_letter].width = min(max_len + 4, 40)

    return out


# ══════════════════════════════════════════════════════════════
#  SESSION SUMMARY  (PDF — alternate format for session_export)
# ══════════════════════════════════════════════════════════════

def _session_export_pdf(from_dt: datetime, to_dt: datetime) -> Path:
    db = SessionLocal()
    try:
        rows = (
            db.query(VehicleSession)
            .filter(VehicleSession.entry_time >= from_dt, VehicleSession.entry_time <= to_dt)
            .order_by(VehicleSession.entry_time.desc())
            .all()
        )
    finally:
        db.close()

    pdf = _make_pdf()
    _pdf_title(
        pdf, "SESSION EXPORT REPORT",
        f"{_fmt(from_dt)}  →  {_fmt(to_dt)}"
    )

    _pdf_section(pdf, "OVERVIEW")
    exited = [r for r in rows if r.status == "EXITED" and r.duration_minutes]
    avg_d = round(sum(s.duration_minutes for s in exited) / len(exited), 1) if exited else 0
    _pdf_kpi_row(pdf, [
        ("Total Sessions", str(len(rows))),
        ("Completed", str(len(exited))),
        ("Avg Dwell (min)", str(avg_d)),
    ])

    _pdf_section(pdf, "SESSIONS (most recent first, max 200)")
    display = rows[:200]
    if display:
        _pdf_table(
            pdf,
            ["Plate", "Entry", "Exit", "Dur (min)", "Status"],
            [
                [
                    r.plate_number,
                    _fmt(r.entry_time),
                    _fmt(r.exit_time),
                    str(round(r.duration_minutes, 1)) if r.duration_minutes else "—",
                    r.status,
                ]
                for r in display
            ],
            col_widths=[36, 42, 42, 24, 38],
        )

    pdf.set_font("Helvetica", "I", 7)
    pdf.set_text_color(*_MID)
    pdf.cell(0, 5, f"Generated: {_fmt(_utcnow())}  ·  Smart ANPR System", align="R")

    out = REPORTS_DIR / f"session_export_{from_dt.strftime('%Y%m%d')}_{to_dt.strftime('%Y%m%d')}.pdf"
    pdf.output(str(out))
    return out


# ══════════════════════════════════════════════════════════════
#  PORTAL: PERSONAL MONTHLY REPORT  (PDF)
# ══════════════════════════════════════════════════════════════

def build_personal_monthly_pdf(username: str, plates: list[str]) -> Path:
    """Generate a personal monthly visit report for a portal user."""
    from datetime import timedelta
    from sqlalchemy import func

    now = _utcnow()
    from_dt = (now.replace(day=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    to_dt = now

    db = SessionLocal()
    try:
        if not plates:
            sessions = []
            detections = []
        else:
            sessions = (
                db.query(VehicleSession)
                .filter(
                    VehicleSession.plate_number.in_(plates),
                    VehicleSession.entry_time >= from_dt,
                )
                .order_by(VehicleSession.entry_time.desc())
                .all()
            )
            detections = (
                db.query(Detection)
                .filter(
                    Detection.plate_number.in_(plates),
                    Detection.timestamp >= from_dt,
                )
                .all()
            )
    finally:
        db.close()

    exited = [s for s in sessions if s.status == "EXITED" and s.duration_minutes]
    avg_dwell = round(sum(s.duration_minutes for s in exited) / len(exited), 1) if exited else 0

    # Daily visit counts for the month
    daily: dict[str, int] = {}
    for s in sessions:
        key = s.entry_time.strftime("%Y-%m-%d")
        daily[key] = daily.get(key, 0) + 1

    pdf = _make_pdf()
    _pdf_title(
        pdf, f"PERSONAL VISIT REPORT",
        f"Account: {username}  ·  Month: {from_dt.strftime('%B %Y')}"
    )

    _pdf_section(pdf, "THIS MONTH AT A GLANCE")
    _pdf_kpi_row(pdf, [
        ("Registered Plates", str(len(plates))),
        ("Total Visits", str(len(sessions))),
        ("Completed Visits", str(len(exited))),
        ("Avg Dwell (min)", str(avg_dwell)),
    ])

    _pdf_section(pdf, "REGISTERED PLATES")
    _pdf_table(pdf, ["Plate Number"], [[p] for p in plates], col_widths=[182])

    _pdf_section(pdf, "VISIT HISTORY")
    if sessions:
        _pdf_table(
            pdf,
            ["Plate", "Entry", "Exit", "Duration (min)", "Status"],
            [
                [
                    s.plate_number,
                    _fmt(s.entry_time),
                    _fmt(s.exit_time),
                    str(round(s.duration_minutes, 1)) if s.duration_minutes else "—",
                    s.status,
                ]
                for s in sessions[:100]
            ],
            col_widths=[40, 42, 42, 30, 28],
        )
        if len(sessions) > 100:
            pdf.set_font("Helvetica", "I", 8)
            pdf.cell(0, 5, f"… and {len(sessions) - 100} more visits (truncated to 100).")
            pdf.ln()
    else:
        pdf.set_font("Helvetica", "I", 9)
        pdf.cell(0, 6, "No visits recorded this month.")
        pdf.ln()

    pdf.set_font("Helvetica", "I", 7)
    pdf.set_text_color(*_MID)
    pdf.cell(0, 5, f"Generated: {_fmt(_utcnow())}  ·  Smart ANPR System", align="R")

    out = REPORTS_DIR / f"personal_{username}_{from_dt.strftime('%Y%m')}.pdf"
    pdf.output(str(out))
    return out


# ══════════════════════════════════════════════════════════════
#  PUBLIC ENTRY POINT
# ══════════════════════════════════════════════════════════════

def build_report(
    report_type: str,
    fmt: str,
    from_dt: datetime,
    to_dt: datetime,
) -> Path:
    """
    Build a report and return the path to the generated file.

    report_type: "traffic_summary" | "anomaly_log" | "session_export"
    fmt:         "pdf" | "xlsx"
    """
    if report_type == "traffic_summary":
        return _traffic_summary_pdf(from_dt, to_dt)

    if report_type == "anomaly_log":
        return _anomaly_log_pdf(from_dt, to_dt)

    if report_type == "session_export":
        if fmt == "xlsx":
            return _session_export_xlsx(from_dt, to_dt)
        return _session_export_pdf(from_dt, to_dt)

    raise ValueError(f"Unknown report type: {report_type}")
