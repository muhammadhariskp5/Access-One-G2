import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { Shield, Filter, ChevronRight, CheckCircle2, XCircle, Clock, ArrowUpDown, ArrowUp, ArrowDown, Calendar, Printer, Download, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Employee, Pass, Location, Category, AccessCode } from '../types';
import { cn, formatDate, parseToYMD, isPassInDateRange } from '../lib/utils';
import { resolvePersonnelStatus } from '../utils/passStatus';
import { PrintExportModal } from '../components/common/PrintExportModal';
import { DateRangeFilter } from '../components/common/DateRangeFilter';

interface AccessMatrixProps {
  employees?: Employee[];
  passes?: Pass[];
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
  employees = [], 
  passes = [], 
  locations = [], 
  categories = [], 
  accessCodes = [],
  globalSearch = '' 
}: AccessMatrixProps) {
  const [filterStatus, setFilterStatus] = useState<string>('active');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [startDateFilter, setStartDateFilter] = useState<string>('');
  const [endDateFilter, setEndDateFilter] = useState<string>('');
  const [sortField, setSortField] = useState<string>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleExportExcel = () => {
    const workbook = XLSX.utils.book_new();

    // Prepare headers
    const r1 = ["ACCESS PASS MATRIX REPORT"];
    const dateStr = new Date().toLocaleDateString();
    const filterInfo = `Exported: ${dateStr} | Status: ${filterStatus} | Category: ${filterCategory}${startDateFilter ? ` | From: ${startDateFilter}` : ''}${endDateFilter ? ` | To: ${endDateFilter}` : ''}`;
    const r2 = [filterInfo];
    const r3 = []; // empty spacing row

    // Level 1: S/N, E-Code, Name, Job Title, then Categories
    const r4: string[] = ["S/N", "E-Code", "Personnel Name", "Job Title"];
    activeCategories.forEach(cat => {
      const locCount = groupedLocations[cat.id]?.length || 0;
      r4.push(cat.name);
      for (let i = 0; i < (locCount * 2) - 1; i++) {
        r4.push("");
      }
    });

    // Level 2: Locations
    const r5: string[] = ["", "", "", ""];
    activeCategories.forEach(cat => {
      groupedLocations[cat.id]?.forEach(loc => {
        r5.push(loc.name);
        r5.push("");
      });
    });

    // Level 3: Codes / Expiry
    const r6: string[] = ["", "", "", ""];
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
        emp.employeeId || '—',
        emp.name || '—',
        emp.jobTitle || 'N/A'
      ];

      const empPasses = passes.filter(p => isPassForEmployee(p, emp) && isPassInDateRange(p, startDateFilter, endDateFilter));
      const validActivePasses = empPasses.filter(p => isPassValidAndActive(p));

      activeCategories.forEach(cat => {
        groupedLocations[cat.id]?.forEach(loc => {
          const activeLocPasses = validActivePasses.filter(p => p.locationId === loc.id);

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
          } else if (filterStatus === 'expired' || filterStatus === 'all_records') {
            const expiredLocPasses = empPasses.filter(p => 
              p.locationId === loc.id && isPassExpired(p) && !isPassReplaced(p)
            );
            if (expiredLocPasses.length > 0) {
              const latestExpired = [...expiredLocPasses].sort((a, b) => 
                new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
              )[0];
              relevantPasses = [latestExpired];
            }
          }

          const sortedPasses = [...relevantPasses].sort((a, b) => (a.type === 'main' ? -1 : 1));
          const latestPass = sortedPasses[0];

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

    const colWidths = [{ wch: 6 }, { wch: 14 }, { wch: 30 }, { wch: 20 }];
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

  const filteredEmployees = useMemo(() => {
    const s = (globalSearch || '').toLowerCase().trim();
    
    return employees.filter(emp => {
      // Get all passes for this employee
      const empAllPasses = passes.filter(p => isPassForEmployee(p, emp) && isPassInDateRange(p, startDateFilter, endDateFilter));
      const validActivePasses = empAllPasses.filter(p => isPassValidAndActive(p));
      const expiredPasses = empAllPasses.filter(p => isPassExpired(p) && !isPassReplaced(p) && (p.status || '').toLowerCase() !== 'rejected' && (p.status || '').toLowerCase() !== 'cancelled');
      const replacedPasses = empAllPasses.filter(p => isPassReplaced(p));

      // 1. Status Filter Validation
      const normFilter = filterStatus.toLowerCase();
      if (normFilter === 'active' || normFilter === 'all') {
        // Must have at least ONE valid, active, unexpired pass
        if (validActivePasses.length === 0) return false;
      } else if (normFilter === 'expired') {
        // Must have at least one expired pass
        if (expiredPasses.length === 0) return false;
      } else if (normFilter === 'replaced') {
        // Must have replaced passes
        if (replacedPasses.length === 0) return false;
      } else if (normFilter === 'no_valid_pass') {
        // Personnel who do NOT have any valid active pass
        if (validActivePasses.length > 0) return false;
      } else if (normFilter === 'all_records') {
        // Any employee with at least one pass record
        if (empAllPasses.length === 0) return false;
      }

      // Relevant passes for search and category filtering
      const relevantPasses = normFilter === 'expired' 
        ? expiredPasses 
        : (normFilter === 'replaced' ? replacedPasses : (validActivePasses.length > 0 ? validActivePasses : empAllPasses));

      // 2. Search matching
      let matchesSearch = true;
      if (s) {
        const passLocations = relevantPasses.map(p => locations.find(l => l.id === p.locationId)?.name?.toLowerCase() || '');
        const passCodes = relevantPasses.flatMap(p => p.accessCodes || []).map(c => c.toLowerCase());

        matchesSearch = Boolean(
          emp.name?.toLowerCase().includes(s) ||
          emp.employeeId?.toLowerCase().includes(s) ||
          emp.jobTitle?.toLowerCase().includes(s) ||
          emp.qatarId?.toLowerCase().includes(s) ||
          emp.qidVisaNumber?.toLowerCase().includes(s) ||
          emp.department?.toLowerCase().includes(s) ||
          emp.division?.toLowerCase().includes(s) ||
          passLocations.some(loc => loc.includes(s)) ||
          passCodes.some(code => code.includes(s))
        );
      }

      if (!matchesSearch) return false;

      // 3. Category matching
      if (filterCategory !== 'all') {
        const catLocIds = locations.filter(l => String(l.categoryId) === String(filterCategory)).map(l => l.id);
        const hasPassInCat = relevantPasses.some(p => catLocIds.includes(p.locationId));
        if (!hasPassInCat) return false;
      }

      return true;
    }).sort((a, b) => {
      let valA: any = '';
      let valB: any = '';
      if (sortField === 'name') {
        valA = a.name || '';
        valB = b.name || '';
      } else if (sortField === 'code') {
        valA = a.employeeId || '';
        valB = b.employeeId || '';
      } else if (sortField === 'jobTitle') {
        valA = a.jobTitle || '';
        valB = b.jobTitle || '';
      } else if (sortField === 'status') {
        valA = a.status || '';
        valB = b.status || '';
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [employees, passes, locations, globalSearch, filterStatus, filterCategory, sortField, sortOrder, startDateFilter, endDateFilter]);

  const groupedLocations = useMemo(() => {
    const groups: Record<string, Location[]> = {};
    categories.forEach(cat => {
      groups[cat.id] = locations.filter(loc => String(loc.categoryId) === String(cat.id));
    });
    // Group uncategorized locations if any exist
    const uncategorized = locations.filter(loc => !loc.categoryId || !categories.some(c => String(c.id) === String(loc.categoryId)));
    if (uncategorized.length > 0) {
      groups['uncategorized'] = uncategorized;
    }
    return groups;
  }, [categories, locations]);

  const activeCategories = useMemo(() => {
    const active = categories.filter(cat => 
      (filterCategory === 'all' || String(cat.id) === String(filterCategory)) && 
      (groupedLocations[cat.id]?.length || 0) > 0
    );
    if ((filterCategory === 'all' || filterCategory === 'uncategorized') && groupedLocations['uncategorized']?.length > 0) {
      return [...active, { id: 'uncategorized', name: 'General Locations' } as Category];
    }
    return active;
  }, [categories, filterCategory, groupedLocations]);

  return (
    <div className="space-y-4 flex-1 flex flex-col w-full min-h-0 h-[calc(100vh-90px)]">
      <div className="flex justify-between items-center flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-[#800020]"></div>
          <div>
            <p className="text-[10px] font-bold text-[#6B7280] uppercase tracking-widest">Access Pass Matrix</p>
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
            <option value="active">Valid Active Passes (Default)</option>
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
            <option value="all">All Categories</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
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
            onClick={() => setIsPrintModalOpen(true)}
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
              <col className="w-[100px] min-w-[100px] max-w-[100px]" />
              <col className="w-[320px] min-w-[320px] max-w-[320px]" />
              <col className="w-[140px] min-w-[140px] max-w-[140px]" />
              {activeCategories.map(cat => 
                groupedLocations[cat.id].map(loc => (
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
                <th 
                  rowSpan={3} 
                  onClick={() => handleSort('code')}
                  className="sticky left-0 z-40 bg-[#F8FAFC] w-[100px] min-w-[100px] max-w-[100px] px-3 py-3 align-middle text-[10px] font-extrabold text-[#374151] uppercase tracking-wider border-r border-b border-[#E5E7EB] cursor-pointer hover:bg-[#F1F5F9] transition-colors select-none group"
                >
                  <div className="flex items-center justify-between gap-1 min-w-0">
                    <span className="truncate" title="E-Code">E-Code</span>
                    {sortField === 'code' ? (
                      sortOrder === 'asc' ? <ArrowUp size={11} className="text-[#800020] flex-shrink-0" /> : <ArrowDown size={11} className="text-[#800020] flex-shrink-0" />
                    ) : (
                      <ArrowUpDown size={11} className="text-gray-400 opacity-40 group-hover:opacity-100 flex-shrink-0" />
                    )}
                  </div>
                </th>
                <th 
                  rowSpan={3} 
                  onClick={() => handleSort('name')}
                  className="sticky left-[100px] z-40 bg-[#F8FAFC] w-[320px] min-w-[320px] max-w-[320px] px-3 py-3 align-middle text-[10px] font-extrabold text-[#374151] uppercase tracking-wider border-r border-b border-[#E5E7EB] cursor-pointer hover:bg-[#F1F5F9] transition-colors select-none group"
                >
                  <div className="flex items-center justify-between gap-1 min-w-0">
                    <span className="truncate" title="Name">Name</span>
                    {sortField === 'name' ? (
                      sortOrder === 'asc' ? <ArrowUp size={11} className="text-[#800020] flex-shrink-0" /> : <ArrowDown size={11} className="text-[#800020] flex-shrink-0" />
                    ) : (
                      <ArrowUpDown size={11} className="text-gray-400 opacity-40 group-hover:opacity-100 flex-shrink-0" />
                    )}
                  </div>
                </th>
                <th 
                  rowSpan={3} 
                  onClick={() => handleSort('jobTitle')}
                  className="sticky left-[420px] z-40 bg-[#F8FAFC] w-[140px] min-w-[140px] max-w-[140px] px-3 py-3 align-middle text-[10px] font-extrabold text-[#374151] uppercase tracking-wider border-r border-b border-[#E5E7EB] shadow-[3px_0_6px_-2px_rgba(0,0,0,0.08)] cursor-pointer hover:bg-[#F1F5F9] transition-colors select-none group"
                >
                  <div className="flex items-center justify-between gap-1 min-w-0">
                    <span className="truncate" title="Job Title">Job Title</span>
                    {sortField === 'jobTitle' ? (
                      sortOrder === 'asc' ? <ArrowUp size={11} className="text-[#800020] flex-shrink-0" /> : <ArrowDown size={11} className="text-[#800020] flex-shrink-0" />
                    ) : (
                      <ArrowUpDown size={11} className="text-gray-400 opacity-40 group-hover:opacity-100 flex-shrink-0" />
                    )}
                  </div>
                </th>
                {activeCategories.map(cat => (
                  <th 
                    key={cat.id} 
                    colSpan={groupedLocations[cat.id].length * 2}
                    className="px-4 py-2 text-[10px] font-bold text-[#800020] uppercase tracking-widest text-center border-r border-[#E5E7EB]"
                  >
                    {cat.name}
                  </th>
                ))}
              </tr>
              {/* Level 2: Locations */}
              <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                {activeCategories.map(cat => (
                  groupedLocations[cat.id].map(loc => (
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
                  groupedLocations[cat.id].map(loc => (
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
                    No personnel records with passes found matching the selected filters.
                  </td>
                </tr>
              ) : (
                filteredEmployees.map(emp => (
                  <tr key={emp.id} className="hover:bg-[#F9FAFB] transition-colors group">
                    <td className="sticky left-0 z-20 bg-white group-hover:bg-[#F8FAFC] w-[100px] min-w-[100px] max-w-[100px] px-3 py-2.5 border-r border-[#E5E7EB]">
                      <span className="text-[10px] font-mono font-bold text-[#800020] truncate block" title={emp.employeeId || '—'}>{emp.employeeId || '—'}</span>
                    </td>
                    <td className="sticky left-[100px] z-20 bg-white group-hover:bg-[#F8FAFC] w-[320px] min-w-[320px] max-w-[320px] px-3 py-2.5 border-r border-[#E5E7EB]">
                      <p className="text-[10px] font-bold text-[#1A1A1A] leading-tight truncate" title={emp.name}>{emp.name}</p>
                    </td>
                    <td className="sticky left-[420px] z-20 bg-white group-hover:bg-[#F8FAFC] w-[140px] min-w-[140px] max-w-[140px] px-3 py-2.5 border-r border-[#E5E7EB] shadow-[3px_0_6px_-2px_rgba(0,0,0,0.08)]">
                      <span className="text-[10px] font-semibold text-[#4B5563] truncate block" title={emp.jobTitle || 'N/A'}>{emp.jobTitle || 'N/A'}</span>
                    </td>
                    {(() => {
                      const empPasses = passes.filter(p => isPassForEmployee(p, emp) && isPassInDateRange(p, startDateFilter, endDateFilter));
                      const validActivePasses = empPasses.filter(p => isPassValidAndActive(p));
                    
                    return activeCategories.map(cat => {
                      return groupedLocations[cat.id].map(loc => {
                        const activeLocPasses = validActivePasses.filter(p => p.locationId === loc.id);
                        
                        let relevantPasses: Pass[] = [];

                        if (activeLocPasses.length > 0) {
                          // Deduplicate: Keep only the latest pass per pass type / access code set
                          const map = new Map<string, Pass>();
                          const sortedByDate = [...activeLocPasses].sort((a, b) => 
                            new Date(a.updatedAt || a.createdAt || 0).getTime() - new Date(b.updatedAt || b.createdAt || 0).getTime()
                          );
                          
                          sortedByDate.forEach(pass => {
                            const key = pass.type === 'main' ? 'main' : `supp-${[...(pass.accessCodes || [])].sort().join(',')}`;
                            map.set(key, pass);
                          });

                          relevantPasses = Array.from(map.values());
                        } else if (filterStatus === 'expired' || filterStatus === 'all_records') {
                          const expiredLocPasses = empPasses.filter(p => 
                            p.locationId === loc.id && isPassExpired(p) && !isPassReplaced(p)
                          );
                          if (expiredLocPasses.length > 0) {
                            const latestExpired = [...expiredLocPasses].sort((a, b) => 
                              new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
                            )[0];
                            relevantPasses = [latestExpired];
                          }
                        }
                        
                        // Sort passes so 'main' comes first
                        const sortedPasses = [...relevantPasses].sort((a, b) => (a.type === 'main' ? -1 : 1));
                        const latestPass = sortedPasses[0];
 
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
                                          ? (isExpired ? "bg-gray-100 text-gray-500 border-gray-200 line-through opacity-70" : "bg-orange-500 text-white border-orange-600")
                                          : (isExpired ? "bg-gray-100 text-gray-400 border-gray-200 line-through opacity-70" : "bg-gray-200 text-gray-700 border-gray-300"),
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
              <p><span className="font-bold">Total Personnel:</span> {filteredEmployees.length}</p>
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
                  <th className="p-1.5 border-r border-gray-300 font-bold text-gray-700">E-Code</th>
                  <th className="p-1.5 border-r border-gray-300 font-bold text-gray-700">Name</th>
                  <th className="p-1.5 border-r border-gray-300 font-bold text-gray-700">Job Title</th>
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
                  <th className="p-1 border-r border-gray-300"></th>
                  <th className="p-1 border-r border-gray-300"></th>
                  <th className="p-1 border-r border-gray-300"></th>
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
                  <th className="p-1 border-r border-gray-300"></th>
                  <th className="p-1 border-r border-gray-300"></th>
                  <th className="p-1 border-r border-gray-300"></th>
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
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={100} className="p-8 text-center text-gray-500 font-semibold text-xs">
                      No personnel records with passes found matching the selected filters.
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map((emp, index) => {
                    const empPasses = passes.filter(p => isPassForEmployee(p, emp) && isPassInDateRange(p, startDateFilter, endDateFilter));
                    const validActivePasses = empPasses.filter(p => isPassValidAndActive(p));

                  return (
                    <tr key={emp.id} className="hover:bg-gray-50">
                      <td className="p-1.5 border-r border-gray-200 font-bold text-gray-500 text-center">{index + 1}</td>
                      <td className="p-1.5 border-r border-gray-200 font-mono font-bold text-[#800020]">{emp.employeeId || '—'}</td>
                      <td className="p-1.5 border-r border-gray-200 font-bold text-gray-900">{emp.name}</td>
                      <td className="p-1.5 border-r border-gray-200 text-gray-600">{emp.jobTitle || 'N/A'}</td>
                      {activeCategories.map(cat => 
                        groupedLocations[cat.id]?.map(loc => {
                          const activeLocPasses = validActivePasses.filter(p => p.locationId === loc.id);
                          
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
                          } else if (filterStatus === 'expired' || filterStatus === 'all_records') {
                            const expiredLocPasses = empPasses.filter(p => 
                              p.locationId === loc.id && isPassExpired(p) && !isPassReplaced(p)
                            );
                            if (expiredLocPasses.length > 0) {
                              const latestExpired = [...expiredLocPasses].sort((a, b) => 
                                new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
                              )[0];
                              relevantPasses = [latestExpired];
                            }
                          }

                          const sortedPasses = [...relevantPasses].sort((a, b) => (a.type === 'main' ? -1 : 1));
                          const latestPass = sortedPasses[0];

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
    </div>
  );
}
