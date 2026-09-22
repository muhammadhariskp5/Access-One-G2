import React, { useState, useMemo } from 'react';
import { FileText, Upload, CheckCircle2, AlertCircle, ChevronRight, ChevronLeft, Settings, Table, Edit3, Trash2, UserX } from 'lucide-react';
import * as XLSX from 'xlsx';
import { BulkImportReview } from '../common/BulkImportReview';
import { apiFetch, cn } from '../../lib/utils';
import { Division, Department, Employee, Project } from '../../types';

interface EmployeeImportFormProps {
  employees: Employee[];
  divisions: Division[];
  departments: Department[];
  projects: Project[];
  onSuccess: () => void;
  onClose: () => void;
}

type ImportStep = 'upload' | 'mapping' | 'defaults' | 'review' | 'results';

const SYSTEM_FIELDS = [
  { id: 'firstName', label: 'First Name', required: true },
  { id: 'lastName', label: 'Last Name', required: true },
  { id: 'employeeId', label: 'Employee Code', required: true },
  { id: 'qidVisaNumber', label: 'QID / Visa Number', required: true },
  { id: 'qidVisaExpiry', label: 'QID / Visa Expiry', required: false },
  { id: 'passportNumber', label: 'Passport Number', required: false },
  { id: 'passportExpiry', label: 'Passport Expiry', required: false },
  { id: 'visaExpiry', label: 'Visa Expiry', required: false },
  { id: 'jobTitle', label: 'Job Title', required: false },
  { id: 'division', label: 'Division', required: false },
  { id: 'department', label: 'Department', required: false },
  { id: 'project', label: 'Project', required: false },
  { id: 'mobileNumber', label: 'Mobile Number', required: false },
  { id: 'email', label: 'Email', required: false },
  { id: 'sponsorName', label: 'Sponsor Name', required: false },
  { id: 'safetyInductionDate', label: 'Safety Induction Date', required: false }
];

