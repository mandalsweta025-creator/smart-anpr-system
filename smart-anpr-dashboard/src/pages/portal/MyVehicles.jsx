import { useState, useCallback, useEffect } from "react";
import { authFetch, API } from "../../store/dashboardStore";

const VEHICLE_TYPES = ["Car", "SUV", "Truck", "Bus", "Motorcycle", "Van", "Jeep", "Other"];

function VehicleCard({ v, onDelete, onEdit }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting,   setDeleting]   = useState(false);

  const handleDelete = async () => {
    if (!confirming) { setConfirming(true); return; }
    setDeleting(true);
    try {
      await authFetch(`${API}/me/vehicles/${encodeURIComponent(v.plate_number)}`, { method: "DELETE" });
      onDelete(v.plate_number);
    } catch {
      setConfirming(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mvc-card">
      <div className="mvc-card-header">
        <div className="mvc-plate">{v.plate_number}</div>
        <div className="mvc-actions">
          <button className="portal-btn-outline mvc-edit-btn" onClick={() => onEdit(v)} title="Edit">✎</button>
          <button
            className={`mvc-del-btn${confirming ? " confirming" : ""}`}
            onClick={handleDelete} disabled={deleting}
            title={confirming ? "Click again to confirm" : "Remove vehicle"}>
            {deleting ? "…" : confirming ? "Confirm?" : "✕"}
          </button>
        </div>
      </div>

      <div className="mvc-details">
        {v.vehicle_type && (
          <div className="mvc-detail-row">
            <span className="mvc-detail-label">Type</span>
            <span className="mvc-detail-value">{v.vehicle_type}</span>
          </div>
        )}
        {v.owner_name && (
          <div className="mvc-detail-row">
            <span className="mvc-detail-label">Owner</span>
            <span className="mvc-detail-value">{v.owner_name}</span>
          </div>
        )}
        {v.phone_number && (
          <div className="mvc-detail-row">
            <span className="mvc-detail-label">Phone</span>
            <span className="mvc-detail-value">{v.phone_number}</span>
          </div>
        )}
        {v.registration_date && (
          <div className="mvc-detail-row">
            <span className="mvc-detail-label">Reg. Date</span>
            <span className="mvc-detail-value">
              {new Date(v.registration_date).toLocaleDateString("en-IN")}
            </span>
          </div>
        )}
        <div className="mvc-detail-row">
          <span className="mvc-detail-label">Added</span>
          <span className="mvc-detail-value">
            {new Date(v.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
        </div>
      </div>
    </div>
  );
}

function VehicleForm({ initial, onSave, onCancel }) {
  const [form, setForm]   = useState(
    initial ?? { plate_number: "", owner_name: "", phone_number: "", vehicle_type: "", registration_date: "" }
  );
  const [saving, setSaving]   = useState(false);
  const [error,  setError]    = useState("");
  const isEdit = Boolean(initial);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.plate_number.trim()) { setError("Plate number is required"); return; }
    setSaving(true); setError("");
    try {
      const body = {
        plate_number:      form.plate_number.trim().toUpperCase(),
        owner_name:        form.owner_name || null,
        phone_number:      form.phone_number || null,
        vehicle_type:      form.vehicle_type || null,
        registration_date: form.registration_date || null,
      };
      const url    = isEdit ? `${API}/me/vehicles/${encodeURIComponent(initial.plate_number)}` : `${API}/me/vehicles`;
      const method = isEdit ? "PUT" : "POST";
      const res = await authFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Failed to save vehicle");
      onSave();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mvc-form-overlay">
      <div className="mvc-form-card">
        <div className="mvc-form-header">
          <h3 className="mvc-form-title">{isEdit ? "Edit Vehicle" : "Register New Vehicle"}</h3>
          <button className="mvc-form-close" onClick={onCancel}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="mvc-form">
          <div className="mvc-form-row">
            <label className="mvc-label">PLATE NUMBER *</label>
            <input className="mvc-input" type="text"
              value={form.plate_number} onChange={set("plate_number")}
              placeholder="e.g. MH20DV2363" required
              disabled={isEdit}
              style={{ textTransform: "uppercase" }}
            />
          </div>

          <div className="mvc-form-row">
            <label className="mvc-label">VEHICLE TYPE</label>
            <select className="mvc-input mvc-select" value={form.vehicle_type} onChange={set("vehicle_type")}>
              <option value="">Select type…</option>
              {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="mvc-form-row">
            <label className="mvc-label">OWNER NAME</label>
            <input className="mvc-input" type="text"
              value={form.owner_name} onChange={set("owner_name")}
              placeholder="Full name as on RC" />
          </div>

          <div className="mvc-form-row">
            <label className="mvc-label">PHONE NUMBER</label>
            <input className="mvc-input" type="tel"
              value={form.phone_number} onChange={set("phone_number")}
              placeholder="+91 98765 43210" />
          </div>

          <div className="mvc-form-row">
            <label className="mvc-label">REGISTRATION DATE</label>
            <input className="mvc-input" type="date"
              value={form.registration_date} onChange={set("registration_date")} />
          </div>

          {error && <div className="portal-error-inline">⚠ {error}</div>}

          <div className="mvc-form-actions">
            <button type="button" className="portal-btn-outline" onClick={onCancel}>Cancel</button>
            <button type="submit" className="portal-btn-primary" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Register Vehicle"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function MyVehicles() {
  const [vehicles, setVehicles] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editVehicle, setEditVehicle] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API}/me/vehicles`);
      setVehicles(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = () => {
    setShowForm(false);
    setEditVehicle(null);
    load();
  };

  const handleDelete = (plate) => {
    setVehicles(vs => vs.filter(v => v.plate_number !== plate));
  };

  const handleEdit = (v) => {
    setEditVehicle({
      ...v,
      registration_date: v.registration_date ? v.registration_date.split("T")[0] : "",
    });
    setShowForm(true);
  };

  return (
    <div className="portal-page">
      <div className="portal-page-header">
        <div>
          <h1 className="portal-page-title">My Vehicles</h1>
          <p className="portal-page-sub">Manage your registered vehicle plate numbers</p>
        </div>
        <button className="portal-btn-primary" onClick={() => { setEditVehicle(null); setShowForm(true); }}>
          + Register Vehicle
        </button>
      </div>

      {(showForm || editVehicle) && (
        <VehicleForm
          initial={editVehicle}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditVehicle(null); }}
        />
      )}

      {loading ? (
        <div className="portal-loading"><div className="portal-spinner"/><div>Loading vehicles…</div></div>
      ) : vehicles.length === 0 ? (
        <div className="portal-empty">
          <div className="portal-empty-icon">🚗</div>
          <div className="portal-empty-text">No vehicles registered yet</div>
          <p className="portal-empty-hint">
            Register your vehicle plate number to start tracking entry/exit history.
          </p>
          <button className="portal-btn-primary" style={{ marginTop: 16 }}
            onClick={() => setShowForm(true)}>Register your first vehicle</button>
        </div>
      ) : (
        <>
          <div className="mvc-summary">
            {vehicles.length} vehicle{vehicles.length !== 1 ? "s" : ""} registered
          </div>
          <div className="mvc-grid">
            {vehicles.map(v => (
              <VehicleCard key={v.plate_number} v={v}
                onDelete={handleDelete} onEdit={handleEdit} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
