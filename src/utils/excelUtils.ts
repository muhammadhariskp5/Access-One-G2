import { Employee } from '../types';

export const parseExcelDate = (excelDate: any): string | undefined => {
  if (!excelDate) return undefined;
  
  // 1. Handle Native Numbers (Excel Serial)
  if (typeof excelDate === 'number') {
    const date = new Date((excelDate - 25569) * 86400 * 1000);
    if (!isNaN(date.getTime())) {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  const str = excelDate.toString().trim();
  if (!str) return undefined;

  // 2. Handle Numeric Strings that are actually Serial Dates
  if (/^\d{5}$/.test(str)) {
    const num = parseInt(str);
    const date = new Date((num - 25569) * 86400 * 1000);
    if (!isNaN(date.getTime())) {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  // 3. Handle DD-MM-YYYY or DD/MM/YYYY
  const dmmyyyy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmmyyyy) {
    const day = String(parseInt(dmmyyyy[1])).padStart(2, '0');
    const m = String(parseInt(dmmyyyy[2])).padStart(2, '0');
    const y = dmmyyyy[3];
    return `${y}-${m}-${day}`;
  }

  // 4. Handle YYYY-MM-DD or YYYY/MM/DD
  const yyyymmdd = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (yyyymmdd) {
    const y = yyyymmdd[1];
    const m = String(parseInt(yyyymmdd[2])).padStart(2, '0');
    const day = String(parseInt(yyyymmdd[3])).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // 5. Fallback to native parsing
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  return undefined;
};

export const parseDateSafely = (d?: string | Date | null): Date | null => {
  if (!d) return null;
  if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
  const isoStr = parseExcelDate(d);
  if (isoStr) {
    const parts = isoStr.split('-');
    if (parts.length === 3) {
      return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }
  }
  return null;
};

export const formatDateToISO = (d?: string | Date | null): string => {
  if (!d) return '';
  if (typeof d === 'string') {
    const parsed = parseExcelDate(d);
    if (parsed) return parsed;
  }
  const dateObj = parseDateSafely(d);
  if (!dateObj) return '';
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const detectEmployeeUpdates = (emp: Employee, row: any, mapping: Record<string, string>) => {
  const updates: { field: string; oldValue: string; newValue: string; enabled: boolean; isDate?: boolean }[] = [];
  
  const check = (dbField: keyof Employee, excelKey: string, isDate = false) => {
    let rawVal = row[mapping[excelKey]];
    if (rawVal === undefined || rawVal === null || rawVal === '') return;
    
    let newVal = isDate ? (parseExcelDate(rawVal) || rawVal.toString()) : rawVal.toString();
    const oldVal = (emp[dbField] as string) || '';
    
    if (newVal && oldVal !== newVal) {
      updates.push({ 
        field: dbField as string, 
        oldValue: oldVal, 
        newValue: newVal, 
        enabled: true,
        isDate
      });
    }
  };

  check('passportNumber', 'passportNumber');
  check('passportExpiry', 'passportExpiry', true);
  check('visaNumber', 'visaNumber');
  check('visaExpiry', 'visaExpiry', true);
  check('qidVisaExpiry', 'qidVisaExpiry', true);
  check('jobTitle', 'jobTitle');
  check('mobileNumber', 'mobileNumber');
  check('firstName', 'firstName');
  check('lastName', 'lastName');
  check('birthDate', 'birthDate', true);
  check('gender', 'gender');
  check('nationality', 'nationality');
  check('bloodGroup', 'bloodGroup');
  check('maritalStatus', 'maritalStatus');
  
  return updates;
};
