export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  firstNameAlt?: string;
  lastNameAlt?: string;
  passportNumber?: string;
  passportExpiry?: string;
  visaNumber?: string;
  visaExpiry?: string;
  qatarId?: string;
  qidVisaNumber?: string;
  qidVisaExpiry?: string;
  employeeType: 'Internal' | 'External' | 'External Sponsor' | 'Externally Working';
  sponsorName?: string;
  division?: 'Operations' | 'Maintenance' | 'Administration' | 'Security';
  department: string;
  project?: string;
  jobTitle: string;
  mobileNumber?: string;
  email?: string;
  status: 'active' | 'inactive';
  employeeId: string;
  name: string; // Combined firstName and lastName
  safetyInductionDate?: string;
  birthDate?: string;
  gender?: string;
  nationality?: string;
  bloodGroup?: string;
  maritalStatus?: string;
  organizationId?: string;
}

export interface Category {
  id: string;
  name: string;
  organizationId?: string;
}

export interface Location {
  id: string;
  name: string;
  code: string;
  categoryId: string;
  description?: string;
  status?: 'active' | 'inactive';
  organizationId?: string;
  isGlobal?: boolean | number;
  securityLevel?: string; // 'Level 1: General Access' | 'Level 2: Operations' | 'Level 3: Restricted Airside / Berths' | 'Level 4: Critical High-Security'
}

export interface AccessCode {
  id: string;
  locationId: string;
  areaCode: string;
  accessArea: string;
  description?: string;
  status?: 'active' | 'not_working' | 'inactive';
  organizationId?: string;
  isGlobal?: boolean | number;
  securityLevel?: string;
}

export type PassType = 'main' | 'supplementary';
export type PassStatus = 'pending' | 'processing' | 'approved' | 'accepted' | 'issued' | 'collected' | 'cancelled' | 'rejected' | 'active' | 'expired' | 'revoked' | 'completed' | 'replaced';
export type ApplicationStatus = 'pending' | 'processing' | 'under_review' | 'under_processing' | 'approved' | 'accepted' | 'issued' | 'partially_issued' | 'collected' | 'cancelled' | 'rejected' | 'forwarded' | 'completed' | 'archived' | 'clarification' | 'replaced';
export type EmployeeApplicationStatus = 'pending' | 'processing' | 'approved' | 'accepted' | 'issued' | 'collected' | 'cancelled' | 'rejected' | 'completed' | 'clarification' | 'replaced';

export interface PassApplication {
  id: string;
  requesterId: string;
  approverId?: string;
  employeeIds: string[];
  temporaryNames?: string[]; // Names typed for rough reference
  employeeStatuses: Record<string, EmployeeApplicationStatus>; // Track status per employee
  locationId: string;
  type: PassType;
  accessCodes: string[];
  status: ApplicationStatus;
  forwardedToId?: string; // ID of the next approver if forwarded
  authorityAppNumber?: string; // Pass Application Number
  parentPassId?: string; // Link to a main pass if supplementary
  startDate?: string;
  endDate?: string;
  expiryDate?: string;
  individualStartDates?: Record<string, string>;
  individualExpiries?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  remarks?: string; // User comments
  approvalRemarks?: string; // Approver comments
  projectId?: string;
  contractNumber?: string;
  contractName?: string;
  contractTitle?: string;
  clientCompany?: string;
  clientApprovers?: string;
  organizationId?: string;
}

export interface ApplicationHistory {
  id: string;
  applicationId: string;
  userId: string;
  action: string;
  remarks?: string;
  timestamp: string;
}

export interface Pass {
  id: string;
  applicationId?: string; // Link to the original application
  requestId?: string;
  employeeId: string;
  locationId: string;
  type: PassType;
  parentPassId?: string; // Links to a main pass if supplementary
  passNumber?: string;
  cardNumber?: string;
  authorityAppNumber?: string; // Pass Application Number
  startDate?: string;
  issueDate?: string;
  expiryDate?: string;
  endDate?: string;
  status: PassStatus;
  accessCodes: string[];
  remarks?: string;
  handoverBy?: string; // Name of the person who physically handed over the pass
  createdAt?: string;
  updatedAt?: string;
  projectId?: string;
  contractNumber?: string;
  contractName?: string;
  clientCompany?: string;
  clientApprovers?: string;
  organizationId?: string;
}

