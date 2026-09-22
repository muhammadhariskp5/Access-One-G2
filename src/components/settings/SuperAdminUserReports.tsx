import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, 
  Activity, 
  Radio, 
  Shield, 
  ShieldCheck, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Search, 
  RefreshCw, 
  Download, 
  Filter, 
  ExternalLink, 
  Globe, 
  Smartphone, 
  Monitor, 
  Key, 
  Lock, 
  UserCheck, 
  UserX, 
  Building2, 
  Layers,
  Pause,
  Play,
  FileSpreadsheet,
  Printer
} from 'lucide-react';
import { cn, formatDateTime, apiFetch } from '../../lib/utils';
import { UserProfile, UserRole, SuperAdminUserReport, UserPresence, UserWorkloadMetric, AuditLog, Division, Project, Department } from '../../types';
import { UserSettingsModal } from './UserSettingsModal';

interface SuperAdminUserReportsProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  divisions?: Division[];
  projects?: Project[];
  departments?: Department[];
  onSuccess?: () => void;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
  showConfirm?: (title: string, message: string, onConfirm: () => void) => void;
  onOpenAuditLogsForUser?: (userId: string) => void;
}

export function SuperAdminUserReports({
  currentUser,
  allUsers,
  divisions = [],
  projects = [],
  departments = [],
  onSuccess = () => {},
  showToast = () => {},
  showConfirm = () => {},
  onOpenAuditLogsForUser
}: SuperAdminUserReportsProps) {
  const [reportData, setReportData] = useState<SuperAdminUserReport | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [timeAgoText, setTimeAgoText] = useState<string>('Just now');

  // Polling settings
  const [isAutoRefresh, setIsAutoRefresh] = useState<boolean>(() => {
    const saved = localStorage.getItem('accessone_presence_auto_refresh');
    return saved !== null ? saved === 'true' : true;
  });
  const [refreshInterval, setRefreshInterval] = useState<number>(() => {
    const saved = localStorage.getItem('accessone_presence_refresh_interval');
    return saved ? parseInt(saved, 10) : 10;
  });

  // Filters & Tabs
  const [activeSubTab, setActiveSubTab] = useState<'presence' | 'workload' | 'auth-events'>('presence');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('ALL');
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<string>('ALL');

  // Modal for editing user
  const [selectedUserForModal, setSelectedUserForModal] = useState<UserProfile | null>(null);
  const [isUserSettingsOpen, setIsUserSettingsOpen] = useState(false);

  // Fetch report data
  const fetchReport = async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const res = await apiFetch('/api/admin/user-reports');
      if (res.ok) {
        const data = await res.json();
        setReportData(data);
        setLastRefreshedAt(new Date());
        if (isManual) {
          showToast('User reports & online presence updated', 'success');
        }
      }
    } catch (err: any) {
      console.warn('User report background fetch notification:', err?.message || err);
      if (isManual) {
        showToast('Unable to refresh user reports at this moment', 'error');
      }
    } finally {
      setIsLoading(false);
      if (isManual) setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, []);

  // Time-ago ticker
  useEffect(() => {
    const updateTicker = () => {
      const seconds = Math.floor((new Date().getTime() - lastRefreshedAt.getTime()) / 1000);
      if (seconds < 5) {
        setTimeAgoText('Just now');
      } else if (seconds < 60) {
        setTimeAgoText(`${seconds}s ago`);
      } else {
        const mins = Math.floor(seconds / 60);
        setTimeAgoText(`${mins}m ago`);
      }
    };

    updateTicker();
    const interval = setInterval(updateTicker, 2000);
    return () => clearInterval(interval);
  }, [lastRefreshedAt]);

  // Auto-refresh interval
  useEffect(() => {
    if (!isAutoRefresh) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchReport();
      }
    }, refreshInterval * 1000);
    return () => clearInterval(interval);
  }, [isAutoRefresh, refreshInterval]);

  const handleToggleAutoRefresh = (enabled: boolean) => {
    setIsAutoRefresh(enabled);
    localStorage.setItem('accessone_presence_auto_refresh', enabled ? 'true' : 'false');
    if (enabled) {
      showToast(`Live presence sync enabled (${refreshInterval}s)`, 'success');
      fetchReport(false);
    } else {
      showToast('Live presence sync paused', 'success');
    }
  };

  const handleChangeInterval = (sec: number) => {
    setRefreshInterval(sec);
    localStorage.setItem('accessone_presence_refresh_interval', sec.toString());
    showToast(`Polling rate set to ${sec}s`, 'success');
  };

  // Open user edit modal
  const handleOpenUserSettings = (userIdOrEmail: string) => {
    const found = allUsers.find(u => 
      (u.id && u.id.toLowerCase() === userIdOrEmail.toLowerCase()) || 
      (u.email && u.email.toLowerCase() === userIdOrEmail.toLowerCase())
    );
    if (found) {
      setSelectedUserForModal(found);
      setIsUserSettingsOpen(true);
    } else {
      showToast('User details not found in registry', 'error');
    }
  };

  // Export filtered workload roster to CSV
  const handleExportCSV = () => {
    if (!reportData) return;

    const headers = [
      'User ID',
      'Name',
      'Email',
      'Role',
      'Department',
      'Account Status',
      'Online Status',
      'Applications Created',
      'Approvals Processed',
      'Total Audit Actions',
      'Last Active'
    ];

    const rows = filteredWorkload.map(u => [
      `"${u.userId}"`,
      `"${u.userName}"`,
      `"${u.userEmail}"`,
      `"${u.role.toUpperCase()}"`,
      `"${u.department || 'Unassigned'}"`,
      `"${u.status}"`,
      `"${u.isOnline ? 'ONLINE' : 'OFFLINE'}"`,
      u.applicationsCreated,
      u.approvalsProcessed,
      u.totalActionsLogged,
      `"${u.lastActiveAt ? formatDateTime(u.lastActiveAt) : 'Never'}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `AccessOne_User_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Exported user report to CSV', 'success');
  };

  // Filtered Online Presences
  const filteredPresences = useMemo(() => {
    if (!reportData?.onlineUsers) return [];
    return reportData.onlineUsers.filter(p => {
      if (p.role === 'power_admin' || p.email?.toLowerCase() === 'm.techsandgadgets@gmail.com') return false;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || 
        p.displayName.toLowerCase().includes(q) || 
        p.email.toLowerCase().includes(q) || 
        (p.department && p.department.toLowerCase().includes(q)) ||
        (p.ipAddress && p.ipAddress.includes(q)) ||
        (p.currentPage && p.currentPage.toLowerCase().includes(q));

      const matchesRole = selectedRoleFilter === 'ALL' || p.role.toLowerCase() === selectedRoleFilter.toLowerCase();
      const matchesStatus = selectedStatusFilter === 'ALL' || p.status.toLowerCase() === selectedStatusFilter.toLowerCase();
      const matchesDept = selectedDeptFilter === 'ALL' || (p.department || '').toLowerCase() === selectedDeptFilter.toLowerCase();

      return matchesSearch && matchesRole && matchesStatus && matchesDept;
    });
  }, [reportData?.onlineUsers, searchQuery, selectedRoleFilter, selectedStatusFilter, selectedDeptFilter]);

  // Filtered Workload
  const filteredWorkload = useMemo(() => {
    if (!reportData?.workloadRanking) return [];
    return reportData.workloadRanking.filter(w => {
      if (w.role === 'power_admin' || w.userEmail?.toLowerCase() === 'm.techsandgadgets@gmail.com') return false;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || 
        w.userName.toLowerCase().includes(q) || 
        w.userEmail.toLowerCase().includes(q) || 
        (w.department && w.department.toLowerCase().includes(q)) ||
        w.userId.toLowerCase().includes(q);

      const matchesRole = selectedRoleFilter === 'ALL' || w.role.toLowerCase() === selectedRoleFilter.toLowerCase();
      const matchesStatus = selectedStatusFilter === 'ALL' || 
        (selectedStatusFilter === 'online' && w.isOnline) ||
        (selectedStatusFilter === 'offline' && !w.isOnline) ||
        (selectedStatusFilter === 'active' && w.status === 'active') ||
        (selectedStatusFilter === 'pending' && w.status === 'pending');
      
      const matchesDept = selectedDeptFilter === 'ALL' || (w.department || '').toLowerCase() === selectedDeptFilter.toLowerCase();

      return matchesSearch && matchesRole && matchesStatus && matchesDept;
    });
  }, [reportData?.workloadRanking, searchQuery, selectedRoleFilter, selectedStatusFilter, selectedDeptFilter]);

  // Filtered Auth Events
  const filteredAuthEvents = useMemo(() => {
    if (!reportData?.recentAuthEvents) return [];
    return reportData.recentAuthEvents.filter(ev => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || 
        ev.userEmail.toLowerCase().includes(q) || 
        (ev.userName && ev.userName.toLowerCase().includes(q)) || 
        ev.action.toLowerCase().includes(q) || 
        ev.details.toLowerCase().includes(q);

      return matchesSearch;
    });
  }, [reportData?.recentAuthEvents, searchQuery]);

  return (
    <div className="space-y-4">
      {/* Header & Live Polling Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <h2 className="text-base font-bold text-[#111827]">Super Admin User Reports & Online Presence</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Real-time live presence tracking, session duration, role distributions, and administrator workload analytics.
          </p>
        </div>

        {/* Live Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 p-1 bg-slate-50 rounded-lg border border-slate-200 shadow-2xs">
            {/* Auto Refresh Toggle */}
            <button
              type="button"
              onClick={() => handleToggleAutoRefresh(!isAutoRefresh)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer",
                isAutoRefresh 
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200/80 hover:bg-emerald-100/70" 
                  : "bg-slate-200/70 text-slate-600 hover:text-slate-900 border border-slate-300/60"
              )}
              title={isAutoRefresh ? "Live polling is active. Click to pause." : "Polling is paused. Click to enable real-time updates."}
            >
              {isAutoRefresh ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  <span>Live ({refreshInterval}s)</span>
                </>
              ) : (
                <>
                  <Pause size={12} className="text-slate-400" />
                  <span>Polling Off</span>
                </>
              )}
            </button>

            {/* Interval dropdown */}
            {isAutoRefresh && (
              <select
                value={refreshInterval}
                onChange={e => handleChangeInterval(Number(e.target.value))}
                className="bg-transparent text-[11px] font-semibold text-slate-700 outline-none cursor-pointer pr-1 border-r border-slate-200 mr-1"
                title="Change presence polling interval"
              >
                <option value={5}>5s</option>
                <option value={10}>10s</option>
                <option value={30}>30s</option>
                <option value={60}>60s</option>
              </select>
            )}

            {/* Manual Sync Button */}
            <button
              type="button"
              onClick={() => fetchReport(true)}
              disabled={isRefreshing}
              className="p-1 px-2 text-slate-600 hover:text-[#800020] hover:bg-white rounded flex items-center gap-1 text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
              title={`Click to refresh data now (Updated: ${timeAgoText})`}
            >
              <RefreshCw size={12} className={cn("text-slate-500", isRefreshing && "animate-spin text-[#800020]")} />
              <span>{isRefreshing ? 'Syncing...' : 'Sync'}</span>
            </button>
          </div>

          {/* Export CSV Button */}
          <button
            type="button"
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-2xs"
            title="Export User Analytics to CSV"
          >
            <Download size={13} className="text-slate-500" />
            <span>Export Report</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Users */}
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Users size={20} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Accounts</p>
            <p className="text-lg font-bold text-slate-900 leading-tight">
              {reportData?.totalUsers ?? allUsers.length}
            </p>
            <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
              <CheckCircle2 size={10} />
              <span>{reportData?.activeUsers ?? allUsers.filter(u => u.status === 'active').length} Active</span>
            </span>
          </div>
        </div>

        {/* Online Now */}
        <div className="bg-white p-3.5 rounded-xl border border-emerald-200/80 bg-emerald-50/20 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 relative">
            <Radio size={20} className="animate-pulse" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-emerald-500 rounded-full"></span>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wider flex items-center gap-1">
              <span>Online Now</span>
            </p>
            <p className="text-lg font-extrabold text-emerald-900 leading-tight">
              {reportData?.onlineNowCount ?? 0}
              <span className="text-xs font-semibold text-emerald-700/80 ml-1.5">
                ({reportData?.idleCount ?? 0} idle)
              </span>
            </p>
            <span className="text-[10px] text-emerald-700 font-semibold">Active in last 90s</span>
          </div>
        </div>

        {/* Admins & Approvers */}
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
            <ShieldCheck size={20} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Admins & Approvers</p>
            <p className="text-lg font-bold text-slate-900 leading-tight">
              {(reportData?.roleDistribution?.admin || 0) + (reportData?.roleDistribution?.approver || 0)}
            </p>
            <span className="text-[10px] text-slate-500 font-medium">
              {reportData?.roleDistribution?.admin || 0} Admins · {reportData?.roleDistribution?.approver || 0} Approvers
            </span>
          </div>
        </div>

        {/* Pending & Inactive */}
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <AlertCircle size={20} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Pending / Attention</p>
            <p className="text-lg font-bold text-slate-900 leading-tight">
              {reportData?.pendingUsersCount ?? allUsers.filter(u => u.status === 'pending').length}
            </p>
            <span className="text-[10px] text-amber-700 font-medium">Awaiting activation</span>
          </div>
        </div>
      </div>

      {/* Role & Department Distribution Visualizer */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Role Distribution Card */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <Shield size={14} className="text-[#800020]" />
              Role Distribution Matrix
            </h3>
            <span className="text-[11px] font-bold text-slate-500">
              {reportData?.totalUsers ?? allUsers.length} Total
            </span>
          </div>

          <div className="space-y-2">
            {[
              { role: 'admin', label: 'Super Admin / Admin', color: 'bg-[#800020]', text: 'text-[#800020]' },
              { role: 'approver', label: 'Approver / Security Officer', color: 'bg-indigo-600', text: 'text-indigo-600' },
              { role: 'applier', label: 'Applier / Requester', color: 'bg-emerald-600', text: 'text-emerald-600' },
              { role: 'viewer', label: 'Read-Only Viewer', color: 'bg-slate-500', text: 'text-slate-600' }
            ].map((item, idx) => {
              const count = reportData?.roleDistribution?.[item.role] || 0;
              const total = reportData?.totalUsers || allUsers.length || 1;
              const pct = Math.round((count / total) * 100);

              return (
                <div key={`rep-role-${item.role}-${idx}`} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">{item.label}</span>
                    <span className="font-bold text-slate-900">{count} <span className="text-slate-400 font-normal">({pct}%)</span></span>
                  </div>
                  <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className={cn("h-full rounded-full transition-all duration-500", item.color)} 
                      style={{ width: `${pct}%` }} 
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Department Density Card */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <Building2 size={14} className="text-blue-600" />
              Department User Density
            </h3>
            <span className="text-[11px] font-bold text-slate-500">
              {Object.keys(reportData?.departmentDistribution || {}).length} Departments
            </span>
          </div>

          <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
            {Object.entries(reportData?.departmentDistribution || {}).length === 0 ? (
              <p className="text-xs text-slate-400 italic py-3 text-center">No department assignments found</p>
            ) : (
              Object.entries(reportData?.departmentDistribution || {})
                .sort((a, b) => Number(b[1]) - Number(a[1]))
                .slice(0, 5)
                .map(([dept, countVal], idx) => {
                  const count = Number(countVal) || 0;
                  const total = reportData?.totalUsers || allUsers.length || 1;
                  const pct = Math.round((count / total) * 100);

                  return (
                    <div key={`rep-dept-${dept || 'unassigned'}-${idx}`} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700 truncate max-w-[200px]">{dept}</span>
                        <span className="font-bold text-slate-900">{count} <span className="text-slate-400 font-normal">({pct}%)</span></span>
                      </div>
                      <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className="h-full rounded-full bg-blue-600 transition-all duration-500" 
                          style={{ width: `${pct}%` }} 
                        />
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      </div>

      {/* Subtabs & Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        {/* Navigation Sub-tabs */}
        <div className="flex flex-wrap items-center justify-between border-b border-slate-200 bg-slate-50/70 px-4 py-2 gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveSubTab('presence')}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                activeSubTab === 'presence'
                  ? "bg-white text-[#800020] shadow-2xs border border-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              <Radio size={13} className={activeSubTab === 'presence' ? "text-emerald-500 animate-pulse" : "text-slate-400"} />
              <span>Live Online Sessions ({reportData?.onlineUsers?.length ?? 0})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab('workload')}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                activeSubTab === 'workload'
                  ? "bg-white text-[#800020] shadow-2xs border border-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              <Activity size={13} />
              <span>User Workload & Activity Roster</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab('auth-events')}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                activeSubTab === 'auth-events'
                  ? "bg-white text-[#800020] shadow-2xs border border-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              <Key size={13} />
              <span>Auth & Security Stream</span>
            </button>
          </div>

          {/* Quick Search */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 text-slate-400" size={13} />
              <input
                type="text"
                placeholder="Filter by name, email, IP, path..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1 bg-white border border-slate-200 rounded-md text-xs font-medium focus:border-[#800020] outline-none w-48 sm:w-60"
              />
            </div>
          </div>
        </div>

        {/* View 1: Real-Time Online Sessions */}
        {activeSubTab === 'presence' && (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                Showing <strong>{filteredPresences.length}</strong> active user sessions
              </span>
              <span className="text-[11px] text-slate-400">
                Sessions update automatically every {refreshInterval}s
              </span>
            </div>

            {filteredPresences.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl">
                <Radio className="mx-auto text-slate-300 mb-2" size={32} />
                <p className="text-xs font-bold text-slate-700">No active user sessions matched filters</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Users appear here in real-time as soon as they navigate or interact with the app.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredPresences.map((presence, idx) => {
                  const isCurrentLoggedUser = presence.userId === currentUser.id;

                  return (
                    <div
                      key={`pres-card-${presence.userId || presence.email || 'session'}-${idx}`}
                      className={cn(
                        "p-3.5 rounded-xl border transition-all relative overflow-hidden bg-white shadow-2xs hover:shadow-xs",
                        presence.status === 'online' ? "border-emerald-200" : "border-amber-200 bg-amber-50/10"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="relative">
                            <img
                              src={`https://ui-avatars.com/api/?name=${encodeURIComponent(presence.displayName)}&background=800020&color=fff`}
                              alt={presence.displayName}
                              className="w-9 h-9 rounded-full border border-slate-200 object-cover"
                            />
                            <span
                              className={cn(
                                "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white",
                                presence.status === 'online' ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
                              )}
                              title={presence.status === 'online' ? 'Active Now' : 'Idle'}
                            />
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-bold text-slate-900 truncate">{presence.displayName}</p>
                              {isCurrentLoggedUser && (
                                <span className="px-1.5 py-0.2 bg-slate-100 text-slate-600 text-[9px] font-bold rounded">
                                  You
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 truncate">{presence.email}</p>
                          </div>
                        </div>

                        <span
                          className={cn(
                            "px-2 py-0.5 text-[9px] font-extrabold uppercase rounded tracking-wider border",
                            presence.role === 'admin' ? "bg-[#800020]/10 text-[#800020] border-[#800020]/20" :
                            presence.role === 'approver' ? "bg-indigo-50 text-indigo-700 border-indigo-200" :
                            "bg-slate-100 text-slate-700 border-slate-200"
                          )}
                        >
                          {presence.role}
                        </span>
                      </div>

                      {/* Details row */}
                      <div className="mt-3 pt-2.5 border-t border-slate-100 grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-slate-400 block text-[9px] font-bold uppercase">Current Screen</span>
                          <span className="font-semibold text-slate-800 truncate block font-mono text-[10px]">
                            {presence.currentPage || '/'}
                          </span>
                        </div>

                        <div>
                          <span className="text-slate-400 block text-[9px] font-bold uppercase">Session Duration</span>
                          <span className="font-semibold text-slate-800">
                            {presence.sessionDurationMinutes ? `${presence.sessionDurationMinutes}m active` : 'Just started'}
                          </span>
                        </div>

                        <div>
                          <span className="text-slate-400 block text-[9px] font-bold uppercase">Last Heartbeat</span>
                          <span className="font-semibold text-slate-800">
                            {presence.secondsAgo !== undefined && presence.secondsAgo < 5 
                              ? 'Active now' 
                              : `${presence.secondsAgo}s ago`}
                          </span>
                        </div>

                        <div>
                          <span className="text-slate-400 block text-[9px] font-bold uppercase">Client IP / Host</span>
                          <span className="font-semibold text-slate-700 font-mono text-[10px] truncate block">
                            {presence.ipAddress || 'Localhost'}
                          </span>
                        </div>
                      </div>

                      {/* Action Bar */}
                      <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => handleOpenUserSettings(presence.userId)}
                          className="text-[11px] font-bold text-[#800020] hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <Shield size={11} />
                          <span>Inspect Account</span>
                        </button>

                        {onOpenAuditLogsForUser && (
                          <button
                            type="button"
                            onClick={() => onOpenAuditLogsForUser(presence.userId)}
                            className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
                          >
                            <Activity size={11} />
                            <span>Audit Trail</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* View 2: User Workload & Activity Roster */}
        {activeSubTab === 'workload' && (
          <div className="p-0 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 px-3">User & Presence</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Department</th>
                  <th className="py-2.5 px-3 text-center">Applications Created</th>
                  <th className="py-2.5 px-3 text-center">Approvals Handled</th>
                  <th className="py-2.5 px-3 text-center">Audit Actions</th>
                  <th className="py-2.5 px-3">Last Active</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredWorkload.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-slate-400 text-xs italic">
                      No user workload records found matching your filters.
                    </td>
                  </tr>
                ) : (
                  filteredWorkload.map((user, idx) => (
                    <tr key={`workload-row-${user.userId || user.userEmail || 'usr'}-${idx}`} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <div className="relative">
                            <img
                              src={`https://ui-avatars.com/api/?name=${encodeURIComponent(user.userName)}&background=800020&color=fff`}
                              alt={user.userName}
                              className="w-7 h-7 rounded-full border border-slate-200 object-cover"
                            />
                            <span
                              className={cn(
                                "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white",
                                user.isOnline ? "bg-emerald-500" : "bg-slate-300"
                              )}
                              title={user.isOnline ? 'Online' : 'Offline'}
                            />
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-900">{user.userName}</span>
                              {user.isOnline && (
                                <span className="px-1 py-0.2 bg-emerald-50 text-emerald-700 text-[8px] font-extrabold rounded border border-emerald-200 uppercase">
                                  Live
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono block">{user.userEmail}</span>
                          </div>
                        </div>
                      </td>

                      <td className="py-2.5 px-3">
                        <span
                          className={cn(
                            "px-2 py-0.5 text-[10px] font-extrabold uppercase rounded tracking-wider border",
                            user.role === 'admin' ? "bg-[#800020]/10 text-[#800020] border-[#800020]/20" :
                            user.role === 'approver' ? "bg-indigo-50 text-indigo-700 border-indigo-200" :
                            "bg-slate-100 text-slate-700 border-slate-200"
                          )}
                        >
                          {user.role}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 font-medium text-slate-600">
                        {user.department || '—'}
                      </td>

                      <td className="py-2.5 px-3 text-center">
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-800 font-bold rounded text-xs">
                          {user.applicationsCreated}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-center">
                        <span className="px-2 py-0.5 bg-indigo-50 text-indigo-800 font-bold rounded text-xs">
                          {user.approvalsProcessed}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-center">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-800 font-bold rounded text-xs">
                          {user.totalActionsLogged}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-slate-500 font-medium text-[11px]">
                        {user.lastActiveAt ? formatDateTime(user.lastActiveAt) : 'Never'}
                      </td>

                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenUserSettings(user.userId)}
                            className="p-1 px-2 text-[#800020] hover:bg-[#800020]/10 rounded font-semibold text-[11px] transition-colors cursor-pointer"
                            title="Edit User Role & Status"
                          >
                            Manage
                          </button>
                          {onOpenAuditLogsForUser && (
                            <button
                              type="button"
                              onClick={() => onOpenAuditLogsForUser(user.userId)}
                              className="p-1 px-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded text-[11px] transition-colors cursor-pointer"
                              title="View Audit Logs"
                            >
                              <Activity size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* View 3: Auth & Security Stream */}
        {activeSubTab === 'auth-events' && (
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
              <span>Showing last <strong>{filteredAuthEvents.length}</strong> authentication & security events</span>
            </div>

            {filteredAuthEvents.length === 0 ? (
              <p className="text-center py-8 text-xs text-slate-400 italic">No authentication events recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {filteredAuthEvents.map((event, idx) => (
                  <div
                    key={`auth-evt-${event.id || 'evt'}-${event.timestamp || ''}-${idx}`}
                    className="p-3 bg-slate-50/80 rounded-lg border border-slate-200/80 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={cn(
                        "w-7 h-7 rounded-md flex items-center justify-center shrink-0",
                        event.action === 'LOGIN' ? "bg-emerald-100 text-emerald-800" :
                        event.action === 'LOGOUT' ? "bg-slate-200 text-slate-700" :
                        event.action === 'RESET_PASSWORD' ? "bg-amber-100 text-amber-800" :
                        "bg-blue-100 text-blue-800"
                      )}>
                        <Key size={14} />
                      </div>

                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate">
                          {event.details || `${event.action} by ${event.userEmail}`}
                        </p>
                        <span className="text-[10px] text-slate-400 font-mono">
                          User ID: {event.userId} · Entity: {event.entityType} ({event.entityId})
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-[11px] font-semibold text-slate-600 block">
                        {formatDateTime(event.timestamp)}
                      </span>
                      <span className="text-[9px] font-extrabold uppercase text-slate-400 tracking-wider">
                        {event.action}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* User Settings Modal */}
      {selectedUserForModal && (
        <UserSettingsModal
          isOpen={isUserSettingsOpen}
          onClose={() => {
            setIsUserSettingsOpen(false);
            setSelectedUserForModal(null);
          }}
          user={selectedUserForModal}
          currentUser={currentUser}
          divisions={divisions}
          projects={projects}
          departments={departments}
          onSuccess={() => {
            fetchReport();
            onSuccess();
          }}
          showToast={showToast}
          showConfirm={showConfirm}
        />
      )}
    </div>
  );
}
