import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { 
  ArrowLeft, User, Mail, Phone, MapPin, Briefcase, 
  Shield, Calendar, FileText, Edit2, Trash2, 
  CheckCircle2, XCircle, Clock, ExternalLink, Printer
} from 'lucide-react';
import { Employee, Pass, PassApplication, Location, AccessCode, UserProfile, Division, Department, Project } from '../types';
import { apiFetch, cn, formatDate } from '../lib/utils';
import { onDataChanged } from '../lib/realtime';
import { resolvePersonnelStatus, getApplicationBadgeProps, isHistoryStatus } from '../utils/passStatus';
import { Modal } from '../components/common/Modal';
import { EmployeeForm } from '../components/employees/EmployeeForm';
import { PrintExportModal } from '../components/common/PrintExportModal';

interface EmployeeDetailProps {
  locations: Location[];
  accessCodes: AccessCode[];
  divisions: Division[];
  departments: Department[];
  projects: Project[];
  currentUser: UserProfile | null;
  onSuccess: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export function EmployeeDetail({ 
  locations, 
  accessCodes, 
  divisions,
  departments,
  projects,
  currentUser, 
  onSuccess,
  showToast,
  showConfirm
}: EmployeeDetailProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPrintBadgeOpen, setIsPrintBadgeOpen] = useState(false);
  // The person, their passes and their applications come from the server (one request), and are
  // reloaded when any of them changes (live updates), so this page needs none of the full lists.
  const [detailedData, setDetailedData] = useState<{ employee: Employee | null; applications: PassApplication[]; passes: Pass[] } | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(true);
  const loadSeq = React.useRef(0);

  const fetchDetails = React.useCallback(async () => {
    if (!id) return;
    const mySeq = ++loadSeq.current;
    try {
      const res = await apiFetch(`/api/employees/${encodeURIComponent(id)}`);
      if (mySeq !== loadSeq.current) return;
      if (res.status === 404) {
        setDetailedData({ employee: null, applications: [], passes: [] });
        return;
      }
      if (!res.ok) return; // keep what is shown
      const { requests, passes: empPasses, ...emp } = await res.json();
      if (mySeq !== loadSeq.current) return;
      setDetailedData({ employee: emp as Employee, applications: requests || [], passes: empPasses || [] });
    } catch (err) {
      console.error("Failed to fetch employee details:", err);
    } finally {
      if (mySeq === loadSeq.current) setIsLoadingDetails(false);
    }
  }, [id]);

  React.useEffect(() => {
    setIsLoadingDetails(true);
    setDetailedData(null);
    fetchDetails();
  }, [fetchDetails]);
  React.useEffect(() => onDataChanged(resources => {
    if (resources.some(r => r === 'employees' || r === 'passes' || r === 'passApplications')) fetchDetails();
  }), [fetchDetails]);

  const employee = detailedData?.employee || undefined;

  const [showHistory, setShowHistory] = useState(false);

  const allEmployeePasses = detailedData?.passes || [];
  const allEmployeeApplications = detailedData?.applications || [];

  // History (expired / replaced / revoked / closed) is retained but shown only on request.
  const employeePasses = allEmployeePasses.filter(p => showHistory || !isHistoryStatus(p.status));
  const historyPassCount = allEmployeePasses.filter(p => isHistoryStatus(p.status)).length;
  const isClosedApp = (a: PassApplication) => isHistoryStatus(a.status) || ['completed', 'collected'].includes((a.status || '').toLowerCase());
  const employeeApplications = allEmployeeApplications.filter(a => showHistory || !isClosedApp(a));
  const historyAppCount = allEmployeeApplications.filter(isClosedApp).length;

  if (!employee && isLoadingDetails) {
    return <div className="p-12 text-center text-xs text-[#6B7280]">Loading…</div>;
  }
  if (!employee) {
    return (
      <div className="p-12 text-center bg-white rounded-3xl border border-[#E5E7EB]">
        <p className="text-[#9CA3AF] text-sm italic">Employee not found.</p>
        <button 
          onClick={() => navigate('/employees')}
          className="mt-4 text-[#800020] font-bold text-sm hover:underline flex items-center justify-center gap-2 mx-auto"
        >
          <ArrowLeft size={16} />
          Back to Directory
        </button>
      </div>
    );
  }