export type UserRole = 'power_admin' | 'admin' | 'applier' | 'viewer' | 'approver' | 'requester';

export function isPowerAdmin(user: UserProfile | null | undefined): boolean {
  if (!user) return false;
  const email = (user.email || '').toLowerCase().trim();
  return (
    user.role === 'power_admin' || 
    email === 'm.techsandgadgets@gmail.com'
  );
}

export interface AppAction {
  id: string;
  type: 'pass_issued' | 'application_approved' | 'application_rejected' | 'status_updated' | 'bulk_updated' | 'deleted' | 'application_forwarded' | 'personnel_mapped' | 'status_reverted';
  title: string;
  details: string;
  timestamp: string;
  data?: any;
}

export interface UserViewPreferences {
  tableDensity?: 'compact' | 'comfortable';
  dateFormat?: 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'DD MMM YYYY';
  defaultLandingPage?: string;
  itemsPerPage?: number;
  enableSound?: boolean;
  expiryWarningDays?: number;
  badgeStyle?: 'minimal' | 'bold';
}

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  name?: string;
  displayName?: string;
  userName?: string;
  photoURL?: string;
  status?: 'active' | 'pending' | 'rejected' | 'inactive';
  phone?: string;
  jobTitle?: string;
  department?: string;
  division?: string;
  project?: string;
  createdAt?: string;
  lastLogin?: string;
  preferences?: UserViewPreferences;
  organizationId?: string;
  organization?: OrganizationTenant;
}

export interface BrandingSettings {
  appName: string;
  appLogoUrl?: string;
  companyName: string;
  companyLogoUrl?: string;
  address?: string;
  contactEmail?: string;
  contactPhone?: string;
  primaryColor?: string;
  poweredBy?: string;
  licenseKey?: string;
  licenseTier?: string;
  licenseExpiry?: string;
  orgCode?: string;
  status?: 'active' | 'suspended' | 'read_only' | 'terminated' | 'expired' | 'trial';
  allowedDomains?: string;
  maxUsers?: number;
  maxPasses?: number;
  maxEmployees?: number;
  // System Maintenance Broadcast
  maintenanceActive?: boolean | number;
  maintenanceMessage?: string;
  maintenanceSeverity?: 'info' | 'warning' | 'critical';
  maintenanceLevel?: 'info' | 'warning' | 'critical';
  maintenanceStart?: string;
  maintenanceEnd?: string;
  maintenanceEstimatedEnd?: string;
  maintenanceDismissible?: boolean | number;
}

export interface OrganizationTenant {
  id: string;
  name: string;
  code: string;
  appName: string;
  appLogoUrl?: string;
  companyLogoUrl?: string;
  address?: string;
  contactEmail?: string;
  contactPhone?: string;
  primaryAdminName?: string;
  primaryAdminEmail?: string;
  primaryColor?: string;
  poweredBy?: string;
  licenseKey: string;
  licenseTier: string;
  licenseExpiry: string;
  maxUsers?: number;
  maxPasses?: number;
  maxEmployees?: number;
  allowedDomains?: string;
  status: 'active' | 'suspended' | 'read_only' | 'terminated' | 'expired' | 'trial';
  statusReason?: string;
  isCurrent?: boolean;
  notes?: string;
  features?: string;
  createdAt?: string;
  updatedAt?: string;
  usageStats?: {
    activePassesCount: number;
    totalEmployeesCount: number;
    totalUsersCount: number;
  };
}

export interface SaaSLicensePlan {
  id: string;
  name: string;
  code: string;
  badgeColor: string;
  pricePerYear: string;
  maxUsers: number | 'Unlimited';
  maxPasses: number | 'Unlimited';
  features: string[];
  recommended?: boolean;
}

