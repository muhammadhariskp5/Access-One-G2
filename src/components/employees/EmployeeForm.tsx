import React, { useState } from 'react';
import { Employee, Division, Department, Project } from '../../types';
import { apiFetch, cn, parseToYMD } from '../../lib/utils';

interface EmployeeFormProps {
  employee?: Partial<Employee>;
  employees: Employee[];
  divisions: Division[];
  departments: Department[];
  projects: Project[];
  onClose: () => void;
  onSuccess: (savedEmp?: Employee) => void;
}

export function EmployeeForm({ employee, employees, divisions, departments, projects, onClose, onSuccess }: EmployeeFormProps) {
  const [data, setData] = useState<Partial<Employee>>(() => {
    if (!employee) return { status: 'active', employeeType: 'Internal' };
    return {
      ...employee,
      passportExpiry: parseToYMD(employee.passportExpiry) || '',
      qidVisaExpiry: parseToYMD(employee.qidVisaExpiry || employee.visaExpiry) || '',
      safetyInductionDate: parseToYMD(employee.safetyInductionDate) || ''
    };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateField = (name: string, value: string) => {
    const newErrors = { ...errors };
    const today = new Date().toISOString().split('T')[0];

    if (name === 'employeeId' && value.trim()) {
      const isDuplicate = employees.some(emp => 
        (emp.employeeId?.toLowerCase() === value.trim().toLowerCase() || emp.id === value.trim()) && emp.id !== employee?.id
      );
      if (isDuplicate) {
        newErrors.employeeId = `ID "${value}" is already in use.`;
      } else {
        delete newErrors.employeeId;
      }
    }

    if (name === 'qidVisaNumber' && value.trim()) {
      const isDuplicate = employees.some(emp => 
        (emp.qidVisaNumber === value.trim() || emp.qatarId === value.trim() || emp.visaNumber === value.trim()) && emp.id !== employee?.id
      );
      if (isDuplicate) {
        newErrors.qidVisaNumber = `QID/Visa "${value}" is already registered.`;
      } else {
        delete newErrors.qidVisaNumber;
      }
    }

    if (name === 'qidVisaExpiry' && value) {
      if (value < today) {
        newErrors.qidVisaExpiry = "Document has already expired.";
      } else {
        delete newErrors.qidVisaExpiry;
      }
    }

    setErrors(newErrors);
  };

  const handleChange = (field: keyof Employee, value: any) => {
    setData(prev => ({ ...prev, [field]: value }));
    if (typeof value === 'string') {
      validateField(field, value);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    if (Object.keys(errors).length > 0) {
      setGeneralError("Please fix the highlighted validation errors before saving.");
      return;
    }

    if (!data.qidVisaNumber && !data.qatarId && !data.visaNumber) {
      setGeneralError("Please provide a QID or Visa Number.");
      return;
    }

    setIsSubmitting(true);
    const fullName = `${data.firstName || ''} ${data.lastName || ''}`.trim();
    const finalEmployeeId = data.employeeId?.trim() || `EMP-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    
    try {
      let savedEmp: Employee | undefined;
      if (employee && employee.id) {
        const res = await apiFetch(`/api/employees/${employee.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...data,
            name: fullName,
            employeeId: finalEmployeeId
          })
        });
        if (res.ok) {
          savedEmp = await res.json();
        }
      } else {
        const res = await apiFetch('/api/employees', {
          method: 'POST',
          body: JSON.stringify({
            ...data,
            name: fullName,
            employeeId: finalEmployeeId
          })
        });
        if (res.ok) {
          savedEmp = await res.json();
        }
      }
      onSuccess(savedEmp);
      onClose();
    } catch (err: any) {
      setGeneralError(err.message || "Failed to save employee");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-h-[70vh] overflow-y-auto px-1 pr-2">
      {generalError && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl font-medium">
          {generalError}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">First Name *</label>
          <input required type="text" value={data.firstName || ''} onChange={e => setData({...data, firstName: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Last Name *</label>
          <input required type="text" value={data.lastName || ''} onChange={e => setData({...data, lastName: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">First Name (Alt Language)</label>
          <input type="text" value={data.firstNameAlt || ''} onChange={e => setData({...data, firstNameAlt: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Last Name (Alt Language)</label>
          <input type="text" value={data.lastNameAlt || ''} onChange={e => setData({...data, lastNameAlt: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Passport Number</label>
          <input type="text" value={data.passportNumber || ''} onChange={e => handleChange('passportNumber', e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Passport Expiry</label>
          <input type="date" value={parseToYMD(data.passportExpiry) || ''} onChange={e => handleChange('passportExpiry', e.target.value)} className={cn("w-full px-4 py-3 rounded-xl border outline-none font-medium text-sm", errors.passportExpiry ? "border-red-500 bg-red-50" : "border-[#E5E7EB] focus:border-[#800020]")} />
          {errors.passportExpiry && <p className="text-[9px] text-red-600 font-bold">{errors.passportExpiry}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">QID / Visa Number *</label>
          <input 
            required
            type="text" 
            value={data.qidVisaNumber || data.qatarId || data.visaNumber || ''} 
            onChange={e => handleChange('qidVisaNumber', e.target.value)} 
            className={cn("w-full px-4 py-3 rounded-xl border outline-none font-medium text-sm", errors.qidVisaNumber ? "border-red-500 bg-red-50" : "border-[#E5E7EB] focus:border-[#800020]")} 
          />
          {errors.qidVisaNumber && <p className="text-[9px] text-red-600 font-bold">{errors.qidVisaNumber}</p>}
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">QID / Visa Expiry</label>
          <input 
            type="date" 
            value={parseToYMD(data.qidVisaExpiry || data.visaExpiry) || ''} 
            onChange={e => handleChange('qidVisaExpiry', e.target.value)} 
            className={cn("w-full px-4 py-3 rounded-xl border outline-none font-medium text-sm", errors.qidVisaExpiry ? "border-red-500 bg-red-50" : "border-[#E5E7EB] focus:border-[#800020]")} 
          />
          {errors.qidVisaExpiry && <p className="text-[9px] text-red-600 font-bold">{errors.qidVisaExpiry}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Employee Type *</label>
          <select 
            required
            value={data.employeeType || 'permanent'} 
            onChange={e => setData({...data, employeeType: e.target.value as any})}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm bg-white"
          >
            <option value="Internal">Internal</option>
            <option value="External">External</option>
            <option value="External Sponsor">External Sponsor</option>
            <option value="Externally Working">Externally Working</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Sponsor Name</label>
          <input type="text" placeholder="e.g. Sponsor Ltd" value={data.sponsorName || ''} onChange={e => setData({...data, sponsorName: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Division</label>
          <select 
            value={data.division || ''} 
            onChange={e => setData({...data, division: e.target.value as any})}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm bg-white"
          >
            <option value="">Select Division...</option>
            {divisions.map(div => (
              <option key={div.id} value={div.name}>{div.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Department</label>
          <select 
            value={data.department || ''} 
            onChange={e => setData({...data, department: e.target.value})}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm bg-white"
          >
            <option value="">Select Department...</option>
            {departments.map(dept => (
              <option key={dept.id} value={dept.name}>{dept.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Project</label>
          <select 
            value={data.project || ''} 
            onChange={e => setData({...data, project: e.target.value})}
            className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm bg-white"
          >
            <option value="">Select Project...</option>
            {projects.map(proj => (
              <option key={proj.id} value={proj.name}>{proj.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Job Title</label>
          <input type="text" value={data.jobTitle || ''} onChange={e => setData({...data, jobTitle: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Mobile Number</label>
          <input type="text" value={data.mobileNumber || ''} onChange={e => setData({...data, mobileNumber: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Employee ID / E-Code</label>
          <input type="text" value={data.employeeId || ''} onChange={e => handleChange('employeeId', e.target.value)} className={cn("w-full px-4 py-3 rounded-xl border outline-none font-medium text-sm", errors.employeeId ? "border-red-500 bg-red-50" : "border-[#E5E7EB] focus:border-[#800020]")} />
          {errors.employeeId && <p className="text-[9px] text-red-600 font-bold">{errors.employeeId}</p>}
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Email Address</label>
          <input type="email" value={data.email || ''} onChange={e => setData({...data, email: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Safety Induction Date</label>
          <input type="date" value={parseToYMD(data.safetyInductionDate) || ''} onChange={e => setData({...data, safetyInductionDate: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-[#E5E7EB] outline-none focus:border-[#800020] font-medium text-sm" />
        </div>
      </div>

      <div className="flex items-center gap-3 p-4 bg-[#F9FAFB] rounded-2xl border border-[#E5E7EB]">
        <input 
          type="checkbox" 
          id="accountStatus"
          checked={data.status === 'active'} 
          onChange={e => setData({...data, status: e.target.checked ? 'active' : 'inactive'})}
          className="w-5 h-5 rounded border-[#E5E7EB] text-[#800020] focus:ring-[#800020]"
        />
        <label htmlFor="accountStatus" className="text-sm font-bold text-[#1A1A1A]">Set as Active Entity</label>
      </div>

      <button 
        type="submit" 
        disabled={isSubmitting || Object.keys(errors).length > 0}
        className="w-full py-4 bg-[#1A1A1A] text-white rounded-2xl font-bold mt-4 hover:bg-[#333333] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isSubmitting ? 'Saving...' : 'Save Employee'}
      </button>
    </form>
  );
}
