import React, { useState, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, Search, Filter, Shield, Clock, CheckCircle2, XCircle, X, Archive,
  ChevronRight, ChevronDown, User as UserIcon, MapPin, Key, 
  Calendar, FileText, Trash2, Edit2, Settings2, Upload, AlertCircle,
  MoreVertical, Info, Download, Printer, History, ArrowRight, Table, Ban,
  Activity, Users, Check, LayoutGrid, Tag, Send, ClipboardCheck, PlusCircle,
  Layers, Eye, Grid, ClipboardList, ArrowUpDown, ArrowUp, ArrowDown, Loader2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { BulkImportReview } from '../common/BulkImportReview';
import { PrintExportModal } from '../common/PrintExportModal';
import { DateRangeFilter } from '../common/DateRangeFilter';
import { PassDetails } from './PassDetails';
import { 
  Pass, PassApplication, Employee, Location, Category, AccessCode, Project, 
  UserProfile, AppAction 
} from '../../types';
import { apiFetch, cn, formatDate, isPassInDateRange } from '../../lib/utils';
import { parseExcelDate, detectEmployeeUpdates } from '../../utils/excelUtils';
import { 
  calculateApplicationStats, 
  getApplicationBadgeProps, 
  resolvePersonnelStatus, 
  computeApplicationRollupStatus, 
  filterPassApplicationItem 
} from '../../utils/passStatus';

export interface PassApplicationsViewProps {
  passes: Pass[];
  applications: PassApplication[];
  employees: Employee[];
  locations: Location[];
  categories: Category[];
  accessCodes: AccessCode[];
  projects: Project[];
  currentUser: UserProfile | null;
  onSuccess: () => void;
  globalSearch: string;
  onNewPass: (data?: any) => void;
  onNewApplication: (data?: any) => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
  logAction: (action: Omit<AppAction, 'id' | 'timestamp'>) => void;
  showReplay: boolean;
  setShowReplay: (show: boolean) => void;
}

export function PassApplicationsView({ 
  passes, 
  applications, 
  employees, 
  locations, 
  categories, 
  accessCodes, 
  projects, 
  currentUser, 
  onSuccess, 
  globalSearch, 
  onNewPass, 
  onNewApplication, 
  showToast, 
  showConfirm, 
  logAction, 
  showReplay, 
  setShowReplay 
}: PassApplicationsViewProps) { 
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStep, setImportStep] = useState<'upload' | 'mapping' | 'review'>('upload');
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [rawImportData, setRawImportData] = useState<any[] | null>(null);
  const [importResults, setImportResults] = useState<any[] | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [startDateFilter, setStartDateFilter] = useState<string>('');
  const [endDateFilter, setEndDateFilter] = useState<string>('');
  const [queueSortBy, setQueueSortBy] = useState<string>('newest');
  const [passSortField, setPassSortField] = useState<string>('employee');
  const [passSortOrder, setPassSortOrder] = useState<'asc' | 'desc'>('asc');

  const handlePassSort = (field: string) => {
    if (passSortField === field) {
      setPassSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setPassSortField(field);
      setPassSortOrder('asc');
    }
  };

  const [selectedEmployees, setSelectedEmployees] = useState<Record<string, string[]>>({});
  const [selectedPasses, setSelectedPasses] = useState<Record<string, string[]>>({});
  const [expandedApplications, setExpandedApplications] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');

  const location = useLocation();

  useEffect(() => {
    const stateAppId = (location.state as any)?.openAppId;
    const searchParams = new URLSearchParams(location.search);
    const paramAppId = searchParams.get('id') || searchParams.get('app');
    const targetId = stateAppId || paramAppId;
    if (targetId) {
      const key = targetId.trim().toUpperCase();
      setExpandedApplications(prev => ({ ...prev, [key]: true }));
      setTimeout(() => {
        const el = document.getElementById(`app-card-${key}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);
    }
  }, [location]);

  // Compute applications list and statistics
  const filteredApps = useMemo(() => {
    return applications.filter(app => {
      const s = globalSearch.toLowerCase();
      const loc = locations.find(l => l.id === app.locationId);
      const matchesSearch = !s || Boolean(
        app.id.toLowerCase().includes(s) ||
        app.authorityAppNumber?.toLowerCase().includes(s) ||
        loc?.name?.toLowerCase().includes(s) ||
        app.employeeIds.some(empId => {
          const emp = employees.find(e => e.id === empId);
          return emp?.name?.toLowerCase().includes(s) || emp?.employeeId?.toLowerCase().includes(s) || emp?.qatarId?.toLowerCase().includes(s);
        })
      );
      const matchesStatus = filterPassApplicationItem(app.status, statusFilter);
      const matchesType = filterType === 'all' || app.type === filterType;
      const matchesDate = isPassInDateRange(app, startDateFilter, endDateFilter);
      return matchesSearch && matchesStatus && matchesType && matchesDate;
    }).sort((a, b) => {
      if (queueSortBy === 'oldest') {
        return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      }
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
  }, [applications, globalSearch, statusFilter, filterType, startDateFilter, endDateFilter, queueSortBy, employees, locations]);

  const isArchivedApp = (app: PassApplication) => {
    const s = (app.status || '').toLowerCase();
    if (s === 'archived' || s === 'completed' || s === 'rejected' || s === 'cancelled') {
      return true;
    }
    // Also check if all members are cancelled or completed
    const passesForApp = passes.filter(p => {
      const pReqId = (p.requestId || p.applicationId || '').trim().toUpperCase();
      const pAuthId = (p.authorityAppNumber || '').trim().toUpperCase();
      const appIdUpper = app.id.trim().toUpperCase();
      return pReqId === appIdUpper || (pAuthId && pAuthId === appIdUpper);
    });
    const stats = calculateApplicationStats(app.employeeIds, app.employeeStatuses || {}, passesForApp);
    const computed = computeApplicationRollupStatus(app.status, stats);
    return computed === 'archived' || computed === 'completed' || computed === 'rejected' || computed === 'cancelled';
  };

  const activeApps = useMemo(() => filteredApps.filter(a => !isArchivedApp(a)), [filteredApps, passes]);
  const archivedApps = useMemo(() => filteredApps.filter(a => isArchivedApp(a)), [filteredApps, passes]);

  const displayedApps = activeTab === 'active' ? activeApps : archivedApps;

  const handleExportExcel = () => {
    const workbook = XLSX.utils.book_new();

    const headers = [
      "S/N",
      "Application Ref",
      "Authority App No",
      "Location",
      "Type",
      "Total Personnel",
      "Start Date",
      "Applicant Pass Expiry",
      "Status",
      "Submitted At"
    ];

    const rows = displayedApps.map((app, index) => {
      const loc = locations.find(l => l.id === app.locationId);
      return [
        (index + 1).toString(),
        `#${app.id.toUpperCase()}`,
        app.authorityAppNumber || '—',
        loc?.name || '—',
        app.type === 'main' ? 'Main' : 'Supplementary',
        (app.employeeIds?.length || 0).toString(),
        formatDate(app.startDate),
        formatDate(app.endDate || (() => {
          const exps = Object.values(app.individualExpiries || {}).filter(Boolean) as string[];
          return exps.length > 0 ? [...exps].sort().reverse()[0] : undefined;
        })()),
        app.status.toUpperCase(),
        formatDate(app.createdAt)
      ];
    });

    const worksheet = XLSX.utils.aoa_to_sheet([
      ["PASS APPLICATIONS QUEUE REPORT"],
      [`Exported: ${new Date().toLocaleDateString()} | Total: ${displayedApps.length} Applications`],
      [],
      headers,
      ...rows
    ]);

    worksheet['!cols'] = [
      { wch: 6 },
      { wch: 18 },
      { wch: 20 },
      { wch: 25 },
      { wch: 14 },
      { wch: 16 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 }
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, "Applications Queue");
    XLSX.writeFile(workbook, `Pass_Applications_Queue_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Top Action & Filter Bar */}
      <div className="space-y-3 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setActiveTab('active')}
              className={cn(
                "h-9 px-3.5 rounded-xl text-xs font-bold transition-all cursor-pointer",
                activeTab === 'active' 
                  ? "bg-[#800020] text-white shadow-2xs" 
                  : "bg-gray-50 text-gray-600 hover:bg-gray-100"
              )}
            >
              Active Applications ({activeApps.length})
            </button>
            <button 
              onClick={() => setActiveTab('archived')}
              className={cn(
                "h-9 px-3.5 rounded-xl text-xs font-bold transition-all cursor-pointer",
                activeTab === 'archived' 
                  ? "bg-[#800020] text-white shadow-2xs" 
                  : "bg-gray-50 text-gray-600 hover:bg-gray-100"
              )}
            >
              History / Archived ({archivedApps.length})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DateRangeFilter 
              startDate={startDateFilter}
              endDate={endDateFilter}
              onStartDateChange={setStartDateFilter}
              onEndDateChange={setEndDateFilter}
            />
            <button
              onClick={() => setIsPrintModalOpen(true)}
              className="h-9 px-3.5 bg-white text-gray-700 hover:bg-gray-50 rounded-xl border border-gray-200 transition-all flex items-center gap-1.5 text-xs font-bold cursor-pointer shadow-2xs"
              title="Print or Export Queue"
            >
              <Printer size={14} className="text-[#800020]" />
              <span>Export</span>
            </button>
            {currentUser?.role !== 'viewer' && (
              <button
                onClick={() => onNewApplication()}
                className="h-9 px-3.5 bg-[#800020] text-white hover:bg-[#600018] rounded-xl font-bold transition-all shadow-2xs flex items-center gap-1.5 text-xs cursor-pointer"
              >
                <Plus size={14} />
                <span>New Application</span>
              </button>
            )}
          </div>
        </div>

        {/* 4-Stage Workflow Filter Pills */}
        <div className="pt-2 border-t border-gray-100 flex items-center gap-1.5 overflow-x-auto custom-scrollbar">
          {[
            { key: 'all', label: 'All Stages' },
            { key: 'pending', label: 'Stage 1: Under Review' },
            { key: 'processing', label: 'Stage 2: Under Processing' },
            { key: 'accepted', label: 'Stage 3: Accepted for Processing' },
            { key: 'issued', label: 'Stage 4: Pass Issued' },
            { key: 'collected', label: 'Stage 4: Collected & Active' },
            { key: 'rejected', label: 'Rejected' },
            { key: 'cancelled', label: 'Cancelled' }
          ].map(st => (
            <button
              key={st.key}
              onClick={() => setStatusFilter(st.key)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap",
                statusFilter === st.key 
                  ? "bg-gray-900 text-white shadow-2xs" 
                  : "bg-gray-100/80 text-gray-600 hover:bg-gray-200/60"
              )}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      {/* Applications List View */}
      <div className="space-y-4">
        {displayedApps.map((app) => {
          const isExpanded = !!expandedApplications[app.id.toUpperCase()];
          const loc = locations.find(l => l.id === app.locationId);
          const passesForApp = passes.filter(p => {
            const pReqId = (p.requestId || p.applicationId || '').trim().toUpperCase();
            const pAuthId = (p.authorityAppNumber || '').trim().toUpperCase();
            const appIdUpper = app.id.trim().toUpperCase();
            return pReqId === appIdUpper || (pAuthId && pAuthId === appIdUpper);
          });
          const stats = calculateApplicationStats(app.employeeIds, app.employeeStatuses || {}, passesForApp, app.status);
          const computedStatus = computeApplicationRollupStatus(app.status, stats);
          const badgeProps = getApplicationBadgeProps(computedStatus, app.employeeIds.length);

          const unissuedEmployeeIds = app.employeeIds.filter(empId => {
            return !passesForApp.some(p => p.employeeId === empId);
          });

          return (
            <div 
              key={app.id} 
              id={`app-card-${app.id.toUpperCase()}`}
              className="bg-white rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-md transition-all overflow-hidden"
            >
              <div 
                onClick={() => setExpandedApplications(prev => ({ ...prev, [app.id.toUpperCase()]: !isExpanded }))}
                className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-gray-50/50 transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-red-50 text-[#800020] flex items-center justify-center font-bold text-xs shrink-0 border border-red-100">
                    <FileText size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-extrabold text-sm text-[#1E293B]">#{app.id.toUpperCase()}</span>
                      {app.authorityAppNumber && (
                        <span className="font-semibold text-xs text-[#800020] bg-[#800020]/5 px-2 py-0.5 rounded-md border border-[#800020]/20">
                          {app.authorityAppNumber}
                        </span>
                      )}
                      <span className={cn("px-2.5 py-0.5 rounded-full text-[10px] font-bold border", badgeProps.bg)}>
                        {badgeProps.label}
                      </span>
                      {app.type === 'supplementary' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                          SUPPLEMENTARY
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 font-medium mt-1">
                      <span className="flex items-center gap-1 font-semibold text-gray-800">
                        <MapPin size={12} className="text-[#800020]" />
                        {loc?.name || 'Multiple Sites'}
                        {loc?.code && (
                          <span className="font-mono text-[10px] bg-[#800020]/10 text-[#800020] px-1.5 py-0.2 rounded font-bold border border-[#800020]/20">
                            {loc.code}
                          </span>
                        )}
                      </span>
                      <span>•</span>
                      <span>{app.employeeIds.length} Personnel</span>
                      <span>•</span>
                      <span>Submitted {formatDate(app.createdAt)}</span>
                      {app.accessCodes && app.accessCodes.length > 0 && (
                        <>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Key size={11} className="text-[#800020]" />
                            <span className="font-mono text-[10px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200">
                              {app.accessCodes.slice(0, 3).join(', ')}{app.accessCodes.length > 3 ? ` +${app.accessCodes.length - 3}` : ''}
                            </span>
                          </span>
                        </>
                      )}
                      {app.contractNumber && (
                        <>
                          <span>•</span>
                          <span className="text-[10px] font-mono font-bold text-gray-600">
                            Ctr: {app.contractNumber}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 flex-wrap">
                  {/* 4-Stage Progress Stats Pills */}
                  <div className="flex items-center gap-1.5 text-xs font-semibold flex-wrap">
                    {stats.activeCollectedCount > 0 && (
                      <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[11px]" title="Stage 4: Collected & Active Passes">
                        {stats.activeCollectedCount} Collected
                      </span>
                    )}
                    {stats.issuedCount > 0 && (
                      <span className="px-2 py-0.5 bg-teal-50 text-teal-700 border border-teal-200 rounded-lg text-[11px]" title="Stage 4: Pass Issued (Awaiting Handover)">
                        {stats.issuedCount} Issued
                      </span>
                    )}
                    {stats.acceptedCount > 0 && (
                      <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-[11px]" title="Stage 3: Accepted for Processing">
                        {stats.acceptedCount} Accepted
                      </span>
                    )}
                    {stats.processingCount > 0 && (
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-[11px]" title="Stage 2: Under Processing">
                        {stats.processingCount} Under Processing
                      </span>
                    )}
                    {stats.pendingCount > 0 && (
                      <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-[11px]" title="Stage 1: Under Review">
                        {stats.pendingCount} Under Review
                      </span>
                    )}
                    {stats.cancelledCount > 0 && (
                      <span className="px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-[11px]" title="Cancelled / Rejected Personnel">
                        {stats.cancelledCount} Rejected
                      </span>
                    )}
                  </div>

                  {/* Action Buttons: Open & Edit */}
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/applications/${app.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="px-3 py-1.5 bg-[#800020] text-white hover:bg-[#600018] rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-all shrink-0 cursor-pointer"
                    >
                      <Eye size={14} />
                      Open Application
                      <ArrowRight size={14} />
                    </Link>

                    {currentUser?.role !== 'viewer' && (
                      <Link
                        to={`/applications/${app.id}?edit=true`}
                        onClick={(e) => e.stopPropagation()}
                        className="px-3 py-1.5 bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-all shrink-0 cursor-pointer"
                        title="Edit Application Details"
                      >
                        <Edit2 size={14} />
                        Edit Application
                      </Link>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <ChevronDown size={18} className={cn("text-gray-400 transition-transform duration-200", isExpanded && "rotate-180")} />
                  </div>
                </div>
              </div>

              {/* Expanded Application Personnel & Pass List */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="border-t border-gray-100 bg-gray-50/50 p-5 space-y-4"
                  >
                    {/* Location, Access Scope & Contract Summary */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Panel 1: Location & Access Authorization */}
                      <div className="bg-white p-3.5 rounded-xl border border-gray-200 space-y-2 text-xs">
                        <div className="flex items-center justify-between border-b border-gray-100 pb-1.5">
                          <span className="font-bold text-gray-700 flex items-center gap-1.5">
                            <Shield size={13} className="text-[#800020]" />
                            Location & Access Scope
                          </span>
                          <span className="font-bold uppercase text-[10px] text-[#800020] bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                            {app.type === 'supplementary' ? 'Supplementary Pass' : 'Main Pass'}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div>
                            <span className="text-[10px] text-gray-400 font-bold uppercase block">Facility / Location</span>
                            <div className="font-bold text-gray-900 flex items-center gap-1 mt-0.5">
                              <MapPin size={11} className="text-[#800020]" />
                              <span>{loc?.name || 'Multiple Sites'}</span>
                              {loc?.code && (
                                <span className="font-mono text-[10px] bg-[#800020]/10 text-[#800020] px-1 py-0.2 rounded border border-[#800020]/20 font-bold">
                                  {loc.code}
                                </span>
                              )}
                            </div>
                          </div>
                          <div>
                            <span className="text-[10px] text-gray-400 font-bold uppercase block">Facility Category</span>
                            <span className="font-semibold text-gray-700 mt-0.5 block">
                              {categories.find(c => c.id === loc?.categoryId)?.name || 'General Operations'}
                            </span>
                          </div>
                        </div>
                        <div className="pt-1.5 border-t border-gray-100">
                          <span className="text-[10px] text-gray-400 font-bold uppercase block mb-1">
                            Authorized Access Codes ({app.accessCodes?.length || 0})
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {app.accessCodes && app.accessCodes.length > 0 ? (
                              app.accessCodes.map(codeStr => {
                                const ac = accessCodes.find(a => (a.areaCode || a.id) === codeStr || a.id === codeStr);
                                return (
                                  <span 
                                    key={codeStr} 
                                    className="px-1.5 py-0.5 bg-slate-100 text-slate-800 border border-slate-200 rounded text-[10px] font-bold inline-flex items-center gap-1"
                                    title={ac?.accessArea || codeStr}
                                  >
                                    <span className="text-[#800020] font-mono">#</span>
                                    <span>{ac?.areaCode || codeStr}</span>
                                    {ac?.accessArea && (
                                      <span className="text-gray-400 font-normal text-[9px] truncate max-w-[80px]">
                                        ({ac.accessArea})
                                      </span>
                                    )}
                                  </span>
                                );
                              })
                            ) : (
                              <span className="text-[10px] text-gray-400 italic">General Site Access</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Panel 2: Contract & Governance Details */}
                      <div className="bg-white p-3.5 rounded-xl border border-gray-200 space-y-2 text-xs">
                        <div className="flex items-center justify-between border-b border-gray-100 pb-1.5">
                          <span className="font-bold text-gray-700 flex items-center gap-1.5">
                            <FileText size={13} className="text-[#800020]" />
                            Contract & Client Governance
                          </span>
                          <span className="text-[10px] font-mono text-gray-500 font-bold">
                            {app.contractNumber || 'No Contract #'}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div>
                            <span className="text-[10px] text-gray-400 font-bold uppercase block">Contract / Project</span>
                            <span className="font-bold text-gray-800 mt-0.5 block truncate" title={app.contractName || 'General Facility Services'}>
                              {app.contractName || 'General Facility Services'}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-gray-400 font-bold uppercase block">Client Company</span>
                            <span className="font-bold text-gray-800 mt-0.5 block truncate" title={app.clientCompany || 'Internal Organization'}>
                              {app.clientCompany || 'Internal Organization'}
                            </span>
                          </div>
                        </div>
                        <div className="pt-1.5 border-t border-gray-100">
                          <span className="text-[10px] text-gray-400 font-bold uppercase block mb-0.5">Client Approvers</span>
                          <p className="text-[11px] text-gray-700 font-medium truncate" title={app.clientApprovers || 'Standard Authority Approvers'}>
                            {app.clientApprovers || 'Standard Authority Approvers'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Header of Personnel Roster */}
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <h5 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Application Personnel Roster</h5>
                        <span className="text-[10px] text-gray-400 font-medium">({app.employeeIds.length} Applicants)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/applications/${app.id}`}
                          className="px-3 py-1.5 bg-[#800020] text-white hover:bg-[#600018] rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
                        >
                          <Eye size={14} />
                          <span>Open in Application Workspace</span>
                          <ArrowRight size={14} />
                        </Link>
                      </div>
                    </div>

                    {/* Roster Table */}
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-500 uppercase">
                          <tr>
                            <th className="p-3">Personnel Name</th>
                            <th className="p-3">ID / QID</th>
                            <th className="p-3">Job Title & Dept</th>
                            <th className="p-3">Workflow Status</th>
                            <th className="p-3">Pass Validity & Expiry</th>
                            <th className="p-3">Pass #</th>
                            <th className="p-3 text-right">Workspace</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
                          {app.employeeIds.map(empId => {
                            const emp = employees.find(e => e.id === empId);
                            const empPass = passesForApp.find(p => p.employeeId === empId);
                            const rawStatus = app.employeeStatuses?.[empId] || app.status || 'pending';
                            const resolved = resolvePersonnelStatus(rawStatus, empPass?.status, app.status);

                            // Resolve stage-specific badge style
                            let stageBadgeClass = "bg-gray-50 text-gray-700 border border-gray-200";
                            if (resolved.statusKey === 'cancelled' || resolved.statusKey === 'rejected') {
                              stageBadgeClass = "bg-rose-50 text-rose-700 border border-rose-200";
                            } else if (resolved.isCreatedAndActive) {
                              stageBadgeClass = "bg-emerald-50 text-emerald-700 border border-emerald-200";
                            } else if (resolved.statusKey === 'issued') {
                              stageBadgeClass = "bg-teal-50 text-teal-700 border border-teal-200";
                            } else if (resolved.statusKey === 'accepted') {
                              stageBadgeClass = "bg-indigo-50 text-indigo-700 border border-indigo-200";
                            } else if (resolved.statusKey === 'processing') {
                              stageBadgeClass = "bg-blue-50 text-blue-700 border border-blue-200";
                            } else if (resolved.statusKey === 'pending') {
                              stageBadgeClass = "bg-amber-50 text-amber-700 border border-amber-200";
                            }

                            const indExp = (app.individualExpiries as any)?.[empId];
                            const indStart = (app.individualStartDates as any)?.[empId];
                            const startVal = indStart || empPass?.startDate || app.startDate || app.createdAt;
                            const endVal = indExp || empPass?.expiryDate || app.endDate || app.expiryDate;
                            const startFmt = formatDate(startVal);
                            const endFmt = formatDate(endVal);

                            return (
                              <tr key={empId} className="hover:bg-gray-50/80">
                                <td className="p-3 font-bold text-[#1E293B]">{emp?.name || 'Unknown Member'}</td>
                                <td className="p-3">{emp?.employeeId || emp?.qatarId || '-'}</td>
                                <td className="p-3">
                                  <div>{emp?.jobTitle || '-'}</div>
                                  <div className="text-[10px] text-gray-400">{emp?.department || '-'}</div>
                                </td>
                                <td className="p-3">
                                  <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase", stageBadgeClass)}>
                                    {resolved.label}
                                  </span>
                                </td>
                                <td className="p-3 font-semibold text-gray-800">
                                  {startFmt !== '-' && endFmt !== '-' ? (
                                    <div className="flex items-center gap-1 text-xs text-gray-900 font-bold whitespace-nowrap">
                                      <Calendar size={13} className="text-[#800020] shrink-0" />
                                      <span>{startFmt} to {endFmt}</span>
                                    </div>
                                  ) : endFmt !== '-' ? (
                                    <div className="flex items-center gap-1 text-xs text-gray-900 font-bold whitespace-nowrap">
                                      <Calendar size={13} className="text-[#800020] shrink-0" />
                                      <span>Valid until {endFmt}</span>
                                    </div>
                                  ) : (
                                    <span className="text-xs text-gray-400 italic">Dates pending</span>
                                  )}
                                  <div className="text-[10px] text-gray-400 font-normal mt-0.5">
                                    {indExp ? 'Per-Applicant Date' : empPass?.expiryDate ? 'Issued Pass Date' : 'Application Date'}
                                  </div>
                                </td>
                                <td className="p-3 font-bold">
                                  {empPass?.passNumber ? (
                                    <span className="px-2 py-0.5 bg-[#800020]/10 text-[#800020] rounded text-xs font-bold border border-[#800020]/20">
                                      #{empPass.passNumber}
                                    </span>
                                  ) : empPass?.id ? (
                                    <span className="px-2 py-0.5 bg-[#800020]/10 text-[#800020] rounded text-xs font-bold border border-[#800020]/20">
                                      #{empPass.id.toUpperCase()}
                                    </span>
                                  ) : (
                                    <span className="text-gray-400 font-normal italic">Pending Issue</span>
                                  )}
                                </td>
                                <td className="p-3 text-right whitespace-nowrap">
                                  <Link
                                    to={`/applications/${app.id}`}
                                    className="px-2.5 py-1 bg-gray-100 hover:bg-[#800020] hover:text-white rounded-lg text-[11px] font-bold text-gray-700 transition-all inline-flex items-center gap-1"
                                    title="Open application workspace to manage this applicant"
                                  >
                                    <span>Details</span>
                                    <ArrowRight size={11} />
                                  </Link>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Centralized Workspace Routing Notice */}
                    <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-gray-200 text-xs">
                      <span className="text-gray-500 font-medium">
                        Stage transitions, approvals, issuance, and audit history are managed centrally in the Application Workspace.
                      </span>
                      <Link
                        to={`/applications/${app.id}`}
                        className="text-xs font-bold text-[#800020] hover:underline inline-flex items-center gap-1 shrink-0"
                      >
                        Open Workspace <ArrowRight size={12} />
                      </Link>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {displayedApps.length === 0 && (
          <div className="py-16 text-center bg-white rounded-2xl border border-dashed border-gray-200">
            <FileText size={32} className="mx-auto mb-3 text-gray-300" />
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">No applications found in queue</p>
          </div>
        )}
      </div>

      <PrintExportModal 
        isOpen={isPrintModalOpen} 
        onClose={() => setIsPrintModalOpen(false)} 
        title="Export Queue Applications / Print Report"
        documentTitle={`Applications_Queue_${displayedApps.length}_Records`}
        onExportExcel={handleExportExcel}
      >
        <div className="space-y-4">
          <div className="flex justify-between items-center border-b border-[#E5E7EB] pb-3">
            <div>
              <h2 className="text-base font-black text-[#800020] uppercase tracking-tight">Pass Applications Queue Report</h2>
              <p className="text-[10px] text-[#6B7280] font-bold">Showing {displayedApps.length} applications in current view</p>
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
                  <th className="p-2">App Ref #</th>
                  <th className="p-2">Authority App #</th>
                  <th className="p-2">Location</th>
                  <th className="p-2">Type</th>
                  <th className="p-2 text-center">Personnel</th>
                  <th className="p-2">Applicant Pass Expiry</th>
                  <th className="p-2 rounded-tr-lg">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {displayedApps.map((app, idx) => {
                  const loc = locations.find(l => l.id === app.locationId);
                  return (
                    <tr key={app.id} className={cn("text-[9px]", idx % 2 === 0 ? "bg-white" : "bg-[#F9FAFB]")}>
                      <td className="p-2 text-center font-bold text-gray-500 border-r border-gray-200">{idx + 1}</td>
                      <td className="p-2 font-bold text-[#800020]">#{app.id.toUpperCase()}</td>
                      <td className="p-2 font-mono text-gray-800">{app.authorityAppNumber || '—'}</td>
                      <td className="p-2 font-semibold text-gray-800">{loc?.name || '—'}</td>
                      <td className="p-2 capitalize font-medium text-gray-600">{app.type}</td>
                      <td className="p-2 text-center font-bold text-gray-800">{app.employeeIds?.length || 0}</td>
                      <td className="p-2 text-gray-600 font-medium">{formatDate(app.startDate)} to {formatDate(app.endDate || (() => {
                        const exps = Object.values(app.individualExpiries || {}).filter(Boolean) as string[];
                        return exps.length > 0 ? [...exps].sort().reverse()[0] : undefined;
                      })())}</td>
                      <td className="p-2">
                        <span className="px-2 py-0.5 rounded-full text-[8px] font-extrabold uppercase bg-gray-100 text-gray-800">
                          {app.status}
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
    </div>
  );
}
