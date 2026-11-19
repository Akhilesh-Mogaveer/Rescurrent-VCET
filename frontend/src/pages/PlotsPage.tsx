import React, { useEffect, useState } from 'react';
import { MapContainer, useMapEvents } from 'react-leaflet';
import { useApp } from '../context/AppContext';
import { apiRequest } from '../services/api';
import type { CrewItem, PlotItem } from '../types';
import {
  EmptyState,
  InlineError,
  SkeletonBlock,
  useDelayedLoading,
  useLoadTimeout,
} from '../components/Skeleton';

const MapClickSelector: React.FC<{ onPick: (lat: number, lon: number) => void }> = ({ onPick }) => {
  useMapEvents({
    click(e) {
      onPick(Number(e.latlng.lat.toFixed(5)), Number(e.latlng.lng.toFixed(5)));
    },
  });
  return null;
};

export const PlotsPage: React.FC = () => {
  const { pushToast } = useApp();
  const [plots, setPlots] = useState<PlotItem[]>([]);
  const [crews, setCrews] = useState<CrewItem[]>([]);
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  const showSkeleton = useDelayedLoading(loading);
  useLoadTimeout(loading, () => setTimedOut(true), 20000);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlot, setEditingPlot] = useState<PlotItem | null>(null);
  const [form, setForm] = useState({
    code: 'P-015',
    farm_name: 'Tunga Valley Arecanut Estate',
    name: '',
    lat: 13.692,
    lon: 75.242,
    area_acres: 2.0,
    priority: 'medium',
    status: 'pending',
    drainage: 'moderate',
    canopy_density: 0.65,
    protection_state: 0.25,
    inspection_required: false,
    assigned_crew_id: '' as string | number,
    notes: '',
  });

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    setTimedOut(false);
    try {
      const q = new URLSearchParams();
      if (search) q.set('search', search);
      if (priorityFilter) q.set('priority', priorityFilter);
      if (statusFilter) q.set('status', statusFilter);
      const [pList, cList] = await Promise.all([
        apiRequest<PlotItem[]>(`/plots?${q.toString()}`),
        apiRequest<CrewItem[]>('/crews'),
      ]);
      setPlots(pList);
      setCrews(cList);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load plots');
      pushToast('Load Failed', err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [search, priorityFilter, statusFilter]);

  const openAddModal = () => {
    setEditingPlot(null);
    setForm({
      code: `P-0${plots.length + 15}`,
      farm_name: 'Tunga Valley Arecanut Estate',
      name: '',
      lat: 13.692,
      lon: 75.242,
      area_acres: 2.0,
      priority: 'medium',
      status: 'pending',
      drainage: 'moderate',
      canopy_density: 0.65,
      protection_state: 0.25,
      inspection_required: false,
      assigned_crew_id: '',
      notes: '',
    });
    setModalOpen(true);
  };

  const openEditModal = (p: PlotItem) => {
    setEditingPlot(p);
    setForm({
      code: p.code,
      farm_name: p.farm_name,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      area_acres: p.area_acres,
      priority: p.priority,
      status: p.status,
      drainage: p.drainage,
      canopy_density: p.canopy_density,
      protection_state: p.protection_state,
      inspection_required: p.inspection_required,
      assigned_crew_id: p.assigned_crew_id || '',
      notes: p.notes || '',
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        assigned_crew_id: form.assigned_crew_id ? Number(form.assigned_crew_id) : null,
      };
      if (editingPlot) {
        await apiRequest(`/plots/${editingPlot.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        pushToast('Plot Updated', `Updated plot ${editingPlot.code}`, 'success');
      } else {
        await apiRequest('/plots', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        pushToast('Plot Added', `Created plot ${form.code}`, 'success');
      }
      setModalOpen(false);
      await loadData();
    } catch (err: any) {
      pushToast('Save Failed', err.message, 'error');
    }
  };

  const handleDelete = async (p: PlotItem) => {
    try {
      await apiRequest(`/plots/${p.id}`, { method: 'DELETE' });
      pushToast('Plot Deleted', `Removed plot ${p.code}`, 'info');
      await loadData();
    } catch (err: any) {
      pushToast('Delete Failed', err.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[#17211C]">Farm & Plot Registry</h1>
          </div>
          <p className="text-xs text-stone-600 mt-1">
            Manage arecanut farm plots, drainage classes, canopy density, current protection state,
            and interactive map coordinates.
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="px-4 py-2.5 rounded-xl bg-[#0C1F17] hover:bg-emerald-950 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
        > Add Farm Plot
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by plot code, plot name, or farm..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-stone-300 text-xs"
          />
        </div>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-stone-300 text-xs bg-white"
        >
          <option value="">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-stone-300 text-xs bg-white"
        >
          <option value="">All Operational Statuses</option>
          <option value="pending">Pending</option>
          <option value="scheduled">Scheduled</option>
          <option value="protected">Protected</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Plots Table */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden">
        {timedOut || loadError ? (
          <div className="p-4">
            <InlineError
              target="farm plots registry"
              message={timedOut ? 'Request timed out after 20s. Could not load farm plots.' : undefined}
              onRetry={loadData}
            />
          </div>
        ) : showSkeleton || (loading && plots.length === 0) ? (
          <div aria-busy="true" className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200 text-stone-500 uppercase text-[10px]">
                  <th className="p-3.5">Plot ID</th>
                  <th className="p-3.5">Plot & Farm Name</th>
                  <th className="p-3.5">Area</th>
                  <th className="p-3.5">Priority</th>
                  <th className="p-3.5">Drainage / Canopy</th>
                  <th className="p-3.5">Protection P(0)</th>
                  <th className="p-3.5">Status / Crew</th>
                  <th className="p-3.5">Updated</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={idx}>
                    <td className="p-3.5"><SkeletonBlock height={14} width={50} /></td>
                    <td className="p-3.5">
                      <SkeletonBlock height={14} width={140} className="mb-1" />
                      <SkeletonBlock height={10} width={100} />
                    </td>
                    <td className="p-3.5"><SkeletonBlock height={14} width={40} /></td>
                    <td className="p-3.5"><SkeletonBlock height={18} width={60} radius={999} /></td>
                    <td className="p-3.5"><SkeletonBlock height={14} width={90} /></td>
                    <td className="p-3.5"><SkeletonBlock height={14} width={45} /></td>
                    <td className="p-3.5"><SkeletonBlock height={14} width={70} /></td>
                    <td className="p-3.5"><SkeletonBlock height={14} width={65} /></td>
                    <td className="p-3.5 text-right"><SkeletonBlock height={20} width={50} className="ml-auto" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : plots.length === 0 ? (
          <EmptyState
            message="No plots match the selected filters."
            actionLabel="Clear filters"
            onAction={() => {
              setSearch('');
              setPriorityFilter('');
              setStatusFilter('');
            }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200 text-stone-500 uppercase text-[10px]">
                  <th className="p-3.5">Plot ID</th>
                  <th className="p-3.5">Plot & Farm Name</th>
                  <th className="p-3.5">Area</th>
                  <th className="p-3.5">Priority</th>
                  <th className="p-3.5">Drainage / Canopy</th>
                  <th className="p-3.5">Protection P(0)</th>
                  <th className="p-3.5">Status / Crew</th>
                  <th className="p-3.5">Updated</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {plots.map((p) => (
                  <tr key={p.id} className="hover:bg-stone-50">
                    <td className="p-3.5 font-mono font-bold text-[#17211C]">
                      {p.code}
                    </td>
                    <td className="p-3.5">
                      <div className="font-bold text-[#17211C]">{p.name}</div>
                      <div className="text-[11px] text-stone-500">
                        {p.farm_name} · [{p.lat.toFixed(4)}, {p.lon.toFixed(4)}]
                      </div>
                    </td>
                    <td className="p-3.5 font-semibold">{p.area_acres} ac</td>
                    <td className="p-3.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          p.priority === 'urgent'
                            ? 'bg-red-100 text-red-800'
                            : p.priority === 'high'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-stone-100 text-stone-700'
                        }`}
                      >
                        {p.priority}
                      </span>
                    </td>
                    <td className="p-3.5 text-stone-600">
                      {p.drainage} · {(p.canopy_density * 100).toFixed(0)}% canopy
                    </td>
                    <td className="p-3.5 font-mono font-semibold text-emerald-800">
                      {(p.protection_state * 100).toFixed(0)}%
                    </td>
                    <td className="p-3.5">
                      <span className="uppercase font-semibold text-[11px] text-stone-700">
                        {p.status}
                      </span>
                      {p.assigned_crew_code && (
                        <div className="text-[10px] text-emerald-700 font-mono">
                          Crew: {p.assigned_crew_code}
                        </div>
                      )}
                    </td>
                    <td className="p-3.5 text-[11px] text-stone-500">
                      {new Date(p.updated_at).toLocaleDateString()}
                    </td>
                    <td className="p-3.5 text-right space-x-1.5">
                      <button
                        onClick={() => openEditModal(p)}
                        className="p-1.5 rounded-lg border border-stone-200 hover:bg-stone-100 text-stone-700 cursor-pointer"
                        title="Edit Plot"
                      >
                      </button>
                      <button
                        onClick={() => handleDelete(p)}
                        className="p-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-700 cursor-pointer"
                        title="Delete Plot"
                      >
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Modal with Interactive Map Coordinate Picker */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-stone-200 max-w-3xl w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <h2 className="text-base font-bold text-[#17211C] flex items-center gap-2">
                {editingPlot ? `Edit Plot ${editingPlot.code}` : 'Register New Farm Plot'}
              </h2>
              <button onClick={() => setModalOpen(false)} className="text-stone-500">
              </button>
            </div>

            <form onSubmit={handleSave} className="grid md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">Plot Code</label>
                    <input
                      type="text"
                      required
                      disabled={!!editingPlot}
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-stone-300 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">Area (Acres)</label>
                    <input
                      type="number"
                      step="0.1"
                      required
                      value={form.area_acres}
                      onChange={(e) => setForm({ ...form, area_acres: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded-lg border border-stone-300"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Plot Name</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g., Tunga East Valley Block"
                    className="w-full px-3 py-2 rounded-lg border border-stone-300"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">Priority</label>
                    <select
                      value={form.priority}
                      onChange={(e) => setForm({ ...form, priority: e.target.value })}
                      className="w-full px-2 py-2 rounded-lg border border-stone-300 bg-white"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">Drainage</label>
                    <select
                      value={form.drainage}
                      onChange={(e) => setForm({ ...form, drainage: e.target.value })}
                      className="w-full px-2 py-2 rounded-lg border border-stone-300 bg-white"
                    >
                      <option value="poor">Poor</option>
                      <option value="moderate">Moderate</option>
                      <option value="good">Good</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">Status</label>
                    <select
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}
                      className="w-full px-2 py-2 rounded-lg border border-stone-300 bg-white"
                    >
                      <option value="pending">Pending</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="protected">Protected</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">
                      Canopy Density (0–1): {form.canopy_density}
                    </label>
                    <input
                      type="range"
                      min={0.2}
                      max={0.95}
                      step={0.05}
                      value={form.canopy_density}
                      onChange={(e) =>
                        setForm({ ...form, canopy_density: Number(e.target.value) })
                      }
                      className="w-full accent-emerald-700"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">
                      Initial Protection (0–1): {form.protection_state}
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={0.95}
                      step={0.05}
                      value={form.protection_state}
                      onChange={(e) =>
                        setForm({ ...form, protection_state: Number(e.target.value) })
                      }
                      className="w-full accent-emerald-700"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">Assigned Crew</label>
                    <select
                      value={form.assigned_crew_id}
                      onChange={(e) => setForm({ ...form, assigned_crew_id: e.target.value })}
                      className="w-full px-2 py-2 rounded-lg border border-stone-300 bg-white"
                    >
                      <option value="">Auto-Assign by Optimizer</option>
                      {crews.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center pt-5">
                    <label className="flex items-center gap-2 font-semibold text-stone-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.inspection_required}
                        onChange={(e) =>
                          setForm({ ...form, inspection_required: e.target.checked })
                        }
                      />
                      Pre-Inspection Required (INSP → PROT)
                    </label>
                  </div>
                </div>
              </div>

              {/* Right Column: Interactive Map Location Picker */}
              <div className="space-y-2">
                <label className="block font-semibold text-stone-700">
                  Click Map to Select Plot Coordinates ([{form.lat}, {form.lon}])
                </label>
                <div className="h-56 rounded-xl overflow-hidden border border-stone-300">
                  <MapContainer
                    center={[form.lat, form.lon]}
                    zoom={13}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <MapClickSelector
                      onPick={(lat, lon) => setForm((prev) => ({ ...prev, lat, lon }))}
                    />
                  </MapContainer>
                </div>
                <div className="flex justify-end gap-2 pt-3">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-stone-300 text-stone-700 font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-[#0C1F17] text-white font-bold cursor-pointer"
                  >
                    {editingPlot ? 'Save Changes' : 'Create Plot'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
