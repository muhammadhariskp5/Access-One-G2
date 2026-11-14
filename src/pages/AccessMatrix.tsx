import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Shield, Filter, ChevronRight, CheckCircle2, XCircle, Clock, ArrowUpDown, ArrowUp, ArrowDown, Calendar, Printer, Download, FileSpreadsheet, Columns, Layers, SlidersHorizontal } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Employee, Pass, Location, Category, AccessCode, UserProfile } from '../types';
import { cn, formatDate, parseToYMD, isPassInDateRange } from '../lib/utils';
import { resolvePersonnelStatus } from '../utils/passStatus';
import { PrintExportModal } from '../components/common/PrintExportModal';
import { DateRangeFilter } from '../components/common/DateRangeFilter';
import { ColumnDefinition } from '../components/common/ColumnCustomizerModal';
import { MatrixCustomizerModal } from '../components/matrix/MatrixCustomizerModal';
import { useUserColumnPreferences } from '../hooks/useUserColumnPreferences';
import { usePagedList } from '../hooks/usePagedList';

// One matrix row from the server: the person and all their live passes
type MatrixRow = Employee & { passes: Pass[] };

interface AccessMatrixProps {
  currentUser?: UserProfile | null;
  showToast?: (message: string, type?: 'success' | 'error') => void;
  locations?: Location[];
  categories?: Category[];
  accessCodes?: AccessCode[];
  globalSearch?: string;
}

const isPassForEmployee = (p: Pass, emp: Employee) => {
  if (!p || !emp) return false;
  const pEmpId = String(p.employeeId || '').toLowerCase().trim();
  if (!pEmpId) return false;

  return (
    String(emp.id || '').toLowerCase().trim() === pEmpId ||
    String(emp.employeeId || '').toLowerCase().trim() === pEmpId ||
    (emp.qatarId && String(emp.qatarId).toLowerCase().trim() === pEmpId) ||
    (emp.qidVisaNumber && String(emp.qidVisaNumber).toLowerCase().trim() === pEmpId)
  );
};

const isPassExpired = (p: Pass) => {
  if (!p) return true;
  const s = String(p.status || '').toLowerCase().trim();
  if (s === 'expired') return true;
  if (!p.expiryDate) return false;
  const expYMD = parseToYMD(p.expiryDate);
  const todayYMD = parseToYMD(new Date());
  if (expYMD && todayYMD && expYMD < todayYMD) return true;
  return false;
};

const isPassReplaced = (p: Pass) => {
  const s = String(p.status || '').toLowerCase().trim();
  const r = String(p.remarks || '').toLowerCase();
  return s === 'replaced' || s === 'superseded' || r.includes('replaced');
};

const isNotReplacedPass = (p: Pass) => {
  const s = String(p.status || '').toLowerCase().trim();
  const r = String(p.remarks || '').toLowerCase();
  return s !== 'replaced' && s !== 'superseded' && !r.includes('replaced') && s !== 'rejected' && s !== 'cancelled' && s !== 'revoked';
};

// Expired (not replaced, revoked, cancelled or rejected) within the last `days` days: kept on the
// matrix as a reminder to re-apply. A renewal marks the old pass 'replaced', which removes it.
const isRecentlyExpired = (p: Pass, days: number) => {
  if (days <= 0 || !isPassExpired(p) || isPassReplaced(p)) return false;
  const s = String(p.status || '').toLowerCase().trim();
  if (s === 'revoked' || s === 'cancelled' || s === 'rejected' || s === 'draft') return false;
  const ended = parseToYMD(p.expiryDate) || parseToYMD(p.updatedAt);
  if (!ended) return false;
  const cutoff = parseToYMD(new Date(Date.now() - days * 86400000));
  return !!cutoff && ended >= cutoff;
};

const readMatrixExpiredDays = (currentUser: UserProfile | null | undefined): number => {
  try {
    const stored = JSON.parse(localStorage.getItem('accessone_view_preferences') || '{}');
    if (typeof stored.matrixExpiredDays === 'number') return stored.matrixExpiredDays;
  } catch { /* ignore */ }
  const fromProfile = (currentUser?.preferences as any)?.matrixExpiredDays;
  return typeof fromProfile === 'number' ? fromProfile : 30;
};

const isActivePassStatus = (status: string) => {
  const resolved = resolvePersonnelStatus(undefined, status);
  const s = String(status || '').toLowerCase().trim();
  return resolved.isCreatedAndActive || s === 'active' || s === 'collected' || s === 'completed' || s === 'received';
};

const isPassValidAndActive = (p: Pass) => {
  if (!p) return false;
  const s = String(p.status || '').toLowerCase().trim();
  if (s === 'rejected' || s === 'cancelled' || s === 'revoked' || s === 'draft' || isPassReplaced(p)) {
    return false;
  }
  if (isPassExpired(p)) return false;
  return isActivePassStatus(s);
};