export interface LicenseProvisionPayload {
  companyName: string;
  orgCode: string;
  appName?: string;
  primaryAdminName: string;
  primaryAdminEmail: string;
  initialAdminPassword?: string;
  primaryAdminPassword?: string;
  contactPhone?: string;
  address?: string;
  primaryColor?: string;
  licenseTier: string;
  licenseDuration?: string; // '1year' | '2year' | '3year' | 'lifetime' | 'custom'
  licenseDurationYears?: number;
  licenseExpiry?: string;
  maxUsers?: number;
  maxPasses?: number;
  maxEmployees?: number;
  allowedDomains?: string;
  notes?: string;
  provisionStarterTemplates?: boolean;
}

export interface ClientWelcomePackage {
  companyName: string;
  orgCode: string;
  portalUrl: string;
  licenseKey: string;
  licenseTier: string;
  licenseExpiry: string;
  primaryAdminEmail: string;
  primaryAdminPassword: string;
  seatQuota: string;
  passQuota: string;
  issuedAt: string;
  vendor: string;
  supportContact: string;
}

export interface PlatformSaaSDashboard {
  totalCompanies: number;
  activeSubscriptions: number;
  suspendedCompanies: number;
  trialCompanies: number;
  tierDistribution: Record<string, number>;
  totalAllocatedSeats: number;
  platformVersion: string;
  vendor: string;
  leadArchitect: string;
  systemHealth: {
    status: 'operational' | 'degraded' | 'maintenance';
    dbConnected: boolean;
    uptimeSeconds: number;
    oracleVersion?: string;
  };
}

export interface PlatformSystemInfo {
  platformName: string;
  platformVersion: string;
  vendor: string;
  leadArchitect: string;
  superAdmins: string[];
  activeOrganization: BrandingSettings;
  systemHealth: {
    status: 'operational' | 'degraded' | 'maintenance';
    dbConnected: boolean;
    uptimeSeconds: number;
    oracleVersion?: string;
  };
  metrics: {
    totalEmployees: number;
    totalPasses: number;
    totalApplications: number;
    totalLocations: number;
    totalAccessCodes: number;
    totalUsers: number;
    totalAuditLogs: number;
    totalDivisions: number;
    totalProjects: number;
  };
}

export interface ClientHandoverPayload {
  companyName: string;
  appName: string;
  primaryColor: string;
  poweredBy?: string;
  address?: string;
  contactEmail?: string;
  companyLogoUrl?: string;
  appLogoUrl?: string;
  licenseTier?: string;
  licenseKey?: string;
  adminEmail: string;
  adminName: string;
  adminPassword?: string;
  keepCategoriesAndLocations: boolean;
  keepDivisionsAndProjects: boolean;
  purgePersonnel: boolean;
  purgePassesAndRequests: boolean;
  purgeAuditLogs: boolean;
}

export interface Division {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  organizationId?: string;
}

export interface Project {
  id: string;
  name: string;
  contractNumber?: string;
  clientCompany?: string;
  clientApprovers?: string;
  endDate?: string;
  status: 'active' | 'inactive';
  organizationId?: string;
}

export interface Department {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  organizationId?: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userEmail: string;
  userName?: string;
  action: string;
  entityType: 'pass' | 'application' | 'employee' | 'user' | 'location' | 'company' | 'auth' | 'handover' | 'mapping' | 'settings' | 'division' | 'project' | 'department' | string;
  entityId: string;
  details: string;
  timestamp: string;
  organizationId?: string;
}

export interface UserPresence {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  organizationId?: string | null;
  department?: string;
  jobTitle?: string;
  lastActive: number;
  connectedAt: number;
  currentPage?: string;
  ipAddress?: string;
  userAgent?: string;
  status: 'online' | 'idle' | 'offline';
}

export interface UserWorkloadMetric {
  userId: string;
  userEmail: string;
  userName: string;
  role: UserRole;
  department?: string;
  applicationsCreated: number;
  approvalsProcessed: number;
  totalActionsLogged: number;
  lastActiveAt?: string;
  isOnline: boolean;
  status: 'active' | 'pending' | 'rejected' | 'inactive';
}

export interface SuperAdminUserReport {
  totalUsers: number;
  activeUsers: number;
  onlineNowCount: number;
  idleCount: number;
  pendingUsersCount: number;
  roleDistribution: Record<string, number>;
  departmentDistribution: Record<string, number>;
  onlineUsers: UserPresence[];
  workloadRanking: UserWorkloadMetric[];
  recentAuthEvents: AuditLog[];
}
