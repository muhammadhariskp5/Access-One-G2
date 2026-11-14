import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Filter, User, Mail, Phone, MapPin, Briefcase, ChevronRight, MoreVertical, Trash2, Edit2, FileText, ExternalLink, Upload, Loader2, ArrowUpDown, ArrowUp, ArrowDown, Copy, Printer, Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { ListedEmployee, useEmployeeList } from '../hooks/useEmployeeList';
import { Employee, UserProfile, Division, Department, Project, Pass, PassApplication } from '../types';
import { apiFetch, cn, formatDate } from '../lib/utils';
import { Modal } from '../components/common/Modal';
import { EmployeeForm } from '../components/employees/EmployeeForm';
import { EmployeeImportForm } from '../components/employees/EmployeeImportForm';
import { PrintExportModal } from '../components/common/PrintExportModal';

interface EmployeesProps {
  divisions: Division[];
  departments: Department[];
  projects: Project[];
  currentUser: UserProfile | null;
  onSuccess: () => void;
  globalSearch: string;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export function Employees({ 
  divisions,
  departments,
  projects,
  currentUser, 
  onSuccess, 
  globalSearch,
  showToast,
  showConfirm
}: EmployeesProps) {
  const navigate = useNavigate();
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterDivision, setFilterDivision] = useState<string>('all');
  const [filterDepartment, setFilterDepartment] = useState<string>('all');
  const [filterProject, setFilterProject] = useState<string>('all');
  const [filterDuplicatesOnly, setFilterDuplicatesOnly] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(['code', 'name', 'jobTitle', 'type', 'status', 'division', 'qidNumber', 'qidExpiry', 'passportNumber', 'passportExpiry', 'induction']);
  const [sortField, setSortField] = useState<string>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Search, filters, duplicate detection, sorting and paging run in the database; the page
  // only holds the rows loaded so far and fetches the next page as you scroll.
  const {
    items: visibleEmployees,
    total: totalMatching,
    duplicateCount,
    loading: listLoading,
    loadingMore: isScrolling,
    hasMore,
    loadMore,
    reload: reloadList,
    fetchAll: fetchAllMatching
  } = useEmployeeList({
    q: globalSearch,
    type: filterType,
    status: filterStatus,
    division: filterDivision,
    department: filterDepartment,
    project: filterProject,
    duplicates: filterDuplicatesOnly,
    sort: sortField,
    order: sortOrder
  });

