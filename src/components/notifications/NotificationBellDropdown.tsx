import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  Trash2,
  ExternalLink,
  Volume2,
  VolumeX,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  Send,
  Sparkles,
  Inbox
} from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext';
import { AppNotification } from '../../types';
import { cn } from '../../lib/utils';

export const NotificationBellDropdown: React.FC = () => {
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAllRead,
    soundEnabled,
    setSoundEnabled,
    sendTestNotification,
  } = useNotifications();

  const [isOpen, setIsOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'unread' | 'passes' | 'applications'>('all');
  const [isTesting, setIsTesting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const filteredNotifications = notifications.filter(notif => {
    if (activeFilter === 'unread') return !notif.isRead;
    if (activeFilter === 'passes') {
      const t = (notif.type || '').toLowerCase();
      return (
        t.includes('expir') ||
        t.includes('pass') ||
        notif.entityType === 'pass'
      );
    }
    if (activeFilter === 'applications') {
      const t = (notif.type || '').toLowerCase();
      return (
        t.includes('application') ||
        notif.entityType === 'application'
      );
    }
    return true;
  });

  const handleNotificationClick = async (notif: AppNotification) => {
    if (!notif.isRead) {
      await markAsRead(notif.id);
    }
    setIsOpen(false);

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
    } else {
      navigate('/notifications');
    }
  };

  const formatTimeAgo = (timestamp?: string) => {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      const diffMs = Date.now() - date.getTime();
      const diffMin = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMin / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMin < 1) return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  const getNotificationIcon = (notif: AppNotification) => {
    const t = (notif.type || '').toLowerCase();
    const p = notif.priority;

    if (p === 'urgent' || t === 'expired' || t === 'security_alert') {
      return (
        <div className="w-8 h-8 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center shrink-0 text-rose-600">
          <ShieldAlert size={16} />
        </div>
      );
    }
    if (t.includes('48h') || t.includes('7d') || t.includes('30d') || t === 'expiring_soon') {
      return (
        <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0 text-amber-600">
          <Clock size={16} />
        </div>
      );
    }
    if (t === 'application_approved' || t === 'pass_issued') {
      return (
        <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0 text-emerald-600">
          <CheckCircle2 size={16} />
        </div>
      );
    }
    if (t === 'application_rejected') {
      return (
        <div className="w-8 h-8 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center shrink-0 text-rose-600">
          <XCircle size={16} />
        </div>
      );
    }
    if (t === 'system_broadcast' || t === 'broadcast') {
      return (
        <div className="w-8 h-8 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center shrink-0 text-purple-600">
          <Send size={16} />
        </div>
      );
    }
    if (t.includes('application')) {
      return (
        <div className="w-8 h-8 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center shrink-0 text-sky-600">
          <AlertTriangle size={16} />
        </div>
      );
    }
    return (
      <div className="w-8 h-8 rounded-xl bg-[#800020]/10 border border-[#800020]/15 flex items-center justify-center shrink-0 text-[#800020]">
        <Bell size={16} />
      </div>
    );
  };

  const handleTestNotification = async () => {
    setIsTesting(true);
    await sendTestNotification();
    setIsTesting(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Trigger Button */}
      <button
        type="button"
        id="in-app-notification-bell-btn"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "relative flex items-center justify-center w-9 h-9 rounded-xl transition-all cursor-pointer",
          isOpen ? "bg-slate-200/70 text-slate-800" : "hover:bg-slate-100/80 text-slate-600 hover:text-slate-900"
        )}
        aria-label="Notifications"
        title="In-App Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <>
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-[#800020] text-white text-[9px] font-bold shadow-xs">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-[#800020] animate-ping opacity-40 pointer-events-none" />
          </>
        )}
      </button>

      {/* Popover Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 max-w-[92vw] bg-white rounded-2xl border border-slate-200 shadow-2xl z-50 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150 ring-1 ring-black/5">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-800 tracking-wide">Notifications</span>
              {unreadCount > 0 ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#800020]/10 text-[#800020]">
                  {unreadCount} unread
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500">
                  All caught up
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={cn(
                  "p-1.5 rounded-lg transition-colors cursor-pointer",
                  soundEnabled ? "text-slate-600 hover:bg-slate-200/60" : "text-slate-400 hover:bg-slate-200/60"
                )}
                title={soundEnabled ? "Mute notification chime" : "Unmute notification chime"}
              >
                {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
              </button>

              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="flex items-center gap-1 text-[11px] font-bold text-[#800020] hover:text-[#600018] px-2 py-1 rounded-lg hover:bg-[#800020]/5 transition-colors cursor-pointer"
                  title="Mark all as read"
                >
                  <CheckCheck size={13} />
                  <span>Mark read</span>
                </button>
              )}
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center px-3 pt-2 pb-1 border-b border-slate-100 bg-white gap-1 overflow-x-auto text-[11px] font-semibold text-slate-600">
            <button
              type="button"
              onClick={() => setActiveFilter('all')}
              className={cn(
                "px-2.5 py-1 rounded-lg transition-colors cursor-pointer whitespace-nowrap",
                activeFilter === 'all'
                  ? "bg-[#800020] text-white font-bold shadow-xs"
                  : "hover:bg-slate-100 text-slate-600"
              )}
            >
              All ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('unread')}
              className={cn(
                "px-2.5 py-1 rounded-lg transition-colors cursor-pointer whitespace-nowrap",
                activeFilter === 'unread'
                  ? "bg-[#800020] text-white font-bold shadow-xs"
                  : "hover:bg-slate-100 text-slate-600"
              )}
            >
              Unread ({unreadCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('passes')}
              className={cn(
                "px-2.5 py-1 rounded-lg transition-colors cursor-pointer whitespace-nowrap",
                activeFilter === 'passes'
                  ? "bg-[#800020] text-white font-bold shadow-xs"
                  : "hover:bg-slate-100 text-slate-600"
              )}
            >
              Passes & Expiry
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('applications')}
              className={cn(
                "px-2.5 py-1 rounded-lg transition-colors cursor-pointer whitespace-nowrap",
                activeFilter === 'applications'
                  ? "bg-[#800020] text-white font-bold shadow-xs"
                  : "hover:bg-slate-100 text-slate-600"
              )}
            >
              Applications
            </button>
          </div>

          {/* List Area */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100 overscroll-contain">
            {filteredNotifications.length === 0 ? (
              <div className="py-12 px-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center mx-auto text-slate-400 mb-2.5">
                  <Inbox size={22} />
                </div>
                <p className="text-xs font-bold text-slate-700">No notifications found</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {activeFilter === 'unread' ? "You're completely up to date!" : 'New alerts and status updates will show up here.'}
                </p>
                <button
                  type="button"
                  onClick={handleTestNotification}
                  disabled={isTesting}
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <Sparkles size={12} className="text-[#800020]" />
                  <span>{isTesting ? 'Sending test alert...' : 'Send Test Alert'}</span>
                </button>
              </div>
            ) : (
              filteredNotifications.map((notif) => {
                const isUnread = !notif.isRead;
                return (
                  <div
                    key={notif.id}
                    className={cn(
                      "group relative flex items-start gap-3 p-3 transition-colors hover:bg-slate-50/80 cursor-pointer",
                      isUnread ? "bg-[#800020]/[0.03]" : "bg-white"
                    )}
                    onClick={() => handleNotificationClick(notif)}
                  >
                    {getNotificationIcon(notif)}

                    <div className="flex-1 min-w-0 pr-6">
                      <div className="flex items-center gap-1.5">
                        <p className={cn(
                          "text-xs truncate",
                          isUnread ? "font-bold text-slate-900" : "font-semibold text-slate-700"
                        )}>
                          {notif.title}
                        </p>
                        {isUnread && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#800020] shrink-0" />
                        )}
                      </div>

                      {notif.message && (
                        <p className="text-[11px] text-slate-500 line-clamp-2 mt-0.5 leading-snug">
                          {notif.message}
                        </p>
                      )}

                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] text-slate-400 font-medium">
                          {formatTimeAgo(notif.timestamp)}
                        </span>

                        {notif.entityId && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                            {notif.entityType === 'application' ? `App #${notif.entityId}` : notif.entityType === 'pass' ? `Pass #${notif.entityId}` : `#${notif.entityId}`}
                          </span>
                        )}

                        {notif.priority === 'urgent' && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">
                            Urgent
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Delete button on hover */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNotification(notif.id);
                      }}
                      className="absolute right-2 top-2 p-1.5 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                      title="Delete notification"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 bg-slate-50/90 border-t border-slate-100 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={clearAllRead}
              className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
            >
              Clear read
            </button>

            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                navigate('/notifications');
              }}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-[#800020] hover:text-[#600018] transition-colors cursor-pointer"
            >
              <span>View all notifications</span>
              <ExternalLink size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
