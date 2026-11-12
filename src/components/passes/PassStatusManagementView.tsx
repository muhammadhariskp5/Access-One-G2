import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Shield, CheckCircle2, XCircle, X, ChevronUp, ChevronDown, Check, Ban, AlertCircle, AlertTriangle, RefreshCw, Eye, Printer, Download
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { DateRangeFilter } from '../common/DateRangeFilter';
import { CustomInputPromptModal } from './CustomInputPromptModal';
import { PassDetails } from './PassDetails';
import { PrintExportModal } from '../common/PrintExportModal';
import { 
  Pass, PassApplication, Employee, Location, Category, AccessCode, UserProfile, PassStatus, AppAction 
} from '../../types';
import { apiFetch, cn, formatDate, parseToYMD, isPassInDateRange } from '../../lib/utils';
import { resolvePersonnelStatus, filterPassApplicationItem, getSkippedWorkflowStages, isHistoryStatus } from '../../utils/passStatus';
import { StageSkipConfirmModal } from './StageSkipConfirmModal';

export interface PassStatusManagementViewProps {
  passes: Pass[];
  applications?: PassApplication[];
  employees: Employee[];
  locations: Location[];
  categories: Category[];
  accessCodes: AccessCode[];
  currentUser: UserProfile | null;
  onSuccess: () => void;
  globalSearch: string;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
  logAction: (action: Omit<AppAction, 'id' | 'timestamp'>) => void;
  onRevertStatus: (passId: string) => void;
}

