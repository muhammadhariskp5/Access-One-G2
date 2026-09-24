import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  Trash2,
  Search,
  Filter,
  Volume2,
  VolumeX,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  Send,
  Sparkles,
  RefreshCw,
  ExternalLink,
  Radio,
  SlidersHorizontal,
  Info
} from 'lucide-react';
import { useNotifications } from '../context/NotificationContext';
import { AppNotification } from '../types';
import { cn } from '../lib/utils';

interface NotificationsPageProps {
  currentUser?: { id: string; role?: string; displayName?: string } | null;
}

export const NotificationsPage: React.FC<NotificationsPageProps> = ({ currentUser }) => {
  const {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAllRead,
    refreshNotifications,
    sendBroadcast,
    checkExpiriesNow,
    sendTestNotification,
    soundEnabled,
    setSoundEnabled,
    toastAlertsEnabled,
    setToastAlertsEnabled,
  } = useNotifications();

  const navigate = useNavigate();

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'unread' | 'passes' | 'applications' | 'broadcast'>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Broadcast modal state
  const [isBroadcastOpen, setIsBroadcastOpen] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastPriority, setBroadcastPriority] = useState<'normal' | 'high' | 'urgent'>('high');
  const [broadcastTargetRole, setBroadcastTargetRole] = useState('all');
  const [isSendingBroadcast, setIsSendingBroadcast] = useState(false);

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'power_admin';

  // Filtered notifications
  const filteredNotifications = useMemo(() => {
    return notifications.filter(notif => {
      // Category filter
      if (categoryFilter === 'unread' && notif.isRead) return false;
      if (categoryFilter === 'passes') {
        const t = (notif.type || '').toLowerCase();
        if (!t.includes('expir') && !t.includes('pass') && notif.entityType !== 'pass') return false;
      }
      if (categoryFilter === 'applications') {
        const t = (notif.type || '').toLowerCase();
        if (!t.includes('application') && notif.entityType !== 'application') return false;
      }
      if (categoryFilter === 'broadcast') {
        const t = (notif.type || '').toLowerCase();
        if (!t.includes('broadcast') && t !== 'security_alert') return false;
      }

      // Priority filter
      if (priorityFilter !== 'all') {
        const p = notif.priority || 'normal';
        if (p !== priorityFilter) return false;
      }

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const titleMatch = notif.title.toLowerCase().includes(q);
        const msgMatch = (notif.message || '').toLowerCase().includes(q);
        const entityMatch = (notif.entityId || '').toLowerCase().includes(q);
        if (!titleMatch && !msgMatch && !entityMatch) return false;
      }

      return true;
    });
  }, [notifications, categoryFilter, priorityFilter, searchQuery]);

  // Metric counts
  const expiryCount = useMemo(() => {
    return notifications.filter(n => {
      const t = (n.type || '').toLowerCase();
      return t.includes('expir') || t === 'expired';
    }).length;
  }, [notifications]);

  const urgentCount = useMemo(() => {
    return notifications.filter(n => n.priority === 'urgent').length;
  }, [notifications]);

  const handleScanExpiries = async () => {
    setIsScanning(true);
    setScanMessage(null);
    try {
      const count = await checkExpiriesNow();
      setScanMessage(
        count > 0
          ? `Scan complete: ${count} pass notification(s) generated or updated.`
          : 'Scan complete: All active passes are up to date and checked.'
      );
    } catch {
      setScanMessage('Scan failed to complete. Please try again.');
    } finally {
      setIsScanning(false);
      setTimeout(() => setScanMessage(null), 5000);
    }
  };

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle.trim() || !broadcastMessage.trim()) return;

    setIsSendingBroadcast(true);
    const success = await sendBroadcast({
      title: broadcastTitle.trim(),
      message: broadcastMessage.trim(),
      priority: broadcastPriority,
      targetRole: broadcastTargetRole,
    });
    setIsSendingBroadcast(false);

    if (success) {
      setIsBroadcastOpen(false);
      setBroadcastTitle('');
      setBroadcastMessage('');
    }
  };

  const handleNotificationClick = async (notif: AppNotification) => {
    if (!notif.isRead) {
      await markAsRead(notif.id);
    }

    if (notif.link) {
      navigate(notif.link);
      return;
    }

    if (notif.entityType === 'application' && notif.entityId) {
      navigate(`/applications/${notif.entityId}`);
    } else if (notif.entityType === 'pass') {
      navigate('/status-management');
    } else if (notif.entityType === 'personnel') {
      navigate('/employees');
    }
  };

  const getNotificationIcon = (notif: AppNotification) => {
    const t = (notif.type || '').toLowerCase();
    const p = notif.priority;

    if (p === 'urgent' || t === 'expired' || t === 'security_alert') {
      return (
        <div className="w-10 h-10 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center shrink-0 text-rose-600">
          <ShieldAlert size={20} />
        </div>
      );
    }
    if (t.includes('48h') || t.includes('7d') || t.includes('30d') || t === 'expiring_soon') {
      return (
        <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0 text-amber-600">
          <Clock size={20} />
        </div>
      );
    }
    if (t === 'application_approved' || t === 'pass_issued') {
      return (
        <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0 text-emerald-600">
          <CheckCircle2 size={20} />
        </div>
      );
    }
    if (t === 'application_rejected') {
      return (
        <div className="w-10 h-10 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center shrink-0 text-rose-600">
          <XCircle size={20} />
        </div>
      );
    }
    if (t === 'system_broadcast' || t === 'broadcast') {
      return (
        <div className="w-10 h-10 rounded-2xl bg-purple-50 border border-purple-100 flex items-center justify-center shrink-0 text-purple-600">
          <Send size={20} />
        </div>
      );
    }
    if (t.includes('application')) {
      return (
        <div className="w-10 h-10 rounded-2xl bg-sky-50 border border-sky-100 flex items-center justify-center shrink-0 text-sky-600">
          <AlertTriangle size={20} />
        </div>
      );
    }
    return (
      <div className="w-10 h-10 rounded-2xl bg-[#800020]/10 border border-[#800020]/20 flex items-center justify-center shrink-0 text-[#800020]">
        <Bell size={20} />
      </div>
    );
  };

  const formatDate = (timestamp?: string) => {
    if (!timestamp) return '';
    try {
      const d = new Date(timestamp);
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 pb-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-[#800020]/10 text-[#800020]">
                <Bell size={22} />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Notification Center</h1>
            </div>
            <p className="text-sm text-slate-500 mt-1">
              Real-time in-app alerts, pass expirations, security alerts, and application status updates.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={refreshNotifications}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs transition-colors cursor-pointer"
            >
              <RefreshCw size={14} className={isLoading ? "animate-spin text-[#800020]" : "text-slate-500"} />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={handleScanExpiries}
              disabled={isScanning}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs transition-colors cursor-pointer"
              title="Scan all passes in database for upcoming 30d, 7d, 48h expirations and expired passes"
            >
              <Clock size={14} className={isScanning ? "animate-spin text-amber-600" : "text-amber-600"} />
              <span>{isScanning ? 'Scanning...' : 'Scan Expiries'}</span>
            </button>

            <button
              type="button"
              onClick={async () => {
                setIsTesting(true);
                await sendTestNotification();
                setIsTesting(false);
              }}
              disabled={isTesting}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs transition-colors cursor-pointer"
            >
              <Sparkles size={14} className="text-[#800020]" />
              <span>Test Notification</span>
            </button>

            {isAdmin && (
              <button
                type="button"
                onClick={() => setIsBroadcastOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#800020] text-white text-xs font-bold shadow-xs hover:bg-[#660019] transition-colors cursor-pointer"
              >
                <Radio size={14} />
                <span>Broadcast Alert</span>
              </button>
            )}
          </div>
        </div>

        {/* Scan Status Toast Banner */}
        {scanMessage && (
          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between gap-3 animate-in fade-in">
            <div className="flex items-center gap-2">
              <Info size={16} className="text-amber-600 shrink-0" />
              <span>{scanMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setScanMessage(null)}
              className="text-amber-700 hover:text-amber-900 font-bold"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mt-6">
          <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Alerts</p>
              <p className="text-2xl font-black text-slate-800 mt-0.5">{notifications.length}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 text-slate-600 border border-slate-100">
              <Bell size={20} />
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Unread</p>
              <p className="text-2xl font-black text-[#800020] mt-0.5">{unreadCount}</p>
            </div>
            <div className="p-3 rounded-xl bg-[#800020]/10 text-[#800020] border border-[#800020]/20">
              <CheckCheck size={20} />
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Pass Expirations</p>
              <p className="text-2xl font-black text-amber-600 mt-0.5">{expiryCount}</p>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 text-amber-600 border border-amber-100">
              <Clock size={20} />
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Urgent Alerts</p>
              <p className="text-2xl font-black text-rose-600 mt-0.5">{urgentCount}</p>
            </div>
            <div className="p-3 rounded-xl bg-rose-50 text-rose-600 border border-rose-100">
              <ShieldAlert size={20} />
            </div>
          </div>
        </div>

        {/* Preferences Bar */}
        <div className="mt-6 p-4 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-xs font-semibold text-slate-700">
            <span className="flex items-center gap-1.5 text-slate-400 uppercase tracking-wider text-[11px] font-bold">
              <SlidersHorizontal size={14} />
              <span>In-App Preferences</span>
            </span>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={soundEnabled}
                onChange={(e) => setSoundEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-[#800020] focus:ring-[#800020] border-slate-300"
              />
              <span className="flex items-center gap-1">
                {soundEnabled ? <Volume2 size={15} className="text-emerald-600" /> : <VolumeX size={15} className="text-slate-400" />}
                <span>Sound Chime</span>
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={toastAlertsEnabled}
                onChange={(e) => setToastAlertsEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-[#800020] focus:ring-[#800020] border-slate-300"
              />
              <span>In-App Floating Popups</span>
            </label>
          </div>

          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-[#800020] hover:bg-[#800020]/5 transition-colors cursor-pointer"
              >
                <CheckCheck size={14} />
                <span>Mark All Read</span>
              </button>
            )}

            <button
              type="button"
              onClick={clearAllRead}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50/50 transition-colors cursor-pointer"
            >
              <Trash2 size={13} />
              <span>Clear Read</span>
            </button>
          </div>
        </div>

        {/* Toolbar: Filters and Search */}
        <div className="mt-6 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs">
          {/* Category Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={cn(
                "px-3 py-1.5 rounded-xl transition-colors cursor-pointer whitespace-nowrap",
                categoryFilter === 'all'
                  ? "bg-[#800020] text-white font-bold shadow-xs"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              All Alerts ({notifications.length})
            </button>

            <button
              type="button"
              onClick={() => setCategoryFilter('unread')}
              className={cn(
                "px-3 py-1.5 rounded-xl transition-colors cursor-pointer whitespace-nowrap",
                categoryFilter === 'unread'
                  ? "bg-[#800020] text-white font-bold shadow-xs"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              Unread ({unreadCount})
            </button>

            <button
              type="button"
              onClick={() => setCategoryFilter('passes')}
              className={cn(
                "px-3 py-1.5 rounded-xl transition-colors cursor-pointer whitespace-nowrap",
                categoryFilter === 'passes'
                  ? "bg-[#800020] text-white font-bold shadow-xs"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              Passes & Expiry
            </button>

            <button
              type="button"
              onClick={() => setCategoryFilter('applications')}
              className={cn(
                "px-3 py-1.5 rounded-xl transition-colors cursor-pointer whitespace-nowrap",
                categoryFilter === 'applications'
                  ? "bg-[#800020] text-white font-bold shadow-xs"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              Applications
            </button>

            <button
              type="button"
              onClick={() => setCategoryFilter('broadcast')}
              className={cn(
                "px-3 py-1.5 rounded-xl transition-colors cursor-pointer whitespace-nowrap",
                categoryFilter === 'broadcast'
                  ? "bg-[#800020] text-white font-bold shadow-xs"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              Broadcasts
            </button>
          </div>

          {/* Search & Priority */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 md:w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search alerts..."
                className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs bg-slate-50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-[#800020]/20 focus:border-[#800020]"
              />
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <Filter size={14} className="text-slate-400" />
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs bg-slate-50 font-medium text-slate-700 focus:outline-hidden focus:border-[#800020]"
              >
                <option value="all">All Priorities</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notifications List */}
        <div className="mt-4 space-y-2.5">
          {filteredNotifications.length === 0 ? (
            <div className="py-20 px-4 text-center bg-white rounded-2xl border border-slate-200/80 shadow-xs">
              <div className="w-16 h-16 rounded-3xl bg-slate-50 border border-slate-100 flex items-center justify-center mx-auto text-slate-400 mb-3">
                <Bell size={28} />
              </div>
              <h3 className="text-sm font-bold text-slate-800">No Notifications</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                {searchQuery
                  ? `No alerts match your search query "${searchQuery}".`
                  : 'You have no notifications in this view.'}
              </p>
            </div>
          ) : (
            filteredNotifications.map((notif) => {
              const isUnread = !notif.isRead;
              return (
                <div
                  key={notif.id}
                  className={cn(
                    "group relative rounded-2xl border transition-all p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white",
                    isUnread
                      ? "border-[#800020]/30 shadow-xs ring-1 ring-[#800020]/5 bg-[#800020]/[0.015]"
                      : "border-slate-200/80 hover:border-slate-300"
                  )}
                >
                  <div
                    className="flex items-start gap-3.5 flex-1 min-w-0 cursor-pointer"
                    onClick={() => handleNotificationClick(notif)}
                  >
                    {getNotificationIcon(notif)}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className={cn(
                          "text-sm tracking-tight",
                          isUnread ? "font-bold text-slate-900" : "font-semibold text-slate-700"
                        )}>
                          {notif.title}
                        </h4>

                        {isUnread && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#800020] text-white">
                            New
                          </span>
                        )}

                        {notif.priority === 'urgent' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">
                            Urgent
                          </span>
                        )}

                        {notif.entityId && (
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-mono font-bold">
                            {notif.entityType === 'application' ? `App #${notif.entityId}` : notif.entityType === 'pass' ? `Pass #${notif.entityId}` : `#${notif.entityId}`}
                          </span>
                        )}
                      </div>

                      {notif.message && (
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                          {notif.message}
                        </p>
                      )}

                      <p className="text-[11px] text-slate-400 mt-1.5 font-medium">
                        {formatDate(notif.timestamp)}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => handleNotificationClick(notif)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-[#800020] hover:text-white border border-slate-200 hover:border-[#800020] text-xs font-bold text-slate-700 transition-colors cursor-pointer"
                    >
                      <span>Open</span>
                      <ExternalLink size={12} />
                    </button>

                    {isUnread ? (
                      <button
                        type="button"
                        onClick={() => markAsRead(notif.id)}
                        className="px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                        title="Mark as read"
                      >
                        Mark Read
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => deleteNotification(notif.id)}
                      className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      title="Delete notification"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Admin Broadcast Announcement Modal */}
      {isBroadcastOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
              <div className="p-2.5 rounded-2xl bg-[#800020]/10 text-[#800020]">
                <Radio size={22} />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Broadcast In-App Announcement</h3>
                <p className="text-xs text-slate-500">
                  Instantly sends a high-priority in-app notification to all logged in users.
                </p>
              </div>
            </div>

            <form onSubmit={handleSendBroadcast} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Announcement Title *
                </label>
                <input
                  type="text"
                  required
                  value={broadcastTitle}
                  onChange={(e) => setBroadcastTitle(e.target.value)}
                  placeholder="e.g. Scheduled System Maintenance / Security Notice"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-[#800020]/20 focus:border-[#800020] focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Message Content *
                </label>
                <textarea
                  required
                  rows={3}
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  placeholder="Detailed instructions or alert information..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-[#800020]/20 focus:border-[#800020] focus:outline-hidden resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Priority Level
                  </label>
                  <select
                    value={broadcastPriority}
                    onChange={(e) => setBroadcastPriority(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold focus:outline-hidden focus:border-[#800020]"
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Target User Role
                  </label>
                  <select
                    value={broadcastTargetRole}
                    onChange={(e) => setBroadcastTargetRole(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold focus:outline-hidden focus:border-[#800020]"
                  >
                    <option value="all">All Users</option>
                    <option value="admin">Admins</option>
                    <option value="approver">Approvers</option>
                    <option value="applier">Appliers</option>
                    <option value="requester">Requesters</option>
                    <option value="viewer">Viewers</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsBroadcastOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={isSendingBroadcast}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-[#800020] text-white hover:bg-[#660019] transition-colors shadow-xs cursor-pointer"
                >
                  {isSendingBroadcast ? 'Broadcasting...' : 'Send Broadcast'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
