import { useState, useEffect, useCallback } from 'react';
import { UserProfile, UserViewPreferences } from '../types';
import { apiFetch } from '../lib/utils';

export function useUserColumnPreferences(
  currentUser: UserProfile | null | undefined,
  storageKey: 'applicationColumns' | 'personnelColumns' | 'passColumns' | 'accessMatrixColumns' | 'accessMatrixCategories' | 'accessMatrixLocations',
  defaultColumns: string[]
) {
  const getInitialColumns = (): string[] => {
    // 1. Try local storage first
    try {
      const stored = localStorage.getItem(`accessone_cols_${storageKey}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }

    // 2. Try user profile preferences
    if (currentUser?.preferences?.[storageKey]) {
      const userCols = currentUser.preferences[storageKey];
      if (Array.isArray(userCols) && userCols.length > 0) {
        return userCols;
      }
    }

    // 3. Fallback to default
    return defaultColumns;
  };

  const [columns, setColumns] = useState<string[]>(getInitialColumns);
  const [isSaving, setIsSaving] = useState(false);

  // Sync if currentUser updates
  useEffect(() => {
    if (currentUser?.preferences?.[storageKey]) {
      const userCols = currentUser.preferences[storageKey];
      if (Array.isArray(userCols) && userCols.length > 0) {
        setColumns(userCols);
      }
    }
  }, [currentUser, storageKey]);

  // Listen to custom cross-window / view preferences update events
  useEffect(() => {
    const handleEvent = (e: any) => {
      if (e.detail?.[storageKey] && Array.isArray(e.detail[storageKey])) {
        setColumns(e.detail[storageKey]);
      }
    };
    window.addEventListener('view_preferences_updated', handleEvent);
    return () => window.removeEventListener('view_preferences_updated', handleEvent);
  }, [storageKey]);

  const saveColumns = useCallback(async (newColumns: string[]) => {
    setColumns(newColumns);
    setIsSaving(true);
    try {
      // 1. Save to localStorage immediately
      localStorage.setItem(`accessone_cols_${storageKey}`, JSON.stringify(newColumns));

      // 2. Dispatch custom event
      const updatedPrefs: UserViewPreferences = {
        ...(currentUser?.preferences || {}),
        [storageKey]: newColumns
      };
      window.dispatchEvent(new CustomEvent('view_preferences_updated', { detail: updatedPrefs }));

      // 3. Persist to server user profile if logged in
      if (currentUser?.id) {
        await apiFetch('/api/users/profile', {
          method: 'PATCH',
          body: JSON.stringify({
            preferences: updatedPrefs
          })
        });
      }
    } catch (err) {
      console.error(`Failed to save column preferences for ${storageKey}:`, err);
    } finally {
      setIsSaving(false);
    }
  }, [currentUser, storageKey]);

  const resetColumns = useCallback(async () => {
    await saveColumns(defaultColumns);
  }, [saveColumns, defaultColumns]);

  return {
    columns,
    saveColumns,
    resetColumns,
    isSaving
  };
}