export function AccessMatrix({ 
  currentUser,
  showToast,
  locations = [],  
  categories = [], 
  accessCodes = [],
  globalSearch = '' 
}: AccessMatrixProps) {
  const [filterStatus, setFilterStatus] = useState<string>('active');
  // User setting (Settings > Display): how long expired passes stay on the default view
  const [expiredWindowDays, setExpiredWindowDays] = useState<number>(() => readMatrixExpiredDays(currentUser));
  useEffect(() => { setExpiredWindowDays(readMatrixExpiredDays(currentUser)); }, [currentUser]);
  useEffect(() => {
    const onPrefs = (e: Event) => {
      const days = (e as CustomEvent).detail?.matrixExpiredDays;
      if (typeof days === 'number') setExpiredWindowDays(days);
    };
    window.addEventListener('view_preferences_updated', onPrefs);
    return () => window.removeEventListener('view_preferences_updated', onPrefs);
  }, []);
  const showsRecentExpired = (filterStatus === 'active' || filterStatus === 'all') && expiredWindowDays > 0;

  // What one matrix cell shows: the latest valid pass per type/code set; otherwise (when the view
  // asks for it) the latest expired pass at that location.
  const cellPasses = (empPasses: Pass[], validActivePasses: Pass[], locId: string) => {
    const activeLocPasses = validActivePasses.filter(p => p.locationId === locId);
    let relevantPasses: Pass[] = [];
    if (activeLocPasses.length > 0) {
      const map = new Map<string, Pass>();
      const sortedByDate = [...activeLocPasses].sort((a, b) =>
        new Date(a.updatedAt || a.createdAt || 0).getTime() - new Date(b.updatedAt || b.createdAt || 0).getTime()
      );
      sortedByDate.forEach(pass => {
        const key = pass.type === 'main' ? 'main' : `supp-${[...(pass.accessCodes || [])].sort().join(',')}`;
        map.set(key, pass);
      });
      relevantPasses = Array.from(map.values());
    } else if (filterStatus === 'expired' || filterStatus === 'all_records' || showsRecentExpired) {
      const expiredLocPasses = empPasses.filter(p =>
        p.locationId === locId && isPassExpired(p) && !isPassReplaced(p) &&
        (filterStatus === 'expired' || filterStatus === 'all_records' || isRecentlyExpired(p, expiredWindowDays))
      );
      if (expiredLocPasses.length > 0) {
        const latestExpired = [...expiredLocPasses].sort((a, b) =>
          new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
        )[0];
        relevantPasses = [latestExpired];
      }
    }
    const sortedPasses = [...relevantPasses].sort((a, b) => (a.type === 'main' ? -1 : 1));
    return { sortedPasses, latestPass: sortedPasses[0] as Pass | undefined };
  };
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [startDateFilter, setStartDateFilter] = useState<string>('');
  const [endDateFilter, setEndDateFilter] = useState<string>('');
  const [sortField, setSortField] = useState<string>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false);
  const [isCustomizerModalOpen, setIsCustomizerModalOpen] = useState<boolean>(false);

  const availableColumns: ColumnDefinition[] = useMemo(() => [
    { id: 'code', label: 'E-Code / Personnel ID' },
    { id: 'name', label: 'Personnel Name', required: true },
    { id: 'jobTitle', label: 'Job Title' },
    { id: 'dept', label: 'Department' },
    { id: 'division', label: 'Division' },
    { id: 'qid', label: 'Qatar ID / Visa No' },
    { id: 'status', label: 'Employment Status' }
  ], []);

  const defaultColumnIds = useMemo(() => [
    'code', 'name', 'jobTitle'
  ], []);

  const {
    columns: visibleColumns,
    saveColumns,
    isSaving: isSavingColumns
  } = useUserColumnPreferences(currentUser, 'accessMatrixColumns', defaultColumnIds);

  const columnConfigs: Record<string, { label: string; width: number; getValue: (emp: Employee) => string; getSortVal: (emp: Employee) => string }> = useMemo(() => ({
    code: {
      label: 'E-Code',
      width: 100,
      getValue: (emp) => emp.employeeId || '—',
      getSortVal: (emp) => emp.employeeId || ''
    },
    name: {
      label: 'Personnel Name',
      width: 280,
      getValue: (emp) => emp.name || '—',
      getSortVal: (emp) => emp.name || ''
    },
    jobTitle: {
      label: 'Job Title',
      width: 140,
      getValue: (emp) => emp.jobTitle || 'N/A',
      getSortVal: (emp) => emp.jobTitle || ''
    },
    dept: {
      label: 'Department',
      width: 130,
      getValue: (emp) => emp.department || '—',
      getSortVal: (emp) => emp.department || ''
    },
    division: {
      label: 'Division',
      width: 120,
      getValue: (emp) => emp.division || '—',
      getSortVal: (emp) => emp.division || ''
    },
    qid: {
      label: 'QID / Visa No',
      width: 130,
      getValue: (emp) => emp.qatarId || emp.qidVisaNumber || '—',
      getSortVal: (emp) => emp.qatarId || emp.qidVisaNumber || ''
    },
    status: {
      label: 'Status',
      width: 100,
      getValue: (emp) => emp.status || 'Active',
      getSortVal: (emp) => emp.status || ''
    }
  }), []);

  const stickyLeftPositions = useMemo(() => {
    const positions: Record<string, number> = {};
    let currentLeft = 0;
    visibleColumns.forEach(colId => {
      positions[colId] = currentLeft;
      const w = columnConfigs[colId]?.width || 120;
      currentLeft += w;
    });
    return positions;
  }, [visibleColumns, columnConfigs]);

  const getLocationSortRank = (loc: Location): number => {
    const name = (loc.name || '').toLowerCase().trim();
    const code = (loc.code || '').toLowerCase().trim();

    // 1. Ras Laffan (RL / RLIC)
    if (
      code === 'rl' || 
      code === 'rlic' || 
      name.startsWith('ras laffan') || 
      name.includes('ras laffan') ||
      name === 'rl' ||
      name === 'rlic'
    ) {
      return 1;
    }

    // 2. Mesaieed Industrial City (MIC)
    if (
      code === 'mic' || 
      name.startsWith('mesaieed') || 
      name.includes('mesaieed') ||
      name.includes('(mic)') ||
      name === 'mic'
    ) {
      return 2;
    }

    // 3. Dukhan Industrial City (DK / DIC)
    if (
      code === 'dk' || 
      code === 'dic' || 
      name.startsWith('dukhan') || 
      name.includes('dukhan') ||
      name === 'dk'
    ) {
      return 3;
    }

    return 99;
  };

  const defaultLocationIds = useMemo(() => {
    const list: string[] = [];
    categories.forEach(cat => {
      const locs = locations.filter(loc => String(loc.categoryId) === String(cat.id));
      locs.sort((a, b) => {
        const rankA = getLocationSortRank(a);
        const rankB = getLocationSortRank(b);
        if (rankA !== rankB) return rankA - rankB;
        return (a.name || '').localeCompare(b.name || '');
      });
      locs.forEach(l => list.push(l.id));
    });
    const uncategorized = locations.filter(loc => !loc.categoryId || !categories.some(c => String(c.id) === String(loc.categoryId)));
    uncategorized.sort((a, b) => {
      const rankA = getLocationSortRank(a);
      const rankB = getLocationSortRank(b);
      if (rankA !== rankB) return rankA - rankB;
      return (a.name || '').localeCompare(b.name || '');
    });
    uncategorized.forEach(l => list.push(l.id));
    return list;
  }, [categories, locations]);

  const {
    columns: arrangedLocationIds,
    saveColumns: saveLocationPreferences,
    isSaving: isSavingLocations
  } = useUserColumnPreferences(currentUser, 'accessMatrixLocations', defaultLocationIds);

  const groupedLocations = useMemo(() => {
    const groups: Record<string, Location[]> = {};
    const locOrderMap = new Map<string, number>();
    arrangedLocationIds.forEach((id, idx) => locOrderMap.set(String(id), idx));

    const sortLocs = (locs: Location[]) => {
      return [...locs].sort((a, b) => {
        const hasA = locOrderMap.has(String(a.id));
        const hasB = locOrderMap.has(String(b.id));
        if (hasA && hasB) {
          return (locOrderMap.get(String(a.id))!) - (locOrderMap.get(String(b.id))!);
        }
        const rankA = getLocationSortRank(a);
        const rankB = getLocationSortRank(b);
        if (rankA !== rankB) return rankA - rankB;
        return (a.name || '').localeCompare(b.name || '');
      });
    };

    categories.forEach(cat => {
      const catLocs = locations.filter(loc => String(loc.categoryId) === String(cat.id));
      groups[cat.id] = sortLocs(catLocs);
    });

    // Group uncategorized locations if any exist
    const uncategorized = locations.filter(loc => !loc.categoryId || !categories.some(c => String(c.id) === String(loc.categoryId)));
    if (uncategorized.length > 0) {
      groups['uncategorized'] = sortLocs(uncategorized);
    }
    return groups;
  }, [categories, locations, arrangedLocationIds]);

  const defaultCategoryIds = useMemo(() => {
    const ids = categories.map(c => c.id);
    if ((groupedLocations['uncategorized']?.length || 0) > 0) {
      ids.push('uncategorized');
    }
    return ids;
  }, [categories, groupedLocations]);

  const {
    columns: arrangedCategoryIds,
    saveColumns: saveCategoryPreferences,
    isSaving: isSavingCategories
  } = useUserColumnPreferences(currentUser, 'accessMatrixCategories', defaultCategoryIds);

  const activeCategories = useMemo(() => {
    // Lookup map of all available categories
    const map = new Map<string, Category>();
    categories.forEach(c => map.set(String(c.id), c));
    if ((groupedLocations['uncategorized']?.length || 0) > 0) {
      map.set('uncategorized', { id: 'uncategorized', name: 'General / Uncategorized' } as Category);
    }

    // Specific category filter from dropdown
    if (filterCategory !== 'all') {
      const single = map.get(String(filterCategory));
      if (single && (groupedLocations[single.id]?.length || 0) > 0) {
        return [single];
      }
      return [];
    }

    // Use user's arranged & selected category IDs in order
    const result: Category[] = [];
    const seen = new Set<string>();

    arrangedCategoryIds.forEach(id => {
      const cat = map.get(String(id));
      if (cat && (groupedLocations[cat.id]?.length || 0) > 0) {
        result.push(cat);
        seen.add(String(cat.id));
      }
    });

    // If user has not yet customized category order, include all categories with locations
    if (arrangedCategoryIds.length === 0) {
      categories.forEach(cat => {
        if (!seen.has(String(cat.id)) && (groupedLocations[cat.id]?.length || 0) > 0) {
          result.push(cat);
          seen.add(String(cat.id));
        }
      });
      if ((groupedLocations['uncategorized']?.length || 0) > 0 && !seen.has('uncategorized')) {
        result.push({ id: 'uncategorized', name: 'General / Uncategorized' } as Category);
      }
    }

    return result;
  }, [categories, filterCategory, groupedLocations, arrangedCategoryIds]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleExportExcel = async () => {
    let allRows: MatrixRow[];
    try {
      allRows = await fetchAllMatching();
    } catch (err: any) {
      showToast?.(err.message || 'Failed to load the matrix for export', 'error');
      return;
    }
    // Every matching row (not just the pages loaded on screen)
    const filteredEmployees: Employee[] = allRows;
    const passes: Pass[] = allRows.flatMap(r => r.passes || []);
    const workbook = XLSX.utils.book_new();

    // Prepare headers
    const r1 = ["ACCESS PASS MATRIX REPORT"];
    const dateStr = new Date().toLocaleDateString();
    const filterInfo = `Exported: ${dateStr} | Status: ${filterStatus} | Category: ${filterCategory}${startDateFilter ? ` | From: ${startDateFilter}` : ''}${endDateFilter ? ` | To: ${endDateFilter}` : ''}`;
    const r2 = [filterInfo];
    const r3 = []; // empty spacing row

    // Level 1: S/N, Dynamic Visible Columns, then Categories
    const r4: string[] = ["S/N", ...visibleColumns.map(colId => columnConfigs[colId]?.label || colId)];
    activeCategories.forEach(cat => {
      const locCount = groupedLocations[cat.id]?.length || 0;
      r4.push(cat.name);
      for (let i = 0; i < (locCount * 2) - 1; i++) {
        r4.push("");
      }
    });

    // Level 2: Locations
    const r5: string[] = ["", ...visibleColumns.map(() => "")];
    activeCategories.forEach(cat => {
      groupedLocations[cat.id]?.forEach(loc => {
        r5.push(loc.name);
        r5.push("");
      });
    });

    // Level 3: Codes / Expiry
    const r6: string[] = ["", ...visibleColumns.map(() => "")];
    activeCategories.forEach(cat => {
      groupedLocations[cat.id]?.forEach(() => {
        r6.push("Codes");
        r6.push("Expiry");
      });
    });

    const rows: any[][] = [r1, r2, r3, r4, r5, r6];

    // Build data rows
    filteredEmployees.forEach((emp, index) => {
      const row: string[] = [
        (index + 1).toString(),
        ...visibleColumns.map(colId => columnConfigs[colId]?.getValue(emp) || '—')
      ];

      const empPasses = passes.filter(p => isPassForEmployee(p, emp) && isPassInDateRange(p, startDateFilter, endDateFilter));
      const validActivePasses = empPasses.filter(p => isPassValidAndActive(p));

      activeCategories.forEach(cat => {
        groupedLocations[cat.id]?.forEach(loc => {
          const { sortedPasses, latestPass } = cellPasses(empPasses, validActivePasses, loc.id);

          if (sortedPasses.length > 0) {
            const codes = sortedPasses.map(p => {
              const expired = isPassExpired(p);
              const prefix = p.type === 'main' ? (expired ? '[EXPIRED Main]' : '[Main]') : (expired ? '[EXPIRED Supp]' : '[Supp]');
              return `${prefix} ${p.accessCodes.join(', ')}`;
            }).join('; ');
            row.push(codes || '—');
          } else {
            row.push('—');
          }

          if (latestPass?.expiryDate) {
            const formatted = formatDate(latestPass.expiryDate);
            const expired = isPassExpired(latestPass);
            const expiry = new Date(latestPass.expiryDate);
            const today = new Date();
            const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            
            if (expired || diffDays <= 0) {
              row.push(`${formatted} (EXPIRED)`);
            } else if (diffDays <= 30) {
              row.push(`${formatted} (Expiring Soon)`);
            } else {
              row.push(formatted);
            }
          } else {
            row.push('—');
          }
        });
      });

      rows.push(row);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(rows);

    const colWidths = [
      { wch: 6 },
      ...visibleColumns.map(colId => ({ wch: Math.max(12, Math.round((columnConfigs[colId]?.width || 120) / 7)) }))
    ];
    activeCategories.forEach(cat => {
      groupedLocations[cat.id]?.forEach(() => {
        colWidths.push({ wch: 12 });
        colWidths.push({ wch: 12 });
      });
    });
    worksheet['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(workbook, worksheet, "Access Matrix");
    XLSX.writeFile(workbook, `Access_Pass_Matrix_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Who appears (status, recent-expiry window, dates, search, category) and in which order is
  // decided by the server (GET /api/matrix), a page at a time; each row carries that person's
  // passes, from which the cells are built exactly as before.
  const {
    items: matrixRows,
    total: totalMatching,
    loading: listLoading,
    loadingMore,
    error: listError,
    hasMore,
    loadMore,
    fetchAll: fetchAllMatching,
  } = usePagedList<MatrixRow>('/api/matrix', {
    q: globalSearch,
    status: filterStatus,
    category: filterCategory,
    from: parseToYMD(startDateFilter),
    to: parseToYMD(endDateFilter),
    sort: sortField,
    order: sortOrder,
    expiredDays: expiredWindowDays,
  }, ['employees', 'passes', 'passApplications', 'locations']);
  const filteredEmployees: Employee[] = matrixRows;
  const passes: Pass[] = useMemo(() => matrixRows.flatMap(r => r.passes || []), [matrixRows]);

  const observerTarget = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && hasMore) loadMore(); },
      { threshold: 1.0 }
    );
    if (observerTarget.current) observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  // Print uses every matching row, fetched when opened
  const [printRows, setPrintRows] = useState<MatrixRow[]>([]);
  const printPasses: Pass[] = useMemo(() => printRows.flatMap(r => r.passes || []), [printRows]);
  const openPrint = async () => {
    try {
      setPrintRows(await fetchAllMatching());
      setIsPrintModalOpen(true);
    } catch (err: any) {
      showToast?.(err.message || 'Failed to load the matrix for printing', 'error');
    }
  };

  return (
    <div className="space-y-4 flex-1 flex flex-col w-full min-h-0 h-[calc(100vh-90px)]">
      <div className="flex justify-between items-center flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-[#800020]"></div>
          <div>
            <p className="text-[10px] font-bold text-[#6B7280] uppercase tracking-widest">Access Pass Matrix</p>
            <p className="text-[10px] text-[#9CA3AF] font-semibold">
              {listLoading ? 'Loading…' : `${totalMatching} personnel` + (filteredEmployees.length < totalMatching ? ` · showing ${filteredEmployees.length}, scroll for more` : '')}
            </p>
          </div>
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
            <option value="active">{expiredWindowDays > 0 ? `Valid + Expired in last ${expiredWindowDays} days (Default)` : 'Valid Active Passes (Default)'}</option>
            <option value="expired">Expired Passes Only</option>
            <option value="no_valid_pass">Personnel Without Valid Pass</option>
            <option value="replaced">Replaced Passes Only</option>
            <option value="all_records">All Personnel Records</option>
          </select>
          <select 
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-xl text-[10px] font-bold outline-none focus:ring-1 focus:ring-[#800020]"
          >
            <option value="all">All Arranged Categories ({activeCategories.length})</option>
            {categories.map(cat => {
              const count = groupedLocations[cat.id]?.length || 0;
              return (
                <option key={cat.id} value={cat.id}>
                  {cat.name} ({count} {count === 1 ? 'loc' : 'locs'})
                </option>
              );
            })}
            {(groupedLocations['uncategorized']?.length || 0) > 0 && (
              <option value="uncategorized">
                General Locations ({groupedLocations['uncategorized'].length} locs)
              </option>
            )}
          </select>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-xl">
            <ArrowUpDown size={12} className="text-[#800020]" />
            <select 
              value={`${sortField}_${sortOrder}`}
              onChange={(e) => {
                const [f, o] = e.target.value.split('_');
                setSortField(f);
                setSortOrder(o as 'asc' | 'desc');
              }}
              className="bg-transparent text-[10px] font-bold outline-none cursor-pointer"
            >
              <option value="name_asc">Personnel Name (A-Z)</option>
              <option value="name_desc">Personnel Name (Z-A)</option>
              <option value="code_asc">Personnel Code (A-Z)</option>
              <option value="code_desc">Personnel Code (Z-A)</option>
              <option value="jobTitle_asc">Job Title (A-Z)</option>
              <option value="jobTitle_desc">Job Title (Z-A)</option>
              <option value="status_asc">Status (Asc)</option>
              <option value="status_desc">Status (Desc)</option>
            </select>
          </div>

          <div className="h-4 w-px bg-[#E5E7EB] mx-0.5"></div>

          <button
            onClick={() => setIsCustomizerModalOpen(true)}
            className="px-3 py-1.5 bg-white border border-[#E5E7EB] text-[#800020] hover:bg-rose-50 hover:border-rose-200 rounded-xl font-bold text-[10px] uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="Customize and arrange matrix columns and pass categories in a single view"
          >
            <SlidersHorizontal size={13} />
            <span>Customize Columns & Categories</span>
          </button>

          <button
            onClick={openPrint}
            className="px-3 py-1.5 bg-white border border-[#E5E7EB] text-[#800020] hover:bg-rose-50 hover:border-rose-200 rounded-xl font-bold text-[10px] uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="Print or Export current Access Matrix to PDF"
          >
            <Printer size={13} />
            <span>Print / PDF</span>
          </button>

          <button
            onClick={handleExportExcel}
            className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 hover:bg-emerald-100 rounded-xl font-bold text-[10px] uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="Export Access Matrix to Excel spreadsheet (.xlsx)"
          >
            <FileSpreadsheet size={13} />
            <span>Export Excel</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden flex-1 flex flex-col min-h-0 h-full">
        <div className="overflow-auto flex-1 min-h-0 h-full">
          <table className="text-left border-collapse table-fixed w-max min-w-full">
            <colgroup>
              {visibleColumns.map(colId => {
                const w = columnConfigs[colId]?.width || 120;
                return (
                  <col key={colId} style={{ width: `${w}px`, minWidth: `${w}px`, maxWidth: `${w}px` }} />
                );
              })}
              {activeCategories.map(cat => 
                groupedLocations[cat.id]?.map(loc => (
                  <React.Fragment key={loc.id}>
                    <col className="w-[110px]" />
                    <col className="w-[90px]" />
                  </React.Fragment>
                ))
              )}
            </colgroup>
            <thead className="sticky top-0 z-30">
              {/* Level 1: Categories */}
              <tr className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
                {visibleColumns.map((colId, cIdx) => {
                  const isLast = cIdx === visibleColumns.length - 1;
                  const cfg = columnConfigs[colId];
                  const left = stickyLeftPositions[colId] ?? 0;
                  const w = cfg?.width || 120;

                  return (
                    <th 
                      key={colId}
                      rowSpan={3} 
                      onClick={() => handleSort(colId)}
                      style={{ 
                        left: `${left}px`,
                        width: `${w}px`,
                        minWidth: `${w}px`,
                        maxWidth: `${w}px`
                      }}
                      className={cn(
                        "sticky z-40 bg-[#F8FAFC] px-3 py-3 align-middle text-[10px] font-extrabold text-[#374151] uppercase tracking-wider border-r border-b border-[#E5E7EB] cursor-pointer hover:bg-[#F1F5F9] transition-colors select-none group",
                        isLast && "shadow-[3px_0_6px_-2px_rgba(0,0,0,0.08)]"
                      )}
                    >
                      <div className="flex items-center justify-between gap-1 min-w-0">
                        <span className="truncate" title={cfg?.label || colId}>{cfg?.label || colId}</span>
                        {sortField === colId ? (
                          sortOrder === 'asc' ? <ArrowUp size={11} className="text-[#800020] flex-shrink-0" /> : <ArrowDown size={11} className="text-[#800020] flex-shrink-0" />
                        ) : (
                          <ArrowUpDown size={11} className="text-gray-400 opacity-40 group-hover:opacity-100 flex-shrink-0" />
                        )}
                      </div>
                    </th>
                  );
                })}
                {activeCategories.map(cat => (
                  <th 
                    key={cat.id} 
                    colSpan={(groupedLocations[cat.id]?.length || 0) * 2}
                    className="px-4 py-2 text-[10px] font-bold text-[#800020] uppercase tracking-widest text-center border-r border-[#E5E7EB]"
                  >
                    {cat.name}
                  </th>
                ))}
              </tr>
              {/* Level 2: Locations */}
              <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                {activeCategories.map(cat => (
                  groupedLocations[cat.id]?.map(loc => (
                    <th 
                      key={loc.id} 
                      colSpan={2}
                      className="px-2 py-1.5 text-[9px] font-bold text-[#4B5563] uppercase tracking-wider text-center border-r border-[#E5E7EB] truncate"
                      title={loc.name}
                    >
                      {loc.name}
                    </th>
                  ))
                ))}
              </tr>
              {/* Level 3: Access Codes & Expiry */}
              <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                {activeCategories.map(cat => (
                  groupedLocations[cat.id]?.map(loc => (
                    <React.Fragment key={loc.id}>
                      <th className="px-2 py-1 text-[9px] font-bold text-[#9CA3AF] uppercase tracking-widest text-center border-r border-[#E5E7EB]">
                        Codes
                      </th>
                      <th className="px-2 py-1 text-[9px] font-bold text-[#9CA3AF] uppercase tracking-widest text-center border-r border-[#E5E7EB]">
                        Expiry
                      </th>
                    </React.Fragment>
                  ))
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F4F6]">
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={100} className="p-12 text-center text-gray-500 font-semibold text-xs">
                    {listLoading ? 'Loading…' : listError ? listError : 'No personnel records with passes found matching the selected filters.'}
                  </td>
                </tr>
              ) : (
                filteredEmployees.map(emp => (
                  <tr key={emp.id} className="hover:bg-[#F9FAFB] transition-colors group">
                    {visibleColumns.map((colId, cIdx) => {
                      const isLast = cIdx === visibleColumns.length - 1;
                      const cfg = columnConfigs[colId];
                      const left = stickyLeftPositions[colId] ?? 0;
                      const w = cfg?.width || 120;
                      const val = cfg ? cfg.getValue(emp) : '—';

                      return (
                        <td 
                          key={colId}
                          style={{ 
                            left: `${left}px`,
                            width: `${w}px`,
                            minWidth: `${w}px`,
                            maxWidth: `${w}px`
                          }}
                          className={cn(
                            "sticky z-20 bg-white group-hover:bg-[#F8FAFC] px-3 py-2.5 border-r border-[#E5E7EB]",
                            isLast && "shadow-[3px_0_6px_-2px_rgba(0,0,0,0.08)]"
                          )}
                        >
                          {colId === 'code' ? (
                            <span className="text-[10px] font-mono font-bold text-[#800020] truncate block" title={val}>{val}</span>
                          ) : colId === 'name' ? (
                            <p className="text-[10px] font-bold text-[#1A1A1A] leading-tight truncate" title={val}>{val}</p>
                          ) : colId === 'status' ? (
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase",
                              val.toLowerCase() === 'active' ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-700"
                            )}>
                              {val}
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold text-[#4B5563] truncate block" title={val}>{val}</span>
                          )}
                        </td>
                      );
                    })}
                    {(() => {
                      const empPasses = passes.filter(p => isPassForEmployee(p, emp) && isPassInDateRange(p, startDateFilter, endDateFilter));
                      const validActivePasses = empPasses.filter(p => isPassValidAndActive(p));
                    
                    return activeCategories.map(cat => {
                      return groupedLocations[cat.id].map(loc => {
                        const { sortedPasses, latestPass } = cellPasses(empPasses, validActivePasses, loc.id);
 
                      return (
                        <React.Fragment key={loc.id}>
                          <td className="px-1 py-1.5 text-center border-r border-[#E5E7EB]">
                            {sortedPasses.length > 0 ? (
                              <div className="flex flex-wrap justify-center gap-1">
                                {sortedPasses.map(pass => {
                                  const isMain = pass.type === 'main';
                                  const isExpired = isPassExpired(pass);
                                  const codesString = pass.accessCodes.join(', ');
                                  const statusLabel = pass.status ? pass.status.charAt(0).toUpperCase() + pass.status.slice(1) : '';
                                  
                                  return (
                                    <span 
                                      key={pass.id} 
                                      className={cn(
                                        "px-1.5 py-0.5 rounded-full text-[9px] font-bold border transition-colors relative",
                                        isMain 
                                          ? (isExpired ? "bg-rose-50 text-rose-700 border-rose-200 line-through" : "bg-orange-500 text-white border-orange-600")
                                          : (isExpired ? "bg-rose-50 text-rose-600 border-rose-200 line-through" : "bg-gray-200 text-gray-700 border-gray-300"),
                                        isExpired && "opacity-70"
                                      )}
                                      title={`${isMain ? 'Main' : 'Supplementary'} Pass - ${statusLabel}${isExpired ? ' (Expired)' : ''}`}
                                    >
                                      {codesString}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className="text-[9px] text-[#D1D5DB]">—</span>
                            )}
                          </td>
                          <td className="px-1 py-1.5 text-center border-r border-[#E5E7EB]">
                            {latestPass?.expiryDate ? (
                              <span className={cn(
                                "px-1.5 py-0.5 rounded-md text-[9px] font-bold",
                                (() => {
                                  const isExpired = isPassExpired(latestPass);
                                  const expiry = new Date(latestPass.expiryDate);
                                  const today = new Date();
                                  const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                                  
                                  if (isExpired || diffDays <= 0) return "bg-rose-50 text-rose-700 border border-rose-100";
                                  if (diffDays <= 30) return "bg-amber-50 text-amber-700 border border-amber-100";
                                  return "bg-emerald-50 text-emerald-700 border border-emerald-100";
                                })()
                              )}>
                                {formatDate(latestPass.expiryDate)}
                              </span>
                            ) : (
                              <span className="text-[9px] text-[#D1D5DB]">—</span>
                            )}
                          </td>
                        </React.Fragment>
                      );
                    });
                  });
                })()}
                </tr>
              ))
            )}
            </tbody>
          </table>
          <div ref={observerTarget} className="h-10 flex items-center justify-center">
            {loadingMore && (
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Loading...</span>
            )}
            {!listLoading && !loadingMore && hasMore && (
              <button onClick={() => loadMore()} className="text-[10px] font-bold text-[#800020] uppercase tracking-wider cursor-pointer">
                Load more ({filteredEmployees.length} of {totalMatching})
              </button>
            )}
          </div>
        </div>
      </div>

      <PrintExportModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        title="Print / Export Access Matrix"
        documentTitle="Access Pass Matrix Report"
        defaultOrientation="landscape"
        defaultFitMode="fit-width"
      >
        <div className="space-y-4 text-xs font-sans">
          <div className="flex justify-between items-start border-b border-gray-200 pb-3">
            <div>
              <h2 className="text-base font-bold text-[#800020] uppercase tracking-wide">Access Pass Matrix</h2>
              <p className="text-[10px] text-gray-500 font-medium">Generated on {new Date().toLocaleString()}</p>
            </div>
            <div className="text-right text-[10px] text-gray-600">
              <p><span className="font-bold">Total Personnel:</span> {printRows.length}</p>
              {(startDateFilter || endDateFilter) && (
                <p><span className="font-bold">Date Range:</span> {startDateFilter || 'Start'} to {endDateFilter || 'End'}</p>
              )}
            </div>
          </div>

          {/* Color Legend for Print / PDF */}
          <div className="flex flex-wrap items-center gap-4 bg-gray-50 p-2.5 rounded-lg border border-gray-200 text-[10px] my-2">
            <span className="font-bold text-gray-700 uppercase tracking-wider">Legend:</span>
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-orange-500 text-white border border-orange-600">Main Pass</span>
              <span className="text-gray-600 font-medium">(Primary)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-gray-200 text-gray-700 border border-gray-300">Supp Pass</span>
              <span className="text-gray-600 font-medium">(Supplementary)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Valid</span>
              <span className="text-gray-600 font-medium">(&gt;30d)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Expiring Soon</span>
              <span className="text-gray-600 font-medium">(≤30d)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-200">Expired</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse border border-gray-300 text-[10px]">
              <thead>
                <tr className="bg-gray-100 border-b border-gray-300">
                  <th className="p-1.5 border-r border-gray-300 font-bold text-gray-700 text-center w-8">S/N</th>
                  {visibleColumns.map(colId => (
                    <th key={colId} className="p-1.5 border-r border-gray-300 font-bold text-gray-700">
                      {columnConfigs[colId]?.label || colId}
                    </th>
                  ))}
                  {activeCategories.map(cat => (
                    <th 
                      key={cat.id} 
                      colSpan={(groupedLocations[cat.id]?.length || 0) * 2}
                      className="p-1.5 border-r border-gray-300 font-bold text-[#800020] text-center"
                    >
                      {cat.name}
                    </th>
                  ))}
                </tr>
                <tr className="bg-gray-50 border-b border-gray-300">
                  <th className="p-1 border-r border-gray-300"></th>
                  {visibleColumns.map(colId => (
                    <th key={colId} className="p-1 border-r border-gray-300"></th>
                  ))}
                  {activeCategories.map(cat => 
                    groupedLocations[cat.id]?.map(loc => (
                      <th key={loc.id} colSpan={2} className="p-1 border-r border-gray-300 text-center text-gray-600 font-semibold">
                        {loc.name}
                      </th>
                    ))
                  )}
                </tr>
                <tr className="bg-gray-50 border-b border-gray-300 text-[9px] text-gray-500">
                  <th className="p-1 border-r border-gray-300"></th>
                  {visibleColumns.map(colId => (
                    <th key={colId} className="p-1 border-r border-gray-300"></th>
                  ))}
                  {activeCategories.map(cat => 
                    groupedLocations[cat.id]?.map(loc => (
                      <React.Fragment key={loc.id}>
                        <th className="p-1 border-r border-gray-300 text-center">Codes</th>
                        <th className="p-1 border-r border-gray-300 text-center">Expiry</th>
                      </React.Fragment>
                    ))
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {printRows.length === 0 ? (
                  <tr>
                    <td colSpan={100} className="p-8 text-center text-gray-500 font-semibold text-xs">
                      No personnel records with passes found matching the selected filters.
                    </td>
                  </tr>
                ) : (
                  printRows.map((emp, index) => {
                    const empPasses = printPasses.filter(p => isPassForEmployee(p, emp) && isPassInDateRange(p, startDateFilter, endDateFilter));
                    const validActivePasses = empPasses.filter(p => isPassValidAndActive(p));

                  return (
                    <tr key={emp.id} className="hover:bg-gray-50">
                      <td className="p-1.5 border-r border-gray-200 font-bold text-gray-500 text-center">{index + 1}</td>
                      {visibleColumns.map(colId => {
                        const val = columnConfigs[colId]?.getValue(emp) || '—';
                        return (
                          <td 
                            key={colId} 
                            className={cn(
                              "p-1.5 border-r border-gray-200",
                              colId === 'code' && "font-mono font-bold text-[#800020]",
                              colId === 'name' && "font-bold text-gray-900",
                              colId !== 'code' && colId !== 'name' && "text-gray-600"
                            )}
                          >
                            {val}
                          </td>
                        );
                      })}
                      {activeCategories.map(cat => 
                        groupedLocations[cat.id]?.map(loc => {
                          const { sortedPasses, latestPass } = cellPasses(empPasses, validActivePasses, loc.id);

                          return (
                            <React.Fragment key={loc.id}>
                              <td className="p-1 border-r border-gray-200 text-center">
                                {sortedPasses.length > 0 ? (
                                  <div className="flex flex-wrap justify-center gap-1">
                                    {sortedPasses.map(pass => {
                                      const isMain = pass.type === 'main';
                                      const isExpired = isPassExpired(pass);
                                      const codesString = pass.accessCodes.join(', ');

                                      return (
                                        <span 
                                          key={pass.id} 
                                          className={cn(
                                            "px-1.5 py-0.5 rounded-full text-[9px] font-bold border inline-block whitespace-nowrap",
                                            isMain 
                                              ? (isExpired ? "bg-gray-100 text-gray-500 border-gray-200 opacity-60 line-through" : "bg-orange-500 text-white border-orange-600")
                                              : (isExpired ? "bg-gray-100 text-gray-400 border-gray-200 opacity-60 line-through" : "bg-gray-200 text-gray-700 border-gray-300"),
                                            isExpired && "opacity-60"
                                          )}
                                        >
                                          {codesString}
                                        </span>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <span className="text-[9px] text-gray-300">—</span>
                                )}
                              </td>
                              <td className="p-1 border-r border-gray-200 text-center">
                                {latestPass?.expiryDate ? (
                                  <span className={cn(
                                    "px-1.5 py-0.5 rounded-md text-[9px] font-bold inline-block whitespace-nowrap",
                                    (() => {
                                      const isExpired = isPassExpired(latestPass);
                                      const expiry = new Date(latestPass.expiryDate);
                                      const today = new Date();
                                      const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                                      
                                      if (isExpired || diffDays <= 0) return "bg-rose-50 text-rose-700 border border-rose-200";
                                      if (diffDays <= 30) return "bg-amber-50 text-amber-700 border border-amber-200";
                                      return "bg-emerald-50 text-emerald-700 border border-emerald-200";
                                    })()
                                  )}>
                                    {formatDate(latestPass.expiryDate)}
                                  </span>
                                ) : (
                                  <span className="text-[9px] text-gray-300">—</span>
                                )}
                              </td>
                            </React.Fragment>
                          );
                        })
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
            </table>
          </div>
        </div>
      </PrintExportModal>

      <MatrixCustomizerModal
        isOpen={isCustomizerModalOpen}
        onClose={() => setIsCustomizerModalOpen(false)}
        availableColumns={availableColumns}
        currentColumnIds={visibleColumns}
        defaultColumnIds={defaultColumnIds}
        onSaveColumns={async (newCols) => {
          await saveColumns(newCols);
        }}
        categories={categories}
        groupedLocations={groupedLocations}
        currentCategoryIds={arrangedCategoryIds}
        defaultCategoryIds={defaultCategoryIds}
        onSaveCategories={async (newCats) => {
          await saveCategoryPreferences(newCats);
        }}
        currentLocationIds={arrangedLocationIds}
        defaultLocationIds={defaultLocationIds}
        onSaveLocations={async (newLocs) => {
          await saveLocationPreferences(newLocs);
          if (showToast) {
            showToast('Matrix settings and columns arrangement saved to your profile', 'success');
          }
        }}
        isSaving={isSavingColumns || isSavingCategories || isSavingLocations}
      />
    </div>
  );
}