export function PassStatusManagementView({ 
  passes, 
  applications = [], 
  employees, 
  locations, 
  categories, 
  accessCodes, 
  currentUser, 
  onSuccess, 
  globalSearch, 
  showToast, 
  showConfirm, 
  logAction, 
  onRevertStatus 
}: PassStatusManagementViewProps) {
  const [selectedPasses, setSelectedPasses] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [startDateFilter, setStartDateFilter] = useState<string>('');
  const [endDateFilter, setEndDateFilter] = useState<string>('');
  const [passSortField, setPassSortField] = useState<string>('employee');
  const [passSortOrder, setPassSortOrder] = useState<'asc' | 'desc'>('asc');
  const [inspectingPass, setInspectingPass] = useState<Pass | null>(null);

  const handlePassSort = (field: string) => {
    if (passSortField === field) {
      setPassSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setPassSortField(field);
      setPassSortOrder('asc');
    }
  };

  const [isRevokeModalOpen, setIsRevokeModalOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [pendingStatus, setPendingStatus] = useState<PassStatus | null>(null);
  const [revokeSupplementaryModal, setRevokeSupplementaryModal] = useState<{
    isOpen: boolean;
    targetPassIds: string[];
    supplementaryPasses: Pass[];
    onConfirm: (reason: string) => Promise<void>;
  } | null>(null);
  const [stageSkipConfirmModal, setStageSkipConfirmModal] = useState<{
    currentStatus: string;
    targetStatus: string;
    entityName: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [inputPromptModal, setInputPromptModal] = useState<{
    isOpen: boolean;
    title: string;
    description?: string;
    label: string;
    defaultValue?: string;
    placeholder?: string;
    confirmText?: string;
    confirmVariant?: 'primary' | 'danger' | 'emerald';
    onSubmit: (value: string) => void;
    onCancel?: () => void;
  } | null>(null);

  const matchesId = (id1: string | null | undefined, id2: string | null | undefined) => {
    if (!id1 || !id2) return false;
    return id1.trim().toUpperCase() === id2.trim().toUpperCase();
  };

  const allPassesCombined = useMemo(() => {
    const list: Pass[] = [...passes];

    applications.forEach(app => {
      app.employeeIds.forEach(empId => {
        const exists = list.some(p => {
          const pReqId = p.requestId || p.applicationId;
          return matchesId(app.id, pReqId) && p.employeeId === empId;
        });

        if (!exists) {
          let rawEmpStatus = (app.employeeStatuses?.[empId] || app.status || 'pending').toLowerCase();
          let status: PassStatus = 'pending';
          if (rawEmpStatus === 'collected' || rawEmpStatus === 'completed') {
            status = 'collected';
          } else if (rawEmpStatus === 'accepted') {
            status = 'accepted';
          } else if (rawEmpStatus === 'approved') {
            status = 'approved';
          } else if (rawEmpStatus === 'cancelled') {
            status = 'cancelled';
          } else if (rawEmpStatus === 'rejected') {
            status = 'rejected';
          } else if (rawEmpStatus === 'active') {
            status = 'active';
          } else if (rawEmpStatus === 'expired') {
            status = 'expired';
          } else if (rawEmpStatus === 'replaced') {
            status = 'replaced';
          } else {
            status = 'processing';
          }

          list.push({
            id: `virtual-${app.id}-${empId}`,
            applicationId: app.id,
            requestId: app.id,
            employeeId: empId,
            locationId: app.locationId,
            type: app.type || 'main',
            parentPassId: app.parentPassId,
            status: status,
            passNumber: app.authorityAppNumber || app.id.toUpperCase(),
            issueDate: app.createdAt,
            expiryDate: app.individualExpiries?.[empId] || app.endDate,
            authorityAppNumber: app.authorityAppNumber,
            accessCodes: app.accessCodes || [],
            createdAt: app.createdAt,
            updatedAt: app.updatedAt
          });
        }
      });
    });

    return list;
  }, [passes, applications]);

  const filteredPasses = useMemo(() => {
    const list = allPassesCombined.filter(p => {
      const s = globalSearch.toLowerCase();
      const emp = employees.find(e => e.id === p.employeeId);
      const loc = locations.find(l => l.id === p.locationId);
      
      const matchesSearch = !s || Boolean(
        emp?.name?.toLowerCase().includes(s) ||
        emp?.employeeId?.toLowerCase().includes(s) ||
        emp?.qatarId?.toLowerCase().includes(s) ||
        emp?.passportNumber?.toLowerCase().includes(s) ||
        loc?.name?.toLowerCase().includes(s) ||
        p.passNumber?.toLowerCase().includes(s) ||
        p.id?.toLowerCase().includes(s) ||
        p.applicationId?.toLowerCase().includes(s) ||
        p.requestId?.toLowerCase().includes(s)
      );

      // History (expired/revoked/cancelled/rejected) is kept but only listed when the user
      // specifically searches for it or explicitly picks that status filter.
      const historyRequested = s.trim().length >= 2 || (filterStatus && filterStatus !== 'all' && filterStatus !== 'active');
      if (isHistoryStatus(p.status) && !historyRequested) return false;

      const matchesStatus = s.trim().length >= 2 && isHistoryStatus(p.status) && (!filterStatus || filterStatus === 'all')
        ? true
        : filterPassApplicationItem(p.status, filterStatus);

      const matchesDate = isPassInDateRange(
        {
          startDate: p.startDate || p.issueDate || p.createdAt,
          expiryDate: p.expiryDate
        },
        startDateFilter,
        endDateFilter
      );

      return matchesSearch && matchesStatus && matchesDate;
    });

    return list.sort((a, b) => {
      let valA: any = '';
      let valB: any = '';
      if (passSortField === 'employeeId') {
        valA = employees.find(e => e.id === a.employeeId)?.employeeId || '';
        valB = employees.find(e => e.id === b.employeeId)?.employeeId || '';
      } else if (passSortField === 'name' || passSortField === 'employee') {
        valA = employees.find(e => e.id === a.employeeId)?.name || '';
        valB = employees.find(e => e.id === b.employeeId)?.name || '';
      } else if (passSortField === 'jobTitle') {
        valA = employees.find(e => e.id === a.employeeId)?.jobTitle || '';
        valB = employees.find(e => e.id === b.employeeId)?.jobTitle || '';
      } else if (passSortField === 'passInfo') {
        valA = a.passNumber || a.id || '';
        valB = b.passNumber || b.id || '';
      } else if (passSortField === 'location') {
        valA = locations.find(l => l.id === a.locationId)?.name || '';
        valB = locations.find(l => l.id === b.locationId)?.name || '';
      } else if (passSortField === 'validity') {
        valA = a.expiryDate || a.validUntil || '';
        valB = b.expiryDate || b.validUntil || '';
      } else if (passSortField === 'status') {
        valA = a.status || '';
        valB = b.status || '';
      }

      if (valA < valB) return passSortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return passSortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [allPassesCombined, globalSearch, employees, locations, filterStatus, passSortField, passSortOrder, startDateFilter, endDateFilter]);

  const togglePassSelection = (passId: string) => {
    setSelectedPasses(prev => 
      prev.includes(passId) ? prev.filter(id => id !== passId) : [...prev, passId]
    );
  };

  const handleBulkStatusUpdate = async (status: PassStatus, remarks?: string, specificIds?: string[]) => {
    const ids = specificIds || selectedPasses;
    if (ids.length === 0) return;

    const realPassIds = ids.filter(id => !id.startsWith('virtual-'));
    const virtualIds = ids.filter(id => id.startsWith('virtual-'));

    const executeUpdates = async (handoverBy?: string) => {
      try {
        if (realPassIds.length > 0) {
          await apiFetch(`/api/passes/bulk-status`, {
            method: 'PATCH',
            body: JSON.stringify({ passIds: realPassIds, status, remarks, handoverBy: handoverBy || '' })
          });
        }

        for (const vId of virtualIds) {
          const parts = vId.split('-');
          if (parts.length >= 3) {
            const appId = parts[1];
            const empId = parts.slice(2).join('-');
            await apiFetch(`/api/passApplications/${appId}/employee/${empId}`, {
              method: 'PATCH',
              body: JSON.stringify({ status, handoverBy: handoverBy || '' })
            });
          }
        }

        showToast(`Updated ${ids.length} passes to ${status}`);
        if (!specificIds) setSelectedPasses([]);
        setRevokeReason('');
        setIsRevokeModalOpen(false);
        setPendingStatus(null);
        onSuccess();
        logAction({
          type: 'bulk_updated',
          title: 'Pass Status Update',
          details: `Updated ${ids.length} passes to ${status}${remarks ? ` (Reason: ${remarks})` : ''}`,
          data: { status, remarks }
        });
      } catch (err: any) {
        showToast(err.message, 'error');
      }
    };

    // 1-Week Early Renewal Collection Constraint
    if (status === 'collected') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const prematurePass = allPassesCombined.find(p => {
        if (!ids.includes(p.id)) return false;
        if (!p.startDate) return false;
        const sTime = new Date(p.startDate).getTime();
        // Check if start date is more than 7 days in the future
        return sTime > today.getTime() + (7 * 24 * 60 * 60 * 1000);
      });

      if (prematurePass) {
        const sDate = parseToYMD(prematurePass.startDate);
        const oneWeekBefore = new Date(new Date(prematurePass.startDate).getTime() - (7 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        showToast(`Early Renewal Pass cannot be collected yet. Passes can only be collected within 1 week of start date (${formatDate(sDate)}), available starting ${formatDate(oneWeekBefore)}.`, 'error');
        return;
      }
    }

    // Supplementary Pass Revocation Confirmation Logic
    if (status === 'revoked') {
      const linkedSupplementary = passes.filter(p => {
        if (p.type !== 'supplementary') return false;
        if (['revoked', 'cancelled', 'rejected', 'expired'].includes(p.status)) return false;
        return ids.some(id => {
          const targetPass = allPassesCombined.find(tp => tp.id === id);
          if (!targetPass) return false;
          return (p.parentPassId && p.parentPassId === targetPass.id) || 
                 (targetPass.type === 'main' && (p.employeeId === targetPass.employeeId || p.parentPassId === (targetPass as any).id));
        });
      });

      if (linkedSupplementary.length > 0) {
        setRevokeSupplementaryModal({
          isOpen: true,
          targetPassIds: ids,
          supplementaryPasses: linkedSupplementary,
          onConfirm: async (reason: string) => {
            await executeUpdates(reason);
            setRevokeSupplementaryModal(null);
          }
        });
        return;
      }
    }

    const firstSelectedPass = allPassesCombined.find(p => ids.includes(p.id));
    const currentPassStatus = firstSelectedPass?.status || 'pending';
    const skipped = getSkippedWorkflowStages(currentPassStatus, status);

    if (skipped.length > 0) {
      setStageSkipConfirmModal({
        currentStatus: currentPassStatus,
        targetStatus: status,
        entityName: `${ids.length} Selected Pass(es)`,
        onConfirm: async () => {
          setStageSkipConfirmModal(null);
          if (status === 'collected') {
            setInputPromptModal({
              isOpen: true,
              title: "Mark Passes Collected",
              description: `Marking ${ids.length} pass(es) as collected.`,
              label: "Handover Party Name",
              defaultValue: currentUser?.name || "PRO / Authority",
              placeholder: "e.g., John Doe (PRO)",
              onSubmit: async (party) => {
                await executeUpdates(party || currentUser?.name || "PRO");
              }
            });
          } else {
            await executeUpdates('');
          }
        }
      });
      return;
    }

    if (status === 'collected') {
      setInputPromptModal({
        isOpen: true,
        title: "Mark Passes Collected",
        description: `Marking ${ids.length} pass(es) as collected.`,
        label: "Handover Party Name",
        defaultValue: currentUser?.name || "PRO / Authority",
        placeholder: "e.g., John Doe (PRO)",
        onSubmit: async (party) => {
          await executeUpdates(party || currentUser?.name || "PRO");
        }
      });
      return;
    }

    await executeUpdates('');
  };

  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  const handleExportExcel = () => {
    const workbook = XLSX.utils.book_new();

    const headers = [
      "S/N",
      "Pass Number",
      "Personnel Name",
      "Personnel ID / QID",
      "Location",
      "Site Code",
      "Pass Type",
      "Access Codes",
      "Issue / Start Date",
      "Expiry Date",
      "Contract Number",
      "Client Company",
      "Status"
    ];

    const rows = filteredPasses.map((pass, index) => {
      const emp = employees.find(e => e.id === pass.employeeId);
      const loc = locations.find(l => l.id === pass.locationId);
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
      return [
        (index + 1).toString(),
        pass.passNumber || pass.id || '—',
        emp?.name || '—',
        emp?.employeeId || emp?.qatarId || '—',
        loc?.name || '—',
        loc?.code || '—',
        pass.type === 'main' ? 'Main' : 'Supplementary',
        codes.join(', ') || 'General Access',
        formatDate(pass.issueDate || pass.startDate),
        formatDate(pass.expiryDate),
        pass.contractNumber || '—',
        pass.clientCompany || '—',
        pass.status?.toUpperCase() || 'UNKNOWN'
      ];
    });

    const worksheet = XLSX.utils.aoa_to_sheet([
      ["MANAGED PASSES REPORT"],
      [`Exported: ${new Date().toLocaleDateString()} | Total: ${filteredPasses.length} Records`],
      [],
      headers,
      ...rows
    ]);

    worksheet['!cols'] = [
      { wch: 6 },
      { wch: 18 },
      { wch: 28 },
      { wch: 18 },
      { wch: 24 },
      { wch: 12 },
      { wch: 14 },
      { wch: 22 },
      { wch: 16 },
      { wch: 16 },
      { wch: 18 },
      { wch: 22 },
      { wch: 14 }
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, "Managed Passes");
    XLSX.writeFile(workbook, `Managed_Passes_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const openRevokeModal = (status: PassStatus) => {
    setPendingStatus(status);
    setIsRevokeModalOpen(true);
  };

  return (
    <div className="space-y-6 flex-1 flex flex-col w-full min-h-[calc(100vh-96px)]">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-[#800020]"></div>
          <p className="text-[10px] font-bold text-[#6B7280] uppercase tracking-widest">Pass Status Management</p>
          <span className="px-2 py-0.5 bg-[#F3F4F6] text-[#6B7280] rounded-full text-[9px] font-bold">
            {filteredPasses.length} Results
          </span>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeFilter 
            startDate={startDateFilter}
            endDate={endDateFilter}
            onStartDateChange={setStartDateFilter}
            onEndDateChange={setEndDateFilter}
          />
          <select 
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-xl text-[10px] font-bold outline-none focus:ring-1 focus:ring-[#800020]"
          >
            <option value="all">All Managed Passes</option>
            <option value="active">Active / Collected Passes</option>
            <option value="accepted">Accepted</option>
            <option value="approved">Approved</option>
            <option value="expired">Expired</option>
            <option value="revoked">Revoked / Terminated</option>
            <option value="replaced">Replaced Passes</option>
          </select>

          <button 
            onClick={handleExportExcel}
            className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 hover:bg-emerald-100 rounded-xl text-[10px] font-bold transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="Export filtered pass list to Excel"
          >
            <Download size={13} />
            <span>Excel</span>
          </button>

          <button 
            onClick={() => setIsPrintModalOpen(true)}
            className="px-3 py-1.5 bg-white border border-[#E5E7EB] text-[#800020] hover:bg-rose-50 rounded-xl text-[10px] font-bold transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="Print or Export PDF"
          >
            <Printer size={13} />
            <span>Print / PDF</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden flex-1 flex flex-col min-h-[calc(100vh-220px)]">
        <div className="p-3 border-b border-[#F3F4F6] flex justify-between items-center bg-[#F9FAFB]/50">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <input 
                type="checkbox"
                checked={selectedPasses.length === filteredPasses.length && filteredPasses.length > 0}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedPasses(filteredPasses.map(p => p.id));
                  } else {
                    setSelectedPasses([]);
                  }
                }}
                className="w-4 h-4 rounded border-[#E5E7EB] text-[#800020] focus:ring-[#800020]"
              />
              <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">
                Select All ({selectedPasses.length} selected)
              </span>
            </div>
          </div>

          {selectedPasses.length > 0 && currentUser?.role === 'admin' && (
            <div className="flex items-center gap-2 animate-in fade-in">
              <button 
                onClick={() => handleBulkStatusUpdate('active')}
                className="px-3 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-[10px] font-bold transition-all border border-emerald-200 flex items-center gap-1"
              >
                <CheckCircle2 size={12} />
                Activate ({selectedPasses.length})
              </button>
              <button 
                onClick={() => openRevokeModal('revoked')}
                className="px-3 py-1 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg text-[10px] font-bold transition-all border border-rose-200 flex items-center gap-1"
              >
                <XCircle size={12} />
                Revoke ({selectedPasses.length})
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB] text-[10px] font-bold text-[#6B7280] uppercase tracking-wider sticky top-0 z-10">
              <tr>
                <th className="p-3 w-10"></th>
                <th className="p-3 w-12 text-center">S/N</th>
                <th className="p-3 cursor-pointer hover:bg-gray-100" onClick={() => handlePassSort('employee')}>
                  <div className="flex items-center gap-1">Personnel Name {passSortField === 'employee' && (passSortOrder === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</div>
                </th>
                <th className="p-3 cursor-pointer hover:bg-gray-100" onClick={() => handlePassSort('employeeId')}>
                  <div className="flex items-center gap-1">ID / QID {passSortField === 'employeeId' && (passSortOrder === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</div>
                </th>
                <th className="p-3 cursor-pointer hover:bg-gray-100" onClick={() => handlePassSort('passInfo')}>
                  <div className="flex items-center gap-1">Pass Number {passSortField === 'passInfo' && (passSortOrder === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</div>
                </th>
                <th className="p-3 cursor-pointer hover:bg-gray-100" onClick={() => handlePassSort('location')}>
                  <div className="flex items-center gap-1">Location & Site Code {passSortField === 'location' && (passSortOrder === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</div>
                </th>
                <th className="p-3">Access Codes & Areas</th>
                <th className="p-3 cursor-pointer hover:bg-gray-100" onClick={() => handlePassSort('validity')}>
                  <div className="flex items-center gap-1">Expiry Date {passSortField === 'validity' && (passSortOrder === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</div>
                </th>
                <th className="p-3 cursor-pointer hover:bg-gray-100" onClick={() => handlePassSort('status')}>
                  <div className="flex items-center gap-1">Current Status {passSortField === 'status' && (passSortOrder === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</div>
                </th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F4F6] text-xs font-medium text-[#1E293B]">
              {filteredPasses.map((pass, index) => {
                const emp = employees.find(e => e.id === pass.employeeId);
                const loc = locations.find(l => l.id === pass.locationId);
                const isSelected = selectedPasses.includes(pass.id);
                const resolved = resolvePersonnelStatus('', pass.status);

                // Normalize access codes safely
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

                return (
                  <tr key={pass.id} className={cn("hover:bg-[#F9FAFB]/80 transition-all", isSelected && "bg-[#800020]/5")}>
                    <td className="p-3">
                      <input 
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => togglePassSelection(pass.id)}
                        className="w-4 h-4 rounded border-[#E5E7EB] text-[#800020] focus:ring-[#800020]"
                      />
                    </td>
                    <td className="p-3 font-bold text-gray-500 font-mono text-[11px] text-center">{index + 1}</td>
                    <td className="p-3 font-bold text-[#1E293B]">{emp?.name || 'Unknown'}</td>
                    <td className="p-3 font-semibold text-gray-600">{emp?.employeeId || emp?.qatarId || '-'}</td>
                    <td className="p-3 font-bold text-[#800020]">{pass.passNumber || pass.id.toUpperCase()}</td>
                    <td className="p-3">
                      <div className="space-y-0.5">
                        <div className="font-bold text-gray-900">{loc?.name || '-'}</div>
                        {loc?.code && (
                          <span className="font-mono text-[10px] bg-[#800020]/10 text-[#800020] px-1.5 py-0.2 rounded border border-[#800020]/20 font-bold inline-block">
                            {loc.code}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1 max-w-[180px]">
                        {codes.length > 0 ? (
                          codes.map(codeStr => {
                            const code = accessCodes.find(ac => (ac.areaCode === codeStr || ac.id === codeStr) && (!ac.locationId || ac.locationId === pass.locationId)) 
                              || accessCodes.find(ac => ac.areaCode === codeStr || ac.id === codeStr);
                            return (
                              <span 
                                key={codeStr} 
                                className="px-1.5 py-0.5 bg-slate-100 text-slate-800 border border-slate-200 rounded text-[10px] font-bold inline-flex items-center gap-0.5"
                                title={code?.accessArea || codeStr}
                              >
                                <span className="text-[#800020] font-mono">#</span>
                                <span>{code?.areaCode || codeStr}</span>
                              </span>
                            );
                          })
                        ) : (
                          <span className="text-[10px] text-gray-400 italic">General Site Access</span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-gray-600">{formatDate(pass.expiryDate)}</td>
                    <td className="p-3">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                        resolved.isCreatedAndActive ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                      )}>
                        {resolved.label}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setInspectingPass(pass)}
                          className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-[#800020]"
                          title="View Pass Details"
                        >
                          <Eye size={14} />
                        </button>
                        {currentUser?.role === 'admin' && pass.status === 'revoked' && (
                          <button
                            onClick={() => onRevertStatus(pass.id)}
                            className="p-1.5 hover:bg-emerald-50 rounded-lg text-emerald-600"
                            title="Revert to Active"
                          >
                            <RefreshCw size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredPasses.length === 0 && (
            <div className="py-16 text-center text-gray-400 text-xs font-semibold">
              No passes match the selected filters.
            </div>
          )}
        </div>
      </div>

      {inspectingPass && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#1E293B]">Pass Details</h3>
              <button onClick={() => setInspectingPass(null)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
                <X size={16} />
              </button>
            </div>
            <PassDetails 
              pass={inspectingPass}
              employee={employees.find(e => e.id === inspectingPass.employeeId)}
              location={locations.find(l => l.id === inspectingPass.locationId)}
              accessCodes={accessCodes}
              onClose={() => setInspectingPass(null)}
              onUpdateStatus={(st) => {
                handleBulkStatusUpdate(st, '', [inspectingPass.id]);
                setInspectingPass(null);
              }}
              currentUser={currentUser}
            />
          </div>
        </div>
      )}

      {inputPromptModal && (
        <CustomInputPromptModal 
          isOpen={inputPromptModal.isOpen}
          title={inputPromptModal.title}
          description={inputPromptModal.description}
          label={inputPromptModal.label}
          defaultValue={inputPromptModal.defaultValue}
          placeholder={inputPromptModal.placeholder}
          onConfirm={(val) => {
            inputPromptModal.onSubmit(val);
            setInputPromptModal(null);
          }}
          onCancel={() => setInputPromptModal(null)}
        />
      )}

      <PrintExportModal 
        isOpen={isPrintModalOpen} 
        onClose={() => setIsPrintModalOpen(false)} 
        title="Print Managed Passes / Export PDF"
        documentTitle={`Managed_Passes_${filteredPasses.length}_Records`}
      >
        <div className="space-y-4">
          <div className="flex justify-between items-center border-b border-[#E5E7EB] pb-3">
            <div>
              <h2 className="text-base font-black text-[#800020] uppercase tracking-tight">Managed Passes Directory Report</h2>
              <p className="text-[10px] text-[#6B7280] font-bold">Showing {filteredPasses.length} pass records</p>
            </div>
            <button
              onClick={handleExportExcel}
              className="px-3 py-1.5 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Download size={14} />
              <span>Export to Excel</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#800020] text-white text-[9px] uppercase tracking-wider font-extrabold">
                  <th className="p-2 text-center rounded-tl-lg w-8 border-r border-rose-900/40">S/N</th>
                  <th className="p-2">Pass No.</th>
                  <th className="p-2">Personnel Name</th>
                  <th className="p-2">ID / QID</th>
                  <th className="p-2">Location & Code</th>
                  <th className="p-2">Access Codes</th>
                  <th className="p-2">Validity</th>
                  <th className="p-2 rounded-tr-lg">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {filteredPasses.map((pass, idx) => {
                  const emp = employees.find(e => e.id === pass.employeeId);
                  const loc = locations.find(l => l.id === pass.locationId);
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
                  return (
                    <tr key={pass.id} className={cn("text-[9px]", idx % 2 === 0 ? "bg-white" : "bg-[#F9FAFB]")}>
                      <td className="p-2 text-center font-bold text-gray-500 border-r border-gray-200">{idx + 1}</td>
                      <td className="p-2 font-bold text-[#800020]">{pass.passNumber || pass.id.toUpperCase()}</td>
                      <td className="p-2 font-bold text-gray-900">{emp?.name || 'Unknown'}</td>
                      <td className="p-2 font-mono text-gray-700">{emp?.employeeId || emp?.qatarId || '—'}</td>
                      <td className="p-2 text-gray-700">
                        {loc?.name || '—'} {loc?.code ? `(${loc.code})` : ''}
                      </td>
                      <td className="p-2 font-mono text-slate-700 font-bold">
                        {codes.join(', ') || 'General'}
                      </td>
                      <td className="p-2 text-gray-600 font-medium">{formatDate(pass.issueDate || pass.startDate)} to {formatDate(pass.expiryDate)}</td>
                      <td className="p-2">
                        <span className="px-2 py-0.5 rounded-full text-[8px] font-extrabold uppercase bg-gray-100 text-gray-800">
                          {pass.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </PrintExportModal>

      {/* Supplementary Pass Revocation Cascade Confirmation Modal */}
      {revokeSupplementaryModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 text-rose-700">
              <div className="p-2.5 bg-rose-100 rounded-xl">
                <AlertTriangle size={24} />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">Confirm Main Pass Revocation</h3>
                <p className="text-xs text-rose-700 font-semibold">Supplementary passes will also be revoked</p>
              </div>
            </div>

            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 space-y-2 text-xs">
              <p className="text-rose-900 font-bold">
                Revoking this Main Pass will automatically cascade and revoke the following {revokeSupplementaryModal.supplementaryPasses.length} linked Supplementary Pass(es):
              </p>
              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                {revokeSupplementaryModal.supplementaryPasses.map(sp => {
                  const spEmp = employees.find(e => e.id === sp.employeeId);
                  const spLoc = locations.find(l => l.id === sp.locationId);
                  return (
                    <div key={sp.id} className="bg-white p-2 rounded-lg border border-rose-200 text-[11px] flex items-center justify-between">
                      <div>
                        <span className="font-bold text-gray-900">{spEmp?.name || 'Personnel'}</span>
                        <span className="text-gray-500 ml-1">({sp.passNumber || sp.id})</span>
                      </div>
                      <span className="text-[10px] font-bold text-rose-800 bg-rose-100 px-2 py-0.5 rounded">
                        {spLoc?.name || 'Supplementary'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-gray-700">
                Reason for Revocation <span className="text-rose-600 font-bold">*</span>
              </label>
              <input
                type="text"
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="Enter mandatory reason for audit log..."
                className="w-full px-3.5 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-rose-600 font-medium"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setRevokeSupplementaryModal(null);
                  setRevokeReason('');
                }}
                className="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-xl text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (revokeSupplementaryModal) {
                    await revokeSupplementaryModal.onConfirm(revokeReason || 'Revoked by admin');
                  }
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
              >
                <XCircle size={14} />
                Confirm & Revoke All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stage Skip Confirmation Modal */}
      {stageSkipConfirmModal && (
        <StageSkipConfirmModal
          isOpen={!!stageSkipConfirmModal}
          onClose={() => setStageSkipConfirmModal(null)}
          onConfirm={stageSkipConfirmModal.onConfirm}
          currentStatus={stageSkipConfirmModal.currentStatus}
          targetStatus={stageSkipConfirmModal.targetStatus}
          entityName={stageSkipConfirmModal.entityName}
        />
      )}
    </div>
  );
}