  const handleDelete = () => {
    const activePasses = employeePasses.filter(p => ['active', 'approved', 'collected', 'processing'].includes(p.status));
    let warningMsg = `Are you sure you want to delete ${employee.name}? This action cannot be undone.`;
    if (activePasses.length > 0) {
      warningMsg += ` Note: This personnel currently holds ${activePasses.length} active pass(es). Deleting will automatically cancel and archive these passes.`;
    }

    showConfirm(
      "Delete Employee",
      warningMsg,
      async () => {
        try {
          const res = await apiFetch(`/api/employees/${employee.id}`, { method: 'DELETE' });
          if (res.ok) {
            showToast("Employee deleted and associated passes cancelled successfully");
            onSuccess();
            navigate('/employees');
          }
        } catch (err: any) {
          showToast(err.message, 'error');
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button 
          onClick={() => navigate('/employees')}
          className="text-[#6B7280] hover:text-[#1A1A1A] transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-widest"
        >
          <ArrowLeft size={16} />
          Back to Directory
        </button>
        <div className="flex gap-2">
          <button 
            onClick={() => setIsPrintBadgeOpen(true)}
            className="px-4 py-2 bg-[#800020] text-white rounded-xl font-bold text-[10px] uppercase tracking-wider hover:bg-[#600018] transition-all flex items-center gap-2 shadow-sm"
          >
            <Printer size={14} />
            Print ID Badge / PDF
          </button>
          <button 
            onClick={() => setIsEditModalOpen(true)}
            className="px-4 py-2 bg-white border border-[#E5E7EB] text-[#1A1A1A] rounded-xl font-bold text-[10px] hover:bg-[#F9FAFB] transition-all flex items-center gap-2 shadow-sm"
          >
            <Edit2 size={14} />
            Edit Profile
          </button>
          {currentUser?.role === 'admin' && (
            <button 
              onClick={handleDelete}
              className="px-4 py-2 bg-rose-50 text-rose-600 rounded-xl font-bold text-[10px] hover:bg-rose-100 transition-all flex items-center gap-2 shadow-sm"
            >
              <Trash2 size={14} />
              Delete Personnel
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white rounded-3xl border border-[#E5E7EB] p-6 text-center shadow-sm">
            <div className="w-24 h-24 rounded-3xl bg-[#F9FAFB] border border-[#F3F4F6] flex items-center justify-center text-[#800020] font-bold text-4xl mx-auto shadow-inner">
              {employee.name.charAt(0)}
            </div>
            <h2 className="mt-4 text-xl font-bold text-[#1A1A1A]">{employee.name}</h2>
            <p className="text-xs text-[#6B7280] font-medium uppercase tracking-widest mt-1">{employee.jobTitle}</p>
            <div className="mt-4 flex justify-center gap-2">
              <span className={cn(
                "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                employee.status === 'active' ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
              )}>
                {employee.status}
              </span>
              <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-[10px] font-bold uppercase tracking-wider">
                {employee.employeeType}
              </span>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-[#E5E7EB] p-6 shadow-sm space-y-4">
            <h3 className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest border-b border-[#F3F4F6] pb-2">Contact Information</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-[#F9FAFB] flex items-center justify-center text-[#6B7280]">
                  <Mail size={16} />
                </div>
                <div>
                  <p className="text-[9px] font-bold text-[#9CA3AF] uppercase tracking-widest">Email Address</p>
                  <p className="text-xs font-bold text-[#1A1A1A]">{employee.email || 'Not provided'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-[#F9FAFB] flex items-center justify-center text-[#6B7280]">
                  <Phone size={16} />
                </div>
                <div>
                  <p className="text-[9px] font-bold text-[#9CA3AF] uppercase tracking-widest">Mobile Number</p>
                  <p className="text-xs font-bold text-[#1A1A1A]">{employee.mobileNumber || 'Not provided'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-3xl border border-[#E5E7EB] shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#F3F4F6] bg-[#F9FAFB]">
              <h3 className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest">Employment & Identity</h3>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <div>
                  <p className="text-[9px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-1">Employee ID / E-Code</p>
                  <p className="text-sm font-bold text-[#1A1A1A]">{employee.employeeId}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-1">Division & Department</p>
                  <p className="text-sm font-bold text-[#1A1A1A]">{employee.division || 'N/A'} • {employee.department}</p>
                </div>
                {employee.sponsorName && (
                  <div>
                    <p className="text-[9px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-1">Sponsor Name</p>
                    <p className="text-sm font-bold text-[#1A1A1A]">{employee.sponsorName}</p>
                  </div>
                )}
                <div>
                  <p className="text-[9px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-1">Safety Induction Date</p>
                  <p className="text-sm font-bold text-[#1A1A1A]">{formatDate(employee.safetyInductionDate)}</p>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-[9px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-1">QID / Visa Number</p>
                  <p className="text-sm font-bold text-[#1A1A1A]">{employee.qidVisaNumber || employee.qatarId || employee.visaNumber || 'Not registered'}</p>
                  {(employee.qidVisaExpiry || employee.visaExpiry) && (
                    <p className="text-[10px] text-rose-600 font-bold mt-0.5">
                      Expires: {employee.qidVisaExpiry || employee.visaExpiry}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[9px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-1">Passport Details</p>
                  <p className="text-sm font-bold text-[#1A1A1A]">{employee.passportNumber || 'N/A'}</p>
                  {employee.passportExpiry && <p className="text-[10px] text-rose-600 font-bold mt-0.5">Expires: {employee.passportExpiry}</p>}
                </div>
              </div>
            </div>
          </div>

          {/* Site Engagement & Application History Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#800020]"></div>
                <p className="text-[10px] font-bold text-[#6B7280] uppercase tracking-widest">
                  {showHistory ? 'All Site Passes (incl. History)' : 'Active Site Passes'}
                </p>
              </div>
              {(historyPassCount + historyAppCount) > 0 && (
                <button
                  type="button"
                  onClick={() => setShowHistory(v => !v)}
                  className="text-[10px] font-bold text-[#800020] hover:underline"
                >
                  {showHistory ? 'Hide history' : `Show history (${historyPassCount} passes, ${historyAppCount} applications)`}
                </button>
              )}
            </div>
            
            <div className="grid grid-cols-1 gap-3">
              {employeePasses.map(pass => {
                const location = locations.find(l => l.id === pass.locationId);
                return (
                  <div key={pass.id} className="bg-white rounded-2xl border border-[#E5E7EB] p-4 flex items-center justify-between shadow-sm hover:shadow-md transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-[#F9FAFB] border border-[#F3F4F6] flex items-center justify-center text-[#800020]">
                        <Shield size={20} />
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-[#1A1A1A]">{location?.name}</h4>
                        <div className="flex gap-1.5 mt-1">
                          {pass.accessCodes.map(code => (
                            <span key={code} className="px-1.5 py-0.5 bg-[#F3F4F6] text-[#6B7280] rounded text-[8px] font-bold uppercase border border-[#E5E7EB]">
                              {code}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end gap-2">
                      <div className="flex items-center gap-2">
                        {(() => {
                          const resolved = resolvePersonnelStatus(undefined, pass.status);
                          return (
                            <span className={cn(
                              "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider",
                              resolved.isCreatedAndActive ? "bg-emerald-50 text-emerald-700" :
                              resolved.statusKey === 'rejected' || resolved.statusKey === 'cancelled' || resolved.statusKey === 'revoked' ? "bg-rose-50 text-rose-700" :
                              "bg-amber-50 text-amber-700"
                            )}>
                              {resolved.label}
                            </span>
                          );
                        })()}
                      </div>
                      <p className="text-[9px] text-[#9CA3AF] font-bold uppercase tracking-widest">Expires: {formatDate(pass.expiryDate)}</p>
                    </div>
                  </div>
                );
              })}
              {employeePasses.length === 0 && !isLoadingDetails && (
                <div className="p-8 text-center bg-white rounded-3xl border border-dashed border-[#E5E7EB]">
                  <p className="text-[#9CA3AF] text-xs italic">No active passes for this personnel.</p>
                </div>
              )}
            </div>
          </div>

          {/* New: Application History */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
              <p className="text-[10px] font-bold text-[#6B7280] uppercase tracking-widest">Application History (Live Connections)</p>
            </div>
            <div className="space-y-3">
              {employeeApplications.map(application => {
                const location = locations.find(l => l.id === application.locationId);
                const status = application.employeeStatuses?.[employee.id] || application.status;
                return (
                  <div 
                    key={application.id} 
                    onClick={() => navigate(`/applications/${application.id}`)}
                    className="bg-white rounded-2xl border border-[#E5E7EB] p-4 flex items-center justify-between shadow-sm hover:shadow-md hover:border-[#800020]/30 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
                        <FileText size={20} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-sm text-[#1A1A1A]">{location?.name || 'Multiple Locations'}</h4>
                          <span className="text-[10px] text-[#9CA3AF]">• #{application.id}</span>
                        </div>
                        <p className="text-[10px] text-[#6B7280] mt-0.5">
                          {application.purpose || 'Routine Access'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      {(() => {
                        const badgeProps = getApplicationBadgeProps(status, 1);
                        return (
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border",
                            badgeProps.bg
                          )}>
                            {badgeProps.label}
                          </span>
                        );
                      })()}
                      <p className="text-[9px] text-[#9CA3AF] font-bold uppercase tracking-widest mt-2">
                        {formatDate(application.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
              {employeeApplications.length === 0 && !isLoadingDetails && (
                <div className="p-8 text-center bg-white rounded-3xl border border-dashed border-[#E5E7EB]">
                  <p className="text-[#9CA3AF] text-xs italic">No prior application history found.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal 
        isOpen={isEditModalOpen} 
        onClose={() => setIsEditModalOpen(false)} 
        title="Edit Personnel Profile"
      >
        <EmployeeForm 
          employee={employee}
          divisions={divisions}
          departments={departments}
          projects={projects}
          onClose={() => setIsEditModalOpen(false)}
          onSuccess={() => { onSuccess(); fetchDetails(); }}
        />
      </Modal>

      {/* Styled Printable ID Badge Modal */}
      <PrintExportModal
        isOpen={isPrintBadgeOpen}
        onClose={() => setIsPrintBadgeOpen(false)}
        title="Print Personnel Badge / Export PDF"
        documentTitle={`Personnel Badge - ${employee.name}`}
        defaultFitMode="fit-page"
        defaultOrientation="portrait"
      >
        <div className="flex justify-center p-4">
          <div className="w-[320px] bg-white rounded-3xl border-2 border-[#800020] p-6 shadow-md print-badge-card text-center space-y-4 relative overflow-hidden">
            {/* Top header banner */}
            <div className="bg-[#800020] text-white -mx-6 -mt-6 p-4 mb-2">
              <p className="text-xs font-black uppercase tracking-widest">OFFICIAL SECURITY PASS</p>
              <p className="text-[8px] font-bold tracking-widest text-rose-200 uppercase mt-0.5">SITE ACCESS BADGE</p>
            </div>

            {/* Avatar & Photo */}
            <div className="w-20 h-20 rounded-2xl bg-[#F9FAFB] border-2 border-[#800020] flex items-center justify-center text-[#800020] font-black text-3xl mx-auto shadow-inner">
              {employee.name.charAt(0)}
            </div>

            {/* Details */}
            <div>
              <h3 className="text-base font-black text-[#1A1A1A]">{employee.name}</h3>
              <p className="text-[10px] font-bold text-[#800020] uppercase tracking-wider mt-0.5">{employee.jobTitle}</p>
              <p className="text-[9px] font-bold text-[#6B7280] uppercase tracking-widest mt-1">ID: {employee.employeeId}</p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-left pt-3 border-t border-gray-100 text-[9px]">
              <div>
                <p className="font-bold text-[#9CA3AF] uppercase">Division</p>
                <p className="font-bold text-[#1A1A1A]">{employee.division || 'N/A'}</p>
              </div>
              <div>
                <p className="font-bold text-[#9CA3AF] uppercase">Department</p>
                <p className="font-bold text-[#1A1A1A]">{employee.department || 'N/A'}</p>
              </div>
              <div>
                <p className="font-bold text-[#9CA3AF] uppercase">QID / Visa</p>
                <p className="font-bold text-[#1A1A1A]">{employee.qatarId || employee.qidVisaNumber || 'N/A'}</p>
              </div>
              <div>
                <p className="font-bold text-[#9CA3AF] uppercase">Passport</p>
                <p className="font-bold text-[#1A1A1A]">{employee.passportNumber || 'N/A'}</p>
              </div>
            </div>

            {/* Barcode representation */}
            <div className="pt-2 border-t border-gray-100 flex flex-col items-center">
              <div className="h-8 w-40 bg-gray-900 flex items-center justify-around px-2 py-1 rounded">
                {[...Array(24)].map((_, i) => (
                  <div key={i} className={`h-full ${i % 3 === 0 ? 'w-1' : i % 2 === 0 ? 'w-0.5' : 'w-1.5'} bg-white`} />
                ))}
              </div>
              <p className="text-[8px] font-mono text-[#6B7280] mt-1 uppercase">{employee.id?.toUpperCase()}</p>
            </div>
          </div>
        </div>
      </PrintExportModal>
    </div>
  );
}
