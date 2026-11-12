import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppNotification } from '../types';
import { apiFetch } from '../lib/utils';
import { onDataChanged, isRealtimeConnected } from '../lib/realtime';

interface BroadcastParams {
  title: string;
  message: string;
  priority?: 'normal' | 'high' | 'urgent';
  targetRole?: string;
  organizationId?: string;
}

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  activeToast: AppNotification | null;
  dismissToast: () => void;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  clearAllRead: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  sendBroadcast: (params: BroadcastParams) => Promise<boolean>;
  checkExpiriesNow: () => Promise<number>;
  sendTestNotification: () => Promise<boolean>;
  soundEnabled: boolean;
  setSoundEnabled: (val: boolean) => void;
  toastAlertsEnabled: boolean;
  setToastAlertsEnabled: (val: boolean) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

// Web Audio API harmonic chime generator
export function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // First tone (D5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.08, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.28);

    // Second harmonic tone (A5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.12);
    gain2.gain.setValueAtTime(0.09, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.48);
  } catch {
    // Autoplay policy may restrict before initial user interaction
  }
}

interface NotificationProviderProps {
  children: React.ReactNode;
  currentUser?: { id: string; role?: string } | null;
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children, currentUser }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeToast, setActiveToast] = useState<AppNotification | null>(null);

  const [soundEnabled, setSoundEnabledState] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('accessone_notif_sound');
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  const [toastAlertsEnabled, setToastAlertsEnabledState] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('accessone_notif_toast');
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  const setSoundEnabled = (val: boolean) => {
    setSoundEnabledState(val);
    try {
      localStorage.setItem('accessone_notif_sound', String(val));
    } catch {
      // LocalStorage access restricted
    }
  };

  const setToastAlertsEnabled = (val: boolean) => {
    setToastAlertsEnabledState(val);
    try {
      localStorage.setItem('accessone_notif_toast', String(val));
    } catch {
      // LocalStorage access restricted
    }
  };

  const prevIdsRef = useRef<Set<string>>(new Set());
  const isFirstLoadRef = useRef(true);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissToast = useCallback(() => {
    setActiveToast(null);
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }
  }, []);

  const fetchNotifications = useCallback(async (isBackground = false) => {
    if (!currentUser?.id) return;
    if (!isBackground) setIsLoading(true);

    try {
      const res = await apiFetch('/api/notifications?limit=100');
      if (!res.ok) throw new Error('Failed to load notifications');
      const data = await res.json();
      const list: AppNotification[] = Array.isArray(data) ? data : [];

      setNotifications(list);

      // Check for incoming new unread notifications
      const currentIds = new Set(list.map(n => n.id));
      if (!isFirstLoadRef.current) {
        const newlyArrived = list.filter(n => !n.isRead && !prevIdsRef.current.has(n.id));
        if (newlyArrived.length > 0) {
          const newest = newlyArrived[0];
          if (soundEnabled) {
            playNotificationSound();
          }
          if (toastAlertsEnabled) {
            setActiveToast(newest);
            if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
            toastTimeoutRef.current = setTimeout(() => {
              setActiveToast(null);
            }, 6500);
          }
        }
      } else {
        isFirstLoadRef.current = false;
      }

      prevIdsRef.current = currentIds;
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      if (!isBackground) setIsLoading(false);
    }
  }, [currentUser?.id, soundEnabled, toastAlertsEnabled]);

  // Notifications are pushed via the realtime feed; no fixed-interval polling
  useEffect(() => {
    if (!currentUser?.id) {
      setNotifications([]);
      isFirstLoadRef.current = true;
      prevIdsRef.current.clear();
      return;
    }

    fetchNotifications();

    // Pushed by the server when a notification is created for this user (or after a reconnect).
    let missedWhileHidden = false;
    const offChange = onDataChanged(resources => {
      if (!resources.includes('notifications') && !resources.includes('*')) return;
      if (document.visibilityState === 'visible') fetchNotifications(true);
      else missedWhileHidden = true;
    });
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && (missedWhileHidden || !isRealtimeConnected())) {
        missedWhileHidden = false;
        fetchNotifications(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Slow fallback only while the live connection is down
    const fallback = setInterval(() => {
      if (!isRealtimeConnected() && document.visibilityState === 'visible') fetchNotifications(true);
    }, 120000);

    return () => {
      offChange();
      clearInterval(fallback);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [currentUser?.id, fetchNotifications]);

  const markAsRead = async (id: string) => {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: 1 } : n));
      if (activeToast?.id === id) {
        dismissToast();
      }
    } catch (e) {
      console.error('Failed to mark notification as read:', e);
    }
  };

  const markAllAsRead = async () => {
    try {
      await apiFetch('/api/notifications/mark-all-read', { method: 'PATCH' });
      setNotifications(prev => prev.map(n => ({ ...n, isRead: 1 })));
      dismissToast();
    } catch (e) {
      console.error('Failed to mark all as read:', e);
    }
  };

  const deleteNotification = async (id: string) => {
    try {
      await apiFetch(`/api/notifications/${id}`, { method: 'DELETE' });
      setNotifications(prev => prev.filter(n => n.id !== id));
      if (activeToast?.id === id) {
        dismissToast();
      }
    } catch (e) {
      console.error('Failed to delete notification:', e);
    }
  };

  const clearAllRead = async () => {
    try {
      await apiFetch('/api/notifications', { method: 'DELETE' });
      setNotifications(prev => prev.filter(n => !n.isRead));
    } catch (e) {
      console.error('Failed to clear read notifications:', e);
    }
  };

  const sendBroadcast = async (params: BroadcastParams): Promise<boolean> => {
    try {
      const res = await apiFetch('/api/notifications/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error('Broadcast failed');
      await fetchNotifications(true);
      return true;
    } catch (e) {
      console.error('Broadcast error:', e);
      return false;
    }
  };

  const checkExpiriesNow = async (): Promise<number> => {
    try {
      const res = await apiFetch('/api/notifications/check-expiries', {
        method: 'POST',
      });
      const data = await res.json();
      await fetchNotifications(true);
      return data.count || 0;
    } catch (e) {
      console.error('Check expiries error:', e);
      return 0;
    }
  };

  const sendTestNotification = async (): Promise<boolean> => {
    try {
      const res = await apiFetch('/api/notifications/test', {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Test failed');
      await fetchNotifications(true);
      return true;
    } catch (e) {
      console.error('Test notification error:', e);
      return false;
    }
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        isLoading,
        activeToast,
        dismissToast,
        markAsRead,
        markAllAsRead,
        deleteNotification,
        clearAllRead,
        refreshNotifications: () => fetchNotifications(false),
        sendBroadcast,
        checkExpiriesNow,
        sendTestNotification,
        soundEnabled,
        setSoundEnabled,
        toastAlertsEnabled,
        setToastAlertsEnabled,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
