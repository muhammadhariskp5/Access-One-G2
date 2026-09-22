import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Shield, 
  Filter, 
  Download, 
  Eye, 
  User, 
  Settings2, 
  Activity, 
  AlertTriangle, 
  Calendar, 
  Clock, 
  Sliders, 
  ArrowUpDown, 
  Layers, 
  CheckCircle2, 
  XCircle,
  ExternalLink,
  RefreshCw,
  Pause,
  Play,
  Zap,
  Wifi,
  Radio
} from 'lucide-react';
import { cn, formatDateTime } from '../lib/utils';
import { AuditLog, UserProfile, Division, Project, Department } from '../types';
import { UserSettingsModal } from '../components/settings/UserSettingsModal';

interface AuditLogsProps {
  logs: AuditLog[];
  globalSearch: string;
  allUsers?: UserProfile[];
  currentUser?: UserProfile | null;
  divisions?: Division[];
  projects?: Project[];
  departments?: Department[];
  onSuccess?: () => void;
  onRefreshAuditLogs?: () => Promise<any> | void;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
  showConfirm?: (title: string, message: string, onConfirm: () => void) => void;
}

export function AuditLogs({ 
  logs, 
  globalSearch,
  allUsers = [],
  currentUser = null,
  divisions = [],
  projects = [],
  departments = [],
  onSuccess = () => {},
  onRefreshAuditLogs,
  showToast = () => {},
  showConfirm = () => {}
}: AuditLogsProps) {
  const navigate = useNavigate();

  // Polling / Live Sync state with localStorage persistence
  const [isAutoRefresh, setIsAutoRefresh] = useState<boolean>(() => {
    const saved = localStorage.getItem('accessone_audit_auto_refresh');
    return saved !== null ? saved === 'true' : true;
  });

  const [refreshInterval, setRefreshInterval] = useState<number>(() => {
    const saved = localStorage.getItem('accessone_audit_refresh_interval');
    return saved ? parseInt(saved, 10) : 5;
  });

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [isTabVisible, setIsTabVisible] = useState<boolean>(
    typeof document !== 'undefined' ? document.visibilityState === 'visible' : true
  );
  const [timeAgoText, setTimeAgoText] = useState<string>('Just now');

  // Filters
  const [selectedUserFilter, setSelectedUserFilter] = useState<string>('ALL');
  const [selectedActionFilter, setSelectedActionFilter] = useState<string>('ALL');
  const [selectedEntityFilter, setSelectedEntityFilter] = useState<string>('ALL');

  // User Settings Modal state
  const [selectedUserForModal, setSelectedUserForModal] = useState<UserProfile | null>(null);
  const [isUserSettingsOpen, setIsUserSettingsOpen] = useState(false);

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
    const tickerInterval = setInterval(updateTicker, 2000);
    return () => clearInterval(tickerInterval);
  }, [lastRefreshedAt]);

  // Read view preferences from localStorage or defaults
  const viewPrefs = useMemo(() => {
    try {
      const stored = localStorage.getItem('accessone_view_preferences');
      if (stored) return JSON.parse(stored);
    } catch (e) { /* ignore */ }
    return { tableDensity: 'comfortable', dateFormat: 'DD/MM/YYYY' };
  }, []);

  // Compute stats
  const stats = useMemo(() => {
    const isPowerAdmin = currentUser?.role === 'power_admin';
    const scopedLogs = logs.filter(log => {
      if (!isPowerAdmin) {
        if (log.userEmail?.toLowerCase() === 'm.techsandgadgets@gmail.com') return false;
        if (log.userId === 'system' || (log.userName?.toLowerCase() === 'system' && !log.organizationId)) return false;
        if (currentUser?.organizationId && log.organizationId && log.organizationId !== currentUser.organizationId) return false;
      }
      return true;
    });
    const total = scopedLogs.length;
    const distinctUsers = new Set(scopedLogs.map(l => l.userEmail || l.userId)).size;
    const deletes = scopedLogs.filter(l => l.action?.toUpperCase() === 'DELETE').length;
    const creates = scopedLogs.filter(l => l.action?.toUpperCase() === 'CREATE').length;
    return { total, distinctUsers, deletes, creates };
  }, [logs, currentUser]);

  // Filter logs
  const filteredLogs = useMemo(() => {
    const searchCombined = (globalSearch || '').toLowerCase().trim();
    const isPowerAdmin = currentUser?.role === 'power_admin';
    
    return logs.filter(log => {
      // Non-power admin must never see power admin or system action logs
      if (!isPowerAdmin) {
        if (log.userEmail?.toLowerCase() === 'm.techsandgadgets@gmail.com') return false;
        if (log.userId === 'system' || (log.userName?.toLowerCase() === 'system' && !log.organizationId)) return false;
        if (currentUser?.organizationId && log.organizationId && log.organizationId !== currentUser.organizationId) return false;
      }

      const matchesSearch = 
        !searchCombined ||
        log.userName?.toLowerCase().includes(searchCombined) ||
        log.userEmail?.toLowerCase().includes(searchCombined) ||
        log.action?.toLowerCase().includes(searchCombined) ||
        log.entityType?.toLowerCase().includes(searchCombined) ||
        log.details?.toLowerCase().includes(searchCombined) ||
        log.entityId?.toLowerCase().includes(searchCombined);

      const matchesUser = 
        selectedUserFilter === 'ALL' || 
        log.userId === selectedUserFilter || 
        log.userEmail === selectedUserFilter;

      const matchesAction = 
        selectedActionFilter === 'ALL' || 
        log.action?.toUpperCase() === selectedActionFilter;

      const matchesEntity = 
        selectedEntityFilter === 'ALL' || 
        log.entityType?.toLowerCase() === selectedEntityFilter.toLowerCase();

      return matchesSearch && matchesUser && matchesAction && matchesEntity;
    });
  }, [logs, globalSearch, selectedUserFilter, selectedActionFilter, selectedEntityFilter, currentUser]);

  // Manual refresh handler
  const handleManualRefresh = async (notify: boolean = true) => {
    setIsRefreshing(true);
    try {
      if (onRefreshAuditLogs) {
        await onRefreshAuditLogs();
      } else {
        await onSuccess();
      }
      setLastRefreshedAt(new Date());
      if (notify) {
        showToast('Audit trail updated', 'success');
      }
    } catch (err) {
      if (notify) {
        showToast('Failed to refresh audit trail', 'error');
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  // Toggle Auto-Refresh & save preference
  const handleToggleAutoRefresh = (enabled: boolean) => {
    setIsAutoRefresh(enabled);
    localStorage.setItem('accessone_audit_auto_refresh', enabled ? 'true' : 'false');
    if (enabled) {
      showToast(`Live audit polling enabled (${refreshInterval}s)`, 'success');
      handleManualRefresh(false);
    } else {
      showToast('Live audit polling paused (manual mode)', 'success');
    }
  };

  // Change interval & save preference
  const handleChangeInterval = (intervalSec: number) => {
    setRefreshInterval(intervalSec);
    localStorage.setItem('accessone_audit_refresh_interval', intervalSec.toString());
    showToast(`Polling interval set to ${intervalSec}s`, 'success');
  };

  // Tab visibility listener (Bandwidth Saver: auto-pause when user leaves tab)
  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setIsTabVisible(visible);
      if (visible && isAutoRefresh) {
        // When tab is reopened, immediately refresh once to catch up
        handleManualRefresh(false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isAutoRefresh, onRefreshAuditLogs, onSuccess]);

  // Dedicated single-endpoint live polling loop
  useEffect(() => {
    if (!isAutoRefresh || !isTabVisible) return;

    const interval = setInterval(async () => {
      if (document.visibilityState === 'visible') {
        setIsRefreshing(true);
        try {
          if (onRefreshAuditLogs) {
            await onRefreshAuditLogs();
          } else {
            await onSuccess();
          }
          setLastRefreshedAt(new Date());
        } catch (e) {
          console.error("Auto refresh error:", e);
        } finally {
          setIsRefreshing(false);
        }
      }
    }, refreshInterval * 1000);

    return () => clearInterval(interval);
  }, [isAutoRefresh, isTabVisible, refreshInterval, onRefreshAuditLogs, onSuccess]);

  // Open User Settings Modal
  const handleOpenUserSettings = (userIdOrEmail: string, userName?: string) => {
    // Look up in allUsers
    const found = allUsers.find(
      u => u.id === userIdOrEmail || u.email?.toLowerCase() === userIdOrEmail?.toLowerCase()
    );

    if (found) {
      setSelectedUserForModal(found);
      setIsUserSettingsOpen(true);
    } else {
      // Create synthetic user profile to inspect
      setSelectedUserForModal({
        id: userIdOrEmail,
        email: userIdOrEmail.includes('@') ? userIdOrEmail : `${userIdOrEmail}@system.local`,
        displayName: userName || userIdOrEmail,
        role: 'requester',
        status: 'active'
      });
      setIsUserSettingsOpen(true);
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    try {
      const headers = ['Timestamp', 'User Name', 'User Email', 'Action', 'Entity Type', 'Entity ID', 'Details'];
      const rows = filteredLogs.map(l => [
        `"${l.timestamp}"`,
        `"${(l.userName || '').replace(/"/g, '""')}"`,
        `"${(l.userEmail || '').replace(/"/g, '""')}"`,
        `"${l.action}"`,
        `"${l.entityType}"`,
        `"${l.entityId || ''}"`,
        `"${(l.details || '').replace(/"/g, '""')}"`
      ]);

      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `system_audit_trail_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('Audit trail exported successfully', 'success');
    } catch (err) {
      showToast('Failed to export audit trail', 'error');
    }
  };

  return (
    <div className="space-y-4 flex-1 flex flex-col w-full min-h-[calc(100vh-96px)]">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#800020] animate-pulse" />
            <h2 className="text-base font-bold text-slate-900 leading-none">System Audit Trail & Access Logs</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Comprehensive audit log of administrative actions, pass status transitions, and user operations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Live Polling / Auto-Refresh Control Bar */}
          <div className="flex items-center gap-1.5 p-1 bg-white rounded-lg border border-slate-200 shadow-2xs">
            {/* Auto-Refresh Toggle Switch */}
            <button
              type="button"
              onClick={() => handleToggleAutoRefresh(!isAutoRefresh)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer",
                isAutoRefresh 
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200/80 hover:bg-emerald-100/70" 
                  : "bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 border border-slate-200"
              )}
              title={isAutoRefresh ? "Auto-refresh is active. Click to disable polling and save bandwidth." : "Auto-refresh is paused. Click to enable automatic polling."}
            >
              {isAutoRefresh ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", isTabVisible ? "bg-emerald-400" : "bg-amber-400")} />
                    <span className={cn("relative inline-flex rounded-full h-2 w-2", isTabVisible ? "bg-emerald-500" : "bg-amber-500")} />
                  </span>
                  <span>Live {isTabVisible ? `(${refreshInterval}s)` : '(Tab Paused)'}</span>
                </>
              ) : (
                <>
                  <Pause size={12} className="text-slate-400" />
                  <span>Polling Off</span>
                </>
              )}
            </button>

            {/* Interval Selector */}
            {isAutoRefresh && (
              <select
                value={refreshInterval}
                onChange={e => handleChangeInterval(Number(e.target.value))}
                className="bg-transparent text-[11px] font-semibold text-slate-700 outline-none cursor-pointer pr-1 border-r border-slate-200 mr-1"
                title="Select auto-refresh polling interval"
              >
                <option value={5}>5s</option>
                <option value={15}>15s</option>
                <option value={30}>30s</option>
                <option value={60}>60s</option>
              </select>
            )}

            {/* Manual Refresh Button */}
            <button
              type="button"
              onClick={() => handleManualRefresh(true)}
              disabled={isRefreshing}
              className="p-1 px-2 text-slate-600 hover:text-[#800020] hover:bg-slate-50 rounded flex items-center gap-1 text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
              title={`Click to manually refresh now (Last updated: ${timeAgoText})`}
            >
              <RefreshCw size={12} className={cn("text-slate-500", isRefreshing && "animate-spin text-[#800020]")} />
              <span>{isRefreshing ? 'Syncing...' : 'Sync'}</span>
            </button>
          </div>

          {/* Link to User Settings & View Options */}
          <button
            onClick={() => navigate('/settings?tab=view-options')}
            className="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 bg-white text-slate-700 hover:text-slate-900 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
            title="Configure table density and date display format"
          >
            <Sliders size={13} className="text-[#800020]" />
            <span>Display Options</span>
          </button>

          <button
            onClick={() => navigate('/settings?tab=users')}
            className="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 bg-white text-slate-700 hover:text-slate-900 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
            title="Manage user roles and permissions"
          >
            <Settings2 size={13} className="text-slate-600" />
            <span>User Settings</span>
          </button>

          <button
            onClick={handleExportCSV}
            disabled={filteredLogs.length === 0}
            className="px-3 py-1.5 bg-[#800020] hover:bg-[#66001a] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer disabled:opacity-50"
          >
            <Download size={13} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
            <Activity size={18} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Audited Events</p>
            <h4 className="text-lg font-black text-slate-900 leading-tight">{stats.total}</h4>
          </div>
        </div>

        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center text-purple-700">
            <User size={18} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Active Operators</p>
            <h4 className="text-lg font-black text-slate-900 leading-tight">{stats.distinctUsers}</h4>
          </div>
        </div>

        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-700">
            <CheckCircle2 size={18} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Creation Records</p>
            <h4 className="text-lg font-black text-emerald-700 leading-tight">{stats.creates}</h4>
          </div>
        </div>

        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-rose-50 flex items-center justify-center text-rose-700">
            <AlertTriangle size={18} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Deletion / Security</p>
            <h4 className="text-lg font-black text-rose-700 leading-tight">{stats.deletes}</h4>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center gap-2.5">
        {/* Filter by User */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase">User:</span>
          <select
            value={selectedUserFilter}
            onChange={e => setSelectedUserFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold outline-none focus:border-[#800020]"
          >
            <option value="ALL">All Users</option>
            {allUsers.map(u => (
              <option key={u.id} value={u.email}>
                {u.displayName || u.email} ({u.role})
              </option>
            ))}
          </select>
        </div>

        {/* Filter by Action */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase">Action:</span>
          <select
            value={selectedActionFilter}
            onChange={e => setSelectedActionFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold outline-none focus:border-[#800020]"
          >
            <option value="ALL">All Actions</option>
            <option value="CREATE">CREATE</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
            <option value="STATUS_CHANGE">STATUS_CHANGE</option>
          </select>
        </div>

        {/* Filter by Entity */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase">Entity:</span>
          <select
            value={selectedEntityFilter}
            onChange={e => setSelectedEntityFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold outline-none focus:border-[#800020]"
          >
            <option value="ALL">All Entities</option>
            <option value="application">Application</option>
            <option value="pass">Pass</option>
            <option value="user">User</option>
            <option value="employee">Employee</option>
            <option value="location">Location</option>
            <option value="company">Company</option>
            <option value="settings">Settings</option>
            <option value="division">Division</option>
            <option value="project">Project</option>
            <option value="department">Department</option>
          </select>
        </div>

        {/* Bandwidth & Sync Status pill */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <Clock size={11} />
            <span>Updated {timeAgoText}</span>
          </span>

          <span className="text-[11px] font-bold text-slate-500 pl-2 border-l border-slate-200">
            Showing {filteredLogs.length} of {logs.length} logs
          </span>
        </div>
      </div>

      {/* Audit Trail Table */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-2xs overflow-hidden flex-1 flex flex-col min-h-[calc(100vh-280px)]">
        <div className="overflow-x-auto overflow-y-auto flex-1">
          <table className={cn("w-full text-left", viewPrefs.tableDensity === 'compact' ? "text-[11px]" : "text-xs")}>
            <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB] sticky top-0 z-10">
              <tr>
                <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">Timestamp</th>
                <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">Operator / User</th>
                <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">Action</th>
                <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">Target Entity</th>
                <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest">Activity Details</th>
                <th className="px-4 py-2.5 text-[9px] font-bold text-[#6B7280] uppercase tracking-widest text-right">User Settings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F4F6]">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-slate-400 text-xs">
                    No audit records match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredLogs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition-colors group">
                    <td className="px-4 py-2.5 text-[10px] text-slate-500 whitespace-nowrap font-mono">
                      {formatDateTime(log.timestamp)}
                    </td>
                    
                    {/* User profile column with clickable modal trigger */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-[#800020]/10 border border-[#800020]/20 flex items-center justify-center text-[#800020] font-bold text-[10px] shrink-0">
                          {log.userName?.charAt(0) || log.userEmail?.charAt(0).toUpperCase() || 'U'}
                        </div>
                        <div>
                          <button
                            type="button"
                            onClick={() => handleOpenUserSettings(log.userEmail || log.userId, log.userName)}
                            className="text-xs font-bold text-slate-900 hover:text-[#800020] hover:underline text-left transition-colors cursor-pointer block leading-tight"
                            title="Click to view user settings"
                          >
                            {log.userName || log.userEmail?.split('@')[0] || 'System User'}
                          </button>
                          <p className="text-[10px] text-slate-500">{log.userEmail}</p>
                        </div>
                      </div>
                    </td>

                    {/* Action badge */}
                    <td className="px-4 py-2.5">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider inline-block",
                        log.action === 'CREATE' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                        log.action === 'DELETE' ? "bg-rose-50 text-rose-700 border border-rose-200" :
                        log.action === 'STATUS_CHANGE' ? "bg-blue-50 text-blue-700 border border-blue-200" :
                        log.action === 'UPDATE' ? "bg-amber-50 text-amber-700 border border-amber-200" :
                        "bg-slate-100 text-slate-700 border border-slate-200"
                      )}>
                        {log.action}
                      </span>
                    </td>

                    {/* Entity */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-bold uppercase text-slate-700">
                          {log.entityType}
                        </span>
                        {log.entityId && (
                          <span className="text-[9px] text-slate-400 font-mono">
                            #{log.entityId.slice(0, 8)}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Details */}
                    <td className="px-4 py-2.5 text-slate-700 text-[11px] max-w-md">
                      {log.details}
                    </td>

                    {/* User Settings View Option Button */}
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleOpenUserSettings(log.userEmail || log.userId, log.userName)}
                        className="px-2.5 py-1 rounded-md border border-slate-200 hover:border-[#800020] bg-white text-slate-700 hover:text-[#800020] text-[11px] font-semibold inline-flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
                        title="View User Settings & Details"
                      >
                        <Eye size={12} />
                        <span>View Settings</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Settings & Details Modal */}
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
        onSuccess={onSuccess}
        showToast={showToast}
        showConfirm={showConfirm}
      />

    </div>
  );
}
