import React, { useState, useEffect } from 'react';
import { 
  Layers, 
  MapPin, 
  Key, 
  Plus, 
  Shield, 
  Search, 
  Globe, 
  RefreshCw, 
  Trash2, 
  CheckCircle2, 
  AlertCircle,
  Building2,
  Lock
} from 'lucide-react';
import { Location, AccessCode, Category } from '../../types';
import { apiFetch, cn } from '../../lib/utils';

interface GlobalMasterPortCatalogProps {
  showToast: (message: string, type?: 'success' | 'error') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export function GlobalMasterPortCatalog({ showToast, showConfirm }: GlobalMasterPortCatalogProps) {
  const [subTab, setSubTab] = useState<'locations' | 'access-codes'>('locations');
  const [locations, setLocations] = useState<Location[]>([]);
  const [accessCodes, setAccessCodes] = useState<AccessCode[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Modals
  const [isAddLocationOpen, setIsAddLocationOpen] = useState(false);
  const [isAddCodeOpen, setIsAddCodeOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // New Global Location Form
  const [locForm, setLocForm] = useState({
    name: '',
    code: '',
    categoryId: '',
    description: '',
    securityLevel: 'Level 2: Operations'
  });

  // New Global Access Code Form
  const [codeForm, setCodeForm] = useState({
    locationId: '',
    areaCode: '',
    accessArea: '',
    description: '',
    securityLevel: 'Level 2: Operations'
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [locRes, codeRes, catRes] = await Promise.all([
        apiFetch('/api/locations'),
        apiFetch('/api/accessCodes'),
        apiFetch('/api/categories')
      ]);

      if (locRes.ok) {
        const locData: Location[] = await locRes.json();
        // Filter or prioritize global items
        setLocations(locData);
      }
      if (codeRes.ok) {
        const codeData: AccessCode[] = await codeRes.json();
        setAccessCodes(codeData);
      }
      if (catRes.ok) {
        const catData: Category[] = await catRes.json();
        setCategories(catData);
      }
    } catch (err) {
      console.error('Failed to load global catalog:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Global items filter
  const globalLocations = locations.filter(l => Boolean(l.isGlobal) || Number(l.isGlobal) === 1);
  const globalAccessCodes = accessCodes.filter(c => Boolean(c.isGlobal) || Number(c.isGlobal) === 1);

  const filteredLocations = globalLocations.filter(l => 
    l.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    l.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (l.description && l.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const filteredCodes = globalAccessCodes.filter(c => 
    c.areaCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.accessArea.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.description && c.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleCreateLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locForm.name.trim() || !locForm.code.trim()) {
      showToast('Name and Location Code are required', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: locForm.name.trim(),
        code: locForm.code.trim().toUpperCase(),
        categoryId: locForm.categoryId || (categories[0]?.id || 'cat-ports'),
        description: locForm.description.trim(),
        securityLevel: locForm.securityLevel,
        isGlobal: 1
      };

      const res = await apiFetch('/api/locations', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create global location');
      }

      showToast(`Global Master Port "${payload.name}" successfully created`, 'success');
      setIsAddLocationOpen(false);
      setLocForm({
        name: '',
        code: '',
        categoryId: '',
        description: '',
        securityLevel: 'Level 2: Operations'
      });
      fetchData();
    } catch (err: any) {
      showToast(err.message || 'Error creating global location', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeForm.areaCode.trim() || !codeForm.accessArea.trim() || !codeForm.locationId) {
      showToast('Please select a port location and provide Area Code & Name', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        locationId: codeForm.locationId,
        areaCode: codeForm.areaCode.trim().toUpperCase(),
        accessArea: codeForm.accessArea.trim(),
        description: codeForm.description.trim(),
        securityLevel: codeForm.securityLevel,
        isGlobal: 1
      };

      const res = await apiFetch('/api/accessCodes', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create global access code');
      }

      showToast(`Global Access Code "${payload.areaCode}" successfully registered`, 'success');
      setIsAddCodeOpen(false);
      setCodeForm({
        locationId: '',
        areaCode: '',
        accessArea: '',
        description: '',
        securityLevel: 'Level 2: Operations'
      });
      fetchData();
    } catch (err: any) {
      showToast(err.message || 'Error creating global access code', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteLocation = (loc: Location) => {
    showConfirm(
      'Delete Global Port Location',
      `Are you sure you want to delete master port "${loc.name}" (${loc.code})? It will be removed from all tenant organizations.`,
      async () => {
        try {
          const res = await apiFetch(`/api/locations/${loc.id}`, { method: 'DELETE' });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to delete location');
          }
          showToast('Global location removed', 'success');
          fetchData();
        } catch (err: any) {
          showToast(err.message || 'Error deleting location', 'error');
        }
      }
    );
  };

  const handleDeleteCode = (code: AccessCode) => {
    showConfirm(
      'Delete Global Access Code',
      `Are you sure you want to delete master access code "${code.areaCode}" - ${code.accessArea}?`,
      async () => {
        try {
          const res = await apiFetch(`/api/accessCodes/${code.id}`, { method: 'DELETE' });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to delete access code');
          }
          showToast('Global access code removed', 'success');
          fetchData();
        } catch (err: any) {
          showToast(err.message || 'Error deleting access code', 'error');
        }
      }
    );
  };

  const securityBadge = (level?: string) => {
    const l = level || 'Level 2: Operations';
    let color = "bg-blue-50 text-blue-700 border-blue-200";
    if (l.includes('Level 3')) color = "bg-purple-50 text-purple-700 border-purple-200";
    if (l.includes('Level 4') || l.includes('Critical')) color = "bg-rose-50 text-rose-700 border-rose-200";
    if (l.includes('Level 1')) color = "bg-emerald-50 text-emerald-700 border-emerald-200";

    return (
      <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold border", color)}>
        {l}
      </span>
    );
  };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#800020]/10 border border-[#800020]/20 flex items-center justify-center text-[#800020]">
              <Globe size={20} />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900">Global Master Port & Gate Catalog</h2>
              <p className="text-xs text-slate-500">
                Governed master dictionary of commercial ports, terminals, checkpoints, and standard security clearance codes inherited automatically across all client organizations.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchData}
              disabled={loading}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              title="Refresh Catalog"
            >
              <RefreshCw size={14} className={loading ? "animate-spin text-[#800020]" : ""} />
            </button>

            {subTab === 'locations' ? (
              <button
                onClick={() => setIsAddLocationOpen(true)}
                className="px-3 py-2 bg-[#800020] hover:bg-[#600018] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <Plus size={14} />
                <span>Add Global Port Location</span>
              </button>
            ) : (
              <button
                onClick={() => setIsAddCodeOpen(true)}
                className="px-3 py-2 bg-[#800020] hover:bg-[#600018] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <Plus size={14} />
                <span>Add Global Access Code</span>
              </button>
            )}
          </div>
        </div>

        {/* Sub Navigation */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSubTab('locations')}
              className={cn(
                "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5",
                subTab === 'locations'
                  ? "bg-[#800020] text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              )}
            >
              <MapPin size={13} />
              <span>Master Port Locations ({globalLocations.length})</span>
            </button>

            <button
              onClick={() => setSubTab('access-codes')}
              className={cn(
                "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5",
                subTab === 'access-codes'
                  ? "bg-[#800020] text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              )}
            >
              <Key size={13} />
              <span>Master Access Codes ({globalAccessCodes.length})</span>
            </button>
          </div>

          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 text-slate-400" size={13} />
            <input
              type="text"
              placeholder={`Search master ${subTab}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:bg-white focus:border-[#800020] outline-none"
            />
          </div>
        </div>
      </div>

      {/* SUB-TAB 1: Locations */}
      {subTab === 'locations' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                  <th className="p-3">Global Port / Location</th>
                  <th className="p-3">Port Code</th>
                  <th className="p-3">Security Level</th>
                  <th className="p-3">Associated Codes</th>
                  <th className="p-3">Governance Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLocations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      {searchTerm ? 'No global port locations match search query.' : 'No global port locations registered yet. Click "Add Global Port Location" to create standard locations.'}
                    </td>
                  </tr>
                ) : (
                  filteredLocations.map((loc) => {
                    const linkedCodes = accessCodes.filter(c => c.locationId === loc.id);
                    return (
                      <tr key={loc.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3">
                          <div className="font-bold text-slate-900 flex items-center gap-1.5">
                            <MapPin size={13} className="text-[#800020] shrink-0" />
                            <span>{loc.name}</span>
                          </div>
                          {loc.description && (
                            <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{loc.description}</p>
                          )}
                        </td>
                        <td className="p-3">
                          <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                            {loc.code}
                          </span>
                        </td>
                        <td className="p-3">
                          {securityBadge(loc.securityLevel)}
                        </td>
                        <td className="p-3">
                          <span className="text-slate-600 font-semibold">
                            {linkedCodes.length} access codes
                          </span>
                        </td>
                        <td className="p-3">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <Globe size={10} />
                            <span>Universal Master</span>
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => handleDeleteLocation(loc)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="Delete Global Port"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: Access Codes */}
      {subTab === 'access-codes' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                  <th className="p-3">Area Code</th>
                  <th className="p-3">Clearance / Gate Name</th>
                  <th className="p-3">Associated Port</th>
                  <th className="p-3">Security Level</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCodes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      {searchTerm ? 'No global access codes match search query.' : 'No global access codes registered yet. Click "Add Global Access Code" to govern standard gate codes.'}
                    </td>
                  </tr>
                ) : (
                  filteredCodes.map((code) => {
                    const loc = locations.find(l => l.id === code.locationId);
                    return (
                      <tr key={code.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3 font-mono font-bold text-slate-900">
                          <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                            {code.areaCode}
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="font-bold text-slate-900">{code.accessArea}</div>
                          {code.description && (
                            <div className="text-[11px] text-slate-500 line-clamp-1">{code.description}</div>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="text-slate-800 font-medium">
                            {loc ? loc.name : 'Unknown Port'}
                          </div>
                          {loc && <div className="text-[10px] font-mono text-slate-400">{loc.code}</div>}
                        </td>
                        <td className="p-3">
                          {securityBadge(code.securityLevel)}
                        </td>
                        <td className="p-3">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <Globe size={10} />
                            <span>Master Governed</span>
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => handleDeleteCode(code)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="Delete Global Code"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL 1: Add Global Location */}
      {isAddLocationOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-white text-slate-900 p-4 flex items-center justify-between border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#800020]/10 text-[#800020] flex items-center justify-center">
                  <MapPin size={15} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Add Global Master Port / Location</h3>
                  <p className="text-[11px] text-slate-500">Universal location accessible by all client organizations</p>
                </div>
              </div>
              <button
                onClick={() => setIsAddLocationOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateLocation} className="p-5 space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">Port / Location Name *</label>
                <input
                  type="text"
                  required
                  value={locForm.name}
                  onChange={(e) => setLocForm({ ...locForm, name: e.target.value })}
                  placeholder="e.g. Doha Port - Commercial Cargo Gate 01"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-medium focus:bg-white focus:border-[#800020] outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Unique Location Code *</label>
                  <input
                    type="text"
                    required
                    value={locForm.code}
                    onChange={(e) => setLocForm({ ...locForm, code: e.target.value.toUpperCase() })}
                    placeholder="e.g. DOH-CARGO-01"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-mono font-bold focus:bg-white focus:border-[#800020] outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Category</label>
                  <select
                    value={locForm.categoryId}
                    onChange={(e) => setLocForm({ ...locForm, categoryId: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-medium focus:bg-white focus:border-[#800020] outline-none"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Governed Security Level</label>
                <select
                  value={locForm.securityLevel}
                  onChange={(e) => setLocForm({ ...locForm, securityLevel: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-semibold focus:bg-white focus:border-[#800020] outline-none"
                >
                  <option value="Level 1: General Access">Level 1: General Public / Visitor Access</option>
                  <option value="Level 2: Operations">Level 2: Operations / Commercial Gate</option>
                  <option value="Level 3: Restricted Airside / Berths">Level 3: Restricted Berth / Airside Clearance</option>
                  <option value="Level 4: Critical High-Security">Level 4: Critical High-Security</option>
                  <option value="Level 5: Defense & Command">Level 5: Defense & Command Center</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Description / Gate Specifics</label>
                <textarea
                  rows={2}
                  value={locForm.description}
                  onChange={(e) => setLocForm({ ...locForm, description: e.target.value })}
                  placeholder="e.g. Main heavy vehicle inbound terminal with optical license plate recognition."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-medium focus:bg-white focus:border-[#800020] outline-none"
                />
              </div>

              <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl text-emerald-800 text-[11px] flex items-start gap-2">
                <Globe size={14} className="shrink-0 mt-0.5 text-emerald-600" />
                <span>
                  This location will immediately be visible to all client organizations and selectable during gate pass requests.
                </span>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsAddLocationOpen(false)}
                  className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#800020] text-white rounded-lg font-bold hover:bg-[#600018] flex items-center gap-1.5"
                >
                  {submitting ? 'Registering...' : 'Register Global Port'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Add Global Access Code */}
      {isAddCodeOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-white text-slate-900 p-4 flex items-center justify-between border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#800020]/10 text-[#800020] flex items-center justify-center">
                  <Key size={15} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Add Global Master Access Code</h3>
                  <p className="text-[11px] text-slate-500">Universal clearance code linked to a master port</p>
                </div>
              </div>
              <button
                onClick={() => setIsAddCodeOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCode} className="p-5 space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">Target Port / Location *</label>
                <select
                  required
                  value={codeForm.locationId}
                  onChange={(e) => setCodeForm({ ...codeForm, locationId: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-medium focus:bg-white focus:border-[#800020] outline-none"
                >
                  <option value="">-- Select Master Port --</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.code}) {Boolean(loc.isGlobal) ? '★ Global' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Area Code *</label>
                  <input
                    type="text"
                    required
                    value={codeForm.areaCode}
                    onChange={(e) => setCodeForm({ ...codeForm, areaCode: e.target.value.toUpperCase() })}
                    placeholder="e.g. PORT-CARGO-A"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-mono font-bold focus:bg-white focus:border-[#800020] outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Access Area Name *</label>
                  <input
                    type="text"
                    required
                    value={codeForm.accessArea}
                    onChange={(e) => setCodeForm({ ...codeForm, accessArea: e.target.value })}
                    placeholder="e.g. Berthing Deck 04"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-medium focus:bg-white focus:border-[#800020] outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Governed Security Level</label>
                <select
                  value={codeForm.securityLevel}
                  onChange={(e) => setCodeForm({ ...codeForm, securityLevel: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-semibold focus:bg-white focus:border-[#800020] outline-none"
                >
                  <option value="Level 1: General Access">Level 1: General Access</option>
                  <option value="Level 2: Operations">Level 2: Operations</option>
                  <option value="Level 3: Restricted Airside / Berths">Level 3: Restricted Airside / Berths</option>
                  <option value="Level 4: Critical High-Security">Level 4: Critical High-Security</option>
                  <option value="Level 5: Defense & Command">Level 5: Defense & Command</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Description</label>
                <textarea
                  rows={2}
                  value={codeForm.description}
                  onChange={(e) => setCodeForm({ ...codeForm, description: e.target.value })}
                  placeholder="e.g. Restricted cargo apron for registered container handlers."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-medium focus:bg-white focus:border-[#800020] outline-none"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsAddCodeOpen(false)}
                  className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#800020] text-white rounded-lg font-bold hover:bg-[#600018] flex items-center gap-1.5"
                >
                  {submitting ? 'Registering...' : 'Register Master Code'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
