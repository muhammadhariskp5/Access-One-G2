import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bell,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Send,
  ArrowRight,
  X
} from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext';
import { AppNotification } from '../../types';

export const InAppNotificationToast: React.FC = () => {
  const { activeToast, dismissToast, markAsRead } = useNotifications();
  const navigate = useNavigate();

  if (!activeToast) return null;

  const handleNavigate = async (notif: AppNotification) => {
    await markAsRead(notif.id);
    dismissToast();

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

  const getTypeIcon = (type: string, priority?: string) => {
    if (priority === 'urgent' || type === 'expired' || type === 'security_alert') {
      return <ShieldAlert className="w-5 h-5 text-rose-600" />;
    }
    if (type.includes('48h') || type.includes('7d') || type.includes('30d') || type === 'expiring_soon') {
      return <Clock className="w-5 h-5 text-amber-600" />;
    }
    if (type === 'application_approved' || type === 'pass_issued') {
      return <CheckCircle2 className="w-5 h-5 text-emerald-600" />;
    }
    if (type === 'application_rejected') {
      return <XCircle className="w-5 h-5 text-rose-600" />;
    }
    if (type === 'system_broadcast' || type === 'broadcast') {
      return <Send className="w-5 h-5 text-purple-600" />;
    }
    if (type.includes('application')) {
      return <AlertTriangle className="w-5 h-5 text-blue-600" />;
    }
    return <Bell className="w-5 h-5 text-[#800020]" />;
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.96 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        className="fixed top-4 right-4 z-50 max-w-sm w-full bg-white rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden ring-1 ring-black/5"
        role="alert"
      >
        <div className="p-3.5 flex items-start gap-3">
          <div className="p-2 rounded-xl bg-slate-50 border border-slate-100 shrink-0 mt-0.5">
            {getTypeIcon(activeToast.type, activeToast.priority)}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold tracking-wider uppercase text-slate-400">
                In-App Notification
              </span>
              <button
                type="button"
                onClick={dismissToast}
                className="text-slate-400 hover:text-slate-600 p-0.5 rounded-md hover:bg-slate-100 transition-colors"
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
            </div>

            <h4 className="text-xs font-bold text-slate-800 line-clamp-1 mt-0.5">
              {activeToast.title}
            </h4>

            {activeToast.message && (
              <p className="text-[11px] text-slate-600 line-clamp-2 mt-0.5 leading-snug">
                {activeToast.message}
              </p>
            )}

            <div className="flex items-center gap-2 mt-2.5">
              <button
                type="button"
                onClick={() => handleNavigate(activeToast)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-white bg-[#800020] hover:bg-[#660019] rounded-lg transition-colors shadow-xs"
              >
                <span>View Details</span>
                <ArrowRight size={12} />
              </button>

              <button
                type="button"
                onClick={async () => {
                  await markAsRead(activeToast.id);
                  dismissToast();
                }}
                className="px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Mark Read
              </button>
            </div>
          </div>
        </div>

        {/* Progress accent bar */}
        <div className="h-1 bg-slate-100 w-full overflow-hidden">
          <motion.div
            initial={{ width: '100%' }}
            animate={{ width: '0%' }}
            transition={{ duration: 6.5, ease: 'linear' }}
            className="h-full bg-[#800020]"
          />
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