  const observerTarget = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) loadMore();
      },
      { threshold: 0, rootMargin: '400px' }
    );
    if (observerTarget.current) observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  // Selections only apply to what's on screen; clear them when the result set changes.
  useEffect(() => {
    setSelectedIds([]);
  }, [globalSearch, filterType, filterStatus, filterDivision, filterDepartment, filterProject, filterDuplicatesOnly]);

  const refreshAfterChange = () => {
    reloadList();
    onSuccess();
  };

  // Export and print use every matching row, fetched when needed (not kept in memory).
  const [printRows, setPrintRows] = useState<ListedEmployee[]>([]);
  const openPrint = async () => {
    try {
      setPrintRows(await fetchAllMatching());
      setIsPrintModalOpen(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to load personnel for printing', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    const emp = visibleEmployees.find(e => e.id === id);
    const empName = emp?.name || 'this employee';
    // Open passes / applications, counted by the server
    let usage = { activePasses: 0, activeApplications: 0 };
    try {
      const res = await apiFetch(`/api/employees/${encodeURIComponent(id)}/usage`);
      if (res.ok) usage = await res.json();
    } catch { /* the confirmation still shows */ }

    let warningMsg = `Are you sure you want to delete ${empName}? This action cannot be undone.`;
    if (usage.activePasses > 0 || usage.activeApplications > 0) {
      warningMsg += ` Note: This employee currently has ${usage.activePasses} active pass(es) and ${usage.activeApplications} active application(s). Deleting will automatically cancel and archive these passes.`;
    }

    showConfirm(
      "Delete Employee",
      warningMsg,
      async () => {
        try {
          const res = await apiFetch(`/api/employees/${id}`, { method: 'DELETE' });
          if (res.ok) {
            showToast("Employee deleted and associated passes cancelled successfully");
            refreshAfterChange();
          }
        } catch (err: any) {
          showToast(err.message, 'error');
        }
      }
    );
  };

  const handleBulkStatus = (status: 'active' | 'inactive') => {
    if (selectedIds.length === 0) return;
    showConfirm(
      `Update ${selectedIds.length} Personnel`,
      `Are you sure you want to set ${selectedIds.length} personnel to ${status}?`,
      async () => {
        try {
          const res = await apiFetch('/api/employees/bulk-status', {
            method: 'PATCH',
            body: JSON.stringify({ ids: selectedIds, status })
          });
          if (res.ok) {
            showToast(`Updated ${selectedIds.length} personnel successfully`);
            setSelectedIds([]);
            refreshAfterChange();
          }
        } catch (err: any) {
          showToast(err.message, 'error');
        }
      }
    );
  };

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    showConfirm(
      "Bulk Delete Personnel",
      `Are you sure you want to delete ${selectedIds.length} personnel? This action cannot be undone.`,
      async () => {
        try {
          const res = await apiFetch('/api/employees/bulk-delete', {
            method: 'DELETE',
            body: JSON.stringify({ ids: selectedIds })
          });
          if (res.ok) {
            showToast(`Deleted ${selectedIds.length} personnel successfully`);
            setSelectedIds([]);
            refreshAfterChange();
          }
        } catch (err: any) {
          showToast(err.message, 'error');
        }
      }
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === visibleEmployees.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(visibleEmployees.map(e => e.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleColumn = (col: string) => {
    setVisibleColumns(prev => 
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    );
  };

  const clearFilters = () => {
    setFilterType('all');
    setFilterStatus('all');
    setFilterDivision('all');
    setFilterDepartment('all');
    setFilterProject('all');
    setFilterDuplicatesOnly(false);
  };

  const handleExportExcel = async () => {
    let filteredEmployees: ListedEmployee[];
    try {
      filteredEmployees = await fetchAllMatching();
    } catch (err: any) {
      showToast(err.message || 'Failed to load personnel for export', 'error');
      return;
    }
    const workbook = XLSX.utils.book_new();

    const headers = [
      "S/N",
      "Personnel Code",
      "Full Name",
      "Employee Type",
      "Division",
      "Department",
      "Project",
      "Job Title",
      "QID / Visa No",
      "QID / Visa Expiry",
      "Passport No",
      "Passport Expiry",
      "Status"
    ];

    const rows = filteredEmployees.map((emp, index) => [
      (index + 1).toString(),
      emp.employeeId || 'N/A',
      emp.name || '',
      emp.employeeType || (emp as any).type || 'Internal',
      emp.division || emp.department || 'N/A',
      emp.department || 'N/A',
      emp.project || 'N/A',
      emp.jobTitle || 'N/A',
      emp.qatarId || emp.visaNumber || emp.qidVisaNumber || 'N/A',
      formatDate(emp.qidVisaExpiry || emp.visaExpiry),
      emp.passportNumber || 'N/A',
      formatDate(emp.passportExpiry),
      emp.status || 'active'
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet([
      ["PERSONNEL DIRECTORY REPORT"],
      [`Exported: ${new Date().toLocaleDateString()} | Total: ${filteredEmployees.length} Records`],
      [],
      headers,
      ...rows
    ]);

    worksheet['!cols'] = [
      { wch: 6 },
      { wch: 14 },
      { wch: 28 },
      { wch: 14 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 18 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 12 }
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, "Personnel Directory");
    XLSX.writeFile(workbook, `Personnel_Directory_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-4 flex-1 flex flex-col w-full min-h-[calc(100vh-96px)]">
      <div className="flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-[#800020]"></div>
            <p className="text-[10px] font-bold text-[#6B7280] uppercase tracking-widest">Personnel Directory</p>
            <span className="px-2 py-0.5 bg-[#F3F4F6] text-[#6B7280] rounded-full text-[9px] font-bold">
              {totalMatching} Total
            </span>
            {selectedIds.length > 0 && (
              <span className="px-2 py-0.5 bg-[#800020] text-white rounded-full text-[9px] font-bold">
                {selectedIds.length} Selected
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-1.5">
            <button 
              onClick={handleExportExcel}
              className="px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 hover:bg-emerald-100 rounded-lg font-bold text-[9px] uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="Export current personnel view to Excel spreadsheet (.xlsx)"
            >
              <Download size={12} />
              <span>Export Excel</span>
            </button>

            <button 
              onClick={openPrint}
              className="px-2.5 py-1.5 bg-white border border-[#E5E7EB] text-[#800020] hover:bg-rose-50 hover:border-rose-200 rounded-lg font-bold text-[9px] uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="Print or Export current personnel view to PDF with styling & colors"
            >
              <Printer size={12} />
              <span>Print / Export PDF</span>
            </button>

            {currentUser?.role !== 'viewer' && (
              <>
                <button 
                  onClick={() => setIsImportModalOpen(true)}
                  className="px-3 py-1.5 bg-[#F3F4F6] text-[#4B5563] rounded-lg font-bold text-[9px] hover:bg-[#E5E7EB] transition-all flex items-center gap-1.5 shadow-xs"
                >
                  <Upload size={12} />
                  Batch Import
                </button>
                
                <button 
                  onClick={() => setIsNewModalOpen(true)}
                  className="px-3 py-1.5 bg-[#1A1A1A] text-white rounded-lg font-bold text-[9px] hover:bg-black transition-all flex items-center gap-1.5 shadow-xs"
                >
                  <Plus size={12} />
                  Add Personnel
                </button>
              </>
            )}
          </div>
        </div>

        {/* Filters & Bulk Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white rounded-2xl border border-[#E5E7EB] shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
              <Filter size={12} className="text-[#9CA3AF]" />
              <select 
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="bg-transparent text-[10px] font-bold outline-none"
              >
                <option value="all">All Types</option>
                <option value="Internal">Internal</option>
                <option value="External">External</option>
                <option value="External Sponsor">External Sponsor</option>
                <option value="Externally Working">Externally Working</option>
              </select>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
              <select 
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-transparent text-[10px] font-bold outline-none"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
              <select 
                value={filterDivision}
                onChange={(e) => setFilterDivision(e.target.value)}
                className="bg-transparent text-[10px] font-bold outline-none max-w-[120px]"
              >
                <option value="all">Division</option>
                {divisions.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
              <select 
                value={filterDepartment}
                onChange={(e) => setFilterDepartment(e.target.value)}
                className="bg-transparent text-[10px] font-bold outline-none max-w-[120px]"
              >
                <option value="all">Department</option>
                {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
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
                <option value="name_asc">Sort: Name (A-Z)</option>
                <option value="name_desc">Sort: Name (Z-A)</option>
                <option value="code_asc">Sort: Code (A-Z)</option>
                <option value="code_desc">Sort: Code (Z-A)</option>
                <option value="status_asc">Sort: Status (Asc)</option>
                <option value="status_desc">Sort: Status (Desc)</option>
                <option value="type_asc">Sort: Type (A-Z)</option>
                <option value="division_asc">Sort: Division (A-Z)</option>
                <option value="department_asc">Sort: Department (A-Z)</option>
                <option value="expiry_asc">Sort: Expiry (Soonest First)</option>
              </select>
            </div>

            <button 
              onClick={() => setFilterDuplicatesOnly(prev => !prev)}
              className={cn(
                "px-3 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-1.5 transition-all cursor-pointer",
                filterDuplicatesOnly 
                  ? "bg-rose-600 text-white shadow-sm ring-2 ring-rose-200" 
                  : "bg-[#F9FAFB] border border-[#E5E7EB] text-[#4B5563] hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200"
              )}
              title="Filter personnel with duplicate names, employee codes, QIDs, or passport numbers"
            >
              <Copy size={12} />
              <span>Find Duplicates</span>
              {duplicateCount > 0 && (
                <span className={cn(
                  "px-1.5 py-0.2 rounded-full text-[9px] font-extrabold",
                  filterDuplicatesOnly ? "bg-white text-rose-700" : "bg-rose-100 text-rose-800"
                )}>
                  {duplicateCount}
                </span>
              )}
            </button>

            <button 
              onClick={clearFilters}
              className="px-3 py-1.5 text-[10px] font-bold text-[#6B7280] hover:text-[#800020] transition-colors"
            >
              Clear
            </button>

            <div className="relative group">
              <button className="px-3 py-1.5 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB] text-[10px] font-bold flex items-center gap-2">
                Columns
                <ChevronRight size={12} className="rotate-90" />
              </button>
              <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-[#E5E7EB] rounded-xl shadow-xl z-50 hidden group-hover:block p-2">
                {[
                  { id: 'code', label: 'Emp Code' },
                  { id: 'name', label: 'Emp Name' },
                  { id: 'jobTitle', label: 'Job Title' },
                  { id: 'type', label: 'Employee Type' },
                  { id: 'status', label: 'Status' },
                  { id: 'division', label: 'Division' },
                  { id: 'qidNumber', label: 'QID / Visa Number' },
                  { id: 'qidExpiry', label: 'QID / Visa Expiry' },
                  { id: 'passportNumber', label: 'Passport Number' },
                  { id: 'passportExpiry', label: 'Passport Expiry' },
                  { id: 'induction', label: 'Safety Induction' },
                  { id: 'department', label: 'Department' },
                  { id: 'contact', label: 'Contact' }
                ].map(col => (
                  <label key={col.id} className="flex items-center gap-2 p-2 hover:bg-[#F9FAFB] rounded-lg cursor-pointer text-[10px] font-bold">
                    <input 
                      type="checkbox" 
                      checked={visibleColumns.includes(col.id)} 
                      onChange={() => toggleColumn(col.id)}
                      className="rounded border-[#E5E7EB] text-[#800020] focus:ring-[#800020]"
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {selectedIds.length > 0 && currentUser?.role !== 'viewer' && (
            <div className="flex items-center gap-2 pl-3 border-l border-[#E5E7EB]">
              <button 
                onClick={() => handleBulkStatus('active')}
                className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-xl font-bold text-[9px] uppercase hover:bg-emerald-100 transition-all"
              >
                Set Active
              </button>
              <button 
                onClick={() => handleBulkStatus('inactive')}
                className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-xl font-bold text-[9px] uppercase hover:bg-amber-100 transition-all"
              >
                Set Inactive
              </button>
              <button 
                onClick={handleBulkDelete}
                className="px-3 py-1.5 bg-rose-50 text-rose-700 rounded-xl font-bold text-[9px] uppercase hover:bg-rose-100 transition-all"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden shadow-sm flex-1 flex flex-col min-h-[calc(100vh-220px)]">
        <div className="overflow-x-auto overflow-y-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                <th className="px-4 py-3 w-10">
                  <input 
                    type="checkbox" 
                    checked={selectedIds.length === visibleEmployees.length && visibleEmployees.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-[#E5E7EB] text-[#800020] focus:ring-[#800020]"
                  />
                </th>
                {visibleColumns.includes('code') && (
                  <th 
                    onClick={() => handleSort('code')}
                    className="px-4 py-3 min-w-[120px] text-[10px] font-bold text-[#1A1A1A] uppercase tracking-wider cursor-pointer select-none hover:bg-[#F3F4F6] transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Emp Code</span>
                      {sortField === 'code' ? (
                        sortOrder === 'asc' ? <ArrowUp size={12} className="text-[#800020]" /> : <ArrowDown size={12} className="text-[#800020]" />
                      ) : (
                        <ArrowUpDown size={12} className="text-gray-400 opacity-40 hover:opacity-100" />
                      )}
                    </div>
                  </th>
                )}
                {visibleColumns.includes('name') && (
                  <th 
                    onClick={() => handleSort('name')}
                    className="px-4 py-3 min-w-[180px] text-[10px] font-bold text-[#1A1A1A] uppercase tracking-wider cursor-pointer select-none hover:bg-[#F3F4F6] transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Emp Name</span>
                      {sortField === 'name' ? (
                        sortOrder === 'asc' ? <ArrowUp size={12} className="text-[#800020]" /> : <ArrowDown size={12} className="text-[#800020]" />
                      ) : (
                        <ArrowUpDown size={12} className="text-gray-400 opacity-40 hover:opacity-100" />
                      )}
                    </div>
                  </th>
                )}
                {visibleColumns.includes('jobTitle') && (
                  <th 
                    onClick={() => handleSort('jobTitle')}
                    className="px-4 py-3 min-w-[140px] text-[10px] font-bold text-[#1A1A1A] uppercase tracking-wider cursor-pointer select-none hover:bg-[#F3F4F6] transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Job Title</span>
                      {sortField === 'jobTitle' ? (
                        sortOrder === 'asc' ? <ArrowUp size={12} className="text-[#800020]" /> : <ArrowDown size={12} className="text-[#800020]" />
                      ) : (
                        <ArrowUpDown size={12} className="text-gray-400 opacity-40 hover:opacity-100" />
                      )}
                    </div>
                  </th>
                )}
                {visibleColumns.includes('type') && (
                  <th 
                    onClick={() => handleSort('type')}
                    className="px-4 py-3 min-w-[120px] text-[10px] font-bold text-[#1A1A1A] uppercase tracking-wider cursor-pointer select-none hover:bg-[#F3F4F6] transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Type</span>
                      {sortField === 'type' ? (
                        sortOrder === 'asc' ? <ArrowUp size={12} className="text-[#800020]" /> : <ArrowDown size={12} className="text-[#800020]" />
                      ) : (
                        <ArrowUpDown size={12} className="text-gray-400 opacity-40 hover:opacity-100" />
                      )}
                    </div>
                  </th>
                )}
                {visibleColumns.includes('status') && (
                  <th 
                    onClick={() => handleSort('status')}
                    className="px-4 py-3 min-w-[100px] text-[10px] font-bold text-[#1A1A1A] uppercase tracking-wider cursor-pointer select-none hover:bg-[#F3F4F6] transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Status</span>
                      {sortField === 'status' ? (
                        sortOrder === 'asc' ? <ArrowUp size={12} className="text-[#800020]" /> : <ArrowDown size={12} className="text-[#800020]" />
                      ) : (
                        <ArrowUpDown size={12} className="text-gray-400 opacity-40 hover:opacity-100" />
                      )}
                    </div>
                  </th>
                )}
                {visibleColumns.includes('division') && (
                  <th 
                    onClick={() => handleSort('division')}
                    className="px-4 py-3 min-w-[120px] text-[10px] font-bold text-[#1A1A1A] uppercase tracking-wider cursor-pointer select-none hover:bg-[#F3F4F6] transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Division</span>
                      {sortField === 'division' ? (
                        sortOrder === 'asc' ? <ArrowUp size={12} className="text-[#800020]" /> : <ArrowDown size={12} className="text-[#800020]" />
                      ) : (
                        <ArrowUpDown size={12} className="text-gray-400 opacity-40 hover:opacity-100" />
                      )}
                    </div>
                  </th>
                )}
                {visibleColumns.includes('qidNumber') && (
                  <th 
                    onClick={() => handleSort('qidNumber')}
                    className="px-4 py-3 min-w-[130px] text-[10px] font-bold text-[#1A1A1A] uppercase tracking-wider cursor-pointer select-none hover:bg-[#F3F4F6] transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>QID / Visa No.</span>
                      {sortField === 'qidNumber' ? (
                        sortOrder === 'asc' ? <ArrowUp size={12} className="text-[#800020]" /> : <ArrowDown size={12} className="text-[#800020]" />
                      ) : (
                        <ArrowUpDown size={12} className="text-gray-400 opacity-40 hover:opacity-100" />
                      )}
                    </div>
                  </th>
                )}
                {(visibleColumns.includes('qidExpiry') || visibleColumns.includes('expiry')) && (
                  <th 
                    onClick={() => handleSort('qidExpiry')}
                    className="px-4 py-3 min-w-[130px] text-[10px] font-bold text-[#1A1A1A] uppercase tracking-wider cursor-pointer select-none hover:bg-[#F3F4F6] transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>QID / Visa Expiry</span>
                      {sortField === 'qidExpiry' || sortField === 'expiry' ? (
                        sortOrder === 'asc' ? <ArrowUp size={12} className="text-[#800020]" /> : <ArrowDown size={12} className="text-[#800020]" />
                      ) : (
                        <ArrowUpDown size={12} className="text-gray-400 opacity-40 hover:opacity-100" />
                      )}
                    </div>
                  </th>
                )}
                {visibleColumns.includes('passportNumber') && (
                  <th 
                    onClick={() => handleSort('passportNumber')}
                    className="px-4 py-3 min-w-[130px] text-[10px] font-bold text-[#1A1A1A] uppercase tracking-wider cursor-pointer select-none hover:bg-[#F3F4F6] transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Passport No.</span>
                      {sortField === 'passportNumber' ? (
                        sortOrder === 'asc' ? <ArrowUp size={12} className="text-[#800020]" /> : <ArrowDown size={12} className="text-[#800020]" />
                      ) : (
                        <ArrowUpDown size={12} className="text-gray-400 opacity-40 hover:opacity-100" />
                      )}
                    </div>
                  </th>
                )}
                {(visibleColumns.includes('passportExpiry') || visibleColumns.includes('passport')) && (
                  <th 
                    onClick={() => handleSort('passportExpiry')}
                    className="px-4 py-3 min-w-[130px] text-[10px] font-bold text-[#1A1A1A] uppercase tracking-wider cursor-pointer select-none hover:bg-[#F3F4F6] transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Passport Expiry</span>
                      {sortField === 'passportExpiry' || sortField === 'passport' ? (
                        sortOrder === 'asc' ? <ArrowUp size={12} className="text-[#800020]" /> : <ArrowDown size={12} className="text-[#800020]" />
                      ) : (
                        <ArrowUpDown size={12} className="text-gray-400 opacity-40 hover:opacity-100" />
                      )}
                    </div>
                  </th>
                )}
                {visibleColumns.includes('induction') && (
                  <th 
                    onClick={() => handleSort('induction')}
                    className="px-4 py-3 min-w-[140px] text-[10px] font-bold text-[#1A1A1A] uppercase tracking-wider cursor-pointer select-none hover:bg-[#F3F4F6] transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Safety Induction</span>
                      {sortField === 'induction' ? (
                        sortOrder === 'asc' ? <ArrowUp size={12} className="text-[#800020]" /> : <ArrowDown size={12} className="text-[#800020]" />
                      ) : (
                        <ArrowUpDown size={12} className="text-gray-400 opacity-40 hover:opacity-100" />
                      )}
                    </div>
                  </th>
                )}
                {visibleColumns.includes('department') && (
                  <th 
                    onClick={() => handleSort('department')}
                    className="px-4 py-3 min-w-[140px] text-[10px] font-bold text-[#1A1A1A] uppercase tracking-wider cursor-pointer select-none hover:bg-[#F3F4F6] transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Department</span>
                      {sortField === 'department' ? (
                        sortOrder === 'asc' ? <ArrowUp size={12} className="text-[#800020]" /> : <ArrowDown size={12} className="text-[#800020]" />
                      ) : (
                        <ArrowUpDown size={12} className="text-gray-400 opacity-40 hover:opacity-100" />
                      )}
                    </div>
                  </th>
                )}
                {visibleColumns.includes('contact') && (
                  <th className="px-4 py-3 text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Contact</th>
                )}
                <th className="px-4 py-3 text-[10px] font-bold text-[#6B7280] uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F4F6]">
              <AnimatePresence mode="popLayout">
                {visibleEmployees.map((emp) => (
                  <motion.tr
                    key={emp.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className={cn(
                      "hover:bg-[#F9FAFB] transition-colors group",
                      selectedIds.includes(emp.id) && "bg-[#800020]/5"
                    )}
                  >
                    <td className="px-4 py-3">
                      <input 
                        type="checkbox" 
                        checked={selectedIds.includes(emp.id)}
                        onChange={() => toggleSelect(emp.id)}
                        className="rounded border-[#E5E7EB] text-[#800020] focus:ring-[#800020]"
                      />
                    </td>
                    {visibleColumns.includes('code') && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#1A1A1A]">
                          <FileText size={12} className="text-[#9CA3AF]" />
                          {emp.employeeId}
                        </div>
                      </td>
                    )}
                    {visibleColumns.includes('name') && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-[#F3F4F6] flex items-center justify-center text-[#800020] font-bold text-xs shrink-0">
                            {emp.name.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-bold text-[#1A1A1A] truncate">{emp.name}</p>
                              {emp.duplicateReasons && (
                                <span 
                                  className="px-1.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded text-[8px] font-extrabold uppercase shrink-0" 
                                  title={emp.duplicateReasons.join(', ')}
                                >
                                  {emp.duplicateReasons[0]}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                    )}
                    {visibleColumns.includes('jobTitle') && (
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold text-[#4B5563] bg-[#F3F4F6] px-2 py-0.5 rounded uppercase">
                          {emp.jobTitle || 'N/A'}
                        </span>
                      </td>
                    )}
                    {visibleColumns.includes('type') && (
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold text-[#4B5563] bg-[#F3F4F6] px-2 py-0.5 rounded-lg uppercase">
                          {emp.employeeType}
                        </span>
                      </td>
                    )}
                    {visibleColumns.includes('status') && (
                      <td className="px-4 py-3">
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider",
                          emp.status === 'active' ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
                        )}>
                          {emp.status}
                        </span>
                      </td>
                    )}
                    {visibleColumns.includes('division') && (
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold text-[#4B5563] uppercase">{emp.division || '-'}</span>
                      </td>
                    )}
                    {visibleColumns.includes('qidNumber') && (
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold text-[#1A1A1A] font-mono">
                          {emp.qidVisaNumber || emp.qatarId || emp.visaNumber || '-'}
                        </span>
                      </td>
                    )}
                    {(visibleColumns.includes('qidExpiry') || visibleColumns.includes('expiry')) && (
                      <td className="px-4 py-3">
                        <span className="text-[10px] text-[#6B7280] font-bold uppercase">
                          {formatDate(emp.qidVisaExpiry || emp.visaExpiry)}
                        </span>
                      </td>
                    )}
                    {visibleColumns.includes('passportNumber') && (
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold text-[#1A1A1A] font-mono">
                          {emp.passportNumber || '-'}
                        </span>
                      </td>
                    )}
                    {(visibleColumns.includes('passportExpiry') || visibleColumns.includes('passport')) && (
                      <td className="px-4 py-3">
                        <span className="text-[10px] text-[#6B7280] font-bold uppercase">
                          {formatDate(emp.passportExpiry)}
                        </span>
                      </td>
                    )}
                    {visibleColumns.includes('induction') && (
                      <td className="px-4 py-3">
                        <div className="text-[10px] font-bold text-[#1A1A1A]">
                          {formatDate(emp.safetyInductionDate)}
                        </div>
                      </td>
                    )}
                    {visibleColumns.includes('department') && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#4B5563]">
                          <Briefcase size={12} className="text-[#9CA3AF]" />
                          {emp.department}
                        </div>
                      </td>
                    )}
                    {visibleColumns.includes('contact') && (
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          {emp.email && (
                            <div className="flex items-center gap-1.5 text-[10px] text-[#4B5563]">
                              <Mail size={12} className="text-[#9CA3AF]" />
                              {emp.email}
                            </div>
                          )}
                          {emp.mobileNumber && (
                            <div className="flex items-center gap-1.5 text-[10px] text-[#4B5563]">
                              <Phone size={12} className="text-[#9CA3AF]" />
                              {emp.mobileNumber}
                            </div>
                          )}
                        </div>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button 
                          onClick={() => navigate(`/employees/${emp.id}`)}
                          className="p-1.5 text-[#6B7280] hover:text-[#800020] hover:bg-[#F3F4F6] rounded-lg transition-all"
                          title="View Details"
                        >
                          <ExternalLink size={14} />
                        </button>
                        {currentUser?.role !== 'viewer' && (
                          <button 
                            onClick={() => setEditingEmployee(emp)}
                            className="p-1.5 text-[#6B7280] hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                            title="Edit"
                          >
                            <Edit2 size={14} />
                          </button>
                        )}
                        {currentUser?.role === 'admin' && (
                          <button 
                            onClick={() => handleDelete(emp.id)}
                            className="p-1.5 text-[#6B7280] hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
        
        {/* Infinite Scroll Trigger */}
        <div ref={observerTarget} className="h-10 flex items-center justify-center">
          {isScrolling && (
            <div className="flex items-center gap-2 text-[#6B7280] text-[10px] font-bold">
              <Loader2 size={14} className="animate-spin" />
              Loading more personnel...
            </div>
          )}
        </div>
      </div>

      {!listLoading && totalMatching === 0 && (
        <div className="p-20 text-center bg-white rounded-3xl border border-dashed border-[#E5E7EB]">
          <div className="w-16 h-16 bg-[#F9FAFB] rounded-full flex items-center justify-center mx-auto mb-4">
            <User size={32} className="text-[#9CA3AF] opacity-20" />
          </div>
          <h3 className="font-bold text-[#1A1A1A]">No personnel found</h3>
          <p className="text-xs text-[#6B7280] mt-1">Try adjusting your search or filters to find what you're looking for.</p>
        </div>
      )}

      <Modal 
        isOpen={isImportModalOpen} 
        onClose={() => setIsImportModalOpen(false)} 
        title="Batch Import Personnel"
      >
        <EmployeeImportForm 
          divisions={divisions}
          departments={departments}
          projects={projects}
          onClose={() => setIsImportModalOpen(false)}
          onSuccess={onSuccess}
        />
      </Modal>

      <Modal 
        isOpen={isNewModalOpen} 
        onClose={() => setIsNewModalOpen(false)} 
        title="Add New Personnel"
      >
        <EmployeeForm 
          divisions={divisions}
          departments={departments}
          projects={projects}
          onClose={() => setIsNewModalOpen(false)}
          onSuccess={onSuccess}
        />
      </Modal>

      <Modal 
        isOpen={!!editingEmployee} 
        onClose={() => setEditingEmployee(null)} 
        title="Edit Personnel"
      >
        {editingEmployee && (
          <EmployeeForm 
            employee={editingEmployee}
              divisions={divisions}
            departments={departments}
            projects={projects}
            onClose={() => setEditingEmployee(null)}
            onSuccess={onSuccess}
          />
        )}
      </Modal>

      {/* Page Specific Print & PDF Export Modal */}
      <PrintExportModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        title="Print Personnel Directory / Export PDF"
        documentTitle={`Personnel Directory - ${printRows.length} Records`}
      >
        <div className="space-y-4">
          <div className="flex justify-between items-center border-b border-[#E5E7EB] pb-3">
            <div>
              <h2 className="text-base font-black text-[#800020] uppercase tracking-tight">Personnel Directory Report</h2>
              <p className="text-[10px] text-[#6B7280] font-bold">Showing {printRows.length} filtered personnel records</p>
            </div>
            <div className="text-right">
              <span className="px-2.5 py-1 bg-rose-50 text-[#800020] rounded-lg text-[9px] font-extrabold uppercase border border-rose-200">
                Official Document
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#800020] text-white text-[9px] uppercase tracking-wider font-extrabold">
                  <th className="p-2 text-center rounded-tl-lg w-8 border-r border-rose-900/40">S/N</th>
                  <th className="p-2">Code</th>
                  <th className="p-2">Full Name</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">Division</th>
                  <th className="p-2">QID / Visa No.</th>
                  <th className="p-2">QID / Visa Exp</th>
                  <th className="p-2">Passport No.</th>
                  <th className="p-2">Passport Exp</th>
                  <th className="p-2 rounded-tr-lg">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {printRows.slice(0, 100).map((emp, idx) => (
                  <tr key={emp.id} className={cn("text-[9px]", idx % 2 === 0 ? "bg-white" : "bg-[#F9FAFB]")}>
                    <td className="p-2 text-center font-bold text-gray-500 border-r border-gray-200">{idx + 1}</td>
                    <td className="p-2 font-bold text-[#800020]">{emp.employeeId || 'N/A'}</td>
                    <td className="p-2 font-bold text-[#1A1A1A]">{emp.name}</td>
                    <td className="p-2 font-semibold text-[#4B5563]">{emp.employeeType || emp.type || 'Internal'}</td>
                    <td className="p-2 text-[#6B7280]">{emp.division || emp.department || 'N/A'}</td>
                    <td className="p-2 text-[#1A1A1A] font-mono">{emp.qatarId || emp.visaNumber || emp.qidVisaNumber || 'N/A'}</td>
                    <td className="p-2 text-[#6B7280] font-bold">{formatDate(emp.qidVisaExpiry || emp.visaExpiry)}</td>
                    <td className="p-2 text-[#1A1A1A] font-mono">{emp.passportNumber || 'N/A'}</td>
                    <td className="p-2 text-[#6B7280] font-bold">{formatDate(emp.passportExpiry)}</td>
                    <td className="p-2">
                      <span className={cn(
                        "px-2 py-0.5 rounded-full text-[8px] font-extrabold uppercase",
                        emp.status === 'active' ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-700"
                      )}>
                        {emp.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {printRows.length > 100 && (
              <p className="text-[10px] font-bold text-[#9CA3AF] text-center mt-3 uppercase tracking-wider">
                Showing first 100 of {printRows.length} personnel records
              </p>
            )}
          </div>
        </div>
      </PrintExportModal>
    </div>
  );
}
