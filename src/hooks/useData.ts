import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/utils';
import { 
  Employee, 
  Pass, 
  PassApplication, 
  Location, 
  Category, 
  AccessCode, 
  UserProfile, 
  AuditLog,
  BrandingSettings
} from '../types';

export function useData(user: UserProfile | null) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [applications, setApplications] = useState<PassApplication[]>([]);
  const [passes, setPasses] = useState<Pass[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accessCodes, setAccessCodes] = useState<AccessCode[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [company, setCompany] = useState<BrandingSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isFetchingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!user || isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const [emps, pss, apps, locs, cats, grps, comp, usrs, logs] = await Promise.all([
        apiFetch('/api/employees').then(r => r.json()),
        apiFetch('/api/passes').then(r => r.json()),
        apiFetch('/api/passApplications').then(r => r.json()),
        apiFetch('/api/locations').then(r => r.json()),
        apiFetch('/api/categories').then(r => r.json()),
        apiFetch('/api/accessCodes').then(r => r.json()),
        apiFetch('/api/settings/company').then(r => r.json()),
        apiFetch('/api/users').then(r => r.json()),
        apiFetch('/api/auditLogs').then(r => r.json())
      ]);
      setEmployees(emps);
      setPasses(pss);
      setApplications(apps);
      setLocations(locs);
      setCategories(cats);
      setAccessCodes(grps);
      setCompany(comp);
      setAllUsers(usrs);
      setAuditLogs(logs);
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      isFetchingRef.current = false;
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchData();
      const interval = setInterval(fetchData, 5000);
      return () => clearInterval(interval);
    } else {
      setIsLoading(false);
    }
  }, [user, fetchData]);

  return {
    employees,
    applications,
    passes,
    locations,
    categories,
    accessCodes,
    allUsers,
    auditLogs,
    company,
    isLoading,
    fetchData
  };
}
