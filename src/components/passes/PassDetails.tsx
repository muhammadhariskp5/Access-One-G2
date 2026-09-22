import React, { useState } from 'react';
import { Pass, Employee, Location, AccessCode, UserProfile, PassStatus } from '../../types';
import { formatDate, cn, apiFetch, parseToYMD } from '../../lib/utils';
import { Shield, Edit3, Calendar, Save, X, CheckCircle } from 'lucide-react';

export interface PassDetailsProps {
  pass: Pass;
  employee?: Employee;
  location?: Location;
  accessCodes: AccessCode[];
  onClose: () => void;
  onUpdateStatus: (status: PassStatus) => void;
  onSavePass?: () => void;
  onShowToast?: (msg: string, type?: 'success' | 'error') => void;
  currentUser: UserProfile | null;
}

export function PassDetails({ 
  pass, 
  employee, 
  location, 
  accessCodes, 
  onClose, 
  onUpdateStatus, 
  onSavePass,
  onShowToast,
  currentUser 
}: PassDetailsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [startDate, setStartDate] = useState(parseToYMD(pass.startDate) || '');
  const [expiryDate, setExpiryDate] = useState(parseToYMD(pass.expiryDate) || '');
  const [passNumber, setPassNumber] = useState(pass.passNumber || '');
  const [authorityAppNumber, setAuthorityAppNumber] = useState(pass.authorityAppNumber || '');
  const [passStatus, setPassStatus] = useState<PassStatus>(pass.status);
  const [handoverBy, setHandoverBy] = useState(pass.handoverBy || '');
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    if (onShowToast) {
      onShowToast(msg, type);
    } else {
      setFeedback(msg);
    }
  };

  const handleSavePassEdit = async () => {
    setIsSaving(true);
    try {
      const res = await apiFetch(`/api/passes/${pass.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          startDate: startDate || pass.startDate,
          expiryDate: expiryDate || pass.expiryDate,
          passNumber: passNumber || null,
          authorityAppNumber: authorityAppNumber || null,
          status: passStatus,
          handoverBy: handoverBy || null,
        })
      });

      if (res.ok) {
        notify("Pass validity and details updated successfully");
        setIsEditing(false);
        if (onSavePass) {
          onSavePass();
        } else {
          onClose();
        }
      } else {
        const err = await res.json();
        notify(err.error || err.message || "Failed to update pass", "error");
      }
    } catch (err: any) {
      notify(err.message || "Error updating pass details", "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between p-4 bg-[#F9FAFB] rounded-2xl border border-[#E5E7EB]">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-white border border-[#F3F4F6] flex items-center justify-center text-[#800020] font-bold text-2xl shadow-sm shrink-0">
            {employee?.name?.charAt(0) || '?'}
          </div>
          <div>
            <h3 className="text-xl font-bold text-[#111827]">{employee?.name}</h3>
            <p className="text-xs text-[#6B7280] font-medium">
              {employee?.jobTitle} • {employee?.employeeId}
              {pass.passNumber && <span className="text-[#800020] ml-2 text-[11px] font-semibold">• ID: {pass.passNumber}</span>}
            </p>
            <div className="mt-2 flex gap-2">
              <span className={cn(
                "px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider",
                pass.status === 'active' || pass.status === 'collected' ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
              )}>
                {pass.status}
              </span>
              <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-semibold uppercase tracking-wider">
                {pass.type} Pass
              </span>
            </div>
          </div>
        </div>

        {currentUser?.role === 'admin' && !isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="px-3.5 py-2 bg-[#800020] text-white hover:bg-[#600018] rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
          >
            <Edit3 size={14} />
            Edit Validity / Pass
          </button>
        )}
      </div>

      {/* Admin Edit Form */}
      {isEditing ? (
        <div className="p-5 bg-amber-50/40 border border-amber-200/80 rounded-2xl space-y-4">
          <div className="flex items-center justify-between border-b border-amber-200/60 pb-3">
            <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider flex items-center gap-2">
              <Calendar size={15} className="text-[#800020]" />
              Edit Pass Validity & Attributes (Admin)
            </h4>
            <button 
              onClick={() => setIsEditing(false)}
              className="text-gray-400 hover:text-gray-600 p-1"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">Valid From (Start Date)</label>
              <input 
                type="date"
                value={parseToYMD(startDate) || ''}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full p-2.5 bg-white border border-gray-300 rounded-xl font-medium focus:outline-none focus:border-[#800020]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">Expiry Date (Valid Until)</label>
              <input 
                type="date"
                value={parseToYMD(expiryDate) || ''}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full p-2.5 bg-white border border-gray-300 rounded-xl font-medium focus:outline-none focus:border-[#800020]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">Pass Number</label>
              <input 
                type="text"
                value={passNumber}
                onChange={(e) => setPassNumber(e.target.value)}
                placeholder="e.g. PASS-2026-0012"
                className="w-full p-2.5 bg-white border border-gray-300 rounded-xl font-medium focus:outline-none focus:border-[#800020]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">Pass Status</label>
              <select
                value={passStatus}
                onChange={(e) => setPassStatus(e.target.value as PassStatus)}
                className="w-full p-2.5 bg-white border border-gray-300 rounded-xl font-bold focus:outline-none focus:border-[#800020]"
              >
                <option value="active">Active</option>
                <option value="collected">Collected</option>
                <option value="accepted">Accepted</option>
                <option value="approved">Approved</option>
                <option value="pending">Pending</option>
                <option value="expired">Expired</option>
                <option value="revoked">Revoked</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-gray-700 mb-1">Handover By / Collector</label>
              <input 
                type="text"
                value={handoverBy}
                onChange={(e) => setHandoverBy(e.target.value)}
                placeholder="PRO or Person who collected the pass"
                className="w-full p-2.5 bg-white border border-gray-300 rounded-xl font-medium focus:outline-none focus:border-[#800020]"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setIsEditing(false)}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-xl text-xs font-bold hover:bg-gray-300 transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSavePassEdit}
              disabled={isSaving}
              className="px-4 py-2 bg-[#800020] text-white rounded-xl text-xs font-bold hover:bg-[#600018] transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-sm"
            >
              <Save size={14} />
              {isSaving ? "Saving..." : "Save Validity Changes"}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl border border-[#F3F4F6] space-y-3">
            <p className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest">Location Details</p>
            <div>
              <p className="text-[10px] text-[#6B7280] font-medium uppercase tracking-wider">Site Name</p>
              <p className="text-sm font-bold text-[#1A1A1A]">{location?.name}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#6B7280] font-medium uppercase tracking-wider">Site Code</p>
              <p className="text-sm font-bold text-[#800020]">{location?.code}</p>
            </div>
          </div>
          <div className="p-4 rounded-2xl border border-[#F3F4F6] space-y-3">
            <p className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest">Validity Period</p>
            <div>
              <p className="text-[10px] text-[#6B7280] font-medium uppercase tracking-wider">Valid From</p>
              <p className="text-sm font-bold text-[#1A1A1A]">{formatDate(pass.startDate)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#6B7280] font-medium uppercase tracking-wider">Expiry Date</p>
              <p className="text-sm font-bold text-[#800020]">{formatDate(pass.expiryDate)}</p>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 rounded-2xl border border-[#F3F4F6] space-y-3 bg-gray-50/50">
        <p className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest">Contract & Project Details</p>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-[10px] text-[#6B7280] font-medium uppercase tracking-wider">Contract Number</p>
            <p className="text-xs font-bold text-[#1A1A1A]">{pass.contractNumber || 'Not Defined'}</p>
          </div>
          <div>
            <p className="text-[10px] text-[#6B7280] font-medium uppercase tracking-wider">Contract / Project Name</p>
            <p className="text-xs font-bold text-[#1A1A1A]">{pass.contractName || 'Not Defined'}</p>
          </div>
          <div>
            <p className="text-[10px] text-[#6B7280] font-medium uppercase tracking-wider">Client Company</p>
            <p className="text-xs font-bold text-[#1A1A1A]">{pass.clientCompany || 'Not Defined'}</p>
          </div>
          <div>
            <p className="text-[10px] text-[#6B7280] font-medium uppercase tracking-wider">Client Approver List</p>
            <p className="text-xs font-semibold text-[#1A1A1A] whitespace-pre-line">{pass.clientApprovers || 'Not Defined'}</p>
          </div>
        </div>
      </div>

      <div className="p-4 rounded-2xl border border-[#F3F4F6] space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest">Authorized Access Areas</p>
          {location?.code && (
            <span className="text-[10px] font-mono font-bold text-[#800020] bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
              Site Code: {location.code}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {(() => {
            let codes: string[] = [];
            if (Array.isArray(pass.accessCodes)) {
              codes = pass.accessCodes;
            } else if (typeof pass.accessCodes === 'string') {
              try {
                const parsed = JSON.parse(pass.accessCodes);
                if (Array.isArray(parsed)) codes = parsed;
                else if (parsed) codes = [String(parsed)];
              } catch {
                if (pass.accessCodes) codes = [pass.accessCodes];
              }
            }
            if (codes.length === 0) {
              return <p className="text-xs text-[#9CA3AF] italic">General facility access (No specific access areas restricted).</p>;
            }
            return codes.map(codeStr => {
              const code = accessCodes.find(ac => (ac.areaCode === codeStr || ac.id === codeStr) && (!ac.locationId || ac.locationId === pass.locationId)) 
                || accessCodes.find(ac => ac.areaCode === codeStr || ac.id === codeStr);
              return (
                <div key={codeStr} className="px-3 py-2 bg-[#F9FAFB] rounded-xl border border-[#F3F4F6] flex items-center gap-2">
                  <Shield size={12} className="text-[#800020]" />
                  <div>
                    <p className="text-[10px] font-bold text-[#1A1A1A]">{code?.areaCode || codeStr}</p>
                    <p className="text-[8px] text-[#6B7280] font-medium uppercase tracking-wider">{code?.accessArea || 'Authorized Zone'}</p>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>

      {currentUser?.role === 'admin' && !isEditing && (
        <div className="flex gap-3 pt-4 border-t border-gray-100">
          {pass.status !== 'active' && (
            <button 
              onClick={() => onUpdateStatus('active')}
              className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-sm text-xs"
            >
              Activate Pass
            </button>
          )}
          {pass.status === 'active' && (
            <button 
              onClick={() => onUpdateStatus('revoked')}
              className="flex-1 py-3 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 transition-all shadow-sm text-xs"
            >
              Revoke Pass
            </button>
          )}
        </div>
      )}
    </div>
  );
}