export function EmployeeImportForm({ employees, divisions, departments, projects, onSuccess, onClose }: EmployeeImportFormProps) {
  const [step, setStep] = useState<ImportStep>('upload');
  const [isImporting, setIsImporting] = useState(false);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawData, setRawData] = useState<any[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [defaults, setDefaults] = useState({
    division: '',
    department: '',
    project: '',
    employeeType: 'External',
    status: 'active'
  });
  const [processedData, setProcessedData] = useState<any[]>([]);
  const [importResults, setImportResults] = useState<any>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const buffer = evt.target?.result as ArrayBuffer;
        if (!buffer) return;
        const arrayData = new Uint8Array(buffer);
        const wb = XLSX.read(arrayData, { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);
        
        if (!data || data.length === 0) return;

        const headers = Object.keys(data[0] as object);
        setRawHeaders(headers);
        setRawData(data);

        // Auto-mapping
        const newMapping: Record<string, string> = {};
        SYSTEM_FIELDS.forEach(field => {
          const match = headers.find(h => 
            h.toLowerCase().replace(/\s/g, '') === field.label.toLowerCase().replace(/\s/g, '') ||
            h.toLowerCase().replace(/\s/g, '') === field.id.toLowerCase()
          );
          if (match) newMapping[field.id] = match;
        });
        setMapping(newMapping);
        setStep('mapping');
      } catch (err) {
        console.error("Error parsing uploaded Excel:", err);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const proceedToDefaults = () => {
    setStep('defaults');
  };

  const proceedToReview = () => {
    const processed = rawData.map((row, index) => {
      const item: any = { 
        id: `temp-${index}`,
        ...defaults 
      };
      SYSTEM_FIELDS.forEach(field => {
        const mappedHeader = mapping[field.id];
        if (mappedHeader) {
          item[field.id] = row[mappedHeader];
        }
      });
      item.name = `${item.firstName || ''} ${item.lastName || ''}`.trim();
      
      // Duplicate detection
      const isDuplicate = employees.some(emp => 
        (item.employeeId && emp.employeeId === item.employeeId) ||
        (item.qidVisaNumber && (emp.qidVisaNumber === item.qidVisaNumber || emp.qatarId === item.qidVisaNumber || emp.visaNumber === item.qidVisaNumber)) ||
        (item.qatarId && (emp.qidVisaNumber === item.qatarId || emp.qatarId === item.qatarId)) ||
        (item.visaNumber && (emp.qidVisaNumber === item.visaNumber || emp.visaNumber === item.visaNumber)) ||
        (item.passportNumber && emp.passportNumber === item.passportNumber)
      );
      item.isDuplicate = isDuplicate;
      item.skip = isDuplicate; // Default to skip duplicates

      return item;
    });
    setProcessedData(processed);
    setStep('review');
  };

  const handleUpdateRow = (id: string, field: string, value: string) => {
    setProcessedData(prev => prev.map(row => {
      if (row.id !== id) return row;
      
      const updated = { ...row, [field]: value };
      if (field === 'firstName' || field === 'lastName') {
        updated.name = `${updated.firstName || ''} ${updated.lastName || ''}`.trim();
      }
      
      // Re-check duplicate status after update
      const isDuplicate = employees.some(emp => 
        (updated.employeeId && emp.employeeId === updated.employeeId) ||
        (updated.qidVisaNumber && (emp.qidVisaNumber === updated.qidVisaNumber || emp.qatarId === updated.qidVisaNumber || emp.visaNumber === updated.qidVisaNumber)) ||
        (updated.qatarId && (emp.qidVisaNumber === updated.qatarId || emp.qatarId === updated.qatarId)) ||
        (updated.visaNumber && (emp.qidVisaNumber === updated.visaNumber || emp.visaNumber === updated.visaNumber)) ||
        (updated.passportNumber && emp.passportNumber === updated.passportNumber)
      );
      updated.isDuplicate = isDuplicate;
      
      return updated;
    }));
  };

  const toggleSkipRow = (id: string) => {
    setProcessedData(prev => prev.map(row => 
      row.id === id ? { ...row, skip: !row.skip } : row
    ));
  };

  const handleDeleteRow = (id: string) => {
    setProcessedData(prev => prev.filter(row => row.id !== id));
  };

  const applyImport = async () => {
    const toImport = processedData.filter(row => !row.skip);
    if (toImport.length === 0) return;
    
    setIsImporting(true);
    try {
      const res = await apiFetch('/api/employees/batch', {
        method: 'POST',
        body: JSON.stringify(toImport)
      });
      const data = await res.json();
      setImportResults(data);
      setStep('results');
      if (data.success && data.created > 0) {
        onSuccess();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsImporting(false);
    }
  };

  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    processedData.filter(row => !row.skip).forEach((row, index) => {
      const rowNum = index + 1;
      if (!row.firstName) errors.push(`Row ${rowNum}: Missing First Name`);
      if (!row.lastName) errors.push(`Row ${rowNum}: Missing Last Name`);
      if (!row.employeeId) errors.push(`Row ${rowNum}: Missing Employee Code`);
      if (!row.qidVisaNumber && !row.qatarId && !row.visaNumber) errors.push(`Row ${rowNum}: Missing QID / Visa Number`);
      if (row.isDuplicate) errors.push(`Row ${rowNum}: Duplicate record detected (Employee Code, QID, or Passport)`);
    });
    return errors;
  }, [processedData]);

  const duplicateCount = useMemo(() => {
    return processedData.filter(row => row.isDuplicate).length;
  }, [processedData]);

  return (
    <div className="space-y-6">
      {/* Step Indicator */}
      <div className="flex items-center justify-between px-4">
        {['Upload', 'Mapping', 'Defaults', 'Review'].map((s, i) => {
          const stepKey = s.toLowerCase() as ImportStep;
          const isActive = step === stepKey;
          const isPast = ['upload', 'mapping', 'defaults', 'review', 'results'].indexOf(step) > i;
          
          return (
            <React.Fragment key={s}>
              <div className="flex flex-col items-center gap-1">
                <div className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all",
                  isActive ? "bg-[#800020] text-white shadow-lg shadow-[#800020]/20" : 
                  isPast ? "bg-emerald-500 text-white" : "bg-[#F3F4F6] text-[#9CA3AF]"
                )}>
                  {isPast ? <CheckCircle2 size={12} /> : i + 1}
                </div>
                <span className={cn(
                  "text-[8px] font-bold uppercase tracking-widest",
                  isActive ? "text-[#1A1A1A]" : "text-[#9CA3AF]"
                )}>{s}</span>
              </div>
              {i < 3 && <div className={cn("flex-1 h-px mx-2", isPast ? "bg-emerald-500" : "bg-[#E5E7EB]")} />}
            </React.Fragment>
          );
        })}
      </div>

      {step === 'upload' && (
        <div className="p-12 border-2 border-dashed border-[#E5E7EB] rounded-3xl text-center space-y-4">
          <FileText size={32} className="text-[#9CA3AF] mx-auto" />
          <div>
            <p className="font-bold text-[#1A1A1A]">Upload Employee Excel File</p>
            <p className="text-[10px] text-[#6B7280] mt-1 uppercase tracking-widest">
              Required: First Name, Last Name, Emp Code, QID / Visa
            </p>
          </div>
          <input 
            type="file" 
            accept=".xlsx, .xls" 
            onChange={handleFileUpload} 
            className="hidden" 
            id="employee-excel-upload" 
          />
          <label 
            htmlFor="employee-excel-upload" 
            className="inline-block px-8 py-3 bg-[#1A1A1A] text-white rounded-xl font-bold cursor-pointer hover:bg-black transition-all text-[10px] uppercase tracking-widest"
          >
            Select File
          </label>
        </div>
      )}

      {step === 'mapping' && (
        <div className="space-y-4">
          <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 flex items-start gap-3">
            <Settings size={16} className="text-blue-600 mt-0.5" />
            <div>
              <p className="text-[11px] font-bold text-blue-900">Column Mapping</p>
              <p className="text-[9px] text-blue-700 mt-0.5">We've auto-mapped some columns. Please verify and map the remaining fields.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 max-h-[400px] overflow-y-auto p-1">
            {SYSTEM_FIELDS.map(field => (
              <div key={field.id} className="space-y-1.5">
                <label className="text-[9px] font-bold text-[#6B7280] uppercase tracking-wider flex items-center gap-1">
                  {field.label}
                  {field.required && <span className="text-rose-500">*</span>}
                </label>
                <select 
                  value={mapping[field.id] || ''}
                  onChange={(e) => setMapping(prev => ({ ...prev, [field.id]: e.target.value }))}
                  className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-xl text-[10px] font-bold outline-none focus:ring-1 focus:ring-[#800020]"
                >
                  <option value="">-- Select Column --</option>
                  {rawHeaders.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex gap-3 pt-4">
            <button 
              onClick={() => setStep('upload')}
              className="px-6 py-3 bg-[#F3F4F6] text-[#4B5563] rounded-xl font-bold text-[10px] uppercase tracking-widest flex items-center gap-2"
            >
              <ChevronLeft size={14} /> Back
            </button>
            <button 
              onClick={proceedToDefaults}
              className="flex-1 py-3 bg-[#1A1A1A] text-white rounded-xl font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-2"
            >
              Next: Set Defaults <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {step === 'defaults' && (
        <div className="space-y-6">
          <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 flex items-start gap-3">
            <CheckCircle2 size={16} className="text-emerald-600 mt-0.5" />
            <div>
              <p className="text-[11px] font-bold text-emerald-900">Batch Defaults</p>
              <p className="text-[9px] text-emerald-700 mt-0.5">Choose default values for all records in this batch.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[9px] font-bold text-[#6B7280] uppercase tracking-wider">Division</label>
              <select 
                value={defaults.division}
                onChange={(e) => setDefaults(prev => ({ ...prev, division: e.target.value }))}
                className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-xl text-[10px] font-bold outline-none focus:ring-1 focus:ring-[#800020]"
              >
                <option value="">Select Division</option>
                {divisions.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[9px] font-bold text-[#6B7280] uppercase tracking-wider">Department</label>
              <select 
                value={defaults.department}
                onChange={(e) => setDefaults(prev => ({ ...prev, department: e.target.value }))}
                className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-xl text-[10px] font-bold outline-none focus:ring-1 focus:ring-[#800020]"
              >
                <option value="">Select Department</option>
                {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[9px] font-bold text-[#6B7280] uppercase tracking-wider">Project</label>
              <select 
                value={defaults.project}
                onChange={(e) => setDefaults(prev => ({ ...prev, project: e.target.value }))}
                className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-xl text-[10px] font-bold outline-none focus:ring-1 focus:ring-[#800020]"
              >
                <option value="">Select Project</option>
                {projects.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[9px] font-bold text-[#6B7280] uppercase tracking-wider">Employee Type</label>
              <select 
                value={defaults.employeeType}
                onChange={(e) => setDefaults(prev => ({ ...prev, employeeType: e.target.value }))}
                className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-xl text-[10px] font-bold outline-none focus:ring-1 focus:ring-[#800020]"
              >
                <option value="Internal">Internal</option>
                <option value="External">External</option>
                <option value="External Sponsor">External Sponsor</option>
                <option value="Externally Working">Externally Working</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[9px] font-bold text-[#6B7280] uppercase tracking-wider">Status</label>
              <select 
                value={defaults.status}
                onChange={(e) => setDefaults(prev => ({ ...prev, status: e.target.value }))}
                className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-xl text-[10px] font-bold outline-none focus:ring-1 focus:ring-[#800020]"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button 
              onClick={() => setStep('mapping')}
              className="px-6 py-3 bg-[#F3F4F6] text-[#4B5563] rounded-xl font-bold text-[10px] uppercase tracking-widest flex items-center gap-2"
            >
              <ChevronLeft size={14} /> Back
            </button>
            <button 
              onClick={proceedToReview}
              className="flex-1 py-3 bg-[#1A1A1A] text-white rounded-xl font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-2"
            >
              Next: Review Data <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <BulkImportReview
          title="Review & Edit Personnel Data"
          description={`${processedData.length} records found. Please verify and edit before importing.`}
          data={processedData}
          columns={[
            { key: 'firstName', label: 'First Name', render: (row: any) => (
              <input 
                type="text" 
                value={row.firstName || ''} 
                onChange={(e) => handleUpdateRow(row.id, 'firstName', e.target.value)}
                className={cn(
                  "w-full bg-transparent text-[10px] font-medium outline-none border-b border-transparent focus:border-[#800020]",
                  !row.firstName && "bg-rose-50"
                )}
              />
            ) },
            { key: 'lastName', label: 'Last Name', render: (row: any) => (
              <input 
                type="text" 
                value={row.lastName || ''} 
                onChange={(e) => handleUpdateRow(row.id, 'lastName', e.target.value)}
                className={cn(
                  "w-full bg-transparent text-[10px] font-medium outline-none border-b border-transparent focus:border-[#800020]",
                  !row.lastName && "bg-rose-50"
                )}
              />
            ) },
            { key: 'employeeId', label: 'Emp Code', render: (row: any) => (
              <input 
                type="text" 
                value={row.employeeId || ''} 
                onChange={(e) => handleUpdateRow(row.id, 'employeeId', e.target.value)}
                className={cn(
                  "w-full bg-transparent text-[10px] font-medium outline-none border-b border-transparent focus:border-[#800020]",
                  !row.employeeId && "bg-rose-50",
                  row.isDuplicate && "text-amber-600"
                )}
              />
            ) },
            { key: 'qidVisaNumber', label: 'QID/Visa', render: (row: any) => (
              <input 
                type="text" 
                value={row.qidVisaNumber || row.qatarId || row.visaNumber || ''} 
                onChange={(e) => handleUpdateRow(row.id, 'qidVisaNumber', e.target.value)}
                className={cn(
                  "w-full bg-transparent text-[10px] font-medium outline-none border-b border-transparent focus:border-[#800020]",
                  (!row.qidVisaNumber && !row.qatarId && !row.visaNumber) && "bg-rose-50",
                  row.isDuplicate && "text-amber-600"
                )}
              />
            ) }
          ]}
          onApply={applyImport}
          onCancel={() => setStep('defaults')}
          onToggleSkip={(idx) => toggleSkipRow(processedData[idx].id)}
          onDeleteRow={(idx) => handleDeleteRow(processedData[idx].id)}
          isImporting={isImporting}
          applyLabel={`Import ${processedData.filter(r => !r.skip).length} Personnel`}
        />
      )}

      {step === 'results' && importResults && (
        <div className="space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 size={32} className="text-emerald-500" />
            </div>
            <h3 className="font-bold text-[#1A1A1A]">Import Completed</h3>
            <p className="text-xs text-[#6B7280]">Your batch import has been processed.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
              <p className="text-2xl font-bold text-emerald-700">{importResults.created}</p>
              <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Successfully Created</p>
            </div>
            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
              <p className="text-2xl font-bold text-amber-700">{importResults.skipped}</p>
              <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">Skipped (Duplicates)</p>
            </div>
          </div>

          {importResults.duplicates && importResults.duplicates.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-[#6B7280] uppercase tracking-widest">Skipped Records (Already Exist)</p>
              <div className="max-h-40 overflow-y-auto p-3 bg-amber-50 rounded-xl border border-amber-100 space-y-1">
                {importResults.duplicates.map((dup: string, i: number) => (
                  <p key={i} className="text-[9px] text-amber-700 flex items-center gap-2">
                    <AlertCircle size={10} />
                    {dup}
                  </p>
                ))}
              </div>
            </div>
          )}

          <button 
            onClick={onClose}
            className="w-full py-3 bg-[#1A1A1A] text-white rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-black transition-all"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
