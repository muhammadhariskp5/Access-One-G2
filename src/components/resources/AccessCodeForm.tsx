import React, { useState } from 'react';
import { AccessCode, Location, Category } from '../../types';
import { apiFetch } from '../../lib/utils';
import { FileText, Upload, AlertCircle, Table } from 'lucide-react';
import { BulkImportReview } from '../common/BulkImportReview';

interface AccessCodeFormProps {
  accessCode?: AccessCode;
  locations: Location[];
  categories: Category[];
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
  mode?: 'manual' | 'import';
  locationId?: string;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
}

export function AccessCodeForm({ accessCode, locations, categories, onClose, onSuccess, mode = 'manual', locationId, showToast }: AccessCodeFormProps) {
  const [data, setData] = useState<Partial<AccessCode>>(accessCode || { locationId: locationId || locations[0]?.id });
  const [isImporting, setIsImporting] = useState(mode === 'import');
  const [importData, setImportData] = useState<any[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSavingImport, setIsSavingImport] = useState(false);
  const [importReport, setImportReport] = useState<string[]>([]);

  // A location written in the file as its ID, code or name
  const findLocation = (v: unknown) => {
    const k = String(v ?? '').trim().toLowerCase();
    if (!k) return undefined;
    return locations.find(l => l.id.toLowerCase() === k || (l.code || '').trim().toLowerCase() === k || (l.name || '').trim().toLowerCase() === k);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      // Spreadsheet parser is loaded only when a file is actually uploaded
      const XLSX = await import('xlsx');
      try {
        const buffer = evt.target?.result as ArrayBuffer;
        if (!buffer) return;
        const arrayData = new Uint8Array(buffer);
        const wb = XLSX.read(arrayData, { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawData = XLSX.utils.sheet_to_json(ws) as any[];
        
        // Columns are matched by name (spaces, case and punctuation ignored)
        const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
        const headers = rawData.length ? Object.keys(rawData[0]) : [];
        const pick = (...names: string[]) => headers.find(h => names.includes(norm(h)));
        const locKey = pick('locationid', 'location', 'locationcode', 'locationname', 'site');
        const codeKey = pick('areacode', 'code', 'accesscode');
        const areaKey = pick('accessarea', 'area', 'areaname', 'accessareaname', 'zone');
        const descKey = pick('description', 'desc', 'remarks');
        if (!codeKey || !areaKey) {
          setErrorMessage('The file needs an "Area Code" column and an "Access Area" column.');
          return;
        }
        const defaultLoc = locationId || locations[0]?.id || '';

        const validatedData = rawData.map((row: any, i: number) => {
          const locRaw = locKey ? String(row[locKey] ?? '').trim() : '';
          const loc = findLocation(locRaw || defaultLoc);
          return {
            rowNumber: i + 2,
            location: locRaw || defaultLoc,
            locationName: loc ? loc.name : `Unknown: ${locRaw}`,
            areaCode: String(row[codeKey] ?? '').trim(),
            accessArea: String(row[areaKey] ?? '').trim(),
            description: descKey ? String(row[descKey] ?? '').trim() : ''
          };
        }).filter(item => item.areaCode && item.accessArea);

        setImportData(validatedData);
      } catch (err) {
        console.error("Error parsing Excel:", err);
        setErrorMessage("Failed to parse Excel file. Please ensure it has the correct columns.");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleImport = async () => {
    if (!importData) return;
    setErrorMessage(null);
    setImportReport([]);
    setIsSavingImport(true);
    try {
      const res = await apiFetch('/api/accessCodes/batch', {
        method: 'POST',
        body: JSON.stringify(importData.map(({ locationName, ...row }) => row))
      });
      const body = await res.json().catch(() => ({}));
      const lines = [
        ...(body.rejected || []).map((r: any) => `Row ${r.row}${r.areaCode ? ` (${r.areaCode})` : ''}: ${r.reason}`),
        ...(body.skipped || []).map((r: any) => `Row ${r.row} (${r.areaCode}): skipped, ${String(r.reason).toLowerCase()}`),
      ];
      if (!res.ok) {
        setErrorMessage(body.error || 'Import failed');
        setImportReport(lines);
        return;
      }
      await onSuccess();
      const summary = `Imported ${body.created} access code(s)` +
        (body.skipped?.length ? `, ${body.skipped.length} already existed` : '') +
        (body.rejected?.length ? `, ${body.rejected.length} rejected` : '');
      showToast?.(summary, body.rejected?.length ? 'error' : 'success');
      if (lines.length > 0) {
        // Keep the dialog open so the problems can be read
        setErrorMessage(summary);
        setImportReport(lines);
        setImportData(null);
      } else {
        onClose();
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Batch import failed");
    } finally {
      setIsSavingImport(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    try {
      if (accessCode) {
        await apiFetch(`/api/accessCodes/${accessCode.id}`, {
          method: 'PATCH',
          body: JSON.stringify(data)
        });
        showToast?.('Access code updated successfully', 'success');
      } else {
        await apiFetch('/api/accessCodes', {
          method: 'POST',
          body: JSON.stringify(data)
        });
        showToast?.('Access code created successfully', 'success');
      }
      await onSuccess();
      onClose();
    } catch (err: any) {
      if (showToast) {
        showToast(err.message, 'error');
      } else {
        setErrorMessage(err.message || 'Failed to save access code');
      }
    }
  };

  if (isImporting) {
    return (
      <div className="space-y-6">
        {errorMessage && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl font-medium flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
        {importReport.length > 0 && (
          <ul className="max-h-40 overflow-y-auto p-3 bg-amber-50 border border-amber-200 text-amber-900 text-[11px] rounded-xl space-y-0.5">
            {importReport.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        )}
        <div className="p-12 border-2 border-dashed border-[#E5E7EB] rounded-3xl text-center space-y-4">
          <div className="w-16 h-16 bg-[#F9FAFB] rounded-full flex items-center justify-center mx-auto">
            <FileText size={32} className="text-[#9CA3AF]" />
          </div>
          <div>
            <p className="font-bold text-[#1A1A1A]">Upload Access Code Excel</p>
            <p className="text-xs text-[#6B7280] mt-1">Columns: Location (name, code or ID; optional), Area Code, Access Area, Description</p>
          </div>
          <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} className="hidden" id="code-upload" />
          <label htmlFor="code-upload" className="inline-block px-8 py-3 bg-[#1A1A1A] text-white rounded-xl font-bold cursor-pointer hover:bg-black transition-all">
            Select File
          </label>
        </div>

        {importData && (
          <BulkImportReview
            title="Review Access Code Import"
            description="Verify access codes found in your Excel file before importing."
            data={importData.map(row => ({ ...row, skip: false }))}
            columns={[
              { key: 'locationName', label: 'Location' },
              { key: 'areaCode', label: 'Area Code' },
              { key: 'accessArea', label: 'Access Area' },
              { key: 'description', label: 'Description' }
            ]}
            onApply={handleImport}
            onCancel={() => setImportData(null)}
            applyLabel={`Import ${importData.length} Access Codes`}
            isImporting={isSavingImport}
          />
        )}
        
        {!importData && (
          <button onClick={() => setIsImporting(false)} className="w-full py-4 bg-[#F3F4F6] text-[#4B5563] rounded-2xl font-bold hover:bg-[#E5E7EB] transition-all">
            Back to Manual Entry
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {errorMessage && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl font-medium flex items-center gap-2">
          <AlertCircle size={16} className="shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Location *</label>
        <select 
          required 
          value={data.locationId || ''} 
          onChange={e => setData({...data, locationId: e.target.value})}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm bg-white"
        >
          <option value="">Select Location...</option>
          {locations.map(loc => {
            const cat = categories.find(c => c.id === loc.categoryId);
            return (
              <option key={loc.id} value={loc.id}>{cat?.name} - {loc.name}</option>
            );
          })}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Area Code *</label>
          <input required type="text" value={data.areaCode || ''} onChange={e => setData({...data, areaCode: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Access Area *</label>
          <input required type="text" value={data.accessArea || ''} onChange={e => setData({...data, accessArea: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm" />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Description</label>
        <textarea value={data.description || ''} onChange={e => setData({...data, description: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm min-h-[100px]" />
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Status</label>
        <select 
          value={data.status || 'active'} 
          onChange={e => setData({...data, status: e.target.value as any})}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm bg-white"
        >
          <option value="active">Active / Working</option>
          <option value="not_working">Not Working / Issue</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={() => setIsImporting(true)} className="flex-1 py-4 bg-[#F3F4F6] text-[#4B5563] rounded-2xl font-bold hover:bg-[#E5E7EB] transition-all flex items-center justify-center gap-2">
          <Upload size={18} />
          Batch Import
        </button>
        <button type="submit" className="flex-[2] py-4 bg-[#1A1A1A] text-white rounded-2xl font-bold hover:bg-black transition-all">
          {accessCode ? 'Update Access Code' : 'Create Access Code'}
        </button>
      </div>
    </form>
  );
}
