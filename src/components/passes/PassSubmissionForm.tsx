import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'motion/react';
import { Plus, Search, Shield, Calendar, X, Upload, Ban, Check, User, ArrowRight, Table, AlertTriangle, FileText, UserPlus, CheckCircle2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { FormAccessMatrix } from './FormAccessMatrix';
import { BulkImportReview } from '../common/BulkImportReview';
import { 
  Pass, PassApplication, Employee, Location, Category, AccessCode, Project, 
  UserProfile, PassType, Division, Department, AppAction
} from '../../types';
import { apiFetch, cn, formatDate, parseToYMD } from '../../lib/utils';
import { parseExcelDate, detectEmployeeUpdates } from '../../utils/excelUtils';
import { isApplicationLineInPipeline } from '../../utils/passStatus';
import { Modal } from '../common/Modal';
import { SearchInput } from '../common/SearchInput';
import { EmployeeForm } from '../employees/EmployeeForm';

export interface PassSubmissionFormProps {
  employees: Employee[];
  locations: Location[];
  categories: Category[];
  accessCodes: AccessCode[];
  projects: Project[];
  divisions: Division[];
  departments: Department[];
  passes: Pass[];
  applications: PassApplication[];
  onSuccess: () => void;
  onClose: () => void;
  currentUser: UserProfile | null;
  initialData?: any;
  logAction: (action: Omit<AppAction, 'id' | 'timestamp'>) => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  allUsers?: UserProfile[];
}

export function PassSubmissionForm({ 
  employees, 
  locations, 
  categories, 
  accessCodes, 
  projects, 
  divisions, 
  departments, 
  passes, 
  applications, 
  onSuccess, 
  onClose, 
  currentUser, 
  initialData, 
  logAction, 
  showToast, 
  allUsers 
}: PassSubmissionFormProps) {
  const [step, setStep] = useState(1);
  const [allApplicationMemberIds] = useState<string[]>(initialData?.employeeIds || []);
  
  // Find source application if initialData has an applicationId or id
  const sourceApp = useMemo(() => {
    if (!initialData) return null;
    const targetId = (initialData.applicationId || initialData.id || '').toString().toLowerCase().trim();
    if (!targetId) return null;
    return applications.find(a => 
      a.id?.toLowerCase().trim() === targetId || 
      a.authorityAppNumber?.toLowerCase().trim() === targetId
    ) || null;
  }, [initialData, applications]);

  useEffect(() => {
    if ((initialData?.applicationId || initialData?.id) && step === 1) {
      setStep(2);
    }
  }, [initialData, step]);

  const calcOneYearLater = (startDateStr: string) => {
    const d = startDateStr ? new Date(startDateStr) : new Date();
    if (isNaN(d.getTime())) return '';
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().split('T')[0];
  };

  const calcNextDay = (dateStr?: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  };

  const defaultStart = parseToYMD(initialData?.startDate) || parseToYMD(sourceApp?.startDate) || parseToYMD(new Date().toISOString());
  const defaultExpiry = parseToYMD(initialData?.expiryDate || (initialData as any)?.endDate) || parseToYMD(sourceApp?.endDate || sourceApp?.expiryDate) || calcOneYearLater(defaultStart);

  const initialEmpIds = initialData?.employeeIds || sourceApp?.employeeIds || [];
  const initialIndExpiries: Record<string, string> = {};
  const initialIndStartDates: Record<string, string> = {};

  initialEmpIds.forEach(id => {
    const rawExp = (initialData as any)?.individualExpiries?.[id] || (sourceApp as any)?.individualExpiries?.[id];
    const rawStart = (initialData as any)?.individualStartDates?.[id] || (sourceApp as any)?.individualStartDates?.[id];
    initialIndExpiries[id] = parseToYMD(rawExp) || (initialData?.expiryDate ? parseToYMD(initialData.expiryDate) : '') || defaultExpiry;
    initialIndStartDates[id] = parseToYMD(rawStart) || (initialData?.startDate ? parseToYMD(initialData.startDate) : '') || defaultStart;
  });

  const initialProjId = initialData?.projectId || sourceApp?.projectId || '';
  const initialProj = projects.find(p => p.id === initialProjId || (initialData?.contractNumber && p.contractNumber === initialData.contractNumber) || (initialData?.contractName && p.name === initialData.contractName));

  const resolvedPassType = (initialData?.type || sourceApp?.type || 'main') as PassType;
  const resolvedLocId = initialData?.locationId || sourceApp?.locationId || '';

  const [data, setData] = useState({
    employeeIds: initialEmpIds,
    temporaryNames: initialData?.temporaryNames || [] as string[],
    categoryId: resolvedLocId ? (locations.find(l => l.id === resolvedLocId)?.categoryId || '') : (initialData?.categoryId || sourceApp?.categoryId || ''),
    locationId: resolvedLocId,
    selections: {} as Record<string, { accessCodes: string[], expiryDate: string }>,
    selectionOrder: [] as string[],
    type: resolvedPassType,
    parentPassId: initialData?.parentPassId || sourceApp?.parentPassId || '',
    accessCodes: initialData?.accessCodes || sourceApp?.accessCodes || [] as string[],
    authorityAppNumber: initialData?.authorityAppNumber || sourceApp?.authorityAppNumber || '',
    remarks: initialData?.remarks || sourceApp?.remarks || '',
    startDate: defaultStart,
    expiryDate: defaultExpiry,
    individualExpiries: initialIndExpiries,
    individualStartDates: initialIndStartDates,
    useIndividualExpiries: true,
    isDirect: initialData?.isDirect || false,
    projectId: initialData?.projectId || sourceApp?.projectId || initialProj?.id || '',
    contractNumber: initialData?.contractNumber || sourceApp?.contractNumber || initialProj?.contractNumber || initialProj?.name || '',
    contractName: initialData?.contractName || sourceApp?.contractName || initialProj?.name || '',
    clientCompany: initialData?.clientCompany || sourceApp?.clientCompany || initialProj?.clientCompany || '',
    clientApprovers: initialData?.clientApprovers || sourceApp?.clientApprovers || initialProj?.clientApprovers || ''
  });

  const [validityIssues, setValidityIssues] = useState<{
    empId: string;
    employee: Employee;
    employeeName: string;
    requestedExpiry: string;
    passportNumber: string;
    passportExpiry: string;
    visaNumber: string;
    visaExpiry: string;
    passportIssue?: string;
    visaIssue?: string;
  }[] | null>(null);
  const [isValidityModalOpen, setIsValidityModalOpen] = useState(false);
  const [isSavingDocUpdates, setIsSavingDocUpdates] = useState(false);
  // 'fix' = opened from a personnel card during selection (save documents only);
  // 'submit' = opened by the submit-time validation (save documents, then submit).
  const [validityMode, setValidityMode] = useState<'fix' | 'submit'>('submit');
  // Document values saved from the Fix modal, applied on top of the employees prop until
  // the next data refresh brings them back from the server (never mutate props).
  const [docOverrides, setDocOverrides] = useState<Record<string, Partial<Employee>>>({});

  interface ErrorGuidance {
    title: string;
    category: 'policy' | 'document' | 'validation' | 'server';
    problem: string;
    explanation: string;
    suggestedAction: string;
    actionButton?: {
      label: string;
      onClick: () => void;
    };
  }

  const [errorGuidance, setErrorGuidance] = useState<ErrorGuidance | null>(null);

  // Collect all known identifiers for the application being processed (ID, authorityAppNumber, etc.)
  const currentAppIdentifiers = useMemo(() => {
    const ids = new Set<string>();
    const add = (v?: any) => {
      if (v !== undefined && v !== null && String(v).trim()) {
        ids.add(String(v).trim().toLowerCase());
      }
    };
    add(initialData?.applicationId);
    add(initialData?.id);
    add(initialData?.authorityAppNumber);
    add(sourceApp?.id);
    add(sourceApp?.authorityAppNumber);
    add(data.authorityAppNumber);
    return ids;
  }, [initialData, sourceApp, data.authorityAppNumber]);

  // Check if an application corresponds to the application currently being edited/processed
  const isCurrentApp = useCallback((app?: PassApplication | null) => {
    if (!app) return false;
    const aId = String(app.id || '').trim().toLowerCase();
    const aAuth = String(app.authorityAppNumber || '').trim().toLowerCase();
    return (!!aId && currentAppIdentifiers.has(aId)) || (!!aAuth && currentAppIdentifiers.has(aAuth));
  }, [currentAppIdentifiers]);

  // Check if a pass belongs to the application currently being processed
  const isPassFromCurrentApp = useCallback((p?: Pass | null) => {
    if (!p) return false;
    const reqId = String(p.requestId || p.applicationId || '').trim().toLowerCase();
    const authNum = String(p.authorityAppNumber || '').trim().toLowerCase();
    return (!!reqId && currentAppIdentifiers.has(reqId)) || (!!authNum && currentAppIdentifiers.has(authNum));
  }, [currentAppIdentifiers]);

  // Initialize selections if initialData has locationId or sourceApp has locationId
  useEffect(() => {
    const locId = initialData?.locationId || sourceApp?.locationId;
    if (locId && Object.keys(data.selections).length === 0) {
      setData(prev => ({
        ...prev,
        selections: {
          [locId]: {
            accessCodes: initialData?.accessCodes || sourceApp?.accessCodes || [],
            expiryDate: initialData?.expiryDate || (initialData as any)?.endDate || sourceApp?.endDate || sourceApp?.expiryDate || prev.expiryDate
          }
        }
      }));
    }
  }, [initialData, sourceApp]);

  // Auto populate contract/project details when personnel are selected if not set yet
  useEffect(() => {
    if (data.employeeIds.length > 0 && !data.projectId && !data.contractNumber) {
      const selectedEmps = employees.filter(e => data.employeeIds.includes(e.id));
      const empProjName = selectedEmps.find(e => e.project)?.project;
      if (empProjName) {
        const matchingProj = projects.find(p => 
          p.id === empProjName || 
          p.name.toLowerCase() === empProjName.toLowerCase() || 
          (p.contractNumber || (p as any).contractnumber)?.toLowerCase() === empProjName.toLowerCase()
        );
        if (matchingProj) {
          const cNum = matchingProj.contractNumber || (matchingProj as any).contractnumber || matchingProj.name || '';
          const cComp = matchingProj.clientCompany || (matchingProj as any).clientcompany || '';
          const cAppr = matchingProj.clientApprovers || (matchingProj as any).clientapprovers || '';
          setData(prev => ({
            ...prev,
            projectId: matchingProj.id,
            contractNumber: cNum,
            contractName: matchingProj.name || '',
            clientCompany: cComp,
            clientApprovers: cAppr
          }));
        } else {
          setData(prev => ({
            ...prev,
            contractName: empProjName,
            contractNumber: empProjName
          }));
        }
      }
    }
  }, [data.employeeIds, projects, employees]);

  const handleToggleAccess = (locId: string, areaCode: string) => {
    setData(prev => {
      const newSelections = { ...prev.selections };
      let newOrder = [...prev.selectionOrder];

      const key = `${locId}:${areaCode}`;
      const currentSelection = newSelections[locId] || { accessCodes: [], expiryDate: prev.expiryDate };
      const nextCodes = currentSelection.accessCodes.includes(areaCode)
        ? currentSelection.accessCodes.filter(c => c !== areaCode)
        : [...currentSelection.accessCodes, areaCode];
      
      const newSelection = { ...currentSelection, accessCodes: nextCodes };

      if (nextCodes.includes(areaCode)) {
        if (!newOrder.includes(key)) newOrder.push(key);
      } else {
        newOrder = newOrder.filter(o => o !== key);
      }

      if (nextCodes.length === 0) {
        delete newSelections[locId];
      } else {
        newSelections[locId] = newSelection;
      }

      return { 
        ...prev, 
        selections: newSelections, 
        selectionOrder: newOrder,
        locationId: locId,
        accessCodes: newSelections[locId]?.accessCodes || []
      };
    });
  };

  const handleSetLocationExpiry = (locId: string, date: string) => {
    setData(prev => ({
      ...prev,
      selections: {
        ...prev.selections,
        [locId]: { ...prev.selections[locId], expiryDate: date }
      }
    }));
  };

  const [importStep, setImportStep] = useState<'upload' | 'mapping' | 'review'>('upload');
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [rawImportData, setRawImportData] = useState<any[] | null>(null);
  const [importResults, setImportResults] = useState<{
    matched: { 
      employee: Employee, 
      row: any,
      updates: { field: string; oldValue: string; newValue: string; enabled: boolean }[]
    }[],
    unmatched: { row: any, existingEmployee: Employee | null; skip?: boolean }[]
  } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [matchingRowIndex, setMatchingRowIndex] = useState<number | null>(null);
  const [creatingEmployeeRow, setCreatingEmployeeRow] = useState<{ row: any; prefilled: Partial<Employee> } | null>(null);
  const [locallyCreatedEmployees, setLocallyCreatedEmployees] = useState<Employee[]>([]);

  const allEmployees = useMemo(() => {
    const existingIds = new Set(employees.map(e => e?.id).filter(Boolean));
    const newItems = locallyCreatedEmployees.filter(e => e?.id && !existingIds.has(e.id));
    return [...employees, ...newItems];
  }, [employees, locallyCreatedEmployees]);

  const reviewColumns = [
    { 
      key: 'name', 
      label: 'Personnel Name',
      render: (row: any) => (
        <div>
          <p className="text-xs font-bold text-[#1E293B]">{row.name}</p>
          <p className="text-[10px] text-gray-500">{row.jobTitle || 'No designation'} {row.mobile ? `• ${row.mobile}` : ''}</p>
        </div>
      )
    },
    { 
      key: 'qid', 
      label: 'QID / Passport / Staff ID',
      render: (row: any) => (
        <div className="text-[10px] text-gray-700">
          <p>QID/Passport: <span className="font-bold text-[#1E293B]">{row.qid}</span></p>
          {row.staffId && <p className="text-gray-500">Staff #: {row.staffId}</p>}
        </div>
      )
    },
    { 
      key: 'status', 
      label: 'Status',
      render: (row: any) => (
        <span className={cn(
          "px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1",
          row._status === 'matched' ? "bg-emerald-100 text-emerald-800 border border-emerald-200" : "bg-amber-100 text-amber-800 border border-amber-200"
        )}>
          {row._status === 'matched' ? '✓ Matched (Existing)' : '⚡ Auto-Register (New)'}
        </span>
      )
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row: any) => (
        <div className="flex items-center justify-end gap-1.5">
          {row._status === 'unmatched' && (
            <button
              type="button"
              onClick={() => handleCreateNewEmployee(row.rawRow)}
              className="px-2.5 py-1 bg-[#800020] text-white rounded-lg text-[10px] font-bold hover:bg-[#600018] transition-all flex items-center gap-1 shadow-xs"
              title="Verify details and add directly to directory & application"
            >
              <UserPlus size={12} />
              Verify & Edit Details
            </button>
          )}
          {row._status === 'matched' && (
            <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1 pr-2">
              <CheckCircle2 size={12} /> Ready
            </span>
          )}
        </div>
      )
    }
  ];

  const reviewData = useMemo(() => {
    if (!importResults) return [];
    const matchedRows = (importResults.matched || []).map((m: any) => ({
      name: m.employee?.name || m.row?.name || 'Matched Employee',
      jobTitle: m.employee?.jobTitle || m.row?.[mapping['jobTitle']] || '',
      mobile: m.employee?.mobileNumber || m.row?.[mapping['mobileNumber']] || '',
      qid: m.employee?.qatarId || m.employee?.passportNumber || m.row?.[mapping['qatarId']] || m.row?.[mapping['passportNumber']] || '-',
      staffId: m.employee?.employeeId || m.row?.[mapping['employeeId']] || '',
      status: 'Matched',
      _status: 'matched',
      rawRow: m.row
    }));
    const unmatchedRows = (importResults.unmatched || []).map((u: any, idx: number) => {
      const row = u.row || {};
      const fName = row[mapping['firstName']] || row['FIRST_NAME'] || row['First Name'] || '';
      const lName = row[mapping['lastName']] || row['LAST_NAME'] || row['Last Name'] || '';
      const rawName = (row[mapping['name']] || row['NAME'] || row['Full Name'] || row['NAME_ENGLISH'] || '').toString().trim();
      const name = (fName || lName) ? `${fName} ${lName}`.trim() : (rawName || 'Unmatched Person');
      const qid = row[mapping['qatarId']] || row[mapping['passportNumber']] || row[mapping['employeeId']] || row['QID'] || row['QATAR_ID'] || '-';
      const jobTitle = row[mapping['jobTitle']] || row['JOB_TITLE'] || '';
      const mobile = row[mapping['mobileNumber']] || row['PERSONAL_PHONE_NUMBER'] || row['MOBILE'] || '';
      const staffId = row[mapping['employeeId']] || row['STAFF_NUMBER'] || row['EMPLOYEE_ID'] || '';
      return {
        name,
        jobTitle,
        mobile,
        qid,
        staffId,
        status: 'Auto-Register (New)',
        _status: 'unmatched',
        rawRow: row,
        unmatchedIndex: idx,
        skip: u.skip || false
      };
    });
    return [...matchedRows, ...unmatchedRows];
  }, [importResults, mapping]);

  const handleCreateNewEmployee = (row: any) => {
    let firstName = row[mapping['firstName']] || row['FIRST_NAME'] || row['First Name'] || '';
    let lastName = row[mapping['lastName']] || row['LAST_NAME'] || row['Last Name'] || '';
    
    if (!firstName && !lastName) {
      const rawName = (row[mapping['name']] || row['NAME'] || row['Full Name'] || row['NAME_ENGLISH'] || '').toString().trim();
      if (rawName) {
        const parts = rawName.split(' ');
        firstName = parts[0] || '';
        lastName = parts.slice(1).join(' ') || '';
      }
    }

    const newEmp: Partial<Employee> = {
      firstName,
      lastName,
      employeeId: row[mapping['employeeId']] || row['STAFF_NUMBER'] || row['EMPLOYEE_ID'] || row['EMP_CODE'] || '',
      qatarId: row[mapping['qatarId']] || row['QATA_ID_NUMBER'] || row['QID'] || row['QATAR_ID'] || '',
      visaNumber: row[mapping['visaNumber']] || row['VISA_NUMBER'] || '',
      qidVisaNumber: row[mapping['qatarId']] || row[mapping['visaNumber']] || row['QATA_ID_NUMBER'] || row['VISA_NUMBER'] || row['QID'] || '',
      qidVisaExpiry: parseExcelDate(row[mapping['qidVisaExpiry']] || row['QATAR_ID_EXPIRY_DATE']),
      passportNumber: row[mapping['passportNumber']] || row['PASSPORT_NUMBER'] || '',
      passportExpiry: parseExcelDate(row[mapping['passportExpiry']] || row['PASSPORT_EXPIRY_DATE']),
      visaExpiry: parseExcelDate(row[mapping['visaExpiry']] || row['VISA_EXPIRY_DATE']),
      jobTitle: row[mapping['jobTitle']] || row['JOB_TITLE'] || '',
      mobileNumber: row[mapping['mobileNumber']] || row['PERSONAL_PHONE_NUMBER'] || row['MOBILE'] || '',
      birthDate: parseExcelDate(row['BIRTH_DATE']),
      gender: row['Gender'] || row['GENDER'],
      nationality: row['NATIONALITY'] || row['Nationality'],
      bloodGroup: row['BLOOD_GROUP'],
      maritalStatus: row['MARITAL_STATUS'],
      status: 'active',
      employeeType: 'Internal',
      department: '',
      division: 'Operations'
    };
    setCreatingEmployeeRow({ row, prefilled: newEmp });
  };

  const handleCreatedEmployeeSuccess = async (createdEmp?: Employee) => {
    await onSuccess();
    
    if (creatingEmployeeRow && importResults) {
      const targetRow = creatingEmployeeRow.row;
      const prefilled = creatingEmployeeRow.prefilled;
      
      try {
        let freshEmp = createdEmp;
        if (!freshEmp) {
          const freshEmployees: Employee[] = await apiFetch('/api/employees').then(res => res.json());
          if (Array.isArray(freshEmployees) && freshEmployees.length > 0) {
            freshEmp = freshEmployees.find(e => 
              (prefilled.employeeId && e.employeeId === prefilled.employeeId) ||
              (prefilled.qidVisaNumber && (e.qidVisaNumber === prefilled.qidVisaNumber || e.qatarId === prefilled.qidVisaNumber || e.visaNumber === prefilled.qidVisaNumber)) ||
              (prefilled.firstName && e.firstName === prefilled.firstName)
            ) || freshEmployees[freshEmployees.length - 1];
          }
        }

        if (freshEmp) {
          setLocallyCreatedEmployees(prev => [...prev, freshEmp]);

          if (importResults && 'unmatched' in importResults && Array.isArray((importResults as any).unmatched)) {
            const obj = importResults as any;
            const unmatchedIndex = obj.unmatched.findIndex((u: any) => u.row === targetRow);
            if (unmatchedIndex !== -1) {
              const newMatched = { employee: freshEmp, row: targetRow, updates: [] };
              setImportResults({
                matched: [...obj.matched, newMatched],
                unmatched: obj.unmatched.filter((_: any, i: number) => i !== unmatchedIndex)
              } as any);

              setData(prev => {
                const updatedEmployeeIds = prev.employeeIds.includes(freshEmp.id)
                  ? prev.employeeIds
                  : [...prev.employeeIds, freshEmp.id];

                const sDate = parseExcelDate(targetRow[mapping['passFrom']] || targetRow['PASS_FROM'] || targetRow['START_DATE']);
                const eDate = parseExcelDate(targetRow[mapping['passExpiry']] || targetRow['PASS_EXPIRY'] || targetRow['END_DATE']);

                const updatedStartDates = { ...prev.individualStartDates };
                const updatedExpiries = { ...prev.individualExpiries };
                if (sDate) updatedStartDates[freshEmp.id] = sDate;
                if (eDate) updatedExpiries[freshEmp.id] = eDate;

                return {
                  ...prev,
                  employeeIds: updatedEmployeeIds,
                  individualStartDates: updatedStartDates,
                  individualExpiries: updatedExpiries
                };
              });

              if (initialData?.id) {
                try {
                  const currentEmpIds = initialData.employeeIds || [];
                  const newEmpIds = Array.from(new Set([...currentEmpIds, freshEmp.id]));
                  const empStatuses = { ...(initialData.employeeStatuses || {}) };
                  if (!empStatuses[freshEmp.id]) empStatuses[freshEmp.id] = 'pending';

                  apiFetch(`/api/passApplications/${initialData.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                      employeeIds: newEmpIds,
                      employeeStatuses: empStatuses
                    })
                  });
                } catch (err) {
                  console.error("Failed to sync new employee to ongoing application DB:", err);
                }
              }

              showToast(`Created ${freshEmp.name} & added to ongoing application!`, 'success');
            }
          }
        }
      } catch (err) {
        console.error("Error matching newly created employee:", err);
      }
    } else {
      showToast("Personnel created successfully.", "success");
    }
    setCreatingEmployeeRow(null);
  };

  const filteredEmployees = useMemo(() => {
    // Exclude inactive employees from the pass application picker
    const activeEmployees = allEmployees.filter(emp => emp.status !== 'inactive');
    if (!searchTerm) return activeEmployees.slice(0, 50);
    const s = searchTerm.toLowerCase();
    return activeEmployees.filter(emp => 
      emp.name?.toLowerCase().includes(s) || 
      emp.employeeId?.toLowerCase().includes(s) ||
      emp.qatarId?.toLowerCase().includes(s) ||
      emp.jobTitle?.toLowerCase().includes(s)
    );
  }, [allEmployees, searchTerm]);

  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const buffer = evt.target?.result as ArrayBuffer;
        if (!buffer) return;
        const data = new Uint8Array(buffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws) as any[];

        if (rows && rows.length > 0) {
          const headers = Object.keys(rows[0]);
          setRawHeaders(headers);
          
          const newMapping: Record<string, string> = {};
          const fields = [
            { id: 'employeeId', labels: ['staff_number', 'employee code', 'emp code', 'e code', 'staff number', 'employee id', 'id', 'staff_no', 'emp_id'] },
            { id: 'qatarId', labels: ['qata_id_number', 'qatar id', 'qid', 'qata id number', 'qatar_id', 'qid_no', 'qid number'] },
            { id: 'visaNumber', labels: ['visa_number', 'visa number', 'visa', 'visa_no'] },
            { id: 'passportNumber', labels: ['passport_number', 'passport number', 'passport', 'passport_no', 'pp_no'] },
            { id: 'passportExpiry', labels: ['passport_expiry_date', 'passport expiry', 'passport exp', 'pp_exp', 'passport_exp'] },
            { id: 'visaExpiry', labels: ['visa_expiry_date', 'visa expiry', 'visa exp', 'visa_exp'] },
            { id: 'qidVisaExpiry', labels: ['qatar_id_expiry_date', 'qid visa expiry', 'qid expiry', 'qid_exp'] },
            { id: 'passFrom', labels: ['pass valid from', 'pass from', 'start date', 'valid from', 'from_date'] },
            { id: 'passExpiry', labels: ['pass valid to', 'pass expiry', 'expiry date', 'valid to', 'end date', 'to_date'] },
            { id: 'jobTitle', labels: ['job_title', 'job title', 'designation', 'occupation', 'role'] },
            { id: 'mobileNumber', labels: ['personal_phone_number', 'mobile number', 'phone', 'mobile', 'contact'] },
            { id: 'firstName', labels: ['first_name', 'first name', 'name', 'full_name', 'employee_name', 'staff_name'] },
            { id: 'lastName', labels: ['last_name', 'last name', 'surname'] }
          ];

          fields.forEach(field => {
            const match = headers.find(h => 
              field.labels.some(l => h.toLowerCase().trim().includes(l)) ||
              h.toLowerCase().replace(/[^a-z0-9]/g, '') === field.id.toLowerCase()
            );
            if (match) newMapping[field.id] = match;
          });

          setMapping(newMapping);
          setRawImportData(rows);
          setImportStep('mapping');
          setIsImporting(true);
        } else {
          showToast('The uploaded Excel file contains no data rows.', 'error');
        }
      } catch (err: any) {
        console.error("Error parsing Excel:", err);
        showToast("Failed to parse Excel file: " + (err.message || 'Invalid format'), 'error');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const proceedToReview = () => {
    if (!rawImportData) return;
    
    const matched: { 
      employee: Employee, 
      row: any,
      updates: { field: string; oldValue: string; newValue: string; enabled: boolean }[]
    }[] = [];
    const unmatched: { row: any, existingEmployee: Employee | null; skip?: boolean }[] = [];
    
    rawImportData.forEach(row => {
      const qatarId = row[mapping['qatarId']]?.toString();
      const visaNumber = row[mapping['visaNumber']]?.toString();
      const staffNumber = row[mapping['employeeId']]?.toString();

      const emp = allEmployees.find(e => 
        (qatarId && (e.qatarId === qatarId || e.qidVisaNumber === qatarId)) || 
        (visaNumber && (e.visaNumber === visaNumber || e.qidVisaNumber === visaNumber)) || 
        (staffNumber && e.employeeId === staffNumber)
      );

      if (emp) {
        matched.push({ 
          employee: emp, 
          row,
          updates: detectEmployeeUpdates(emp, row, mapping)
        });
      } else {
        unmatched.push({ row, existingEmployee: null });
      }
    });

    setImportResults({ matched, unmatched });
    setImportStep('review');
  };

  const applyImport = async () => {
    if (!importResults) return;
    
    const matchedIds = [...data.employeeIds];
    const updates: Promise<any>[] = [];
    const newIndividualStartDates = { ...data.individualStartDates };
    const newIndividualExpiries = { ...data.individualExpiries };
    const newCreatedEmployees: Employee[] = [];

    // 1. Update matched existing employees
    importResults.matched.forEach(item => {
      const { employee: emp, row, updates: detectedUpdates } = item;
      if (!matchedIds.includes(emp.id)) {
        matchedIds.push(emp.id);
      }

      const sDate = parseExcelDate(row[mapping['passFrom']]);
      const eDate = parseExcelDate(row[mapping['passExpiry']]);
      newIndividualStartDates[emp.id] = sDate || data.startDate;
      newIndividualExpiries[emp.id] = eDate || data.expiryDate || calcOneYearLater(newIndividualStartDates[emp.id]);

      const employeeUpdates: any = {};
      detectedUpdates.forEach(u => {
        if (u.enabled) {
          employeeUpdates[u.field] = u.isDate ? parseExcelDate(u.newValue) : u.newValue;
        }
      });
      
      if (Object.keys(employeeUpdates).length > 0) {
        updates.push(apiFetch(`/api/employees/${emp.id}`, {
          method: 'PATCH',
          body: JSON.stringify(employeeUpdates)
        }));
      }
    });

    // 2. Auto-register unmatched new personnel into database and pass application list
    let createdCount = 0;
    if (importResults.unmatched && importResults.unmatched.length > 0) {
      for (const item of importResults.unmatched) {
        if ((item as any).skip) continue;
        const row = item.row || {};

        let firstName = row[mapping['firstName']] || row['FIRST_NAME'] || row['First Name'] || '';
        let lastName = row[mapping['lastName']] || row['LAST_NAME'] || row['Last Name'] || '';
        
        if (!firstName && !lastName) {
          const rawName = (row[mapping['name']] || row['NAME'] || row['Full Name'] || row['NAME_ENGLISH'] || '').toString().trim();
          if (rawName) {
            const parts = rawName.split(' ');
            firstName = parts[0] || '';
            lastName = parts.slice(1).join(' ') || '';
          }
        }

        const name = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : 'Imported Personnel';

        const empPayload = {
          name,
          firstName,
          lastName,
          employeeId: row[mapping['employeeId']] || row['STAFF_NUMBER'] || row['EMPLOYEE_ID'] || row['EMP_CODE'] || '',
          qatarId: row[mapping['qatarId']] || row['QATA_ID_NUMBER'] || row['QID'] || row['QATAR_ID'] || '',
          visaNumber: row[mapping['visaNumber']] || row['VISA_NUMBER'] || '',
          qidVisaNumber: row[mapping['qatarId']] || row[mapping['visaNumber']] || row['QATA_ID_NUMBER'] || row['VISA_NUMBER'] || row['QID'] || '',
          qidVisaExpiry: parseExcelDate(row[mapping['qidVisaExpiry']] || row['QATAR_ID_EXPIRY_DATE']),
          passportNumber: row[mapping['passportNumber']] || row['PASSPORT_NUMBER'] || '',
          passportExpiry: parseExcelDate(row[mapping['passportExpiry']] || row['PASSPORT_EXPIRY_DATE']),
          visaExpiry: parseExcelDate(row[mapping['visaExpiry']] || row['VISA_EXPIRY_DATE']),
          jobTitle: row[mapping['jobTitle']] || row['JOB_TITLE'] || '',
          mobileNumber: row[mapping['mobileNumber']] || row['PERSONAL_PHONE_NUMBER'] || row['MOBILE'] || '',
          status: 'active',
          employeeType: 'Internal',
          department: '',
          division: 'Operations'
        };

        try {
          const res = await apiFetch('/api/employees', {
            method: 'POST',
            body: JSON.stringify(empPayload)
          });

          if (res.ok) {
            const createdEmp = await res.json();
            if (createdEmp?.id) {
              newCreatedEmployees.push(createdEmp);
              if (!matchedIds.includes(createdEmp.id)) {
                matchedIds.push(createdEmp.id);
              }
              const sDate = parseExcelDate(row[mapping['passFrom']] || row['PASS_FROM'] || row['START_DATE']);
              const eDate = parseExcelDate(row[mapping['passExpiry']] || row['PASS_EXPIRY'] || row['END_DATE']);
              newIndividualStartDates[createdEmp.id] = sDate || data.startDate;
              newIndividualExpiries[createdEmp.id] = eDate || data.expiryDate || calcOneYearLater(newIndividualStartDates[createdEmp.id]);
              createdCount++;
            }
          }
        } catch (err) {
          console.error("Failed to auto-register unmatched personnel during import:", err);
        }
      }
    }

    await Promise.all(updates);

    if (newCreatedEmployees.length > 0) {
      setLocallyCreatedEmployees(prev => [...prev, ...newCreatedEmployees]);
    }

    if (createdCount > 0 && onSuccess) {
      try {
        await onSuccess();
      } catch (err) {
        console.error("Error refreshing global employees list after import:", err);
      }
    }
    
    setData(prev => ({ 
      ...prev, 
      employeeIds: matchedIds,
      individualStartDates: newIndividualStartDates,
      individualExpiries: newIndividualExpiries
    }));

    if (initialData?.id) {
      try {
        const empStatuses: Record<string, string> = { ...(initialData.employeeStatuses || {}) };
        matchedIds.forEach(id => {
          if (!empStatuses[id] || empStatuses[id] === 'rejected' || empStatuses[id] === 'cancelled') {
            empStatuses[id] = 'pending';
          }
        });

        await apiFetch(`/api/passApplications/${initialData.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            employeeIds: matchedIds,
            employeeStatuses: empStatuses
          })
        });
      } catch (err) {
        console.error("Failed to sync import to application DB:", err);
      }
    }

    setIsImporting(false);
    const totalCount = importResults.matched.length + createdCount;
    showToast(`Successfully processed ${totalCount} personnel (${importResults.matched.length} matched, ${createdCount} auto-registered).`, 'success');
  };

  // Helper to find active Main Pass for an employee in a given location or category
  const findActiveMainPass = (empId: string, locId?: string, catId?: string) => {
    const empObj = employees.find(e => e.id === empId || e.employeeId === empId || e.qatarId === empId);
    const possibleEmpIds = new Set([
      empId,
      empObj?.id,
      empObj?.employeeId,
      empObj?.qatarId
    ].filter(Boolean) as string[]);

    const targetCatId = catId || (locId ? locations.find(l => l.id === locId)?.categoryId : undefined);

    return passes.find(p => {
      if (!possibleEmpIds.has(p.employeeId)) return false;
      if (isPassFromCurrentApp(p)) return false;
      if (p.type !== 'main') return false;
      if (['expired', 'revoked', 'cancelled', 'replaced', 'superseded', 'inactive', 'rejected'].includes((p.status || '').toLowerCase())) return false;

      // 45-day early renewal rule: If pass is within 45 days of expiry, a new renewal Main Pass application is allowed
      if (p.expiryDate) {
        const expiryTime = new Date(p.expiryDate).getTime();
        const now = Date.now();
        const diffDays = Math.ceil((expiryTime - now) / (1000 * 60 * 60 * 24));
        if (diffDays <= 45) {
          // Inside 45-day renewal window -> permit new Main Pass application
          return false;
        }
      }

      const passLoc = locations.find(l => l.id === p.locationId);
      const passCatId = (p as any).categoryId || passLoc?.categoryId;
      if (targetCatId && passCatId) {
        return passCatId === targetCatId;
      }
      if (locId && p.locationId === locId) return true;
      return false;
    });
  };

  // Find parent active Main Pass for linking Supplementary passes (regardless of early renewal window)
  const findParentMainPassForSupplementary = (empId: string, locId?: string, catId?: string) => {
    const empObj = employees.find(e => e.id === empId || e.employeeId === empId || e.qatarId === empId);
    const possibleEmpIds = new Set([
      empId,
      empObj?.id,
      empObj?.employeeId,
      empObj?.qatarId
    ].filter(Boolean) as string[]);

    const targetCatId = catId || (locId ? locations.find(l => l.id === locId)?.categoryId : undefined);

    return passes.find(p => {
      if (!possibleEmpIds.has(p.employeeId)) return false;
      if (isPassFromCurrentApp(p)) return false;
      if (p.type !== 'main') return false;
      if (['expired', 'revoked', 'cancelled', 'replaced', 'rejected'].includes(p.status)) return false;
      const passLoc = locations.find(l => l.id === p.locationId);
      const passCatId = (p as any).categoryId || passLoc?.categoryId;
      if (targetCatId && passCatId) {
        return passCatId === targetCatId;
      }
      if (locId && p.locationId === locId) return true;
      return false;
    });
  };

  // Find expiring Main pass within 45-day early renewal window
  const findExpiringRenewalMainPass = (empId: string, locId?: string, catId?: string) => {
    const empObj = employees.find(e => e.id === empId || e.employeeId === empId || e.qatarId === empId);
    const possibleEmpIds = new Set([
      empId,
      empObj?.id,
      empObj?.employeeId,
      empObj?.qatarId
    ].filter(Boolean) as string[]);

    const targetCatId = catId || (locId ? locations.find(l => l.id === locId)?.categoryId : undefined);

    return passes.find(p => {
      if (!possibleEmpIds.has(p.employeeId)) return false;
      if (isPassFromCurrentApp(p)) return false;
      if (p.type !== 'main') return false;
      if (['expired', 'revoked', 'cancelled', 'replaced', 'rejected'].includes(p.status)) return false;
      if (!p.expiryDate) return false;
      
      const expiryTime = new Date(p.expiryDate).getTime();
      const now = Date.now();
      const diffDays = Math.ceil((expiryTime - now) / (1000 * 60 * 60 * 24));
      if (diffDays <= 45) {
        const passLoc = locations.find(l => l.id === p.locationId);
        const passCatId = (p as any).categoryId || passLoc?.categoryId;
        if (targetCatId && passCatId) {
          return passCatId === targetCatId;
        }
        if (locId && p.locationId === locId) return true;
        return false;
      }
      return false;
    });
  };

  const findActiveMainApp = (empId: string, locId?: string, catId?: string) => {
    const empObj = employees.find(e => e.id === empId || e.employeeId === empId || e.qatarId === empId);
    const possibleEmpIds = new Set([
      empId,
      empObj?.id,
      empObj?.employeeId,
      empObj?.qatarId
    ].filter(Boolean) as string[]);

    const targetCatId = catId || (locId ? locations.find(l => l.id === locId)?.categoryId : undefined);

    return applications.find(a => {
      if (isCurrentApp(a)) return false;
      if (a.type !== 'main') return false;

      const appEmpIds = a.employeeIds || [];
      const matchedEmpId = appEmpIds.find(id => possibleEmpIds.has(id));
      if (!matchedEmpId) return false;

      // Only applications still in the pipeline (not yet issued) block. After issuance the
      // pass itself governs via findActiveMainPass (incl. 45-day renewal window).
      if (!isApplicationLineInPipeline(a.status, a.employeeStatuses?.[matchedEmpId])) return false;

      const appLoc = locations.find(l => l.id === a.locationId);
      const appCatId = (a as any).categoryId || appLoc?.categoryId;
      if (targetCatId && appCatId) {
        return appCatId === targetCatId;
      }
      if (locId && a.locationId === locId) return true;
      return false;
    });
  };

  const checkDocumentValidity = (empIds: string[], targetLocId: string) =>
    checkDocumentValidityWith(empIds, targetLocId, docOverrides);

  const checkDocumentValidityWith = (empIds: string[], targetLocId: string, overrides: Record<string, Partial<Employee>>) => {
    const issues: {
      empId: string;
      employee: Employee;
      employeeName: string;
      requestedExpiry: string;
      passportNumber: string;
      passportExpiry: string;
      visaNumber: string;
      visaExpiry: string;
      passportIssue?: string;
      visaIssue?: string;
    }[] = [];

    for (const empId of empIds) {
      const baseEmp = employees.find(e => e.id === empId || e.employeeId === empId || e.qatarId === empId);
      if (!baseEmp) continue;
      const emp: Employee = { ...baseEmp, ...(overrides[baseEmp.id] || {}) };

      const empReqStart = parseToYMD(data.individualStartDates[empId] || data.startDate) || new Date().toISOString().split('T')[0];
      const empReqExpiry = parseToYMD(data.individualExpiries[empId] || data.selections[targetLocId]?.expiryDate || data.expiryDate) || '';

      const passExp = parseToYMD(emp.passportExpiry);
      const passNum = emp.passportNumber || '';

      const visaExp = parseToYMD(emp.qidVisaExpiry || emp.visaExpiry);
      const visaNum = emp.qidVisaNumber || emp.visaNumber || '';

      let passportIssue = '';
      if (!passExp) {
        passportIssue = 'Passport Expiry Date is missing in personnel record.';
      } else if (passExp < empReqStart) {
        passportIssue = `Passport is already expired (${formatDate(passExp)}).`;
      } else if (empReqExpiry && passExp < empReqExpiry) {
        passportIssue = `Passport expires on ${formatDate(passExp)}, which is earlier than requested pass expiry (${formatDate(empReqExpiry)}).`;
      }

      let visaIssue = '';
      if (!visaExp) {
        visaIssue = 'Visa / QID Expiry Date is missing in personnel record.';
      } else if (visaExp < empReqStart) {
        visaIssue = `Visa / QID is already expired (${formatDate(visaExp)}).`;
      } else if (empReqExpiry && visaExp < empReqExpiry) {
        visaIssue = `Visa / QID expires on ${formatDate(visaExp)}, which is earlier than requested pass expiry (${formatDate(empReqExpiry)}).`;
      }

      if (passportIssue || visaIssue) {
        issues.push({
          empId: emp.id,
          employee: emp,
          employeeName: emp.name || `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || empId,
          requestedExpiry: empReqExpiry,
          passportNumber: passNum,
          passportExpiry: passExp || '',
          visaNumber: visaNum,
          visaExpiry: visaExp || '',
          passportIssue,
          visaIssue
        });
      }
    }

    return issues;
  };

  const executeSubmission = async () => {
    try {
      const selectedLocIds = Object.keys(data.selections);
      const targetAppId = initialData?.applicationId || (initialData?.id && initialData?.status && ['approved', 'accepted', 'processing', 'under_processing', 'issued'].includes(initialData.status) ? initialData.id : undefined);

      if (targetAppId) {
        const selectedLocs = Object.keys(data.selections);
        const passItemsToIssue: any[] = [];

        selectedLocs.forEach(locId => {
          const sel = data.selections[locId];
          data.employeeIds.forEach(empId => {
            const activeMain = findActiveMainPass(empId, locId, data.categoryId);
            const passPayload = {
              employeeId: empId,
              requestId: targetAppId,
              locationId: locId,
              accessCodes: sel.accessCodes,
              type: data.type,
              parentPassId: data.type === 'supplementary' ? (data.parentPassId || activeMain?.id || initialData.parentPassId || sourceApp?.parentPassId || undefined) : undefined,
              status: 'issued',
              startDate: data.individualStartDates[empId] || data.startDate || new Date().toISOString().split('T')[0],
              expiryDate: data.individualExpiries[empId] || sel.expiryDate || data.expiryDate,
              authorityAppNumber: data.authorityAppNumber || sourceApp?.authorityAppNumber || initialData.authorityAppNumber,
              remarks: data.remarks,
              projectId: data.projectId || null,
              contractNumber: data.contractNumber || null,
              contractName: data.contractName || null,
              clientCompany: data.clientCompany || null,
              clientApprovers: data.clientApprovers || null
            };
            passItemsToIssue.push(passPayload);
          });
        });

        // Run pass creation with concurrency limit of 2 to avoid exhausting Oracle connection pool
        for (let i = 0; i < passItemsToIssue.length; i += 2) {
          const batch = passItemsToIssue.slice(i, i + 2);
          await Promise.all(batch.map(payload => apiFetch('/api/passes', {
            method: 'POST',
            body: JSON.stringify(payload)
          })));
        }

        const empStatuses = { ...(sourceApp?.employeeStatuses || initialData.employeeStatuses || {}) };
        data.employeeIds.forEach(id => {
          empStatuses[id] = 'issued';
        });

        const allAppEmpIds = sourceApp?.employeeIds || initialData.employeeIds || data.employeeIds;
        const nonTerm = allAppEmpIds.filter((id: string) => !['rejected', 'cancelled'].includes(empStatuses[id]));
        const allIssuedOrCollected = nonTerm.length > 0 && nonTerm.every((id: string) => ['issued', 'ready_for_collection', 'collected', 'completed', 'active'].includes(empStatuses[id]));
        const newAppStatus = allIssuedOrCollected ? 'issued' : 'partially_issued';

        await apiFetch(`/api/passApplications/${targetAppId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: newAppStatus,
            employeeStatuses: empStatuses
          })
        });

        logAction({
          type: 'pass_issued',
          title: 'Passes Issued (Pass Issuance & Collection)',
          details: `Issued ${data.employeeIds.length} passes for Application ${targetAppId?.toUpperCase() || 'UNKNOWN'} — Stage 4: Pass Issuance & Collection`
        });

        showToast('Passes issued successfully! Ready for counter collection.', 'success');
      } else if (data.isDirect) {
        const selectedLocs = Object.keys(data.selections);
        const directPassItems: any[] = [];

        selectedLocs.forEach(locId => {
          const sel = data.selections[locId];
          data.employeeIds.forEach(empId => {
            const activeMain = findActiveMainPass(empId, locId, data.categoryId);
            const passPayload = {
              employeeId: empId,
              locationId: locId,
              accessCodes: sel.accessCodes,
              type: data.type,
              parentPassId: data.type === 'supplementary' ? activeMain?.id : undefined,
              status: 'active',
              startDate: data.individualStartDates[empId] || data.startDate || new Date().toISOString().split('T')[0],
              expiryDate: data.individualExpiries[empId] || sel.expiryDate || data.expiryDate,
              authorityAppNumber: data.authorityAppNumber,
              remarks: data.remarks,
              projectId: data.projectId || null,
              contractNumber: data.contractNumber || null,
              contractName: data.contractName || null,
              clientCompany: data.clientCompany || null,
              clientApprovers: data.clientApprovers || null
            };
            directPassItems.push(passPayload);
          });
        });

        // Run pass creation with concurrency limit of 2
        for (let i = 0; i < directPassItems.length; i += 2) {
          const batch = directPassItems.slice(i, i + 2);
          await Promise.all(batch.map(payload => apiFetch('/api/passes', {
            method: 'POST',
            body: JSON.stringify(payload)
          })));
        }

        logAction({
          type: 'pass_issued',
          title: 'Direct Pass Issued',
          details: `Direct entry created for ${data.employeeIds.length} personnel`
        });

        showToast('Direct passes created successfully!', 'success');
      } else {
        const empStatuses: Record<string, string> = {};
        data.employeeIds.forEach(id => {
          empStatuses[id] = 'pending';
        });

        const appPayload = {
          requesterId: currentUser?.id || 'system',
          applicantId: currentUser?.id || 'system',
          employeeIds: data.employeeIds,
          locationId: selectedLocIds[0] || data.locationId,
          categoryId: data.categoryId,
          type: data.type,
          parentPassId: data.type === 'supplementary' ? findActiveMainPass(data.employeeIds[0], selectedLocIds[0] || data.locationId, data.categoryId)?.id : undefined,
          accessCodes: data.selections[selectedLocIds[0]]?.accessCodes || data.accessCodes,
          status: 'pending',
          authorityAppNumber: data.authorityAppNumber,
          remarks: data.remarks,
          startDate: data.startDate,
          endDate: data.expiryDate || data.selections[selectedLocIds[0]]?.expiryDate || (Object.values(data.individualExpiries).filter(Boolean).sort().reverse()[0] as string) || data.startDate,
          individualExpiries: data.individualExpiries,
          individualStartDates: data.individualStartDates,
          employeeStatuses: empStatuses,
          projectId: data.projectId || null,
          contractNumber: data.contractNumber || null,
          contractName: data.contractName || null,
          clientCompany: data.clientCompany || null,
          clientApprovers: data.clientApprovers || null
        };

        const res = await apiFetch('/api/passApplications', {
          method: 'POST',
          body: JSON.stringify(appPayload)
        });

        const newApp = await res.json();

        logAction({
          type: 'pass_issued',
          title: 'Application Created',
          details: `Created new application ${newApp.id?.toUpperCase() || ''} for ${data.employeeIds.length} personnel`
        });

        showToast('Pass application submitted successfully!', 'success');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error submitting form:', err);
      const isNet = err?.message?.includes('network') || err?.message?.includes('fetch') || err?.message?.includes('connection') || err?.message?.includes('Failed to fetch');
      setErrorGuidance({
        title: isNet ? 'Network Communication Issue' : 'Submission Processing Error',
        category: 'server',
        problem: err.message || 'The server encountered an issue while finalizing your application.',
        explanation: isNet
          ? 'The database request timed out or a momentary network disconnect occurred. All your entered form details, personnel selections, and validity settings are completely preserved.'
          : 'The server could not finalize the request. Your inputs are still intact in the form.',
        suggestedAction: 'Click "Retry Submission" below to submit your application again.',
        actionButton: {
          label: 'Retry Submission',
          onClick: () => {
            setErrorGuidance(null);
            executeSubmission();
          }
        }
      });
    }
  };

  const handleSaveValidityUpdatesAndSubmit = async () => {
    if (!validityIssues || validityIssues.length === 0) return;
    setIsSavingDocUpdates(true);

    try {
      const newOverrides: Record<string, Partial<Employee>> = {};
      for (const issue of validityIssues) {
        const current: Employee = { ...issue.employee, ...(docOverrides[issue.empId] || {}) };
        // Only send what actually changed. Visa/QID edits go to the QID/Visa fields the
        // validation reads (qidVisa*), never overwriting the separate visaNumber/qatarId fields.
        const payload: Record<string, any> = {};
        if ((issue.passportNumber || '') !== (current.passportNumber || '')) payload.passportNumber = issue.passportNumber || null;
        if ((parseToYMD(issue.passportExpiry) || '') !== (parseToYMD(current.passportExpiry) || '')) payload.passportExpiry = parseToYMD(issue.passportExpiry) || null;
        if ((issue.visaNumber || '') !== (current.qidVisaNumber || current.visaNumber || '')) payload.qidVisaNumber = issue.visaNumber || null;
        if ((parseToYMD(issue.visaExpiry) || '') !== (parseToYMD(current.qidVisaExpiry || current.visaExpiry) || '')) payload.qidVisaExpiry = parseToYMD(issue.visaExpiry) || null;

        if (Object.keys(payload).length === 0) continue;

        await apiFetch(`/api/employees/${issue.empId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        newOverrides[issue.empId] = { ...(docOverrides[issue.empId] || {}), ...payload };
      }

      // checkDocumentValidity reads docOverrides from state, so recompute with the merged
      // overrides explicitly rather than waiting for the state update.
      const mergedOverrides = { ...docOverrides, ...newOverrides };
      setDocOverrides(mergedOverrides);
      if (Object.keys(newOverrides).length > 0) {
        showToast('Updated personnel document validity details', 'success');
      }

      const selectedLocIds = Object.keys(data.selections);
      const targetLocId = selectedLocIds[0] || data.locationId;
      const scopeIds = validityMode === 'fix' ? validityIssues.map(i => i.empId) : data.employeeIds;
      const remainingIssues = checkDocumentValidityWith(scopeIds, targetLocId, mergedOverrides);

      if (remainingIssues.length > 0) {
        setValidityIssues(remainingIssues);
        showToast('Some document validity dates still expire before requested pass expiry. Please update them or adjust pass dates.', 'error');
        setIsSavingDocUpdates(false);
        return;
      }

      setIsValidityModalOpen(false);
      setValidityIssues(null);
      setIsSavingDocUpdates(false);

      // From a personnel card: just fix the record and return to the form.
      if (validityMode === 'fix') return;

      await executeSubmission();
    } catch (err: any) {
      console.error("Failed to update employee details:", err);
      showToast(err.message || 'Failed to update personnel document details', 'error');
      setIsSavingDocUpdates(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const selectedLocIds = Object.keys(data.selections);
    const targetLocId = selectedLocIds[0] || data.locationId;
    if (selectedLocIds.length === 0 && !data.locationId) {
      setErrorGuidance({
        title: 'Location & Access Code Required',
        category: 'validation',
        problem: 'No access locations or gate codes were selected for this pass application.',
        explanation: 'Security pass applications require at least one target location and defined access codes before processing.',
        suggestedAction: 'Click below to return to Step 1 and select the required access zones.',
        actionButton: {
          label: 'Go to Step 1 (Select Locations)',
          onClick: () => {
            setStep(1);
            setErrorGuidance(null);
          }
        }
      });
      return;
    }

    if (data.employeeIds.length === 0) {
      setErrorGuidance({
        title: 'No Personnel Selected',
        category: 'validation',
        problem: 'You haven\'t selected any personnel records for this application.',
        explanation: 'A pass application must be associated with at least one employee or contractor.',
        suggestedAction: 'Click below to return to Step 2 to select personnel or upload an Excel file.',
        actionButton: {
          label: 'Go to Step 2 (Select Personnel)',
          onClick: () => {
            setStep(2);
            setErrorGuidance(null);
          }
        }
      });
      return;
    }

    // Validation: Block inactive employees
    for (const empId of data.employeeIds) {
      const emp = allEmployees.find(e => e.id === empId);
      if (emp && emp.status === 'inactive') {
        setErrorGuidance({
          title: 'Inactive Employee Restriction',
          category: 'policy',
          problem: `Personnel "${emp.name}" is marked as Inactive in the company directory.`,
          explanation: 'Pass applications cannot be submitted for personnel who are inactive or have left the company.',
          suggestedAction: 'Please remove inactive personnel from the selection before submitting.',
          actionButton: {
            label: 'Remove Inactive Personnel & Retry',
            onClick: () => {
              setData(prev => ({
                ...prev,
                employeeIds: prev.employeeIds.filter(id => id !== empId)
              }));
              setErrorGuidance(null);
            }
          }
        });
        return;
      }
    }

    // Validation: Require individual Expiry Date for each pass applicant
    for (const empId of data.employeeIds) {
      const empName = allEmployees.find(e => e.id === empId)?.name || empId;
      const empExpiry = data.individualExpiries[empId];
      if (!empExpiry) {
        setErrorGuidance({
          title: 'Applicant Expiry Date Required',
          category: 'validation',
          problem: `No expiry date was specified for applicant "${empName}".`,
          explanation: 'Each pass applicant must have an individual expiry date specified before submitting the application.',
          suggestedAction: 'Please set an Expiry Date for all selected personnel in Step 2.',
          actionButton: {
            label: 'Go to Step 2 (Personnel Selection)',
            onClick: () => {
              setStep(2);
              setErrorGuidance(null);
            }
          }
        });
        return;
      }
    }

    // Validation: Check Main vs Supplementary rules per personnel
    const isIssuingPassesForApp = !!(
      initialData?.applicationId || 
      (initialData?.id && initialData?.status && ['approved', 'accepted', 'processing', 'under_processing', 'issued'].includes(initialData.status))
    );

    // Only enforce initial submission policy conflicts when submitting a new pass application.
    // When issuing passes for an already-approved application, that application has already been authorized.
    if (!isIssuingPassesForApp) {
      for (const empId of data.employeeIds) {
        const empName = employees.find(e => e.id === empId)?.name || empId;
        const activeMainPass = findActiveMainPass(empId, targetLocId, data.categoryId);
        const activeMainApp = findActiveMainApp(empId, targetLocId, data.categoryId);

        if (data.type === 'main') {
          if (activeMainPass) {
            setErrorGuidance({
              title: 'Main Pass Policy Restriction',
              category: 'policy',
              problem: `Personnel "${empName}" already holds an active Main Pass (${activeMainPass.passNumber || activeMainPass.id}).`,
              explanation: 'Security policy permits only 1 active Main Pass per zone/category per person. Early renewal is permitted within 45 days prior to pass expiry. Otherwise, subsequent passes must be requested as Supplementary Passes.',
              suggestedAction: 'Click below to convert this application to a Supplementary Pass automatically.',
              actionButton: {
                label: 'Switch to Supplementary Pass & Retry',
                onClick: () => {
                  setData(prev => ({ ...prev, type: 'supplementary' }));
                  setErrorGuidance(null);
                  showToast('Switched application type to Supplementary Pass', 'success');
                }
              }
            });
            return;
          }
          if (activeMainApp) {
            setErrorGuidance({
              title: 'Active Application Conflict',
              category: 'policy',
              problem: `Personnel "${empName}" already has an active pending Main Pass application (Ref: ${activeMainApp.authorityAppNumber || activeMainApp.id}).`,
              explanation: 'Duplicate Main Pass requests for the same zone cannot be processed simultaneously.',
              suggestedAction: 'Click below to switch this application to a Supplementary Pass.',
              actionButton: {
                label: 'Switch to Supplementary Pass & Retry',
                onClick: () => {
                  setData(prev => ({ ...prev, type: 'supplementary' }));
                  setErrorGuidance(null);
                  showToast('Switched application type to Supplementary Pass', 'success');
                }
              }
            });
            return;
          }
        }

        if (data.type === 'supplementary') {
          const hasLinkedParent = !!(data.parentPassId || initialData?.parentPassId || sourceApp?.parentPassId);
          if (!activeMainPass && !activeMainApp && !hasLinkedParent) {
            setErrorGuidance({
              title: 'Main Pass Required for Supplementary Pass',
              category: 'policy',
              problem: `Personnel "${empName}" does not hold an active Main Pass in this location/category.`,
              explanation: 'Supplementary Passes can only be granted to individuals who already hold a valid, active Main Pass for the requested zone.',
              suggestedAction: 'Click below to convert this application to a Main Pass automatically.',
              actionButton: {
                label: 'Switch to Main Pass & Retry',
                onClick: () => {
                  setData(prev => ({ ...prev, type: 'main' }));
                  setErrorGuidance(null);
                  showToast('Switched application type to Main Pass', 'success');
                }
              }
            });
            return;
          }

          // Check if there is already an active pending supplementary application for this same employee & location
          // Explicitly exclude the current application being processed/issued/edited!
          const duplicateSuppApp = applications.find(a => {
            if (isCurrentApp(a)) return false;
            if (a.type !== 'supplementary') return false;
            if (a.locationId !== targetLocId) return false;
            if (!a.employeeIds?.includes(empId)) return false;
            return isApplicationLineInPipeline(a.status, a.employeeStatuses?.[empId]);
          });

          if (duplicateSuppApp) {
            setErrorGuidance({
              title: 'Duplicate Supplementary Application Exists',
              category: 'policy',
              problem: `Personnel "${empName}" already has a pending Supplementary Pass application for this location (Ref: ${duplicateSuppApp.authorityAppNumber || duplicateSuppApp.id}).`,
              explanation: 'Duplicate pass applications for the same personnel and location cannot be submitted while one is already in progress.',
              suggestedAction: 'Please wait for the existing application to complete or remove this personnel from the current submission.',
              actionButton: {
                label: 'Review Existing Applications',
                onClick: () => {
                  setErrorGuidance(null);
                  onClose();
                }
              }
            });
            return;
          }
        }
      }
    }

    // Validation: Document Expiry Check (Passport & Visa/QID)
    const docIssues = checkDocumentValidity(data.employeeIds, targetLocId);
    if (docIssues.length > 0) {
      setValidityMode('submit');
      setValidityIssues(docIssues);
      setIsValidityModalOpen(true);
      return;
    }

    await executeSubmission();
  };

  return (
    <div className="space-y-4 w-full max-w-none px-1 py-1">
      {/* Header Stepper */}
      <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-4">
        <div className="flex items-center gap-6">
          <div className={cn(
            "flex items-center gap-2 font-bold text-xs",
            step === 1 ? "text-[#800020]" : "text-[#6B7280]"
          )}>
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-[10px]",
              step === 1 ? "bg-[#800020] text-white" : "bg-gray-100 text-[#6B7280]"
            )}>1</div>
            1. Access & Location
          </div>
          <ArrowRight size={14} className="text-gray-300" />
          <div className={cn(
            "flex items-center gap-2 font-bold text-xs",
            step === 2 ? "text-[#800020]" : "text-[#6B7280]"
          )}>
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-[10px]",
              step === 2 ? "bg-[#800020] text-white" : "bg-gray-100 text-[#6B7280]"
            )}>2</div>
            2. Personnel & Details
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Pass Type:</span>
          <select 
            value={data.type}
            onChange={(e) => setData({ ...data, type: e.target.value as PassType })}
            className="px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-[#1E293B] outline-none"
          >
            <option value="main">Main Pass</option>
            <option value="supplementary">Supplementary Pass</option>
          </select>
        </div>
      </div>

      {step === 1 ? (
        <div className="space-y-6">
          {/* Contract / Project Details Section */}
          <div className="bg-gray-50/80 p-4 rounded-2xl border border-gray-200/80 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-gray-200/60">
              <h4 className="text-xs font-bold text-[#111827] uppercase tracking-wider flex items-center gap-1.5">
                <FileText size={14} className="text-[#800020]" />
                Contract Details
              </h4>
              <span className="text-[10px] text-gray-500 italic">Inherited per pass</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Select Contract Dropdown */}
              <div>
                <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block mb-1">
                  Select Contract
                </label>
                <select
                  value={
                    data.projectId 
                      ? data.projectId 
                      : (projects.find(p => {
                          const cNum = p.contractNumber || (p as any).contractnumber;
                          return (cNum && cNum === data.contractNumber) || p.name === data.contractName;
                        })?.id || (data.contractNumber || data.contractName ? 'custom' : ''))
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) {
                      setData(prev => ({
                        ...prev,
                        projectId: '',
                        contractNumber: '',
                        contractName: '',
                        clientCompany: '',
                        clientApprovers: ''
                      }));
                    } else if (val === 'custom') {
                      setData(prev => ({
                        ...prev,
                        projectId: '',
                        contractNumber: prev.contractNumber || '',
                        contractName: prev.contractName || ''
                      }));
                    } else {
                      const proj = projects.find(p => p.id === val);
                      if (proj) {
                        const cNum = proj.contractNumber || (proj as any).contractnumber || proj.name || '';
                        const cComp = proj.clientCompany || (proj as any).clientcompany || '';
                        const cAppr = proj.clientApprovers || (proj as any).clientapprovers || '';
                        setData(prev => ({
                          ...prev,
                          projectId: proj.id,
                          contractNumber: cNum,
                          contractName: proj.name || '',
                          clientCompany: cComp,
                          clientApprovers: cAppr
                        }));
                      }
                    }
                  }}
                  className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-semibold focus:border-[#800020] outline-none cursor-pointer"
                >
                  <option value="">-- Select Contract --</option>
                  {projects.map(p => {
                    const cNum = p.contractNumber || (p as any).contractnumber;
                    return (
                      <option key={p.id} value={p.id}>
                        {cNum ? `${cNum} - ${p.name}` : p.name}
                      </option>
                    );
                  })}
                  <option value="custom">Other / Custom Contract Number</option>
                </select>
              </div>

              {/* Contract Number */}
              <div>
                <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block mb-1">
                  Contract Number
                </label>
                <input 
                  type="text"
                  value={data.contractNumber || ''}
                  onChange={(e) => setData({ ...data, contractNumber: e.target.value })}
                  placeholder="e.g. CNT-2026-001 or Not Defined"
                  className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-semibold focus:border-[#800020] outline-none"
                />
              </div>

              {/* Auto populate Contract Name */}
              <div>
                <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block mb-1">
                  Contract / Project Name
                </label>
                <input 
                  type="text"
                  value={data.contractName || ''}
                  onChange={(e) => setData({ ...data, contractName: e.target.value })}
                  placeholder="Contract or project name..."
                  className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-semibold focus:border-[#800020] outline-none"
                />
              </div>

              {/* Client Company auto populate */}
              <div>
                <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block mb-1">
                  Client Company
                </label>
                <input 
                  type="text"
                  value={data.clientCompany || ''}
                  onChange={(e) => setData({ ...data, clientCompany: e.target.value })}
                  placeholder="Client company name..."
                  className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-semibold focus:border-[#800020] outline-none"
                />
              </div>

              {/* Client Approver List (Multi-line Text) */}
              <div className="col-span-1 sm:col-span-2 lg:col-span-4">
                <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block mb-1">
                  Client Approver List
                </label>
                <textarea 
                  rows={2}
                  value={data.clientApprovers || ''}
                  onChange={(e) => setData({ ...data, clientApprovers: e.target.value })}
                  placeholder="List of client approver names and roles (e.g., John Doe - Lead Inspector)..."
                  className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-semibold focus:border-[#800020] outline-none custom-scrollbar"
                />
              </div>
            </div>
          </div>

          <FormAccessMatrix 
            categories={categories}
            locations={locations}
            accessCodes={accessCodes}
            selections={data.selections}
            selectionOrder={data.selectionOrder}
            onToggle={handleToggleAccess}
            onSetExpiry={handleSetLocationExpiry}
          />
        </div>
      ) : (
        <div className="space-y-6">

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-gray-50/80 p-3.5 rounded-xl border border-gray-100">
            <div>
              <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block mb-1">
                Authority Application / Pass Number
              </label>
              <input 
                type="text"
                value={data.authorityAppNumber || ''}
                onChange={(e) => setData({ ...data, authorityAppNumber: e.target.value })}
                placeholder="e.g. MOI-PASS-8891"
                className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-semibold focus:border-[#800020] outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block mb-1">
                Remarks / Notes
              </label>
              <input 
                type="text"
                value={data.remarks || ''}
                onChange={(e) => setData({ ...data, remarks: e.target.value })}
                placeholder="Optional submission details..."
                className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-semibold focus:border-[#800020] outline-none"
              />
            </div>

            {/* Auto-derived Parent Pass Info for Supplementary Pass */}
            {data.type === 'supplementary' && (
              <div className="col-span-1 md:col-span-2 bg-amber-50/70 border border-amber-200 p-2.5 rounded-xl space-y-0.5 text-xs">
                <p className="font-bold text-amber-900 flex items-center gap-1.5 text-[11px]">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                  Automatic Parent Main Pass Linkage
                </p>
                <p className="text-[11px] text-amber-800">
                  Supplementary passes are automatically linked to each personnel's active Main Pass in this location/category. Personnel must already hold an active Main Pass to receive a Supplementary Pass.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-[#1E293B]">Selected Personnel ({data.employeeIds.length})</h4>
              <p className="text-xs text-[#6B7280]">Select personnel from the directory or import from Excel</p>
            </div>
            <div className="flex gap-2">
              <label className="px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-bold text-[#1E293B] hover:bg-gray-50 cursor-pointer flex items-center gap-1.5 shadow-sm">
                <Upload size={14} className="text-[#800020]" />
                Import Excel List
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelImport} className="hidden" />
              </label>
            </div>
          </div>

          {isImporting && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl space-y-3">
              {importStep === 'mapping' && (
                <div className="space-y-3">
                  <p className="text-xs font-bold text-blue-900">Map Columns from Excel File</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {Object.keys(mapping).map(k => (
                      <div key={k} className="text-xs">
                        <span className="font-semibold capitalize text-gray-700">{k}: </span>
                        <select 
                          value={mapping[k] || ''} 
                          onChange={(e) => setMapping({ ...mapping, [k]: e.target.value })}
                          className="w-full mt-1 bg-white border border-gray-200 rounded p-1 text-[11px]"
                        >
                          <option value="">-- Ignore --</option>
                          {rawHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button onClick={() => setIsImporting(false)} className="px-3 py-1 text-xs text-gray-600">Cancel</button>
                    <button onClick={proceedToReview} className="px-4 py-1.5 bg-[#800020] text-white rounded-lg text-xs font-bold">Review Mapping</button>
                  </div>
                </div>
              )}

              {importStep === 'review' && importResults && (
                <BulkImportReview 
                  data={reviewData}
                  columns={reviewColumns}
                  title="Import Personnel Review"
                  description="Review matched and unmatched personnel records before importing"
                  matchedCount={importResults.matched?.length || 0}
                  unmatchedCount={importResults.unmatched?.length || 0}
                  onApply={applyImport}
                  onCancel={() => setIsImporting(false)}
                />
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left: Personnel Search & Directory Picker */}
            <div className="border border-gray-200 rounded-2xl p-3.5 space-y-2.5 bg-white">
              <SearchInput 
                value={searchTerm}
                onChange={setSearchTerm}
                placeholder="Search by name, ID, or QID..."
              />
              <div className="max-h-[380px] overflow-y-auto divide-y divide-gray-100 pr-1 custom-scrollbar">
                {filteredEmployees.map(emp => {
                  const isSelected = data.employeeIds.includes(emp.id);
                  return (
                    <div key={emp.id} className="py-2 flex items-center justify-between hover:bg-gray-50 px-2 rounded-xl transition-all">
                      <div>
                        <p className="text-xs font-bold text-[#1E293B]">{emp.name}</p>
                        <p className="text-[10px] text-[#6B7280]">{emp.jobTitle} • {emp.employeeId || emp.qatarId || 'No ID'}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setData(prev => {
                            const newSelected = isSelected
                              ? prev.employeeIds.filter(id => id !== emp.id)
                              : [...prev.employeeIds, emp.id];
                            
                            // Determine default expiry date from site selections if available
                            const firstLocSelection = Object.values(prev.selections)[0] as { accessCodes: string[]; expiryDate: string } | undefined;
                            const defaultLocationExpiry = firstLocSelection?.expiryDate;
                            const targetLocId = Object.keys(prev.selections)[0] || prev.locationId;
                            
                            const parentMainPass = findParentMainPassForSupplementary(emp.id, targetLocId, prev.categoryId);
                            const expiringMainPass = findExpiringRenewalMainPass(emp.id, targetLocId, prev.categoryId);

                            let fallbackStart = (initialData as any)?.individualStartDates?.[emp.id] || (sourceApp as any)?.individualStartDates?.[emp.id] || prev.startDate || parseToYMD(new Date().toISOString());
                            let fallbackExpiry = (initialData as any)?.individualExpiries?.[emp.id] || (sourceApp as any)?.individualExpiries?.[emp.id] || prev.expiryDate || defaultLocationExpiry || calcOneYearLater(fallbackStart);

                            if (prev.type === 'main' && expiringMainPass?.expiryDate) {
                              fallbackStart = calcNextDay(expiringMainPass.expiryDate);
                              fallbackExpiry = calcOneYearLater(fallbackStart);
                            } else if (prev.type === 'supplementary' && parentMainPass?.expiryDate) {
                              fallbackExpiry = parseToYMD(parentMainPass.expiryDate) || fallbackExpiry;
                            }

                            return {
                              ...prev,
                              employeeIds: newSelected,
                              individualStartDates: !isSelected ? {
                                ...prev.individualStartDates,
                                [emp.id]: prev.individualStartDates[emp.id] || fallbackStart
                              } : prev.individualStartDates,
                              individualExpiries: !isSelected ? {
                                ...prev.individualExpiries,
                                [emp.id]: prev.individualExpiries[emp.id] || fallbackExpiry
                              } : prev.individualExpiries
                            };
                          });
                        }}
                        className={cn(
                          "px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase transition-all",
                          isSelected ? "bg-rose-50 text-rose-700 hover:bg-rose-100" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        )}
                      >
                        {isSelected ? 'Remove' : 'Select'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Selected Members & Individual Dates */}
            <div className="border border-gray-200 rounded-2xl p-3.5 space-y-2.5 bg-gray-50">
              <div className="flex items-center justify-between">
                <h5 className="text-xs font-bold text-[#1E293B] uppercase tracking-wider">
                  Selected Personnel ({data.employeeIds.length})
                </h5>
                {data.employeeIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const todayStr = parseToYMD(new Date().toISOString());
                      const oneYearLaterStr = calcOneYearLater(todayStr);
                      setData(prev => {
                        const newExps: Record<string, string> = {};
                        const newStarts: Record<string, string> = {};
                        prev.employeeIds.forEach(id => {
                          const s = prev.individualStartDates[id] || todayStr;
                          newStarts[id] = s;
                          newExps[id] = calcOneYearLater(s) || oneYearLaterStr;
                        });
                        return { ...prev, individualStartDates: newStarts, individualExpiries: newExps };
                      });
                      showToast('Applied 1-Year validity (Pass Valid From → Pass Valid To) to all personnel', 'success');
                    }}
                    className="text-[10px] font-bold text-[#800020] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Calendar size={12} /> Set 1-Year Default for All
                  </button>
                )}
              </div>
              <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {data.employeeIds.map(empId => {
                  const emp = allEmployees.find(e => e.id === empId);
                  const selectedLocIds = Object.keys(data.selections);
                  const targetLocId = selectedLocIds[0] || data.locationId;
                  const activeMainPass = findActiveMainPass(empId, targetLocId, data.categoryId);
                  const activeMainApp = findActiveMainApp(empId, targetLocId, data.categoryId);
                  const parentMainPass = findParentMainPassForSupplementary(empId, targetLocId, data.categoryId);
                  const expiringMainPass = findExpiringRenewalMainPass(empId, targetLocId, data.categoryId);

                  return (
                    <div key={empId} className="bg-white p-3 rounded-xl border border-gray-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-bold text-[#1E293B]">{emp?.name || empId}</p>
                          <p className="text-[10px] text-gray-500">{emp?.qatarId || emp?.employeeId || emp?.jobTitle}</p>
                        </div>
                        <button 
                          onClick={() => setData(prev => ({ ...prev, employeeIds: prev.employeeIds.filter(id => id !== empId) }))}
                          className="text-gray-400 hover:text-rose-600"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      {/* Main Pass / Active Application Status Badge */}
                      {data.type === 'main' ? (
                        expiringMainPass ? (
                          <div className="text-[10px] font-bold text-blue-900 bg-blue-50 border border-blue-200 px-2 py-1 rounded-lg space-y-0.5">
                            <div>🔄 Early Renewal Window (Expires {formatDate(expiringMainPass.expiryDate)})</div>
                            <div className="text-[9px] text-blue-700 font-medium">New pass scheduled to activate {formatDate(calcNextDay(expiringMainPass.expiryDate))}</div>
                          </div>
                        ) : activeMainPass ? (
                          <div className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                            ⚠️ Already holds Main Pass ({activeMainPass.passNumber || activeMainPass.id}) - Switch to Supplementary
                          </div>
                        ) : activeMainApp ? (
                          <div className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                            ⚠️ Has Active App ({activeMainApp.authorityAppNumber || activeMainApp.id}) - Switch to Supplementary
                          </div>
                        ) : (
                          <div className="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg inline-block">
                            ✓ Eligible for Main Pass
                          </div>
                        )
                      ) : (
                        parentMainPass ? (
                          <div className="text-[10px] font-bold text-emerald-900 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg space-y-0.5">
                            <div>✓ Linked to Parent Main Pass ({parentMainPass.passNumber || parentMainPass.id})</div>
                            <div className="text-[9px] text-emerald-700 font-medium">
                              Parent pass valid until {formatDate(parentMainPass.expiryDate)} (Supplementary validity can be set to any shorter duration)
                            </div>
                          </div>
                        ) : activeMainApp ? (
                          <div className="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg">
                            ✓ Auto-linked to Active App ({activeMainApp.authorityAppNumber || activeMainApp.id})
                          </div>
                        ) : (
                          <div className="text-[10px] font-bold text-rose-800 bg-rose-50 border border-rose-200 px-2 py-1 rounded-lg">
                            ❌ No active Main Pass found in this category
                          </div>
                        )
                      )}
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <div>
                          <label className="text-gray-500 font-semibold block mb-0.5">Pass Valid From</label>
                          <input 
                            type="date"
                            value={parseToYMD(data.individualStartDates[empId]) || ''}
                            onChange={(e) => setData(prev => ({
                              ...prev,
                              individualStartDates: { ...prev.individualStartDates, [empId]: e.target.value }
                            }))}
                            className="w-full bg-gray-50 border border-gray-200 rounded px-1.5 py-1 font-semibold"
                          />
                        </div>
                        <div>
                          <label className="text-gray-500 font-semibold block mb-0.5">Pass Valid To</label>
                          <input 
                            type="date"
                            value={parseToYMD(data.individualExpiries[empId]) || ''}
                            onChange={(e) => setData(prev => ({
                              ...prev,
                              individualExpiries: { ...prev.individualExpiries, [empId]: e.target.value }
                            }))}
                            className="w-full bg-gray-50 border border-gray-200 rounded px-1.5 py-1 font-semibold"
                          />
                        </div>
                      </div>

                      {/* Live Document Expiry Status Callout */}
                      {(() => {
                        // Same rule as the submit-time check, so the card warning and the Fix modal always agree.
                        const targetLocId = Object.keys(data.selections)[0] || data.locationId;
                        const cardIssues = checkDocumentValidity([empId], targetLocId);
                        const cardIssue = cardIssues[0];
                        const msg = cardIssue ? (cardIssue.passportIssue || cardIssue.visaIssue || '') : '';

                        if (msg) {
                          return (
                            <div className="mt-1 text-[10px] text-rose-800 bg-rose-50 border border-rose-200 px-2 py-1 rounded-lg flex items-center justify-between">
                              <span className="truncate pr-1" title={[cardIssue?.passportIssue, cardIssue?.visaIssue].filter(Boolean).join(' ')}>⚠️ {msg}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setValidityMode('fix');
                                  setValidityIssues(cardIssues);
                                  setIsValidityModalOpen(true);
                                }}
                                className="font-bold text-rose-900 underline hover:text-black ml-1 flex-shrink-0"
                              >
                                Fix
                              </button>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  );
                })}
                {data.employeeIds.length === 0 && (
                  <div className="py-12 text-center text-gray-400 text-xs italic">
                    No personnel selected yet. Choose from left pane or import Excel.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Locations Summary */}
          {Object.keys(data.selections).length > 0 && (
            <div className="p-3 bg-gray-50/80 rounded-xl border border-gray-100 space-y-1.5">
              <p className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Configured Access Sites:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {Object.keys(data.selections).map(locId => {
                  const loc = locations.find(l => l.id === locId);
                  const selection = data.selections[locId];
                  if (!selection?.accessCodes.length) return null;
                  return (
                    <div key={locId} className="p-2.5 bg-white border border-gray-200 rounded-xl flex items-center justify-between shadow-2xs">
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-[#1E293B] truncate">{loc?.name}</p>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {selection.accessCodes.map(ac => (
                            <span key={ac} className="text-[8px] font-black bg-gray-100 text-gray-600 px-1 py-0.5 rounded uppercase">{ac}</span>
                          ))}
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          setData(prev => {
                            const newSelections = { ...prev.selections };
                            delete newSelections[locId];
                            return { ...prev, selections: newSelections };
                          });
                        }}
                        className="text-gray-400 hover:text-[#800020] p-1 shrink-0 ml-1"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3 pt-4 border-t border-[#F3F4F6]">
        {step > 1 && (
          <motion.button 
            whileTap={{ scale: 0.98 }}
            onClick={() => setStep(step - 1)}
            className="flex-1 py-2.5 bg-[#F3F4F6] text-[#4B5563] rounded-xl font-semibold hover:bg-[#E5E7EB] transition-all text-xs"
          >
            Back
          </motion.button>
        )}
        {step < 2 ? (
          <motion.button 
            whileTap={{ scale: 0.98 }}
            disabled={step === 1 && Object.keys(data.selections).length === 0}
            onClick={() => setStep(step + 1)}
            className="flex-[2] py-2.5 bg-[#1A1A1A] text-white rounded-xl font-semibold hover:bg-black transition-all disabled:opacity-50 text-xs"
          >
            Continue to Personnel Selection
          </motion.button>
        ) : (
          <motion.button 
            whileTap={{ scale: 0.98 }}
            disabled={data.employeeIds.length === 0}
            onClick={handleSubmit}
            className="flex-[2] py-2.5 bg-[#800020] text-white rounded-xl font-semibold hover:bg-[#600018] transition-all shadow-sm disabled:opacity-50 text-xs"
          >
            {initialData?.applicationId ? 'Confirm Issuance' : (data.isDirect ? 'Issue Direct Passes' : 'Submit Application')}
          </motion.button>
        )}
      </div>

      {creatingEmployeeRow && (
        <Modal 
          isOpen={!!creatingEmployeeRow} 
          onClose={() => setCreatingEmployeeRow(null)}
          title="Add Member Directly to Directory"
          size="lg"
        >
          <EmployeeForm
            employee={creatingEmployeeRow.prefilled as Employee}
            employees={employees}
            divisions={divisions}
            departments={departments}
            projects={projects}
            onClose={() => setCreatingEmployeeRow(null)}
            onSuccess={handleCreatedEmployeeSuccess}
          />
        </Modal>
      )}

      {/* Document Validity Conflict Modal */}
      {isValidityModalOpen && validityIssues && (
        <Modal
          isOpen={isValidityModalOpen}
          onClose={() => setIsValidityModalOpen(false)}
          title="Personnel Document Expiry Restriction"
          size="lg"
        >
          <div className="space-y-4 text-xs font-sans">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-3 text-amber-900">
              <AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" size={18} />
              <div>
                <p className="font-bold text-xs">Pass Validity Conflict Detected</p>
                <p className="text-[11px] text-amber-800 mt-0.5">
                  The requested pass validity extends beyond the Passport or Visa/QID expiry date for the following personnel (or document expiry is missing). You can update their document details directly below and submit in one click.
                </p>
              </div>
            </div>

            <div className="max-h-[400px] overflow-y-auto space-y-3 pr-1 custom-scrollbar">
              {validityIssues.map((issue, idx) => (
                <div key={issue.empId} className="bg-white p-3.5 rounded-xl border border-gray-200 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                    <div>
                      <span className="font-bold text-sm text-[#1E293B]">{issue.employeeName}</span>
                      <span className="text-[11px] text-gray-500 ml-2">({issue.employee?.employeeId || issue.employee?.qatarId || 'No ID'})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-gray-500 uppercase">Pass Expiry:</span>
                      <input 
                        type="date"
                        value={parseToYMD(data.individualExpiries[issue.empId]) || parseToYMD(issue.requestedExpiry) || ''}
                        onChange={(e) => {
                          const newExp = e.target.value;
                          setData(prev => ({
                            ...prev,
                            individualExpiries: { ...prev.individualExpiries, [issue.empId]: newExp }
                          }));
                          setValidityIssues(prev => prev ? prev.map((item, i) => i === idx ? { ...item, requestedExpiry: newExp } : item) : null);
                        }}
                        className="bg-gray-50 border border-gray-300 rounded px-2 py-0.5 font-bold text-xs text-[#800020]"
                      />
                    </div>
                  </div>

                  {/* Passport & Visa Grids */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Passport Box */}
                    <div className={cn(
                      "p-2.5 rounded-lg border text-xs space-y-2",
                      issue.passportIssue ? "bg-rose-50/50 border-rose-200" : "bg-gray-50/50 border-gray-200"
                    )}>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-700 text-[11px] flex items-center gap-1">
                          <FileText size={12} className="text-gray-500" /> Passport Details
                        </span>
                        {issue.passportIssue && (
                          <span className="text-[10px] font-bold text-rose-600 bg-rose-100 px-1.5 py-0.5 rounded">Action Required</span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-gray-500 font-semibold block mb-0.5">Passport Number</label>
                          <input 
                            type="text"
                            value={issue.passportNumber}
                            onChange={(e) => {
                              const val = e.target.value;
                              setValidityIssues(prev => prev ? prev.map((item, i) => i === idx ? { ...item, passportNumber: val } : item) : null);
                            }}
                            placeholder="Passport No."
                            className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 font-semibold block mb-0.5">Passport Expiry Date</label>
                          <input 
                            type="date"
                            value={parseToYMD(issue.passportExpiry) || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setValidityIssues(prev => prev ? prev.map((item, i) => i === idx ? { ...item, passportExpiry: val } : item) : null);
                            }}
                            className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs font-semibold"
                          />
                        </div>
                      </div>

                      {issue.passportIssue && (
                        <p className="text-[10px] text-rose-700 font-medium">⚠️ {issue.passportIssue}</p>
                      )}
                    </div>

                    {/* Visa / QID Box */}
                    <div className={cn(
                      "p-2.5 rounded-lg border text-xs space-y-2",
                      issue.visaIssue ? "bg-rose-50/50 border-rose-200" : "bg-gray-50/50 border-gray-200"
                    )}>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-700 text-[11px] flex items-center gap-1">
                          <Shield size={12} className="text-gray-500" /> Visa / QID Details
                        </span>
                        {issue.visaIssue && (
                          <span className="text-[10px] font-bold text-rose-600 bg-rose-100 px-1.5 py-0.5 rounded">Action Required</span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-gray-500 font-semibold block mb-0.5">Visa / QID Number</label>
                          <input 
                            type="text"
                            value={issue.visaNumber}
                            onChange={(e) => {
                              const val = e.target.value;
                              setValidityIssues(prev => prev ? prev.map((item, i) => i === idx ? { ...item, visaNumber: val } : item) : null);
                            }}
                            placeholder="Visa / QID No."
                            className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 font-semibold block mb-0.5">Visa / QID Expiry Date</label>
                          <input 
                            type="date"
                            value={parseToYMD(issue.visaExpiry) || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setValidityIssues(prev => prev ? prev.map((item, i) => i === idx ? { ...item, visaExpiry: val } : item) : null);
                            }}
                            className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs font-semibold"
                          />
                        </div>
                      </div>

                      {issue.visaIssue && (
                        <p className="text-[10px] text-rose-700 font-medium">⚠️ {issue.visaIssue}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-200">
              <button
                type="button"
                onClick={() => setIsValidityModalOpen(false)}
                className="px-3.5 py-1.5 text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveValidityUpdatesAndSubmit}
                disabled={isSavingDocUpdates}
                className="px-4 py-1.5 text-xs font-bold text-white bg-[#800020] hover:bg-[#600018] rounded-xl shadow-xs transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {isSavingDocUpdates ? (
                  <span>Saving & Processing...</span>
                ) : (
                  <>
                    <Check size={14} /> {validityMode === 'fix' ? 'Save Document Details' : 'Save Document Details & Proceed Submission'}
                  </>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Operational Error Guidance Modal */}
      {errorGuidance && (
        <Modal
          isOpen={!!errorGuidance}
          onClose={() => setErrorGuidance(null)}
          title={errorGuidance.title}
          size="md"
        >
          <div className="space-y-4 text-xs font-sans">
            <div className={cn(
              "p-3.5 rounded-xl border flex items-start gap-3 shadow-xs",
              errorGuidance.category === 'policy' && "bg-amber-50/80 border-amber-200 text-amber-900",
              errorGuidance.category === 'document' && "bg-rose-50/80 border-rose-200 text-rose-900",
              errorGuidance.category === 'validation' && "bg-blue-50/80 border-blue-200 text-blue-900",
              errorGuidance.category === 'server' && "bg-slate-50 border-slate-200 text-slate-900"
            )}>
              <AlertTriangle className={cn(
                "flex-shrink-0 mt-0.5",
                errorGuidance.category === 'policy' && "text-amber-600",
                errorGuidance.category === 'document' && "text-rose-600",
                errorGuidance.category === 'validation' && "text-blue-600",
                errorGuidance.category === 'server' && "text-slate-600"
              )} size={20} />
              <div className="space-y-1">
                <p className="font-bold text-sm leading-snug">{errorGuidance.problem}</p>
                <p className="text-xs opacity-90 leading-relaxed">{errorGuidance.explanation}</p>
              </div>
            </div>

            <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 space-y-1.5 text-gray-700">
              <span className="font-bold text-[10px] text-gray-900 block uppercase tracking-wider">💡 Recommended Action</span>
              <p className="text-xs text-gray-600 leading-relaxed">{errorGuidance.suggestedAction}</p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setErrorGuidance(null)}
                className="px-3.5 py-1.5 text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-all"
              >
                Dismiss
              </button>
              {errorGuidance.actionButton && (
                <button
                  type="button"
                  onClick={errorGuidance.actionButton.onClick}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-[#800020] hover:bg-[#600018] rounded-xl shadow-xs transition-all flex items-center gap-1.5"
                >
                  {errorGuidance.actionButton.label}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
