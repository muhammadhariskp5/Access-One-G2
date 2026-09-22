import React, { useState, useEffect } from 'react';
import { 
  Radio, 
  AlertTriangle, 
  Info, 
  CheckCircle2, 
  Clock, 
  Save, 
  Eye, 
  Power,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import { apiFetch, cn } from '../../lib/utils';

interface MaintenanceBroadcastAdminProps {
  showToast: (message: string, type?: 'success' | 'error') => void;
  onSuccess?: () => void;
}

export function MaintenanceBroadcastAdmin({ showToast, onSuccess }: MaintenanceBroadcastAdminProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [broadcastActive, setBroadcastActive] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastSeverity, setBroadcastSeverity] = useState<'info' | 'warning' | 'critical'>('info');
  const [broadcastEstimatedEnd, setBroadcastEstimatedEnd] = useState('');

  const fetchCurrentBroadcast = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/platform/maintenance');
      if (res.ok) {
        const data = await res.json();
        setBroadcastActive(Boolean(data.active));
        setBroadcastMessage(data.message || '');
        setBroadcastSeverity(data.severity || 'info');
        setBroadcastEstimatedEnd(data.estimatedEnd || '');
      }
    } catch (err) {
      console.error('Failed to load maintenance settings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrentBroadcast();
  }, []);

  const handleSave = async (activeOverride?: boolean) => {
    setSaving(true);
    try {
      const isActive = activeOverride !== undefined ? activeOverride : broadcastActive;
      const payload = {
        active: isActive,
        message: broadcastMessage,
        severity: broadcastSeverity,
        estimatedEnd: broadcastEstimatedEnd || null
      };

      const res = await apiFetch('/api/platform/maintenance', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update system maintenance settings');
      }

      const result = await res.json();
      if (activeOverride !== undefined) {
        setBroadcastActive(activeOverride);
      }
      showToast(
        isActive 
          ? 'System maintenance announcement broadcasted across all organizations' 
          : 'System maintenance broadcast deactivated',
        'success'
      );
      onSuccess?.();
    } catch (err: any) {
      showToast(err.message || 'Failed to save maintenance configuration', 'error');
    } finally {
      setSaving(false);
    }
  };

  const presetMessages = [
    {
      title: 'Scheduled Cloud Maintenance',
      severity: 'info' as const,
      text: 'Scheduled Oracle Autonomous DB Cloud upgrade in progress. System operations remain functional with minor latency.'
    },
    {
      title: 'Emergency Maintenance Window',
      severity: 'warning' as const,
      text: 'Routine security patching and SSL certificate renewals are currently underway. Some reporting tools may temporarily re-index.'
    },
    {
      title: 'Critical Port Infrastructure Notice',
      severity: 'critical' as const,
      text: 'URGENT: Port authority checkpoint gate sync is undergoing synchronized failover. Please verify all physical badges manually if offline.'
    }
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header Info */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#800020]/10 border border-[#800020]/20 flex items-center justify-center text-[#800020]">
              <Radio size={20} className={broadcastActive ? "animate-pulse" : ""} />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900">System Maintenance & Emergency Broadcast</h2>
              <p className="text-xs text-slate-500">
                Broadcast authoritative system-wide notices, maintenance windows, or downtime warnings to all logged-in organization portals and public login gates in real-time.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchCurrentBroadcast}
              disabled={loading}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              title="Refresh Current State"
            >
              <RefreshCw size={14} className={loading ? "animate-spin text-[#800020]" : ""} />
            </button>
            <div className={cn(
              "px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5",
              broadcastActive 
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-slate-100 text-slate-600 border-slate-200"
            )}>
              <span className={cn(
                "w-2 h-2 rounded-full",
                broadcastActive ? "bg-emerald-500 animate-ping" : "bg-slate-400"
              )} />
              <span>{broadcastActive ? 'BROADCAST ACTIVE' : 'INACTIVE'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Live Preview Panel */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-3">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 font-bold text-slate-700">
            <Eye size={15} className="text-[#800020]" />
            <span>Live Interactive Preview (What Tenant Users & Operators Will See)</span>
          </div>
          <span className="text-[11px] font-mono text-slate-400">Fixed Top Ingress Banner</span>
        </div>

        {broadcastActive || broadcastMessage.trim() ? (
          <div className={cn(
            "px-4 py-3 rounded-xl text-xs font-semibold flex items-center justify-between gap-3 border transition-all shadow-xs",
            broadcastSeverity === 'critical'
              ? "bg-rose-600 text-white border-rose-700 shadow-rose-600/20"
              : broadcastSeverity === 'warning'
              ? "bg-amber-500 text-amber-950 border-amber-600 shadow-amber-500/20"
              : "bg-blue-600 text-white border-blue-700 shadow-blue-600/20"
          )}>
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-6 h-6 rounded-lg bg-black/15 flex items-center justify-center shrink-0">
                {broadcastSeverity === 'critical' ? (
                  <AlertTriangle size={14} className="animate-bounce" />
                ) : broadcastSeverity === 'warning' ? (
                  <AlertTriangle size={14} />
                ) : (
                  <Info size={14} />
                )}
              </span>
              <div className="min-w-0">
                <span className="font-black uppercase tracking-wider text-[10px] opacity-90 mr-2">
                  System Broadcast:
                </span>
                <span className="font-medium">
                  {broadcastMessage || 'No announcement message specified yet.'}
                </span>
              </div>
            </div>

            {broadcastEstimatedEnd && (
              <div className="shrink-0 text-[11px] font-mono opacity-90 bg-black/15 px-2 py-0.5 rounded-md flex items-center gap-1">
                <Clock size={11} />
                <span>Est: {new Date(broadcastEstimatedEnd).toLocaleString()}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-400">
            No active broadcast banner is currently displayed. Configure the message below and toggle activation.
          </div>
        )}
      </div>

      {/* Configuration Form */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-5">
        <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
          Broadcast Configuration Controls
        </h3>

        {/* Status Toggle Switch */}
        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
          <div>
            <div className="font-bold text-xs text-slate-900">Broadcast Activation State</div>
            <div className="text-[11px] text-slate-500">
              When enabled, this banner will render continuously at the top of every tenant’s dashboard, application screen, and login page.
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              checked={broadcastActive} 
              onChange={(e) => setBroadcastActive(e.target.checked)}
              className="sr-only peer" 
            />
            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#800020]"></div>
          </label>
        </div>

        {/* Severity Selector */}
        <div className="space-y-1.5">
          <label className="font-bold text-xs text-slate-700">Severity Level & Visual Theme</label>
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setBroadcastSeverity('info')}
              className={cn(
                "p-3 rounded-xl border text-left text-xs font-bold transition-all cursor-pointer",
                broadcastSeverity === 'info'
                  ? "bg-blue-50 border-blue-500 text-blue-900 ring-2 ring-blue-500/20"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              )}
            >
              <div className="flex items-center gap-1.5 text-blue-600 mb-1">
                <Info size={15} />
                <span>Informational</span>
              </div>
              <p className="text-[10px] font-normal text-slate-500">
                Planned maintenance or standard operational updates.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setBroadcastSeverity('warning')}
              className={cn(
                "p-3 rounded-xl border text-left text-xs font-bold transition-all cursor-pointer",
                broadcastSeverity === 'warning'
                  ? "bg-amber-50 border-amber-500 text-amber-950 ring-2 ring-amber-500/20"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              )}
            >
              <div className="flex items-center gap-1.5 text-amber-600 mb-1">
                <AlertTriangle size={15} />
                <span>Maintenance Warning</span>
              </div>
              <p className="text-[10px] font-normal text-slate-500">
                Intermittent degraded service, read-only windows, or patching.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setBroadcastSeverity('critical')}
              className={cn(
                "p-3 rounded-xl border text-left text-xs font-bold transition-all cursor-pointer",
                broadcastSeverity === 'critical'
                  ? "bg-rose-50 border-rose-500 text-rose-900 ring-2 ring-rose-500/20"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              )}
            >
              <div className="flex items-center gap-1.5 text-rose-600 mb-1">
                <AlertTriangle size={15} />
                <span>Critical / Emergency</span>
              </div>
              <p className="text-[10px] font-normal text-slate-500">
                Security incidents, urgent gate failovers, or immediate outages.
              </p>
            </button>
          </div>
        </div>

        {/* Message Input */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="font-bold text-xs text-slate-700">Announcement Message Content *</label>
            <span className="text-[11px] text-slate-400">{broadcastMessage.length}/300 chars</span>
          </div>
          <textarea
            rows={3}
            maxLength={300}
            value={broadcastMessage}
            onChange={(e) => setBroadcastMessage(e.target.value)}
            placeholder="e.g. Scheduled database maintenance on Sunday 02:00 AM UTC. Portal will operate in read-only mode for 30 minutes."
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:border-[#800020] outline-none transition-all"
          />
        </div>

        {/* Estimated Completion Date/Time */}
        <div className="space-y-1.5">
          <label className="font-bold text-xs text-slate-700">Estimated Resolution / Completion Time (Optional)</label>
          <input
            type="datetime-local"
            value={broadcastEstimatedEnd}
            onChange={(e) => setBroadcastEstimatedEnd(e.target.value)}
            className="w-full sm:w-80 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:bg-white focus:border-[#800020] outline-none"
          />
        </div>

        {/* One-Click Presets */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Sparkles size={12} className="text-[#800020]" />
            <span>Quick-Load Standard Template Presets</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {presetMessages.map((p, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setBroadcastMessage(p.text);
                  setBroadcastSeverity(p.severity);
                }}
                className="p-2.5 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 text-left transition-colors cursor-pointer"
              >
                <div className="text-[11px] font-bold text-slate-800">{p.title}</div>
                <div className="text-[10px] text-slate-500 line-clamp-2 mt-0.5">{p.text}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2">
          {broadcastActive ? (
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={saving}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Power size={13} className="text-rose-600" />
              <span>Deactivate Broadcast</span>
            </button>
          ) : <div />}

          <button
            type="button"
            onClick={() => handleSave()}
            disabled={saving || (broadcastActive && !broadcastMessage.trim())}
            className="px-5 py-2.5 bg-[#800020] hover:bg-[#600018] text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-md shadow-[#800020]/20 disabled:opacity-50"
          >
            {saving ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                <span>Broadcasting to Platform...</span>
              </>
            ) : (
              <>
                <Save size={14} />
                <span>Save & Publish Broadcast</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
