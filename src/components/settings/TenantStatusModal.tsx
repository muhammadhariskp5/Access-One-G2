import React, { useState } from 'react';
import { 
  ShieldAlert, 
  CheckCircle2, 
  Eye, 
  Ban, 
  XOctagon, 
  AlertCircle, 
  RefreshCw, 
  Sparkles,
  Building2,
  Lock
} from 'lucide-react';
import { OrganizationTenant } from '../../types';
import { apiFetch, cn } from '../../lib/utils';

interface TenantStatusModalProps {
  company: OrganizationTenant;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
}

export function TenantStatusModal({ company, isOpen, onClose, onSuccess, showToast }: TenantStatusModalProps) {
  const [status, setStatus] = useState<'active' | 'read_only' | 'suspended' | 'terminated'>(
    (company.status as any) || 'active'
  );
  const [statusReason, setStatusReason] = useState(company.statusReason || '');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/platform/companies/${company.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          status,
          statusReason: statusReason.trim()
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update organization status');
      }

      showToast(`Status updated to "${status.toUpperCase()}" for ${company.name}`, 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Error updating status', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const statusOptions = [
    {
      value: 'active' as const,
      label: 'Active (Full Operational Access)',
      icon: CheckCircle2,
      color: 'text-emerald-600',
      border: 'border-emerald-200 bg-emerald-50/50',
      activeRing: 'ring-2 ring-emerald-500 border-emerald-500',
      desc: 'All tenant users have normal read, write, pass issuance, and reporting privileges within assigned quotas.'
    },
    {
      value: 'read_only' as const,
      label: 'Read-Only (Lock Creation & Edits)',
      icon: Eye,
      color: 'text-blue-600',
      border: 'border-blue-200 bg-blue-50/50',
      activeRing: 'ring-2 ring-blue-500 border-blue-500',
      desc: 'Users can log in and view historical passes, personnel, and reports, but cannot create or modify records.'
    },
    {
      value: 'suspended' as const,
      label: 'Suspended (Block Login & API Access)',
      icon: Ban,
      color: 'text-amber-600',
      border: 'border-amber-200 bg-amber-50/50',
      activeRing: 'ring-2 ring-amber-500 border-amber-500',
      desc: 'Tenant users are locked out immediately. Suitable for payment defaults, security investigations, or expired contracts.'
    },
    {
      value: 'terminated' as const,
      label: 'Terminated (Permanent Contract End)',
      icon: XOctagon,
      color: 'text-rose-600',
      border: 'border-rose-200 bg-rose-50/50',
      activeRing: 'ring-2 ring-rose-500 border-rose-500',
      desc: 'Tenant operations have permanently ceased. All access requests are rejected by security gateways.'
    }
  ];

  const quickReasons = [
    'Commercial subscription expired; awaiting contract renewal agreement.',
    'Overdue payment beyond 15-day grace period; access temporarily locked.',
    'Compliance security audit hold requested by Port Authority Command.',
    'Tenant requested temporary freeze during seasonal holiday shutdown.',
    'Contract terminated by mutual agreement; workspace archived.'
  ];

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 max-w-xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-white text-slate-900 p-5 flex items-center justify-between border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#800020]/10 text-[#800020] flex items-center justify-center">
              <ShieldAlert size={18} />
            </div>
            <div>
              <h3 className="font-black text-sm text-slate-900">Tenant Status & Access Control Engine</h3>
              <p className="text-[11px] text-slate-500">
                {company.name} (Code: <span className="font-mono font-bold text-slate-700">{company.code}</span>)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 text-xs">
          {/* Status Selection Cards */}
          <div className="space-y-2">
            <label className="font-bold text-slate-700 text-xs">Target Operational State *</label>
            <div className="space-y-2">
              {statusOptions.map((opt) => {
                const Icon = opt.icon;
                const isSelected = status === opt.value;
                return (
                  <label
                    key={opt.value}
                    onClick={() => setStatus(opt.value)}
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                      isSelected ? opt.activeRing : "border-slate-200 bg-white hover:bg-slate-50"
                    )}
                  >
                    <input
                      type="radio"
                      name="tenantStatus"
                      value={opt.value}
                      checked={isSelected}
                      onChange={() => setStatus(opt.value)}
                      className="sr-only"
                    />
                    <div className={cn("mt-0.5", opt.color)}>
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-slate-900 text-xs flex items-center justify-between">
                        <span>{opt.label}</span>
                        {isSelected && (
                          <span className="text-[10px] font-black uppercase text-[#800020]">Selected</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{opt.desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Reason Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-bold text-slate-700 text-xs">
                Status Reason & Audit Justification {status !== 'active' && '*'}
              </label>
              <span className="text-[10px] text-slate-400">Recorded in Platform Audit Log</span>
            </div>
            <textarea
              rows={2}
              required={status !== 'active'}
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              placeholder="e.g. Contract expired on Sept 15; suspended pending renewal discussions."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-xs focus:bg-white focus:border-[#800020] outline-none"
            />
          </div>

          {/* Quick preset reasons */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Sparkles size={11} className="text-[#800020]" />
              <span>Standard Operational Reasons</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {quickReasons.map((qr, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setStatusReason(qr)}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-medium transition-colors text-left"
                >
                  {qr.slice(0, 45)}...
                </button>
              ))}
            </div>
          </div>

          {/* Footer actions */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 bg-[#800020] text-white rounded-xl font-bold hover:bg-[#600018] flex items-center gap-1.5 transition-all shadow-md shadow-[#800020]/20 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <RefreshCw size={13} className="animate-spin" />
                  <span>Enforcing State...</span>
                </>
              ) : (
                <>
                  <Lock size={13} />
                  <span>Enforce Tenant Status</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
