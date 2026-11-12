import React, { useState } from 'react';
import { Location, Category } from '../../types';
import { apiFetch } from '../../lib/utils';
import { FileText, Upload, AlertCircle, Table } from 'lucide-react';
import { BulkImportReview } from '../common/BulkImportReview';

interface LocationFormProps {
  location?: Location;
  categories: Category[];
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
  mode?: 'manual' | 'import';
  showToast?: (msg: string, type?: 'success' | 'error') => void;
}

export function LocationForm({ location, categories, onClose, onSuccess, mode = 'manual', showToast }: LocationFormProps) {
  const [data, setData] = useState<Partial<Location>>(location || { categoryId: categories[0]?.id });
  const [isImporting, setIsImporting] = useState(mode === 'import');
  const [importData, setImportData] = useState<any[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
        const data = XLSX.utils.sheet_to_json(ws);
        setImportData(data);
      } catch (err) {
        console.error("Error parsing Excel:", err);
        setErrorMessage("Failed to parse Excel file.");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleImport = async () => {
    if (!importData) return;
    setErrorMessage(null);
    try {
      const res = await apiFetch('/api/locations/batch', {
        method: 'POST',
        body: JSON.stringify({ locations: importData })
      });
      if (res.ok) {
        await onSuccess();
        onClose();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Import failed');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    try {
      if (location) {
        await apiFetch(`/api/locations/${location.id}`, {
          method: 'PATCH',
          body: JSON.stringify(data)
        });
      } else {
        await apiFetch('/api/locations', {
          method: 'POST',
          body: JSON.stringify(data)
        });
      }
      await onSuccess();
      onClose();
    } catch (err: any) {
      if (showToast) {
        showToast(err.message, 'error');
      } else {
        setErrorMessage(err.message || 'Failed to save location');
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
        <div className="p-12 border-2 border-dashed border-[#E5E7EB] rounded-3xl text-center space-y-4">
          <div className="w-16 h-16 bg-[#F9FAFB] rounded-full flex items-center justify-center mx-auto">
            <FileText size={32} className="text-[#9CA3AF]" />
          </div>
          <div>
            <p className="font-bold text-[#1A1A1A]">Upload Location Excel</p>
            <p className="text-xs text-[#6B7280] mt-1">Columns: name, code, categoryId, description</p>
          </div>
          <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} className="hidden" id="loc-upload" />
          <label htmlFor="loc-upload" className="inline-block px-8 py-3 bg-[#1A1A1A] text-white rounded-xl font-bold cursor-pointer hover:bg-black transition-all">
            Select File
          </label>
        </div>

        {importData && (
          <BulkImportReview
            title="Review Location Import"
            description="Verify locations found in your Excel file before importing."
            data={importData.map(row => ({ ...row, skip: false }))}
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'code', label: 'Code' },
              { key: 'categoryId', label: 'Category ID' }
            ]}
            onApply={handleImport}
            onCancel={() => setImportData(null)}
            applyLabel={`Import ${importData.length} Locations`}
            isImporting={isImporting}
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
        <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Category *</label>
        <select 
          required 
          value={data.categoryId || ''} 
          onChange={e => setData({...data, categoryId: e.target.value})}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm bg-white"
        >
          <option value="">Select Category...</option>
          {categories.map(cat => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Location Name *</label>
          <input required type="text" value={data.name || ''} onChange={e => setData({...data, name: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Location Code *</label>
          <input required type="text" value={data.code || ''} onChange={e => setData({...data, code: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm" />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Status *</label>
        <select 
          required 
          value={data.status || 'active'} 
          onChange={e => setData({...data, status: e.target.value as any})}
          className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm bg-white"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Description</label>
        <textarea value={data.description || ''} onChange={e => setData({...data, description: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm min-h-[100px]" />
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={() => setIsImporting(true)} className="flex-1 py-4 bg-[#F3F4F6] text-[#4B5563] rounded-2xl font-bold hover:bg-[#E5E7EB] transition-all flex items-center justify-center gap-2">
          <Upload size={18} />
          Batch Import
        </button>
        <button type="submit" className="flex-[2] py-4 bg-[#1A1A1A] text-white rounded-2xl font-bold hover:bg-black transition-all">
          {location ? 'Update Location' : 'Create Location'}
        </button>
      </div>
    </form>
  );
}
