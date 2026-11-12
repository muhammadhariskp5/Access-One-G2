// Shared helpers passed from server.ts to each feature route module.
export interface RouteContext {
  bcrypt: any;
  oracledb: any;
  logAction: any;
  createNotification: any;
  notifyAdmins: any;
  scanPassExpiries: any;
  activePresences: Map<string, any>;
  cleanStalePresences: any;
  cleanupOldCategoryPasses: any;
  orgStatusCache: Map<string, any>;
  getCachedOrgStatus: any;
  authorize: any;
  authorizePowerAdmin: any;
  validateEmployeeReferences: any;
  normalizeDateStr: any;
  validatePassExpiries: any;
  archiveAuditLogs: any;
  getConnection: any;
  getDbEngine: any;
  initializeDatabase: any;
  closeDatabase: any;
  toCamelCase: any;
  toOracleKeys: any;
  getTenantOrgId: any;
  closeApplicationsForEndedPasses: any;
  safeFilename: any;
  safeDirname: any;
  /** Handlers one feature module provides for another (e.g. shared route handlers). */
  shared: Record<string, any>;
}
