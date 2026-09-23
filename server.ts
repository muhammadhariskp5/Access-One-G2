import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";

const logFile = path.join(process.cwd(), 'server_debug.log');
function debugLog(msg: string) {
  try {
    const line = `${new Date().toISOString()} - ${msg}\n`;
    fs.appendFileSync(logFile, line);
    console.log(msg);
  } catch (e) {
    console.error('Failed to write to log file:', e);
  }
}

debugLog(`Server script started. NODE_ENV: ${process.env.NODE_ENV}, PORT: ${process.env.PORT}`);

process.on('uncaughtException', (err) => {
  debugLog(`Uncaught Exception: ${err?.stack || err?.message || err}`);
});
process.on('unhandledRejection', (reason, promise) => {
  debugLog(`Unhandled Rejection: ${reason}`);
});

async function startServer() {
  debugLog('startServer called');
  try {
    debugLog('Loading heavy libraries...');
    const bcrypt = (await import("bcryptjs")).default;
    const oracledb = (await import("oracledb")).default;
    const { initializeDatabase, getConnection, getDbEngine } = await import("./src/db.ts");
    debugLog('Heavy libraries loaded');

    const safeFilename = typeof import.meta !== "undefined" && import.meta.url ? fileURLToPath(import.meta.url) : (typeof __filename !== "undefined" ? __filename : "");
    const safeDirname = typeof __dirname !== "undefined" ? __dirname : (safeFilename ? path.dirname(safeFilename) : process.cwd());

    // --- Audit Logging Helper ---
    async function logAction(
      req: express.Request, 
      action: string, 
      entityType: string, 
      entityId: string, 
      details: string,
      customActor?: { userId?: string; userEmail?: string; userName?: string; organizationId?: string | null }
    ) {
      const userId = customActor?.userId || (req.headers['x-user-id'] as string) || 'system';
      const userEmail = customActor?.userEmail || (req.headers['x-user-email'] as string) || 'system@example.com';
      const userName = customActor?.userName || (req.headers['x-user-name'] as string) || 'System';
      const orgId = customActor?.organizationId !== undefined 
        ? customActor.organizationId 
        : ((req.headers['x-user-org-id'] as string) || null);

      const log = {
        id: Math.random().toString(36).substr(2, 9),
        userId,
        userEmail,
        userName,
        action,
        entityType,
        entityId,
        details,
        timestamp: new Date().toISOString(),
        orgId
      };

      let connection;
      try {
        connection = await getConnection();
        await connection.execute(
          `INSERT INTO auditLogs (id, userId, userEmail, userName, action, entityType, entityId, details, "TIMESTAMP", organizationId) 
           VALUES (:id, :userId, :userEmail, :userName, :action, :entityType, :entityId, :details, :timestamp, :orgId)`,
          log
        );
        await connection.commit();
      } catch (err) {
        console.error('Failed to log action:', err);
      } finally {
        if (connection) await connection.close();
      }
    }

// --- In-App Notification Helper ---
async function createNotification(connection: any, params: { userId: string; organizationId?: string | null; type: string; title: string; message?: string; entityType?: string; entityId?: string }) {
  try {
    const notif = {
      id: Math.random().toString(36).substr(2, 9),
      userId: params.userId,
      organizationId: params.organizationId || null,
      type: params.type,
      title: params.title,
      message: params.message || '',
      entityType: params.entityType || null,
      entityId: params.entityId || null,
      timestamp: new Date().toISOString(),
    };
    await connection.execute(
      `INSERT INTO notifications (id, userId, organizationId, type, title, message, entityType, entityId, isRead, "TIMESTAMP")
       VALUES (:id, :userId, :organizationId, :type, :title, :message, :entityType, :entityId, 0, :timestamp)`,
      notif
    );
    await connection.commit();
  } catch (err) {
    console.error('Failed to create notification:', err);
  }
}

    // --- Real-time User Presence In-Memory Registry ---
    interface PresenceRecord {
      userId: string;
      email: string;
      displayName: string;
      role: string;
      organizationId?: string | null;
      department?: string;
      jobTitle?: string;
      lastActive: number;
      connectedAt: number;
      currentPage?: string;
      ipAddress?: string;
      userAgent?: string;
    }

    const activePresences = new Map<string, PresenceRecord>();

    function cleanStalePresences() {
      const cutoff = Date.now() - 5 * 60 * 1000; // 5 minutes cutoff
      for (const [key, presence] of activePresences.entries()) {
        if (presence.lastActive < cutoff) {
          activePresences.delete(key);
        }
      }
    }

    // --- Cleanup Old Category Passes Helper ---
    async function cleanupOldCategoryPasses(connection: any, employeeId: string, locationId: string, excludePassId?: string) {
      if (!employeeId || !locationId) return;
      try {
        const oracledb = (await import("oracledb")).default;
        
        // Find category ID of the location
        const locRes = await connection.execute(
          `SELECT categoryId FROM locations WHERE id = :locationId`,
          [locationId],
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const categoryId = locRes.rows?.[0]?.CATEGORYID || locRes.rows?.[0]?.categoryId;
        if (!categoryId) return;

        // Find all old passes for this employee in locations under the same category
        const res = await connection.execute(
          `SELECT p.id, p.type, p.status FROM passes p 
           JOIN locations l ON p.locationId = l.id 
           WHERE p.employeeId = :employeeId 
           AND l.categoryId = :categoryId`,
          { employeeId, categoryId },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const rows = res.rows || [];
        const idsToDelete: string[] = [];

        for (const r of rows) {
          const pid = r.ID || r.id;
          if (!pid || pid === excludePassId) continue;
          const s = (r.STATUS || r.status || '').toLowerCase();
          const ptype = (r.TYPE || r.type || '').toLowerCase();

          // Delete expired, cancelled, revoked, replaced, superseded, inactive passes, or older main passes
          if (['expired', 'cancelled', 'revoked', 'replaced', 'superseded', 'inactive'].includes(s) || ptype === 'main') {
            idsToDelete.push(pid);
          }
        }

        for (const oldId of idsToDelete) {
          await connection.execute(`DELETE FROM passAccessCodes WHERE passId = :id`, [oldId]);
          await connection.execute(`DELETE FROM passAccessCodes WHERE passId IN (SELECT id FROM passes WHERE parentPassId = :id)`, [oldId]);
          await connection.execute(`DELETE FROM passes WHERE parentPassId = :id`, [oldId]);
          await connection.execute(`DELETE FROM passes WHERE id = :id`, [oldId]);
        }
      } catch (err) {
        console.error('Failed to cleanup old category passes:', err);
      }
    }

// --- Signed Session Token Helpers (added by security audit fix) ---
// Client identity must never be trusted directly from request headers; it must come from
// a token that was signed by this server at login time and verified on every request.
const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  debugLog('WARNING: SESSION_SECRET env var not set. Using an ephemeral secret for this process only; all sessions will be invalidated on restart. Set SESSION_SECRET in your environment for production use.');
  return crypto.randomBytes(32).toString('hex');
})();

function signSessionToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 24 * 60 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}

function verifySessionToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

    // --- Organization Status Cache & Engine ---
    const orgStatusCache = new Map<string, { status: string; statusReason?: string; timestamp: number }>();

    async function getCachedOrgStatus(orgId: string): Promise<{ status: string; statusReason?: string }> {
      if (!orgId) return { status: 'active' };
      const cached = orgStatusCache.get(orgId);
      const now = Date.now();
      if (cached && now - cached.timestamp < 10000) {
        return cached;
      }
      try {
        const conn = await getConnection();
        try {
          const res = await conn.execute(
            `SELECT status, statusReason FROM organizations WHERE id = :id`,
            [orgId],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );
          if (res.rows && res.rows.length > 0) {
            const row: any = toCamelCase(res.rows[0]);
            const val = { status: row.status || 'active', statusReason: row.statusReason };
            orgStatusCache.set(orgId, { ...val, timestamp: now });
            return val;
          }
        } finally {
          await conn.close();
        }
      } catch (err) {
        console.error("Error checking org status:", err);
      }
      return { status: 'active' };
    }

    // --- Authorization Middleware ---
    const authorize = (roles: string[] = []) => {
      return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = (req.headers['authorization'] as string) || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const verifiedSession = bearerToken ? verifySessionToken(bearerToken) : null;

    if (!verifiedSession || !verifiedSession.id) {
      if (req.path === '/api/health' || req.path.startsWith('/api/auth')) {
        return next();
      }
      return res.status(401).json({ error: "Unauthorized: Please log in." });
    }

    // Overwrite any client-supplied identity headers with the cryptographically verified values.
    // Everything downstream reads identity from these headers, so this is the sole trust boundary.
    req.headers['x-user-id'] = String(verifiedSession.id);
    req.headers['x-user-email'] = String(verifiedSession.email || '').toLowerCase().trim();
    req.headers['x-user-role'] = String(verifiedSession.role || 'viewer').toLowerCase().trim();
    req.headers['x-user-org-id'] = verifiedSession.organizationId ? String(verifiedSession.organizationId) : '';

    const userRole = String(verifiedSession.role || 'viewer').toLowerCase().trim();
    const userEmail = String(verifiedSession.email || '').toLowerCase().trim();

        // Power Admin (Platform Owner) has global super access across all functional tenant scopes
        const isPowerAdminUser = userRole === 'power_admin' || 
                                userEmail === 'm.techsandgadgets@gmail.com';

        if (roles.length > 0) {
          const lowerRoles = roles.map(r => r.toLowerCase().trim());
          const effectiveRole = userRole === 'requester' ? 'applier' : userRole;
          const isAllowed = isPowerAdminUser ||
                            lowerRoles.includes(userRole) || 
                            lowerRoles.includes(effectiveRole) || 
                            (userRole === 'applier' && lowerRoles.includes('requester')) ||
                            (userRole === 'admin');
          if (!isAllowed) {
            return res.status(403).json({ error: "Forbidden: You do not have permission to perform this action." });
          }
        }

        // --- Tenant Status Toggle & Suspension Engine Enforcement ---
        if (!isPowerAdminUser && verifiedSession.organizationId) {
          const orgInfo = await getCachedOrgStatus(String(verifiedSession.organizationId));
          const orgStatus = orgInfo.status ? orgInfo.status.toLowerCase() : 'active';
          
          if (orgStatus === 'suspended' || orgStatus === 'terminated') {
            return res.status(403).json({
              error: `Organization Access Suspended: Your company account is currently ${orgStatus.toUpperCase()}. ${orgInfo.statusReason ? '(' + orgInfo.statusReason + '). ' : ''}Please contact platform administration.`,
              code: "ORG_SUSPENDED",
              orgStatus
            });
          }

          if (orgStatus === 'read_only') {
            const method = req.method.toUpperCase();
            const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
            const isPresence = req.path.includes('/presence');
            if (isMutation && !isPresence) {
              return res.status(403).json({
                error: `Organization Read-Only Enforcement: Your organization account is in Read-Only mode. Mutations, submissions, and deletions are currently restricted.`,
                code: "ORG_READ_ONLY",
                orgStatus: "read_only"
              });
            }
          }
        }

        next();
      };
    };

    // Strict Platform Master / Power Admin Only Middleware
    const authorizePowerAdmin = () => {
      return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = (req.headers['authorization'] as string) || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const verifiedSession = bearerToken ? verifySessionToken(bearerToken) : null;

    if (!verifiedSession || !verifiedSession.id) {
      return res.status(401).json({ error: "Unauthorized: Please log in." });
    }

    req.headers['x-user-id'] = String(verifiedSession.id);
    req.headers['x-user-email'] = String(verifiedSession.email || '').toLowerCase().trim();
    req.headers['x-user-role'] = String(verifiedSession.role || 'viewer').toLowerCase().trim();
    req.headers['x-user-org-id'] = verifiedSession.organizationId ? String(verifiedSession.organizationId) : '';

    const userRole = String(verifiedSession.role || 'viewer').toLowerCase().trim();
    const userEmail = String(verifiedSession.email || '').toLowerCase().trim();

        const isPowerAdminUser = userRole === 'power_admin' || 
                                userEmail === 'm.techsandgadgets@gmail.com';

        if (!isPowerAdminUser) {
          return res.status(403).json({ 
            error: "Forbidden: Platform Master Control & Multi-Tenant management is restricted exclusively to the Power Admin (Software Vendor Root)." 
          });
        }

        next();
      };
    };

    const validateEmployeeReferences = async (connection: any, data: any, orgId?: string | null) => {
      if (data.division && data.division !== '') {
        let sql = `SELECT name FROM divisions WHERE LOWER(name) = LOWER(:name)`;
        const binds: any = { name: data.division };
        if (orgId) {
          sql += ` AND organizationId = :orgId`;
          binds.orgId = orgId;
        }
        const res = await connection.execute(sql, binds);
        if (!res.rows || res.rows.length === 0) {
          // Fallback check without orgId for flexibility
          const globalRes = await connection.execute(`SELECT name FROM divisions WHERE LOWER(name) = LOWER(:name)`, { name: data.division });
          if (!globalRes.rows || globalRes.rows.length === 0) {
            throw new Error(`Invalid Division: ${data.division}. Personnel must be linked to a valid division.`);
          }
        }
      }
      if (data.department && data.department !== '') {
        let sql = `SELECT name FROM departments WHERE LOWER(name) = LOWER(:name)`;
        const binds: any = { name: data.department };
        if (orgId) {
          sql += ` AND organizationId = :orgId`;
          binds.orgId = orgId;
        }
        const res = await connection.execute(sql, binds);
        if (!res.rows || res.rows.length === 0) {
          const globalRes = await connection.execute(`SELECT name FROM departments WHERE LOWER(name) = LOWER(:name)`, { name: data.department });
          if (!globalRes.rows || globalRes.rows.length === 0) {
            throw new Error(`Invalid Department: ${data.department}. Personnel must be linked to a valid department.`);
          }
        }
      }
      if (data.project && data.project !== '') {
        let sql = `SELECT name FROM projects WHERE LOWER(name) = LOWER(:name)`;
        const binds: any = { name: data.project };
        if (orgId) {
          sql += ` AND organizationId = :orgId`;
          binds.orgId = orgId;
        }
        const res = await connection.execute(sql, binds);
        if (!res.rows || res.rows.length === 0) {
          const globalRes = await connection.execute(`SELECT name FROM projects WHERE LOWER(name) = LOWER(:name)`, { name: data.project });
          if (!globalRes.rows || globalRes.rows.length === 0) {
            throw new Error(`Invalid Project: ${data.project}. Personnel must be linked to a valid project.`);
          }
        }
      }
    };

    const normalizeDateStr = (d: any): string | null => {
      if (!d) return null;
      if (d instanceof Date) {
        if (isNaN(d.getTime())) return null;
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
      const str = String(d).trim();
      if (!str) return null;
      
      const ymdMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      if (ymdMatch) {
        const y = ymdMatch[1];
        const m = ymdMatch[2].padStart(2, '0');
        const day = ymdMatch[3].padStart(2, '0');
        return `${y}-${m}-${day}`;
      }

      const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
      if (dmyMatch) {
        const day = dmyMatch[1].padStart(2, '0');
        const m = dmyMatch[2].padStart(2, '0');
        const y = dmyMatch[3];
        return `${y}-${m}-${day}`;
      }

      const parsed = new Date(str);
      if (!isNaN(parsed.getTime())) {
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
      return null;
    };

    const validatePassExpiries = async (connection: any, employeeIds: string[], filteredCommonData: any, individualExpiries: any) => {
      const oracledb = (await import("oracledb")).default;
      for (const empId of employeeIds) {
        const empResult = await connection.execute(
          `SELECT qidVisaExpiry, visaExpiry, project, name FROM employees WHERE id = :id`, 
          [empId], 
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const emp = empResult.rows?.[0];
        if (!emp) continue;

        let projectEndDate = null;
        if (emp.PROJECT) {
          const projResult = await connection.execute(
            `SELECT endDate FROM projects WHERE name = :name`, 
            { name: emp.PROJECT }, 
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );
          projectEndDate = projResult.rows?.[0]?.ENDDATE;
        }

        let parentPassExpiry = null;
        if (filteredCommonData.parentPassId) {
          const parentResult = await connection.execute(
            `SELECT expiryDate FROM passes WHERE id = :id`, 
            [filteredCommonData.parentPassId], 
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );
          parentPassExpiry = parentResult.rows?.[0]?.EXPIRYDATE;
        }

        const requestedExpiryRaw = (individualExpiries && individualExpiries[empId]) || filteredCommonData.expiryDate || filteredCommonData.endDate;
        const reqDateStr = normalizeDateStr(requestedExpiryRaw);
        if (!reqDateStr) continue;

        const constraints: Record<string, string | null> = {
          'Project End Date': normalizeDateStr(projectEndDate),
          'QID/Visa Expiry': normalizeDateStr(emp.QIDVISAEXPIRY || emp.VISAEXPIRY),
          'Main Pass Expiry': normalizeDateStr(parentPassExpiry)
        };

        let effectiveCapDate = reqDateStr;
        let capReasonName = '';

        for (const [name, constraintDateStr] of Object.entries(constraints)) {
          if (constraintDateStr) {
            if (constraintDateStr < effectiveCapDate) {
              effectiveCapDate = constraintDateStr;
              capReasonName = name;
            }
          }
        }

        const startDateStr = normalizeDateStr(filteredCommonData.startDate) || normalizeDateStr(new Date());

        if (startDateStr && effectiveCapDate < startDateStr) {
          throw new Error(`${emp.NAME || 'Employee'}: Cannot issue pass because ${capReasonName} (${effectiveCapDate}) is before the requested Start Date (${startDateStr}). Please update ${capReasonName} first.`);
        }

        if (effectiveCapDate < reqDateStr) {
          if (individualExpiries) {
            individualExpiries[empId] = effectiveCapDate;
          }
        }
      }
    };

    async function archiveAuditLogs() {
      debugLog('Running audit log archiving task...');
      let connection;
      try {
        connection = await getConnection();
        
        // Ensure auditLogs_archive table has organizationId column
        try {
          const colCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'AUDITLOGS_ARCHIVE' AND column_name = 'ORGANIZATIONID'`;
          const colResult = await connection.execute(colCheckSql);
          if (colResult.rows && colResult.rows.length === 0) {
            await connection.execute(`ALTER TABLE auditLogs_archive ADD (organizationId VARCHAR2(50))`);
            await connection.commit();
            debugLog('Added organizationId column to auditLogs_archive table');
          }
        } catch (colErr) {
          debugLog(`Audit log archive column check: ${colErr}`);
        }

        // 1. Archive logs older than 1 month
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        const oneMonthStr = oneMonthAgo.toISOString();

        // Query column lists from user_tab_cols to ensure matching columns and avoid ORA-00913
        const [archiveColsRes, logsColsRes] = await Promise.all([
          connection.execute(`SELECT column_name FROM user_tab_cols WHERE table_name = 'AUDITLOGS_ARCHIVE'`),
          connection.execute(`SELECT column_name FROM user_tab_cols WHERE table_name = 'AUDITLOGS'`)
        ]);

        const getColNames = (res: any) => (res.rows || []).map((r: any) => {
          const val = Array.isArray(r) ? r[0] : (r.COLUMN_NAME || r.column_name);
          return String(val).toUpperCase();
        });

        const archiveCols = getColNames(archiveColsRes);
        const logsCols = getColNames(logsColsRes);
        const commonCols = archiveCols.filter(c => logsCols.includes(c));

        if (commonCols.length > 0) {
          const formattedCols = commonCols.map(c => c === 'TIMESTAMP' ? '"TIMESTAMP"' : c).join(', ');
          await connection.execute(
            `INSERT INTO auditLogs_archive (${formattedCols}) SELECT ${formattedCols} FROM auditLogs WHERE "TIMESTAMP" < :dateStr`,
            [oneMonthStr]
          );
        } else {
          // Fallback to explicit known core columns
          await connection.execute(
            `INSERT INTO auditLogs_archive (id, userId, userEmail, userName, action, entityType, entityId, details, "TIMESTAMP")
             SELECT id, userId, userEmail, userName, action, entityType, entityId, details, "TIMESTAMP"
             FROM auditLogs WHERE "TIMESTAMP" < :dateStr`,
            [oneMonthStr]
          );
        }
        
        await connection.execute(
          `DELETE FROM auditLogs WHERE "TIMESTAMP" < :dateStr`,
          [oneMonthStr]
        );

        // 2. Delete archived logs older than 12 months
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const oneYearStr = oneYearAgo.toISOString();

        const deleteResult = await connection.execute(
          `DELETE FROM auditLogs_archive WHERE "TIMESTAMP" < :dateStr`,
          [oneYearStr]
        );
        
        await connection.commit();
        debugLog(`Archived audit logs older than 1 month and deleted ${deleteResult.rowsAffected} older than 12 months.`);
      } catch (err) {
        console.error('Failed to archive audit logs:', err);
      } finally {
        if (connection) await connection.close();
      }
    }

    // Database initialization is non-blocking to allow the server to start immediately
    // and show the connection status in the UI.
    debugLog('Initializing database...');
    initializeDatabase().then(() => {
      debugLog('Database initialization completed (success)');
      // Run archiving task after DB is ready
      archiveAuditLogs();
    }).catch(err => {
      debugLog(`CRITICAL: Database initialization failed: ${err.message}`);
      console.error('CRITICAL: Database initialization failed. The application may not function correctly.', err);
    });
    
    const app = express();
    const PORT = 3000;

    app.use(express.json());

    // Request logging middleware
    app.use((req, res, next) => {
      debugLog(`${req.method} ${req.url}`);
      next();
    });

    // API routes FIRST
    app.get("/api/health", async (req, res) => {
      let connection;
      try {
        connection = await getConnection();
        res.json({ status: "ok", dbConnected: true, engine: getDbEngine() });
      } catch (err: any) {
        console.error('Health check DB error:', err);
        let error = "Database connection failed";
        if (err.errorNum === 1017) {
          error = "Invalid credentials";
        } else if (err.errorNum === 28000) {
          error = "Account is locked";
        }
        res.json({ status: "error", dbConnected: false, error });
      } finally {
        if (connection) await connection.close();
      }
    });

    // ... (rest of the API routes)

  // --- Data Models ---
  // Note: Using Oracle Database for state management.
  
  const toCamelCase = (obj: any) => {
    if (!obj || typeof obj !== 'object') return obj;
    const newObj: any = {};
    const mapping: Record<string, string> = {
      'DISPLAYNAME': 'displayName',
      'PHOTOURL': 'photoURL',
      'FIRSTNAME': 'firstName',
      'LASTNAME': 'lastName',
      'FIRSTNAMEALT': 'firstNameAlt',
      'LASTNAMEALT': 'lastNameAlt',
      'PASSPORTNUMBER': 'passportNumber',
      'PASSPORTEXPIRY': 'passportExpiry',
      'VISANUMBER': 'visaNumber',
      'VISAEXPIRY': 'visaExpiry',
      'QATARID': 'qatarId',
      'EMPLOYEETYPE': 'employeeType',
      'SPONSORNAME': 'sponsorName',
      'JOBTITLE': 'jobTitle',
      'MOBILENUMBER': 'mobileNumber',
      'EMPLOYEEID': 'employeeId',
      'NAME': 'name',
      'LOCATIONID': 'locationId',
      'CATEGORYID': 'categoryId',
      'AREACODE': 'areaCode',
      'ACCESSAREA': 'accessArea',
      'REQUESTERID': 'requesterId',
      'APPROVERID': 'approverId',
      'EMPLOYEEIDS': 'employeeIds',
      'EMPLOYEESTATUSES': 'employeeStatuses',
      'STARTDATE': 'startDate',
      'ENDDATE': 'endDate',
      'CREATEDAT': 'createdAt',
      'UPDATEDAT': 'updatedAt',
      'REQUESTID': 'applicationId',
      'PARENTPASSID': 'parentPassId',
      'PASSNUMBER': 'passNumber',
      'EXPIRYDATE': 'expiryDate',
      'ACCESSCODES': 'accessCodes',
      'REMARKS': 'remarks',
      'APPROVALREMARKS': 'approvalRemarks',
      'PURPOSE': 'purpose',
      'APPNAME': 'appName',
      'APPLOGOURL': 'appLogoUrl',
      'COMPANYNAME': 'companyName',
      'COMPANYLOGOURL': 'companyLogoUrl',
      'CONTACTEMAIL': 'contactEmail',
      'PRIMARYCOLOR': 'primaryColor',
      'POWEREDBY': 'poweredBy',
      'USERID': 'userId',
      'USEREMAIL': 'userEmail',
      'USERNAME': 'userName',
      'ENTITYTYPE': 'entityType',
      'ENTITYID': 'entityId',
      'APPLICATIONID': 'applicationId',
      'DIVISION': 'division',
      'DEPARTMENT': 'department',
      'PROJECT': 'project',
      'QIDVISANUMBER': 'qidVisaNumber',
      'QIDVISAEXPIRY': 'qidVisaExpiry',
      'HANDOVERBY': 'handoverBy',
      'INDIVIDUALEXPIRIES': 'individualExpiries',
      'INDIVIDUALSTARTDATES': 'individualStartDates',
      'CONTRACTNUMBER': 'contractNumber',
      'CONTRACTNAME': 'contractName',
      'CONTRACTTITLE': 'contractTitle',
      'CARDNUMBER': 'cardNumber',
      'CLIENTCOMPANY': 'clientCompany',
      'CLIENTAPPROVERS': 'clientApprovers',
      'PROJECTID': 'projectId',
      'AUTHORITYAPPNUMBER': 'authorityAppNumber',
      'ORGANIZATIONID': 'organizationId'
    };

    Object.keys(obj).forEach(key => {
      const camelKey = mapping[key.toUpperCase()] || key.toLowerCase();
      newObj[camelKey] = obj[key];
    });
    return newObj;
  };

  const toOracleKeys = (obj: any) => {
    if (!obj || typeof obj !== 'object') return obj;
    const newObj: any = {};
    const mapping: Record<string, string> = {
      'displayName': 'DISPLAYNAME',
      'photoURL': 'PHOTOURL',
      'firstName': 'FIRSTNAME',
      'lastName': 'LASTNAME',
      'firstNameAlt': 'FIRSTNAMEALT',
      'lastNameAlt': 'LASTNAMEALT',
      'passportNumber': 'PASSPORTNUMBER',
      'passportExpiry': 'PASSPORTEXPIRY',
      'visaNumber': 'VISANUMBER',
      'visaExpiry': 'VISAEXPIRY',
      'qatarId': 'QATARID',
      'employeeType': 'EMPLOYEETYPE',
      'sponsorName': 'SPONSORNAME',
      'jobTitle': 'JOBTITLE',
      'mobileNumber': 'MOBILENUMBER',
      'employeeId': 'EMPLOYEEID',
      'name': 'NAME',
      'locationId': 'LOCATIONID',
      'categoryId': 'CATEGORYID',
      'areaCode': 'AREACODE',
      'accessArea': 'ACCESSAREA',
      'applierId': 'REQUESTERID',
      'requesterId': 'REQUESTERID',
      'approverId': 'APPROVERID',
      'employeeIds': 'EMPLOYEEIDS',
      'employeeStatuses': 'EMPLOYEESTATUSES',
      'startDate': 'STARTDATE',
      'endDate': 'ENDDATE',
      'createdAt': 'CREATEDAT',
      'updatedAt': 'UPDATEDAT',
      'applicationId': 'REQUESTID',
      'requestId': 'REQUESTID',
      'parentPassId': 'PARENTPASSID',
      'expiryDate': 'EXPIRYDATE',
      'accessCodes': 'ACCESSCODES',
      'remarks': 'REMARKS',
      'approvalRemarks': 'APPROVALREMARKS',
      'purpose': 'PURPOSE',
      'appName': 'APPNAME',
      'appLogoUrl': 'APPLOGOURL',
      'companyName': 'COMPANYNAME',
      'companyLogoUrl': 'COMPANYLOGOURL',
      'contactEmail': 'CONTACTEMAIL',
      'primaryColor': 'PRIMARYCOLOR',
      'poweredBy': 'POWEREDBY',
      'userId': 'USERID',
      'userEmail': 'USEREMAIL',
      'userName': 'USERNAME',
      'entityType': 'ENTITYTYPE',
      'entityId': 'ENTITYID',
      'division': 'DIVISION',
      'department': 'DEPARTMENT',
      'project': 'PROJECT',
      'qidVisaNumber': 'QIDVISANUMBER',
      'qidVisaExpiry': 'QIDVISAEXPIRY',
      'handoverBy': 'HANDOVERBY',
      'individualExpiries': 'INDIVIDUALEXPIRIES',
      'individualStartDates': 'INDIVIDUALSTARTDATES',
      'contractNumber': 'CONTRACTNUMBER',
      'contractName': 'CONTRACTNAME',
      'contractTitle': 'CONTRACTTITLE',
      'cardNumber': 'CARDNUMBER',
      'clientCompany': 'CLIENTCOMPANY',
      'clientApprovers': 'CLIENTAPPROVERS',
      'projectId': 'PROJECTID',
      'authorityAppNumber': 'AUTHORITYAPPNUMBER',
      'description': 'DESCRIPTION',
      'status': 'STATUS',
      'passNumber': 'PASSNUMBER',
      'issueDate': 'ISSUEDATE',
      'role': 'ROLE',
      'email': 'EMAIL',
      'password': 'PASSWORD',
      'organizationId': 'ORGANIZATIONID'
    };

    Object.keys(obj).forEach(key => {
      const oracleKey = mapping[key] || key.toUpperCase();
      let val = obj[key];
      if (val === undefined) {
        val = null;
      } else if (val !== null && typeof val === 'object' && !(val instanceof Date) && !(val instanceof Buffer)) {
        try {
          val = JSON.stringify(val);
        } catch (e) {
          val = String(val);
        }
      }
      newObj[oracleKey] = val;
    });
    return newObj;
  };

  // Helper to determine the tenant organization for any incoming request
  const getTenantOrgId = async (
    req: express.Request,
    connection: any
  ): Promise<{ orgId: string | null; isPowerAdmin: boolean }> => {
    const rawRole = ((req.headers['x-user-role'] as string) || '').toLowerCase().trim();
    const userEmail = ((req.headers['x-user-email'] as string) || '').toLowerCase().trim();
    const headerOrgId = ((req.headers['x-user-org-id'] as string) || '').trim();

    const isPowerAdmin = rawRole === 'power_admin' || userEmail === 'm.techsandgadgets@gmail.com';

    // Power Admin can either scope to a specific tenant or query across all
    if (isPowerAdmin) {
      if (headerOrgId && headerOrgId !== 'all' && headerOrgId !== 'undefined' && headerOrgId !== 'null' && headerOrgId !== '') {
        return { orgId: headerOrgId, isPowerAdmin: true };
      }
      if (headerOrgId === 'all') {
        return { orgId: null, isPowerAdmin: true };
      }
    }

    // If user is authenticated, retrieve their assigned organizationId from users table
    if (userEmail && userEmail !== 'system') {
      try {
        const uRes = await connection.execute(
          `SELECT organizationId, role FROM users WHERE LOWER(email) = LOWER(:email)`,
          [userEmail],
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        if (uRes.rows && uRes.rows.length > 0) {
          const uOrg = uRes.rows[0].ORGANIZATIONID;
          const uRole = (uRes.rows[0].ROLE || '').toLowerCase().trim();
          if (uRole === 'power_admin') {
            if (headerOrgId && headerOrgId !== 'all' && headerOrgId !== 'undefined' && headerOrgId !== 'null' && headerOrgId !== '') {
              return { orgId: headerOrgId, isPowerAdmin: true };
            }
            return { orgId: null, isPowerAdmin: true };
          }
          if (uOrg) {
            return { orgId: uOrg, isPowerAdmin: false };
          }
        }
      } catch (e) {
        console.error('Error fetching user organization in getTenantOrgId:', e);
      }
    }

    // Check header
    if (headerOrgId && headerOrgId !== 'all' && headerOrgId !== 'undefined' && headerOrgId !== 'null' && headerOrgId !== '') {
      return { orgId: headerOrgId, isPowerAdmin };
    }

    // Fallback: active licensed organization (isCurrent = 1)
    try {
      const currentOrg = await connection.execute(
        `SELECT id FROM organizations WHERE isCurrent = 1`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const fallbackId = currentOrg.rows?.[0]?.ID || 'org-habari';
      return { orgId: fallbackId, isPowerAdmin };
    } catch (e) {
      return { orgId: 'org-habari', isPowerAdmin };
    }
  };
  // --- Auth Endpoints ---
  app.post("/api/auth/register", async (req, res) => {
    const { email, password, displayName } = req.body;
    const trimmedEmail = email?.trim().toLowerCase();
    
    let connection;
    try {
      connection = await getConnection();
      
      // Check if email already exists
      const emailCheck = await connection.execute(`SELECT id FROM users WHERE email = :email`, [trimmedEmail]);
      if (emailCheck.rows && emailCheck.rows.length > 0) {
        return res.status(400).json({ error: "Email already in use. Please sign in instead." });
      }

      // Check if display name already exists
      const nameCheck = await connection.execute(`SELECT id FROM users WHERE displayName = :displayName`, [displayName]);
      if (nameCheck.rows && nameCheck.rows.length > 0) {
        return res.status(400).json({ error: "Username already taken. Please choose another." });
      }
      
      // Check if this is the first user
      const userCountResult = await connection.execute(`SELECT COUNT(*) as count FROM users`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const userCount = (userCountResult.rows?.[0] as any).COUNT || 0;
      const isFirstUser = userCount === 0;

      const hashedPassword = await bcrypt.hash(password, 10);
      const orgIdToAssign = (req.body.organizationId as string) || 'org-habari';

      // Domain Whitelist, Quota, and Suspension Check for target organization
      try {
        const orgRes = await connection.execute(
          `SELECT id, name, status, statusReason, allowedDomains, maxUsers FROM organizations WHERE id = :id`,
          [orgIdToAssign],
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        if (orgRes.rows && orgRes.rows.length > 0) {
          const targetOrg: any = toCamelCase(orgRes.rows[0]);
          const oStatus = (targetOrg.status || 'active').toLowerCase();
          if (oStatus === 'suspended' || oStatus === 'terminated') {
            return res.status(403).json({
              error: `Registration Denied: Organization '${targetOrg.name}' is currently ${oStatus.toUpperCase()}. New user registrations are restricted.`
            });
          }

          // Domain Whitelist
          if (targetOrg.allowedDomains && targetOrg.allowedDomains.trim()) {
            const emailDomain = trimmedEmail.split('@')[1];
            const allowed = targetOrg.allowedDomains.split(',').map((d: string) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
            if (allowed.length > 0 && !allowed.includes(emailDomain)) {
              return res.status(400).json({
                error: `Email domain '@${emailDomain}' is not permitted for organization '${targetOrg.name}'. Allowed domains: ${allowed.map((d: string) => '@' + d).join(', ')}`
              });
            }
          }

          // User Seat Quota
          if (targetOrg.maxUsers && targetOrg.maxUsers > 0) {
            const uCountRes = await connection.execute(
              `SELECT COUNT(*) AS CNT FROM users WHERE organizationId = :orgId AND status = 'active'`,
              [orgIdToAssign],
              { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );
            const activeSeats = (uCountRes.rows?.[0] as any)?.CNT || 0;
            if (activeSeats >= targetOrg.maxUsers) {
              return res.status(400).json({
                error: `User seat quota reached for organization '${targetOrg.name}' (${activeSeats}/${targetOrg.maxUsers} seats allocated). Please contact your platform administrator.`
              });
            }
          }
        }
      } catch (checkErr) {
        console.error("Error validating organization quotas during registration:", checkErr);
      }

      const newUser = {
        id: Math.random().toString(36).substr(2, 9),
        email: trimmedEmail,
        password: hashedPassword,
        displayName,
        role: isFirstUser ? 'admin' : 'viewer', // First user is admin, others are viewers
        status: isFirstUser ? 'active' : 'pending', // First user is active, others need approval
        photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=800020&color=fff`,
        organizationId: orgIdToAssign
      };
      
      await connection.execute(
        `INSERT INTO users (id, email, password, role, displayName, photoURL, status, organizationId) 
         VALUES (:id, :email, :password, :role, :displayName, :photoURL, :status, :organizationId)`,
        newUser
      );
      await connection.commit();
      
      logAction(req, 'REGISTER', 'auth', newUser.id, `User ${newUser.email} registered as ${newUser.role}`, {
        userId: newUser.id,
        userEmail: newUser.email,
        userName: newUser.displayName,
        organizationId: newUser.organizationId || null
      });
      const { password: _, ...userWithoutPassword } = newUser;
      res.json({ ...userWithoutPassword, token: signSessionToken({ id: newUser.id, email: newUser.email, role: newUser.role, organizationId: newUser.organizationId }) });
    } catch (err: any) {
      console.error('Registration Error:', err);
      let errorMessage = "Registration failed";
      if (err.errorNum === 1017) {
        errorMessage = "Database connection failed: Invalid credentials.";
      } else if (err.errorNum === 28000) {
        errorMessage = "Database account is locked. Please unlock it in the Oracle Cloud console.";
      }
      res.status(500).json({ error: errorMessage, details: err.message });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    const trimmedEmail = email?.trim().toLowerCase();
    
    let connection;
    try {
      connection = await getConnection();
      const result = await connection.execute(
        `SELECT id, email, password, role, displayName, photoURL, status, organizationId FROM users WHERE LOWER(email) = LOWER(:email)`,
        [trimmedEmail],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      
      const user = result.rows?.[0] as any;
      if (!user || !(await bcrypt.compare(password, user.PASSWORD || user.password))) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      if (user.STATUS !== 'active' && user.status !== 'active') {
        return res.status(403).json({ error: "Account pending approval. Please contact an administrator." });
      }
      
      logAction(req, 'LOGIN', 'auth', user.ID || user.id, `User ${user.EMAIL || user.email} logged in`, {
        userId: user.ID || user.id,
        userEmail: user.EMAIL || user.email,
        userName: user.DISPLAYNAME || user.displayName || user.EMAIL || user.email,
        organizationId: user.ORGANIZATIONID || user.organizationId || null
      });
      
      // Update lastLogin timestamp in database
      const nowIso = new Date().toISOString();
      try {
        await connection.execute(
          `UPDATE users SET lastLogin = :now WHERE id = :id`,
          { now: nowIso, id: user.ID || user.id }
        );
        await connection.commit();
      } catch (uErr) {
        console.error('Failed to update lastLogin:', uErr);
      }

      const userCamel = toCamelCase(user);
      userCamel.lastLogin = nowIso;
      userCamel.organizationId = user.ORGANIZATIONID || user.organizationId || null;

      // Attach organization details if user has an assigned organization
      if (userCamel.organizationId) {
        try {
          const orgRes = await connection.execute(
            `SELECT id, name, code, appName, primaryColor, licenseTier, status, statusReason, maxUsers, maxPasses, maxEmployees, allowedDomains FROM organizations WHERE id = :id`,
            [userCamel.organizationId],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );
          if (orgRes.rows && orgRes.rows.length > 0) {
            userCamel.organization = toCamelCase(orgRes.rows[0]);

            // Power Admin override check
            const isPowerAdminUser = userCamel.role === 'power_admin' || userCamel.email === 'm.techsandgadgets@gmail.com';
            const orgStatus = (userCamel.organization.status || 'active').toLowerCase();

            if (!isPowerAdminUser && (orgStatus === 'suspended' || orgStatus === 'terminated')) {
              return res.status(403).json({
                error: `Access Denied: Your organization account (${userCamel.organization.name}) is ${orgStatus.toUpperCase()}. ${userCamel.organization.statusReason ? 'Reason: ' + userCamel.organization.statusReason + '. ' : ''}Please contact platform administration.`,
                code: "ORG_SUSPENDED",
                orgStatus
              });
            }
          }
        } catch (orgErr) {
          console.error("Failed to fetch organization for logged in user:", orgErr);
        }
      }

      const { password: _, ...userWithoutPassword } = userCamel;
    res.json({ ...userWithoutPassword, token: signSessionToken({ id: userCamel.id, email: userCamel.email, role: userCamel.role, organizationId: userCamel.organizationId }) });
    } catch (err: any) {
      console.error('Login Error:', err);
      let errorMessage = "Login failed";
      if (err.errorNum === 1017) {
        errorMessage = "Database connection failed: Invalid credentials.";
      } else if (err.errorNum === 28000) {
        errorMessage = "Database account is locked. Please unlock it in the Oracle Cloud console.";
      }
      res.status(500).json({ error: errorMessage });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.get("/api/auth/me", authorize([]), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const userId = req.headers['x-user-id'] as string;
      const userRes = await connection.execute(
        `SELECT * FROM users WHERE UPPER(id) = UPPER(:id) OR UPPER(email) = UPPER(:email)`,
        { id: userId, email: req.headers['x-user-email'] as string },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if (!userRes.rows || userRes.rows.length === 0) {
        return res.status(404).json({ error: "User profile not found" });
      }
      const user = userRes.rows[0] as any;
      const userCamel = toCamelCase(user);
      userCamel.organizationId = user.ORGANIZATIONID || user.organizationId || null;

      if (userCamel.organizationId) {
        try {
          const orgRes = await connection.execute(
            `SELECT id, name, code, appName, primaryColor, licenseTier, status, statusReason, maxUsers, maxPasses, maxEmployees, allowedDomains FROM organizations WHERE id = :id`,
            [userCamel.organizationId],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );
          if (orgRes.rows && orgRes.rows.length > 0) {
            userCamel.organization = toCamelCase(orgRes.rows[0]);
          }
        } catch (orgErr) {
          console.error("Failed to fetch organization for current user:", orgErr);
        }
      }
      const { password: _, ...userWithoutPassword } = userCamel;
      res.json(userWithoutPassword);
    } catch (err) {
      console.error("Error in /api/auth/me:", err);
      res.status(500).json({ error: "Failed to fetch user profile" });
    } finally {
      if (connection) await connection.close();
    }
  });

async function sendResetPasswordEmail(toEmail: string, toName: string, rawToken: string) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    debugLog('BREVO_API_KEY not set; skipping password reset email send.');
    return;
  }
  const fromEmail = process.env.BREVO_SENDER_EMAIL || 'no-reply@example.com';
  const fromName = process.env.BREVO_SENDER_NAME || 'AccessOne';
  try {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: [{ email: toEmail, name: toName || 'there' }],
        subject: 'Your AccessOne password reset code',
        htmlContent: `<p>Hi ${toName || 'there'},</p><p>Your password reset code is:</p><h2 style="letter-spacing:2px;">${rawToken}</h2><p>This code expires in 15 minutes. If you did not request this, you can safely ignore this email.</p>`
      })
    });
    if (!resp.ok) {
      const errText = await resp.text();
      debugLog(`Brevo email send failed: ${resp.status} ${errText}`);
    }
  } catch (e: any) {
    debugLog(`Brevo email send error: ${e?.message || e}`);
  }
}

app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body;
  const trimmedEmail = (email || '').trim().toLowerCase();
  let connection;
  try {
    connection = await getConnection();
    const result = await connection.execute(
      `SELECT id, displayName FROM users WHERE email = :email`,
      [trimmedEmail],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const user = result.rows?.[0] as any;
    if (user) {
      const rawToken = crypto.randomBytes(6).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await connection.execute(
        `UPDATE users SET resetTokenHash = :hash, resetTokenExpiry = :expiry WHERE email = :email`,
        [tokenHash, expiry, trimmedEmail]
      );
      await connection.commit();
      await sendResetPasswordEmail(trimmedEmail, user.DISPLAYNAME || user.displayName, rawToken);
    }
    // Always return the same generic response so this endpoint can't be used to enumerate registered emails.
    res.json({ message: "If an account with that email exists, a password reset code has been sent." });
  } catch (err: any) {
    console.error('Forgot Password Error:', err);
    res.status(500).json({ error: "Failed to process password reset request" });
  } finally {
    if (connection) await connection.close();
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { email, token, newPassword } = req.body;
  const trimmedEmail = email?.trim().toLowerCase();

  if (!token || !newPassword) {
    return res.status(400).json({ error: "Reset code and new password are required." });
  }

  let connection;
  try {
    connection = await getConnection();
    const result = await connection.execute(
      `SELECT id, resetTokenHash, resetTokenExpiry FROM users WHERE email = :email`,
      [trimmedEmail],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const user = result.rows?.[0] as any;
    if (!user) {
      return res.status(400).json({ error: "Invalid or expired reset code." });
    }

    const storedHash = user.RESETTOKENHASH || user.resetTokenHash;
    const expiry = user.RESETTOKENEXPIRY || user.resetTokenExpiry;
    const providedHash = crypto.createHash('sha256').update(token).digest('hex');

    const hashBuf = Buffer.from(providedHash);
    const storedBuf = Buffer.from(storedHash || '');
    const validHash = !!storedHash && hashBuf.length === storedBuf.length && crypto.timingSafeEqual(hashBuf, storedBuf);
    const validExpiry = !!expiry && Date.now() < new Date(expiry).getTime();

    if (!validHash || !validExpiry) {
      return res.status(400).json({ error: "Invalid or expired reset code." });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await connection.execute(
      `UPDATE users SET password = :password, resetTokenHash = NULL, resetTokenExpiry = NULL WHERE email = :email`,
      [hashedPassword, trimmedEmail]
    );
    await connection.commit();

    logAction(req, 'RESET_PASSWORD', 'auth', user.ID || user.id, `Password reset for ${trimmedEmail}`, {
      userId: user.ID || user.id,
      userEmail: user.EMAIL || user.email,
      userName: user.DISPLAYNAME || user.displayName || user.EMAIL || user.email,
      organizationId: user.ORGANIZATIONID || user.organizationId || null
    });
    res.json({ message: "Password reset successfully" });
  } catch (err: any) {
    console.error('Reset Password Error:', err);
    res.status(500).json({ error: "Failed to reset password" });
  } finally {
    if (connection) await connection.close();
  }
});


  app.get("/api/auth/check-availability", async (req, res) => {
    const { email, displayName } = req.query;
    let connection;
    try {
      connection = await getConnection();
      if (email) {
        const result = await connection.execute(`SELECT id FROM users WHERE email = :email`, [email.toString().toLowerCase()]);
        return res.json({ available: result.rows?.length === 0 });
      }
      if (displayName) {
        const result = await connection.execute(`SELECT id FROM users WHERE displayName = :displayName`, [displayName.toString()]);
        return res.json({ available: result.rows?.length === 0 });
      }
      res.status(400).json({ error: "Missing parameters" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Check failed" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // --- Data Endpoints ---
  app.get("/api/employees", authorize(['admin', 'approver', 'applier', 'viewer']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      let sql = `SELECT * FROM employees`;
      const binds: any = {};
      if (orgId) {
        sql += ` WHERE organizationId = :orgId`;
        binds.orgId = orgId;
      }
      const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      res.json(result.rows?.map(toCamelCase));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch employees" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.get("/api/employees/:id", authorize(['admin', 'approver', 'applier', 'viewer']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      
      // 1. Fetch employee details
      const empResult = await connection.execute(
        `SELECT * FROM employees WHERE id = :id`,
        [req.params.id],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      
      if (!empResult.rows || empResult.rows.length === 0) {
        return res.status(404).json({ error: "Employee not found" });
      }
      
      const employee = toCamelCase(empResult.rows[0]);

      // 2. Fetch linked requests via mapping table
      const requestsResult = await connection.execute(
        `SELECT r.* FROM passRequests r
         JOIN passRequestEmployees re ON r.id = re.requestId
         WHERE re.employeeId = :id
         ORDER BY r.createdAt DESC`,
        [req.params.id],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      
      const requests = requestsResult.rows?.map((r: any) => ({
        ...toCamelCase(r),
        employeeIds: JSON.parse(r.EMPLOYEEIDS || '[]'),
        employeeStatuses: JSON.parse(r.EMPLOYEESTATUSES || '{}'),
        accessCodes: JSON.parse(r.ACCESSCODES || '[]')
      })) || [];

      // 3. Fetch linked passes
      const passesResult = await connection.execute(
        `SELECT * FROM passes WHERE employeeId = :id ORDER BY createdAt DESC`,
        [req.params.id],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      
      const passes = passesResult.rows?.map((p: any) => ({
        ...toCamelCase(p),
        accessCodes: JSON.parse(p.ACCESSCODES || '[]')
      })) || [];

      res.json({
        ...employee,
        requests,
        passes
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch employee details" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/employees", authorize(['admin', 'approver', 'applier']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const data = req.body;
      const { orgId } = await getTenantOrgId(req, connection);
      const effectiveOrgId = orgId || data.organizationId || 'org-habari';

      // Tenant Quotas & Usage Limits: maxEmployees
      const orgRes = await connection.execute(
        `SELECT maxEmployees, name FROM organizations WHERE id = :id`,
        [effectiveOrgId],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if (orgRes.rows && orgRes.rows.length > 0) {
        const maxEmp = (orgRes.rows[0] as any).MAXEMPLOYEES;
        if (maxEmp && maxEmp > 0) {
          const empCountRes = await connection.execute(
            `SELECT COUNT(*) AS CNT FROM employees WHERE organizationId = :orgId`,
            [effectiveOrgId],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );
          const currEmp = (empCountRes.rows?.[0] as any)?.CNT || 0;
          if (currEmp >= maxEmp) {
            return res.status(400).json({
              error: `Organization personnel roster quota reached (${currEmp}/${maxEmp} employees). Please upgrade license capacity to register additional employees.`
            });
          }
        }
      }

      // Duplicate Check: EMP CODE (employeeId) or QID/Visa (qidVisaNumber) within organization
      if (data.employeeId || data.qidVisaNumber) {
        const checkSql = `SELECT id, name FROM employees WHERE ((employeeId = :employeeId AND employeeId IS NOT NULL) OR (qidVisaNumber = :qidVisaNumber AND qidVisaNumber IS NOT NULL)) AND (organizationId = :orgId OR organizationId IS NULL)`;
        const checkResult = await connection.execute(checkSql, { 
          employeeId: data.employeeId || null, 
          qidVisaNumber: data.qidVisaNumber || null,
          orgId: effectiveOrgId
        }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        if (checkResult.rows && checkResult.rows.length > 0) {
          return res.status(400).json({ error: "Duplicate employee detected (EMP CODE or QID/Visa already exists)" });
        }
      }

      // Selection only check
      try {
        await validateEmployeeReferences(connection, data, effectiveOrgId);
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }

      const newEmployee = toOracleKeys({ 
        status: 'active',
        ...data, 
        organizationId: effectiveOrgId,
        id: Math.random().toString(36).substr(2, 9) 
      });
      
      const validColumns = [
        'ID', 'FIRSTNAME', 'LASTNAME', 'FIRSTNAMEALT', 'LASTNAMEALT', 
        'PASSPORTNUMBER', 'PASSPORTEXPIRY', 'VISANUMBER', 'VISAEXPIRY', 
        'QATARID', 'EMPLOYEETYPE', 'SPONSORNAME', 'DIVISION', 'DEPARTMENT', 'PROJECT',
        'JOBTITLE', 'MOBILENUMBER', 'EMAIL', 'EMPLOYEEID', 'NAME', 'STATUS',
        'QIDVISANUMBER', 'QIDVISAEXPIRY', 'SAFETYINDUCTIONDATE', 'ORGANIZATIONID'
      ];

      const filteredEmployee: any = {};
      validColumns.forEach(col => {
        if (newEmployee[col] !== undefined) {
          filteredEmployee[col] = newEmployee[col];
        }
      });

      const columns = Object.keys(filteredEmployee).join(', ');
      const placeholders = Object.keys(filteredEmployee).map((_, i) => `:${i + 1}`).join(', ');
      const values = Object.values(filteredEmployee);
      
      await connection.execute(
        `INSERT INTO employees (${columns}) VALUES (${placeholders})`,
        values
      );
      await connection.commit();
      
      logAction(req, 'CREATE', 'employee', filteredEmployee.ID, `Created employee ${filteredEmployee.NAME}`);
      res.json(toCamelCase(filteredEmployee));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create employee" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/employees/batch", authorize(['admin', 'approver']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const employees = req.body;
      if (!Array.isArray(employees)) {
        return res.status(400).json({ error: "Expected an array of employees" });
      }

      const { orgId } = await getTenantOrgId(req, connection);
      const effectiveOrgId = (req.headers['x-user-org-id'] as string) || orgId || 'org-habari';

      // Check maxEmployees quota
      const orgRes = await connection.execute(
        `SELECT maxEmployees, name FROM organizations WHERE id = :id`,
        [effectiveOrgId],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if (orgRes.rows && orgRes.rows.length > 0) {
        const maxEmp = (orgRes.rows[0] as any).MAXEMPLOYEES;
        if (maxEmp && maxEmp > 0) {
          const empCountRes = await connection.execute(
            `SELECT COUNT(*) AS CNT FROM employees WHERE organizationId = :orgId`,
            [effectiveOrgId],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );
          const currEmp = (empCountRes.rows?.[0] as any)?.CNT || 0;
          if (currEmp + employees.length > maxEmp) {
            return res.status(400).json({
              error: `Batch exceeds employee roster quota: currently ${currEmp}/${maxEmp} employees registered. Adding ${employees.length} would exceed quota limit.`
            });
          }
        }
      }

      const validColumns = [
        'ID', 'FIRSTNAME', 'LASTNAME', 'FIRSTNAMEALT', 'LASTNAMEALT', 
        'PASSPORTNUMBER', 'PASSPORTEXPIRY', 'VISANUMBER', 'VISAEXPIRY', 
        'QATARID', 'EMPLOYEETYPE', 'SPONSORNAME', 'DIVISION', 'DEPARTMENT', 'PROJECT',
        'JOBTITLE', 'MOBILENUMBER', 'EMAIL', 'EMPLOYEEID', 'NAME', 'STATUS',
        'QIDVISANUMBER', 'QIDVISAEXPIRY', 'SAFETYINDUCTIONDATE', 'ORGANIZATIONID'
      ];

      const results = {
        created: 0,
        skipped: 0,
        duplicates: [] as string[]
      };

      const toInsert: any[] = [];

      for (const empData of employees) {
        const itemOrgId = empData.organizationId || effectiveOrgId;
        // Selection only check
        try {
          await validateEmployeeReferences(connection, empData, itemOrgId);
        } catch (err: any) {
          results.skipped++;
          results.duplicates.push(`${empData.firstName} ${empData.lastName || ''} - Error: ${err.message}`);
          continue;
        }

        // Duplicate Check: EMP CODE (employeeId) or QID/Visa (qidVisaNumber)
        if (empData.employeeId || empData.qidVisaNumber) {
          const checkSql = `SELECT id, name FROM employees WHERE ((employeeId = :employeeId AND employeeId IS NOT NULL) OR (qidVisaNumber = :qidVisaNumber AND qidVisaNumber IS NOT NULL)) AND (organizationId = :orgId OR organizationId IS NULL)`;
          const checkResult = await connection.execute(checkSql, { 
            employeeId: empData.employeeId || null, 
            qidVisaNumber: empData.qidVisaNumber || null,
            orgId: itemOrgId
          }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

          if (checkResult.rows && checkResult.rows.length > 0) {
            results.skipped++;
            results.duplicates.push(`${empData.firstName} ${empData.lastName || ''} (ID: ${empData.qidVisaNumber || empData.employeeId})`);
            continue;
          }
        }

        const newEmployee = toOracleKeys({ 
          status: 'active',
          ...empData, 
          organizationId: itemOrgId,
          id: Math.random().toString(36).substr(2, 9) 
        });

        const filteredEmployee: any = {};
        validColumns.forEach(col => {
          const val = newEmployee[col];
          filteredEmployee[col] = (val !== undefined && val !== null) ? String(val) : null;
        });

        toInsert.push(filteredEmployee);
      }
      
      if (toInsert.length > 0) {
        const columns = validColumns.join(', ');
        const placeholders = validColumns.map(col => `:${col}`).join(', ');
        
        const bindDefs: any = {};
        validColumns.forEach(col => {
          bindDefs[col] = { type: oracledb.STRING, maxSize: 4000 };
        });

        await connection.executeMany(
          `INSERT INTO employees (${columns}) VALUES (${placeholders})`,
          toInsert,
          { 
            autoCommit: false,
            bindDefs: bindDefs
          }
        );
        results.created = toInsert.length;
      }
      
      await connection.commit();
      logAction(req, 'CREATE', 'employee', 'batch', `Created ${results.created} employees, skipped ${results.skipped} duplicates via batch import`);
      res.json({ success: true, ...results });
    } catch (err: any) {
      console.error('Batch Import Error:', err);
      if (connection) await connection.rollback();
      res.status(500).json({ error: "Failed to batch create employees", details: err.message });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.patch("/api/employees/bulk-status", authorize(['admin', 'approver']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { ids, status } = req.body;
      if (!Array.isArray(ids)) return res.status(400).json({ error: "ids must be an array" });

      const placeholders = ids.map((_, i) => `:${i + 1}`).join(', ');
      await connection.execute(
        `UPDATE employees SET status = :status WHERE id IN (${placeholders})`,
        [status, ...ids]
      );
      await connection.commit();
      logAction(req, 'UPDATE', 'employee', 'bulk', `Updated status to ${status} for ${ids.length} employees`);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update bulk status" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.delete("/api/employees/bulk-delete", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids must be a non-empty array" });

      const placeholders = ids.map((_, i) => `:${i + 1}`).join(', ');
      
      // Auto-cancel active passes
      await connection.execute(
        `UPDATE passes SET status = 'cancelled' WHERE employeeId IN (${placeholders}) AND status IN ('active', 'approved', 'collected', 'processing', 'pending')`,
        ids
      );

      // Auto-cancel application member entries
      await connection.execute(
        `UPDATE passRequestEmployees SET status = 'cancelled' WHERE employeeId IN (${placeholders}) AND status IN ('processing', 'approved', 'pending')`,
        ids
      );

      await connection.execute(
        `DELETE FROM employees WHERE id IN (${placeholders})`,
        ids
      );
      await connection.commit();
      logAction(req, 'DELETE', 'employee', 'bulk', `Deleted ${ids.length} employees and cancelled associated active passes/applications`);
      res.json({ success: true });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Failed to bulk delete employees", details: err.message });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.delete("/api/employees/:id", authorize(['admin', 'approver']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const empId = req.params.id;

      // Auto-cancel active passes
      await connection.execute(
        `UPDATE passes SET status = 'cancelled' WHERE employeeId = :empId AND status IN ('active', 'approved', 'collected', 'processing', 'pending')`,
        [empId]
      );

      // Auto-cancel application member entries
      await connection.execute(
        `UPDATE passRequestEmployees SET status = 'cancelled' WHERE employeeId = :empId AND status IN ('processing', 'approved', 'pending')`,
        [empId]
      );

      await connection.execute(
        `DELETE FROM employees WHERE id = :empId`,
        [empId]
      );
      await connection.commit();
      logAction(req, 'DELETE', 'employee', empId, `Deleted employee ${empId} and cancelled associated passes/applications`);
      res.json({ success: true });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete employee", details: err.message });
    } finally {
      if (connection) await connection.close();
    }
  });
  app.patch("/api/employees/:id", authorize(['admin', 'approver', 'applier']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      
      // Selection only check
      try {
        await validateEmployeeReferences(connection, req.body);
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }

      const updates = toOracleKeys(req.body);
      const validColumns = [
        'FIRSTNAME', 'LASTNAME', 'FIRSTNAMEALT', 'LASTNAMEALT', 
        'PASSPORTNUMBER', 'PASSPORTEXPIRY', 'VISANUMBER', 'VISAEXPIRY', 
        'QATARID', 'EMPLOYEETYPE', 'SPONSORNAME', 'DIVISION', 'DEPARTMENT', 'PROJECT',
        'JOBTITLE', 'MOBILENUMBER', 'EMAIL', 'EMPLOYEEID', 'NAME', 'STATUS',
        'QIDVISANUMBER', 'QIDVISAEXPIRY', 'SAFETYINDUCTIONDATE'
      ];

      const filteredUpdates: any = {};
      validColumns.forEach(col => {
        if (updates[col] !== undefined) {
          filteredUpdates[col] = updates[col];
        }
      });

      if (Object.keys(filteredUpdates).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      const setClause = Object.keys(filteredUpdates).map(key => `${key} = :${key}`).join(', ');
      
      await connection.execute(
        `UPDATE employees SET ${setClause} WHERE id = :id`,
        { ...filteredUpdates, id: req.params.id }
      );
      await connection.commit();
      
      logAction(req, 'UPDATE', 'employee', req.params.id, `Updated employee ${req.params.id}`);
      res.json({ id: req.params.id, ...updates });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update employee" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.get("/api/locations", authorize(['admin', 'approver', 'applier', 'viewer']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId, isPowerAdmin } = await getTenantOrgId(req, connection);
      let query = `SELECT * FROM locations`;
      const binds: any = {};
      if (orgId && !isPowerAdmin) {
        query += ` WHERE (organizationId = :orgId OR isGlobal = 1 OR (organizationId IS NULL AND :isDefaultOrg = 1))`;
        binds.orgId = orgId;
        binds.isDefaultOrg = orgId === 'org-habari' ? 1 : 0;
      }
      query += ` ORDER BY name ASC`;
      const result = await connection.execute(query, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      res.json(result.rows?.map(toCamelCase));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch locations" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/locations", authorize(['admin', 'power_admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId, isPowerAdmin } = await getTenantOrgId(req, connection);
      const isGlobal = req.body.isGlobal ? 1 : 0;
      const effectiveOrgId = isGlobal ? null : (orgId || req.body.organizationId || 'org-habari');
      const newLocation = toOracleKeys({ 
        ...req.body, 
        id: Math.random().toString(36).substr(2, 9),
        organizationId: effectiveOrgId,
        isGlobal: isGlobal,
        securityLevel: req.body.securityLevel || 'Level 1: General Access'
      });
      
      await connection.execute(
        `INSERT INTO locations (id, name, code, description, categoryId, organizationId, isGlobal, securityLevel) 
         VALUES (:ID, :NAME, :CODE, :DESCRIPTION, :CATEGORYID, :ORGANIZATIONID, :ISGLOBAL, :SECURITYLEVEL)`,
        newLocation
      );
      await connection.commit();
      
      logAction(req, 'CREATE', 'location', newLocation.ID, `Created location ${newLocation.NAME}`);
      res.json(toCamelCase(newLocation));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create location" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/locations/batch", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      const effectiveOrgId = orgId || 'org-habari';
      const newLocations = req.body.map((loc: any) => toOracleKeys({
        ...loc,
        id: Math.random().toString(36).substr(2, 9),
        organizationId: loc.organizationId || effectiveOrgId
      }));
      
      for (const loc of newLocations) {
        await connection.execute(
          `INSERT INTO locations (id, name, code, description, categoryId, organizationId) VALUES (:ID, :NAME, :CODE, :DESCRIPTION, :CATEGORYID, :ORGANIZATIONID)`,
          loc
        );
      }
      await connection.commit();
      
      logAction(req, 'BATCH_CREATE', 'location', 'batch', `Imported ${newLocations.length} locations`);
      res.json(newLocations.map(toCamelCase));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to batch create locations" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.get("/api/categories", authorize(['admin', 'approver', 'applier', 'viewer']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId, isPowerAdmin } = await getTenantOrgId(req, connection);
      let query = `SELECT * FROM categories`;
      const binds: any = {};
      if (orgId && !isPowerAdmin) {
        query += ` WHERE (organizationId = :orgId OR (organizationId IS NULL AND :isDefaultOrg = 1))`;
        binds.orgId = orgId;
        binds.isDefaultOrg = orgId === 'org-habari' ? 1 : 0;
      }
      query += ` ORDER BY name ASC`;
      const result = await connection.execute(query, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      res.json(result.rows?.map(toCamelCase));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch categories" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/categories", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      const effectiveOrgId = orgId || req.body.organizationId || 'org-habari';
      const newCategory = toOracleKeys({ 
        ...req.body, 
        id: Math.random().toString(36).substr(2, 9),
        organizationId: effectiveOrgId
      });
      
      await connection.execute(
        `INSERT INTO categories (id, name, organizationId) VALUES (:ID, :NAME, :ORGANIZATIONID)`,
        newCategory
      );
      await connection.commit();
      
      logAction(req, 'CREATE', 'category', newCategory.ID, `Created category ${newCategory.NAME}`);
      res.json(toCamelCase(newCategory));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create category" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.patch("/api/locations/:id", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const updates = toOracleKeys(req.body);
      delete updates.ID;
      const setClause = Object.keys(updates).map(k => `${k} = :${k}`).join(', ');
      
      await connection.execute(
        `UPDATE locations SET ${setClause} WHERE id = :id`,
        { ...updates, id: req.params.id }
      );
      await connection.commit();
      logAction(req, 'UPDATE', 'location', req.params.id, `Updated location ${req.params.id}`);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update location" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.patch("/api/categories/:id", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const updates = toOracleKeys(req.body);
      delete updates.ID;
      const setClause = Object.keys(updates).map(k => `${k} = :${k}`).join(', ');
      
      await connection.execute(
        `UPDATE categories SET ${setClause} WHERE id = :id`,
        { ...updates, id: req.params.id }
      );
      await connection.commit();
      logAction(req, 'UPDATE', 'category', req.params.id, `Updated category ${req.params.id}`);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update category" });
    } finally {
      if (connection) await connection.close();
    }
  });

  async function ensurePassesAndExpiriesSynced(connection: any) {
    try {
      // Backfill missing passNumbers on already existing passes only if needed
      const missingPasses = await connection.execute(
        `SELECT id FROM passes WHERE passNumber IS NULL OR passNumber = ''`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if (missingPasses.rows && missingPasses.rows.length > 0) {
        const year = new Date().getFullYear();
        for (const pRow of (missingPasses.rows as any[])) {
          const pId = pRow.ID || pRow.id;
          const rnd = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
          const num = `PASS-${year}-${rnd}`;
          await connection.execute(`UPDATE passes SET passNumber = :num WHERE id = :pId`, { num, pId });
        }
        await connection.commit();
      }
      // Sync pending applications whose employeeStatuses might have been incorrectly set to processing on creation
      const pendingApps = await connection.execute(
        `SELECT id, employeeStatuses, employeeIds FROM passRequests WHERE LOWER(status) IN ('pending', 'under_review')`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if (pendingApps.rows && pendingApps.rows.length > 0) {
        for (const row of (pendingApps.rows as any[])) {
          const empStatuses = JSON.parse(row.EMPLOYEESTATUSES || '{}');
          const empIds = JSON.parse(row.EMPLOYEEIDS || '[]');
          let changed = false;
          empIds.forEach((id: string) => {
            if (empStatuses[id] === 'processing') {
              empStatuses[id] = 'pending';
              changed = true;
            }
          });
          if (changed) {
            await connection.execute(
              `UPDATE passRequests SET employeeStatuses = :statuses WHERE id = :id`,
              { statuses: JSON.stringify(empStatuses), id: row.ID }
            );
            await connection.execute(
              `UPDATE passRequestEmployees SET status = 'pending' WHERE UPPER(requestId) = UPPER(:id) AND status = 'processing'`,
              { id: row.ID }
            );
          }
        }
        await connection.commit();
      }
    } catch (err) {
      console.error("ensurePassesAndExpiriesSynced error:", err);
    }
  }

  app.get("/api/passApplications", authorize(['admin', 'approver', 'applier', 'viewer']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      let sql = `SELECT * FROM passRequests`;
      const binds: any = {};
      if (orgId) {
        sql += ` WHERE organizationId = :orgId`;
        binds.orgId = orgId;
      }
      sql += ` ORDER BY createdAt DESC`;

      const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });

      const requests = result.rows?.map((r: any) => {
        const camel = toCamelCase(r);
        return {
          ...camel,
          employeeIds: JSON.parse(r.EMPLOYEEIDS || '[]'),
          employeeStatuses: JSON.parse(r.EMPLOYEESTATUSES || '{}'),
          temporaryNames: JSON.parse(r.TEMPORARYNAMES || '[]'),
          accessCodes: JSON.parse(r.ACCESSCODES || '[]'),
          individualExpiries: JSON.parse(r.INDIVIDUALEXPIRIES || '{}'),
          individualStartDates: JSON.parse(r.INDIVIDUALSTARTDATES || '{}')
        };
      }) || [];

      res.json(requests);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch applications" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/passApplications", authorize(['admin', 'approver', 'applier']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const employeeStatuses = {};
      const employeeIds = Array.from(new Set(req.body.employeeIds || [])) as string[];
      
      // Prevent overlapping pending/approved applications for same location/employees
      const locationId = req.body.locationId;
      if (locationId) {
        for (const empId of employeeIds) {
          const overlap = await connection.execute(
            `SELECT id FROM passRequests 
             WHERE locationId = :locId 
             AND status IN ('processing', 'approved') 
             AND employeeIds LIKE :empPattern`,
            { 
              locId: locationId, 
              empPattern: `%${empId}%` 
            }
          );
          if (overlap.rows?.length > 0) {
             // We'll log it but let it pass for now if they really want to, 
             // but maybe it's better to block? 
             // The frontend already blocks it now.
          }
        }
      }

      employeeIds.forEach((id: string) => {
        employeeStatuses[id] = req.body.employeeStatuses?.[id] || req.body.status || 'pending';
      });

      const allowedFields = [
        'requesterId', 'locationId', 'purpose', 'startDate', 'endDate', 
        'status', 'authorityAppNumber', 'parentPassId', 'remarks', 'expiryDate', 'type',
        'projectId', 'contractNumber', 'contractName', 'contractTitle', 'clientCompany', 'clientApprovers'
      ];
      const filteredBody: any = {};
      allowedFields.forEach(field => {
        if (req.body[field] !== undefined) filteredBody[field] = req.body[field];
      });

      // Ensure requesterId is mapped from req.body.requesterId or req.body.applicantId or header
      if (!filteredBody.requesterId) {
        filteredBody.requesterId = req.body.applicantId || (req.headers['x-user-id'] as string) || 'system';
      }

      // Map expiryDate to endDate if provided, or fallback to max individual expiry
      let resolvedEndDate = filteredBody.endDate || filteredBody.expiryDate;
      const individualExpiries = req.body.individualExpiries || {};

      // Validate that each applicant has an individual expiry date (or top-level fallback)
      for (const empId of employeeIds) {
        if (!individualExpiries[empId] && !resolvedEndDate) {
          return res.status(400).json({ error: `Expiry date is required for pass applicant ${empId}.` });
        }
      }

      if (!resolvedEndDate) {
        const indExps = Object.values(individualExpiries).filter(Boolean).sort().reverse() as string[];
        if (indExps.length > 0) {
          resolvedEndDate = indExps[0];
        }
      }

      filteredBody.endDate = resolvedEndDate || null;
      delete filteredBody.expiryDate;

      // Map remarks to purpose if provided
      if (req.body.remarks && !filteredBody.purpose) {
        filteredBody.purpose = req.body.remarks;
      }

      // Validate Expiries
      try {
        const individualExpiries = req.body.individualExpiries || {};
        const validationData = {
          expiryDate: filteredBody.endDate,
          parentPassId: filteredBody.parentPassId
        };
        await validatePassExpiries(connection, employeeIds, validationData, individualExpiries);
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }

      // Applications start in Stage 1: Under Review (pending)
      const requestId = Math.random().toString(36).substr(2, 9).toUpperCase();
      const initialAppStatus = req.body.status || 'pending';
      const { orgId } = await getTenantOrgId(req, connection);
      const effectiveOrgId = orgId || req.body.organizationId || 'org-habari';

      const newRequest = toOracleKeys({ 
        ...filteredBody, 
        type: req.body.type || filteredBody.type || 'main',
        employeeStatuses: JSON.stringify(employeeStatuses),
        employeeIds: JSON.stringify(employeeIds),
        temporaryNames: JSON.stringify(req.body.temporaryNames || []),
        accessCodes: JSON.stringify(req.body.accessCodes || []),
        individualExpiries: JSON.stringify(req.body.individualExpiries || {}),
        individualStartDates: JSON.stringify(req.body.individualStartDates || {}),
        parentPassId: req.body.parentPassId || null,
        organizationId: effectiveOrgId,
        id: requestId, 
        status: initialAppStatus,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      
      const columns = Object.keys(newRequest).join(', ');
      const placeholders = Object.keys(newRequest).map((_, i) => `:${i + 1}`).join(', ');
      const values = Object.values(newRequest);
      
      await connection.execute(
        `INSERT INTO passRequests (${columns}) VALUES (${placeholders})`,
        values
      );

      // Populate passRequestEmployees mapping table for live searchability
      const initialEmployeeStatus = initialAppStatus;
      for (const empId of employeeIds) {
        await connection.execute(
          `INSERT INTO passRequestEmployees (id, requestId, employeeId, status) 
           VALUES (:id, :requestId, :employeeId, :status)`,
          {
            id: Math.random().toString(36).substr(2, 9),
            requestId: requestId,
            employeeId: empId,
            status: initialEmployeeStatus
          }
        );
      }

      // Populate passRequestAccessCodes mapping table
      const accessCodeIds = Array.from(new Set(req.body.accessCodeIds || []));
      for (const acId of accessCodeIds) {
        await connection.execute(
          `INSERT INTO passRequestAccessCodes (id, requestId, accessCodeId) 
           VALUES (:id, :requestId, :accessCodeId)`,
          {
            id: Math.random().toString(36).substr(2, 9),
            requestId: requestId,
            accessCodeId: acId
          }
        );
      }

      await connection.commit();
      
      logAction(req, 'CREATE', 'application', requestId, `Created pass application for ${employeeIds.length} employees`);
      res.json({
        ...newRequest,
        id: requestId,
        employeeIds: employeeIds,
        employeeStatuses: employeeStatuses
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create application" });
    } finally {
      if (connection) await connection.close();
    }
  });

  /**
   * Defined Sub-Process Effect:
   * When Application Process / Stage / Status changes, trigger the defined sub-process effect
   * on individual applicant / pass statuses while preserving independent changeability.
   */
  async function applyApplicationStatusSubProcessEffect(
    connection: any,
    applicationId: string,
    targetStatus: string,
    now: string
  ) {
    const normStatus = (targetStatus || '').toLowerCase();
    
    // Fetch current application record
    const appResult = await connection.execute(
      `SELECT * FROM passRequests WHERE UPPER(id) = UPPER(:id)`,
      { id: applicationId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const appRow = appResult.rows?.[0] as any;
    if (!appRow) return null;

    let employeeStatuses: Record<string, string> = JSON.parse(appRow.EMPLOYEESTATUSES || '{}');
    let employeeIds: string[] = JSON.parse(appRow.EMPLOYEEIDS || '[]');
    
    employeeIds.forEach(empId => {
      if (!employeeStatuses[empId]) {
        employeeStatuses[empId] = 'pending';
      }
    });

    const wasRejectedOrCancelled = ['rejected', 'cancelled'].includes((appRow.STATUS || '').toLowerCase()) ||
      (employeeIds.length > 0 && employeeIds.every(id => ['rejected', 'cancelled'].includes((employeeStatuses[id] || '').toLowerCase())));

    if (['rejected', 'cancelled'].includes(normStatus)) {
      // Application rejected/cancelled -> cascade effect to all applicants
      employeeIds.forEach(empId => {
        employeeStatuses[empId] = normStatus;
      });
      // Cascade effect to associated passes
      await connection.execute(
        `UPDATE passes SET status = :status, updatedAt = :updatedAt WHERE UPPER(requestId) = UPPER(:id)`,
        { status: normStatus, updatedAt: now, id: applicationId }
      );
    } else if (['collected', 'completed', 'active'].includes(normStatus)) {
      // Stage 4 Completed: Pass Issuance & Collection / Active Access
      // Update non-terminal applicants to 'collected'
      employeeIds.forEach(empId => {
        const s = (employeeStatuses[empId] || '').toLowerCase();
        if (wasRejectedOrCancelled || !['rejected', 'cancelled', 'revoked'].includes(s)) {
          employeeStatuses[empId] = 'collected';
        }
      });
      // Update existing passes to 'active' or 'collected'
      await connection.execute(
        `UPDATE passes SET status = 'active', updatedAt = :updatedAt 
         WHERE UPPER(requestId) = UPPER(:id) AND LOWER(status) NOT IN ('revoked', 'expired')`,
        { updatedAt: now, id: applicationId }
      );

      // Check if any applicant is missing a pass record in the passes table, and auto-provision it
      const existingPassesRes = await connection.execute(
        `SELECT employeeId FROM passes WHERE UPPER(requestId) = UPPER(:id)`,
        { id: applicationId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const existingEmpIds = new Set((existingPassesRes.rows || []).map((r: any) => r.EMPLOYEEID || r.employeeId));
      
      const indExpiries = JSON.parse(appRow.INDIVIDUALEXPIRIES || '{}');
      const indStartDates = JSON.parse(appRow.INDIVIDUALSTARTDATES || '{}');
      const getOneYearLater = (sStr?: string) => {
        const d = sStr ? new Date(sStr) : new Date();
        if (isNaN(d.getTime())) {
          const n = new Date();
          n.setFullYear(n.getFullYear() + 1);
          return n.toISOString().split('T')[0];
        }
        d.setFullYear(d.getFullYear() + 1);
        return d.toISOString().split('T')[0];
      };

      for (const empId of employeeIds) {
        if (!existingEmpIds.has(empId)) {
          const s = (employeeStatuses[empId] || '').toLowerCase();
          if (!wasRejectedOrCancelled && ['rejected', 'cancelled', 'revoked'].includes(s)) continue;

          const passId = Math.random().toString(36).substr(2, 9);
          const year = new Date().getFullYear();
          const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
          const passNumber = `PASS-${year}-${random}`;
          const empStart = indStartDates[empId] || appRow.STARTDATE || now.split('T')[0];
          const empExpiry = indExpiries[empId] || appRow.ENDDATE || appRow.EXPIRYDATE || getOneYearLater(empStart);

          await connection.execute(
            `INSERT INTO passes (id, requestId, employeeId, locationId, type, status, parentPassId, authorityAppNumber, accessCodes, startDate, expiryDate, passNumber, createdAt, updatedAt, projectId, contractNumber, contractName, clientCompany, clientApprovers)
             VALUES (:id, :requestId, :employeeId, :locationId, :type, :status, :parentPassId, :authorityAppNumber, :accessCodes, :startDate, :expiryDate, :passNumber, :createdAt, :updatedAt, :projectId, :contractNumber, :contractName, :clientCompany, :clientApprovers)`,
            {
              id: passId,
              requestId: applicationId,
              employeeId: empId,
              locationId: appRow.LOCATIONID,
              type: appRow.TYPE || 'main',
              status: 'active',
              parentPassId: appRow.PARENTPASSID || null,
              authorityAppNumber: appRow.AUTHORITYAPPNUMBER || null,
              accessCodes: appRow.ACCESSCODES || '[]',
              startDate: empStart,
              expiryDate: empExpiry,
              passNumber: passNumber,
              createdAt: appRow.CREATEDAT || now,
              updatedAt: now,
              projectId: appRow.PROJECTID || null,
              contractNumber: appRow.CONTRACTNUMBER || null,
              contractName: appRow.CONTRACTNAME || null,
              clientCompany: appRow.CLIENTCOMPANY || null,
              clientApprovers: appRow.CLIENTAPPROVERS || null
            }
          );
        }
      }
    } else if (['issued', 'ready_for_collection', 'partially_issued'].includes(normStatus)) {
      // Stage 4: Pass Issuance & Collection (Pass Issued)
      employeeIds.forEach(empId => {
        const s = (employeeStatuses[empId] || '').toLowerCase();
        if (wasRejectedOrCancelled || !['rejected', 'cancelled', 'revoked'].includes(s)) {
          employeeStatuses[empId] = 'issued';
        }
      });
      await connection.execute(
        `UPDATE passes SET status = 'issued', updatedAt = :updatedAt 
         WHERE UPPER(requestId) = UPPER(:id) AND LOWER(status) NOT IN ('revoked', 'expired', 'active', 'collected')`,
        { updatedAt: now, id: applicationId }
      );
    } else if (['accepted', 'approved'].includes(normStatus)) {
      // Stage 3: Accepted for Processing (Pass not issued yet)
      employeeIds.forEach(empId => {
        const s = (employeeStatuses[empId] || '').toLowerCase();
        if (wasRejectedOrCancelled || !['rejected', 'cancelled', 'revoked'].includes(s)) {
          employeeStatuses[empId] = 'accepted';
        }
      });
      // Revert passes back to pending state awaiting physical issuance
      await connection.execute(
        `UPDATE passes SET status = 'pending', updatedAt = :updatedAt 
         WHERE UPPER(requestId) = UPPER(:id) AND LOWER(status) IN ('active', 'collected', 'issued', 'rejected', 'cancelled')`,
        { updatedAt: now, id: applicationId }
      );
    } else if (['processing', 'under_processing', 'forwarded', 'clarification'].includes(normStatus)) {
      // Stage 2: Under Processing
      employeeIds.forEach(empId => {
        const s = (employeeStatuses[empId] || '').toLowerCase();
        if (wasRejectedOrCancelled || !['rejected', 'cancelled', 'revoked'].includes(s)) {
          employeeStatuses[empId] = 'processing';
        }
      });
      // If moved back to Stage 2, revert passes to pending
      await connection.execute(
        `UPDATE passes SET status = 'pending', updatedAt = :updatedAt 
         WHERE UPPER(requestId) = UPPER(:id) AND LOWER(status) IN ('active', 'collected', 'approved', 'accepted', 'issued', 'rejected', 'cancelled')`,
        { updatedAt: now, id: applicationId }
      );
    } else if (['pending', 'under_review', 'review'].includes(normStatus)) {
      // Stage 1: Under Review
      employeeIds.forEach(empId => {
        const s = (employeeStatuses[empId] || '').toLowerCase();
        if (wasRejectedOrCancelled || !['rejected', 'cancelled', 'revoked'].includes(s)) {
          employeeStatuses[empId] = 'pending';
        }
      });
      await connection.execute(
        `UPDATE passes SET status = 'pending', updatedAt = :updatedAt 
         WHERE UPPER(requestId) = UPPER(:id) AND LOWER(status) IN ('active', 'collected', 'approved', 'accepted', 'issued', 'processing', 'rejected', 'cancelled')`,
        { updatedAt: now, id: applicationId }
      );
    }

    // Persist updated employeeStatuses to the application and mapping table
    await connection.execute(
      `UPDATE passRequests SET employeeStatuses = :statuses, updatedAt = :updatedAt WHERE UPPER(id) = UPPER(:id)`,
      { statuses: JSON.stringify(employeeStatuses), updatedAt: now, id: applicationId }
    );

    for (const empId of employeeIds) {
      const s = employeeStatuses[empId] || normStatus;
      await connection.execute(
        `UPDATE passRequestEmployees SET status = :status WHERE UPPER(requestId) = UPPER(:id) AND employeeId = :empId`,
        { status: s, id: applicationId, empId }
      );
    }

    return employeeStatuses;
  }

  app.patch("/api/passApplications/:id", authorize(['admin', 'approver', 'applier']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      
      const allowedUpdateFields = [
        'requesterId', 'locationId', 'purpose', 'startDate', 'endDate', 
        'status', 'authorityAppNumber', 'parentPassId', 'remarks', 'approvalRemarks',
        'employeeIds', 'employeeStatuses', 'accessCodes', 'individualExpiries', 'individualStartDates', 'temporaryNames', 'type',
        'projectId', 'contractNumber', 'contractName', 'contractTitle', 'clientCompany', 'clientApprovers', 'expiryDate'
      ];
      const filteredUpdates: any = { updatedAt: new Date().toISOString() };
      allowedUpdateFields.forEach(field => {
        if (req.body[field] !== undefined) filteredUpdates[field] = req.body[field];
      });

      // Map expiryDate to endDate if sent in PATCH
      if ('expiryDate' in req.body) {
        if (!filteredUpdates.endDate) {
          filteredUpdates.endDate = req.body.expiryDate;
        }
      }

      const updates = toOracleKeys(filteredUpdates);
      delete updates.ID;
      
      const setClause = Object.keys(updates).map(key => `${key} = :${key}`).join(', ');
      await connection.execute(
        `UPDATE passRequests SET ${setClause} WHERE UPPER(id) = UPPER(:id)`,
        { ...updates, id: req.params.id }
      );

      // Trigger defined sub-process effect if application status was updated
      if (req.body.status && req.body.employeeStatuses === undefined) {
        await applyApplicationStatusSubProcessEffect(connection, req.params.id, req.body.status, filteredUpdates.updatedAt);
      }

      // Sync existing pass dates, locations, accessCodes and contract details if updated
      const newLoc = req.body.locationId;
      const newAuth = req.body.authorityAppNumber;
      const newStart = req.body.startDate;
      const newExp = req.body.endDate || req.body.expiryDate;
      const newType = req.body.type;
      const newParent = req.body.parentPassId;
      const newAccessCodes = req.body.accessCodes;
      const newContractNum = req.body.contractNumber;
      const newContractName = req.body.contractName;
      const newClientCo = req.body.clientCompany;
      const newClientAppr = req.body.clientApprovers;
      const newIndExpiries = req.body.individualExpiries;
      const newIndStartDates = req.body.individualStartDates;

      if (newLoc || newAuth || newStart || newExp || newType || newParent !== undefined || newAccessCodes !== undefined || newContractNum !== undefined || newContractName !== undefined || newClientCo !== undefined || newClientAppr !== undefined) {
        const passUpdates: string[] = ['updatedAt = :passUpdatedAt'];
        const passBinds: any = { passUpdatedAt: new Date().toISOString(), reqId: req.params.id };
        if (newLoc) { passUpdates.push('locationId = :passLoc'); passBinds.passLoc = newLoc; }
        if (newAuth) { passUpdates.push('authorityAppNumber = :passAuth'); passBinds.passAuth = newAuth; }
        if (newStart) { passUpdates.push('startDate = :passStart'); passBinds.passStart = newStart; }
        if (newExp) { passUpdates.push('expiryDate = :passExp'); passBinds.passExp = newExp; }
        if (newType) { passUpdates.push('type = :passType'); passBinds.passType = newType; }
        if (newParent !== undefined) { passUpdates.push('parentPassId = :passParent'); passBinds.passParent = newParent; }
        if (newAccessCodes !== undefined) { passUpdates.push('accessCodes = :passCodes'); passBinds.passCodes = JSON.stringify(newAccessCodes); }
        if (newContractNum !== undefined) { passUpdates.push('contractNumber = :passContractNum'); passBinds.passContractNum = newContractNum; }
        if (newContractName !== undefined) { passUpdates.push('contractName = :passContractName'); passBinds.passContractName = newContractName; }
        if (newClientCo !== undefined) { passUpdates.push('clientCompany = :passClientCo'); passBinds.passClientCo = newClientCo; }
        if (newClientAppr !== undefined) { passUpdates.push('clientApprovers = :passClientAppr'); passBinds.passClientAppr = newClientAppr; }

        await connection.execute(
          `UPDATE passes SET ${passUpdates.join(', ')} WHERE UPPER(requestId) = UPPER(:reqId)`,
          passBinds
        );
      }

      // Sync individual per-applicant dates if provided
      if (newIndExpiries || newIndStartDates) {
        const targetEmpIds = new Set([
          ...Object.keys(newIndExpiries || {}),
          ...Object.keys(newIndStartDates || {})
        ]);
        for (const empId of targetEmpIds) {
          const empExp = newIndExpiries?.[empId] || newExp;
          const empStart = newIndStartDates?.[empId] || newStart;
          const indUpdates: string[] = ['updatedAt = :indUpdatedAt'];
          const indBinds: any = { indUpdatedAt: new Date().toISOString(), reqId: req.params.id, empId };
          if (empExp) { indUpdates.push('expiryDate = :empExp'); indBinds.empExp = empExp; }
          if (empStart) { indUpdates.push('startDate = :empStart'); indBinds.empStart = empStart; }
          if (newLoc) { indUpdates.push('locationId = :passLoc'); indBinds.passLoc = newLoc; }
          if (newAuth) { indUpdates.push('authorityAppNumber = :passAuth'); indBinds.passAuth = newAuth; }
          if (newType) { indUpdates.push('type = :passType'); indBinds.passType = newType; }
          if (newParent !== undefined) { indUpdates.push('parentPassId = :passParent'); indBinds.passParent = newParent; }

          await connection.execute(
            `UPDATE passes SET ${indUpdates.join(', ')} WHERE UPPER(requestId) = UPPER(:reqId) AND employeeId = :empId`,
            indBinds
          );
        }
      }

      // Record request history
      const histId = Math.random().toString(36).substr(2, 9);
      const actionText = req.body.status ? `STATUS_UPDATE (${req.body.status})` : 'DATA_UPDATE';
      const remarkText = req.body.approvalRemarks || req.body.remarks || `Application updated: ${req.body.status || 'data change'}`;
      try {
        await connection.execute(
          `INSERT INTO requestHistory (id, requestId, userId, action, remarks, timestamp)
           VALUES (:id, :requestId, :userId, :action, :remarks, :timestamp)`,
          { id: histId, requestId: req.params.id, userId: (req.headers['x-user-id'] as string) || 'system', action: actionText, remarks: remarkText, timestamp: new Date().toISOString() }
        );
      } catch (hErr) {
        console.error("Failed to log requestHistory:", hErr);
      }

      await connection.commit();
      
      logAction(req, 'UPDATE', 'application', req.params.id, `Updated application: ${req.body.status || 'data update'}`);
      res.json({ id: req.params.id, ...updates });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update application" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // Explicit route for Updating Application Status (used by ApplicationDetail modal)
  app.patch("/api/passApplications/:id/status", authorize(['admin', 'approver', 'applier']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { status, remarks, approvalRemarks, approverId } = req.body;
      const now = new Date().toISOString();

      const result = await connection.execute(`SELECT * FROM passRequests WHERE UPPER(id) = UPPER(:id)`, [req.params.id]);
      const application = result.rows?.[0] as any;
      if (!application) return res.status(404).json({ error: "Application not found" });

      const updates: any = { status, updatedAt: now };
      if (remarks) updates.remarks = remarks;
      if (approvalRemarks) updates.approvalRemarks = approvalRemarks;
      const activeUserId = (req.headers['x-user-id'] as string) || '';
      if (approverId) {
        updates.approverId = approverId;
      } else if (activeUserId && activeUserId !== 'System') {
        updates.approverId = activeUserId;
      }

      const dbUpdates = toOracleKeys(updates);
      const setClause = Object.keys(dbUpdates).map(key => `${key} = :${key}`).join(', ');
      await connection.execute(
        `UPDATE passRequests SET ${setClause} WHERE UPPER(id) = UPPER(:id)`,
        { ...dbUpdates, id: req.params.id }
      );

      // Trigger defined sub-process effect on applicant/pass statuses
      const updatedEmpStatuses = await applyApplicationStatusSubProcessEffect(connection, req.params.id, status, now);
      if (updatedEmpStatuses) {
        updates.employeeStatuses = updatedEmpStatuses;
      }

      // Record request history
      const histId = Math.random().toString(36).substr(2, 9);
      try {
        await connection.execute(
          `INSERT INTO requestHistory (id, requestId, userId, action, remarks, timestamp)
           VALUES (:id, :requestId, :userId, :action, :remarks, :timestamp)`,
          {
            id: histId,
            requestId: req.params.id,
            userId: approverId || (req.headers['x-user-id'] as string) || 'system',
            action: `STATUS_CHANGE (${(status || '').toUpperCase()})`,
            remarks: approvalRemarks || remarks || `Application status changed to ${status}`,
            timestamp: now
          }
        );
      } catch (hErr) {
        console.error("Failed to log request history:", hErr);
      }

      await connection.commit();
      const notifyUserId = application.REQUESTERID || application.requesterId;
      if (notifyUserId && notifyUserId !== 'system') {
        await createNotification(connection, {
          userId: notifyUserId,
          organizationId: application.ORGANIZATIONID || application.organizationId || null,
          type: 'application_status',
          title: `Application ${req.params.id} status updated`,
          message: `Your pass application is now: ${status}`,
          entityType: 'application',
          entityId: req.params.id,
        });
      }
      logAction(req, 'STATUS_CHANGE', 'application', req.params.id, `Changed status to ${status}`);
      res.json({ id: req.params.id, status, ...updates });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update application status" });
    } finally {
      if (connection) await connection.close();
    }
  });

  const getAppHistoryHandler = async (req: express.Request, res: express.Response) => {
    let connection;
    try {
      connection = await getConnection();
      const appId = req.params.id;

      // 1. Fetch from requestHistory table
      const histResult = await connection.execute(
        `SELECT * FROM requestHistory 
         WHERE UPPER(requestId) = UPPER(:id) 
            OR UPPER(requestId) IN (SELECT UPPER(id) FROM passRequests WHERE UPPER(authorityAppNumber) = UPPER(:id))
         ORDER BY timestamp DESC`,
        { id: appId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const histList = (histResult.rows || []).map(toCamelCase);

      // 2. Fetch relevant records from auditLogs table if applicable
      const auditResult = await connection.execute(
        `SELECT id, userId, userName as userEmail, action, details as remarks, "TIMESTAMP" as timestamp 
         FROM auditLogs 
         WHERE UPPER(entityId) = UPPER(:id) OR UPPER(details) LIKE '%' || UPPER(:id) || '%'
         ORDER BY "TIMESTAMP" DESC`,
        { id: appId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const auditList = (auditResult.rows || []).map(toCamelCase).map((a: any) => ({
        ...a,
        requestId: appId,
        action: a.action || 'AUDIT_LOG'
      }));

      // Combine and deduplicate by action + timestamp + remarks
      const combined = [...histList];
      const existingKeys = new Set(histList.map((h: any) => `${h.action}_${h.timestamp}_${h.remarks}`));

      auditList.forEach((a: any) => {
        const key = `${a.action}_${a.timestamp}_${a.remarks}`;
        if (!existingKeys.has(key)) {
          combined.push(a);
        }
      });

      combined.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());

      res.json(combined);
    } catch (err) {
      console.error("Failed to fetch application history:", err);
      res.status(500).json({ error: "Failed to fetch application history" });
    } finally {
      if (connection) await connection.close();
    }
  };

  app.get("/api/passApplications/:id/history", authorize(['admin', 'approver', 'applier', 'viewer']), getAppHistoryHandler);
  app.get("/api/pass-requests/:id/history", authorize(['admin', 'approver', 'applier', 'viewer']), getAppHistoryHandler);

  // Bulk / Member status update route
  const handleBulkMemberStatus = async (req: express.Request, res: express.Response) => {
    let connection;
    try {
      connection = await getConnection();
      const { employeeIds, status, handoverBy, remarks } = req.body;
      const now = new Date().toISOString();

      const result = await connection.execute(`SELECT * FROM passRequests WHERE UPPER(id) = UPPER(:id)`, [req.params.id]);
      const application = result.rows?.[0] as any;
      if (!application) return res.status(404).json({ error: "Application not found" });

      const employeeStatuses = JSON.parse(application.EMPLOYEESTATUSES || '{}');
      const allEmployeeIds = JSON.parse(application.EMPLOYEEIDS || '[]');
      
      (employeeIds || []).forEach((empId: string) => {
        const lowerStatus = status?.toLowerCase();
        if (lowerStatus === 'collected' || lowerStatus === 'completed') {
          employeeStatuses[empId] = 'collected';
        } else if (lowerStatus === 'issued' || lowerStatus === 'ready_for_collection') {
          employeeStatuses[empId] = 'issued';
        } else if (lowerStatus === 'approved' || lowerStatus === 'accepted') {
          employeeStatuses[empId] = 'accepted';
        } else if (lowerStatus === 'processing' || lowerStatus === 'under_processing') {
          employeeStatuses[empId] = 'processing';
        } else if (lowerStatus === 'pending' || lowerStatus === 'under_review') {
          employeeStatuses[empId] = 'pending';
        } else {
          employeeStatuses[empId] = status;
        }
      });
      
      let newStatus = application.STATUS;
      const allCancelledOrRejected = allEmployeeIds.length > 0 && allEmployeeIds.every((id: string) => {
        const s = (employeeStatuses[id] || '').toLowerCase();
        return s === 'rejected' || s === 'cancelled';
      });

      const nonCancelledIds = allEmployeeIds.filter((id: string) => {
        const s = (employeeStatuses[id] || '').toLowerCase();
        return s !== 'rejected' && s !== 'cancelled';
      });

      if (allCancelledOrRejected) {
        const firstStatus = employeeStatuses[allEmployeeIds[0]]?.toLowerCase();
        newStatus = firstStatus || 'cancelled';
      } else if (nonCancelledIds.length > 0) {
        const allCollected = nonCancelledIds.every((id: string) => {
          const s = (employeeStatuses[id] || '').toLowerCase();
          return s === 'completed' || s === 'collected' || s === 'active';
        });
        const allIssuedOrCollected = nonCancelledIds.every((id: string) => {
          const s = (employeeStatuses[id] || '').toLowerCase();
          return s === 'issued' || s === 'ready_for_collection' || s === 'completed' || s === 'collected' || s === 'active';
        });
        const anyIssuedOrCollected = nonCancelledIds.some((id: string) => {
          const s = (employeeStatuses[id] || '').toLowerCase();
          return s === 'issued' || s === 'ready_for_collection' || s === 'completed' || s === 'collected' || s === 'active';
        });
        const allAcceptedOrAbove = nonCancelledIds.every((id: string) => {
          const s = (employeeStatuses[id] || '').toLowerCase();
          return s === 'accepted' || s === 'approved' || s === 'issued' || s === 'ready_for_collection' || s === 'completed' || s === 'collected' || s === 'active';
        });
        const anyProcessingOrAbove = nonCancelledIds.some((id: string) => {
          const s = (employeeStatuses[id] || '').toLowerCase();
          return s === 'processing' || s === 'under_processing' || s === 'accepted' || s === 'approved' || s === 'issued' || s === 'ready_for_collection' || s === 'completed' || s === 'collected' || s === 'active';
        });

        if (allCollected) {
          newStatus = 'completed';
        } else if (allIssuedOrCollected) {
          newStatus = 'issued';
        } else if (anyIssuedOrCollected) {
          newStatus = 'partially_issued';
        } else if (allAcceptedOrAbove) {
          newStatus = 'accepted';
        } else if (anyProcessingOrAbove) {
          newStatus = 'processing';
        } else {
          newStatus = 'pending';
        }
      }

      await connection.execute(
        `UPDATE passRequests SET employeeStatuses = :statuses, status = :status, updatedAt = :updatedAt WHERE UPPER(id) = UPPER(:id)`,
        { statuses: JSON.stringify(employeeStatuses), status: newStatus, updatedAt: now, id: req.params.id }
      );

      // If status is collected/completed, mark the corresponding passes as active/collected with updatedAt timestamp
      const effectiveStatus = status?.toLowerCase();
      if (effectiveStatus === 'collected' || effectiveStatus === 'completed') {
        const locId = application.LOCATIONID;
        for (const empId of (employeeIds || [])) {
          await connection.execute(
            `UPDATE passes SET status = 'expired', updatedAt = :updatedAt WHERE employeeId = :employeeId AND locationId = :locationId AND status = 'active' AND UPPER(requestId) != UPPER(:requestId)`,
            { updatedAt: now, employeeId: empId, locationId: locId, requestId: req.params.id }
          );

          await connection.execute(
            `UPDATE passes SET status = :passStatus, handoverBy = :handoverBy, updatedAt = :updatedAt WHERE UPPER(requestId) = UPPER(:requestId) AND employeeId = :employeeId`,
            { passStatus: status === 'collected' ? 'collected' : 'active', handoverBy: handoverBy || null, updatedAt: now, requestId: req.params.id, employeeId: empId }
          );

          // Get pass ID to cleanup older category passes or create pass if missing
          const pRes = await connection.execute(
            `SELECT id, type FROM passes WHERE UPPER(requestId) = UPPER(:requestId) AND employeeId = :employeeId`,
            { requestId: req.params.id, employeeId: empId },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );
          let pRow = pRes.rows?.[0] as any;

          if (!pRow) {
            // Auto-create pass record if missing in passes table
            const passId = Math.random().toString(36).substr(2, 9);
            const year = new Date().getFullYear();
            const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
            const passNumber = `PASS-${year}-${random}`;
            const indExpiries = JSON.parse(application.INDIVIDUALEXPIRIES || '{}');
            const indStartDates = JSON.parse(application.INDIVIDUALSTARTDATES || '{}');
            const empStart = indStartDates[empId] || application.STARTDATE || now.split('T')[0];
            const getOneYearLater = (sStr?: string) => {
              const d = sStr ? new Date(sStr) : new Date();
              if (isNaN(d.getTime())) {
                const n = new Date();
                n.setFullYear(n.getFullYear() + 1);
                return n.toISOString().split('T')[0];
              }
              d.setFullYear(d.getFullYear() + 1);
              return d.toISOString().split('T')[0];
            };
            const empExpiry = indExpiries[empId] || application.ENDDATE || application.EXPIRYDATE || getOneYearLater(empStart);
            const passStatus = status === 'collected' ? 'collected' : 'active';

            await connection.execute(
              `INSERT INTO passes (id, requestId, employeeId, locationId, type, status, parentPassId, authorityAppNumber, accessCodes, startDate, expiryDate, passNumber, handoverBy, createdAt, updatedAt, projectId, contractNumber, contractName, clientCompany, clientApprovers)
               VALUES (:id, :requestId, :employeeId, :locationId, :type, :status, :parentPassId, :authorityAppNumber, :accessCodes, :startDate, :expiryDate, :passNumber, :handoverBy, :createdAt, :updatedAt, :projectId, :contractNumber, :contractName, :clientCompany, :clientApprovers)`,
              {
                id: passId,
                requestId: req.params.id,
                employeeId: empId,
                locationId: locId,
                type: application.TYPE || 'main',
                status: passStatus,
                parentPassId: application.PARENTPASSID || null,
                authorityAppNumber: application.AUTHORITYAPPNUMBER || null,
                accessCodes: application.ACCESSCODES || '[]',
                startDate: empStart,
                expiryDate: empExpiry,
                passNumber: passNumber,
                handoverBy: handoverBy || null,
                createdAt: application.CREATEDAT || now,
                updatedAt: now,
                projectId: application.PROJECTID || null,
                contractNumber: application.CONTRACTNUMBER || null,
                contractName: application.CONTRACTNAME || null,
                clientCompany: application.CLIENTCOMPANY || null,
                clientApprovers: application.CLIENTAPPROVERS || null
              }
            );
            pRow = { id: passId, type: application.TYPE || 'main' };
          }

          if (pRow) {
            const passId = pRow.ID || pRow.id;
            const passType = (pRow.TYPE || pRow.type || 'main').toLowerCase();
            if (passType === 'main') {
              await cleanupOldCategoryPasses(connection, empId, locId, passId);
            }
          }
        }
      } else if (['cancelled', 'rejected', 'revoked'].includes(effectiveStatus)) {
        for (const empId of (employeeIds || [])) {
          await connection.execute(
            `UPDATE passes SET status = :passStatus, updatedAt = :updatedAt WHERE UPPER(requestId) = UPPER(:requestId) AND employeeId = :employeeId`,
            { passStatus: effectiveStatus, updatedAt: now, requestId: req.params.id, employeeId: empId }
          );
          await connection.execute(
            `UPDATE passes SET status = :passStatus, updatedAt = :updatedAt WHERE parentPassId IN (SELECT id FROM passes WHERE UPPER(requestId) = UPPER(:requestId) AND employeeId = :employeeId)`,
            { passStatus: effectiveStatus, updatedAt: now, requestId: req.params.id, employeeId: empId }
          );
        }
      } else if (['issued', 'ready_for_collection'].includes(effectiveStatus)) {
        for (const empId of (employeeIds || [])) {
          await connection.execute(
            `UPDATE passes SET status = 'issued', updatedAt = :updatedAt WHERE UPPER(requestId) = UPPER(:requestId) AND employeeId = :employeeId`,
            { updatedAt: now, requestId: req.params.id, employeeId: empId }
          );
        }
      } else if (['pending', 'processing', 'approved', 'accepted'].includes(effectiveStatus)) {
        for (const empId of (employeeIds || [])) {
          await connection.execute(
            `UPDATE passes SET status = 'pending', updatedAt = :updatedAt WHERE UPPER(requestId) = UPPER(:requestId) AND employeeId = :employeeId`,
            { updatedAt: now, requestId: req.params.id, employeeId: empId }
          );
        }
      } else {
        // Update updatedAt on passes so activity reflects
        for (const empId of (employeeIds || [])) {
          await connection.execute(
            `UPDATE passes SET updatedAt = :updatedAt WHERE UPPER(requestId) = UPPER(:requestId) AND employeeId = :employeeId`,
            { updatedAt: now, requestId: req.params.id, employeeId: empId }
          );
        }
      }

      // Record request history
      const histId = Math.random().toString(36).substr(2, 9);
      try {
        await connection.execute(
          `INSERT INTO requestHistory (id, requestId, userId, action, remarks, timestamp)
           VALUES (:id, :requestId, :userId, :action, :remarks, :timestamp)`,
          {
            id: histId,
            requestId: req.params.id,
            userId: (req.headers['x-user-id'] as string) || 'system',
            action: `MEMBER_STATUS_UPDATE (${status.toUpperCase()})`,
            remarks: remarks || `Updated status to "${status}" for ${employeeIds.length} personnel${handoverBy ? ` (Handover by: ${handoverBy})` : ''}`,
            timestamp: now
          }
        );
      } catch (hErr) {
        console.error("Failed to insert request history:", hErr);
      }

      await connection.commit();

      logAction(req, 'MEMBER_STATUS_CHANGE', 'application', req.params.id, `Updated ${employeeIds.length} members status to ${status}`);
      res.json({ success: true, employeeStatuses, status: newStatus });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update bulk status" });
    } finally {
      if (connection) await connection.close();
    }
  };

  app.patch("/api/passApplications/:id/bulk-status", authorize(['admin', 'approver', 'applier']), handleBulkMemberStatus);
  app.patch("/api/passApplications/:id/employeeStatus", authorize(['admin', 'approver', 'applier']), handleBulkMemberStatus);

  app.patch("/api/passApplications/:id/employee/:employeeId", authorize(['admin', 'approver', 'applier']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const result = await connection.execute(`SELECT * FROM passRequests WHERE UPPER(id) = UPPER(:id)`, [req.params.id]);
      const application = result.rows?.[0] as any;
      if (!application) return res.status(404).json({ error: "Application not found" });

      const employeeStatuses = JSON.parse(application.EMPLOYEESTATUSES || '{}');
      const employeeIds = JSON.parse(application.EMPLOYEEIDS || '[]');
      
      employeeStatuses[req.params.employeeId] = req.body.status;
      
      let newStatus = application.STATUS;
      const allDone = employeeIds.every(id => {
        const s = employeeStatuses[id]?.toLowerCase();
        return s === 'completed' || s === 'collected' || s === 'rejected' || s === 'cancelled';
      });
      
      if (allDone) {
        newStatus = 'completed';
      }

      await connection.execute(
        `UPDATE passRequests SET employeeStatuses = :statuses, status = :status, updatedAt = :updatedAt WHERE UPPER(id) = UPPER(:id)`,
        { statuses: JSON.stringify(employeeStatuses), status: newStatus, updatedAt: new Date().toISOString(), id: req.params.id }
      );

      // If status is collected/completed/rejected/cancelled, update or create the corresponding pass
      const terminalStatuses = ['collected', 'completed', 'rejected', 'cancelled'];
      if (terminalStatuses.includes(req.body.status)) {
        const handoverBy = req.body.handoverBy || null;
        const passStatus = req.body.status === 'completed' ? 'active' : req.body.status;
        
        const updateRes = await connection.execute(
          `UPDATE passes SET status = :passStatus, handoverBy = :handoverBy WHERE UPPER(requestId) = UPPER(:requestId) AND employeeId = :employeeId`,
          { passStatus, handoverBy, requestId: req.params.id, employeeId: req.params.employeeId }
        );

        if ((updateRes.rowsAffected || 0) === 0 && ['collected', 'completed'].includes(req.body.status)) {
          const passId = Math.random().toString(36).substr(2, 9);
          const year = new Date().getFullYear();
          const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
          const passNumber = `PASS-${year}-${random}`;
          const indExpiries = JSON.parse(application.INDIVIDUALEXPIRIES || '{}');
          const indStartDates = JSON.parse(application.INDIVIDUALSTARTDATES || '{}');
          const empId = req.params.employeeId;
          const empStart = indStartDates[empId] || application.STARTDATE || new Date().toISOString().split('T')[0];
          const calcOneYr = (sStr?: string) => {
            const d = sStr ? new Date(sStr) : new Date();
            if (isNaN(d.getTime())) {
              const n = new Date();
              n.setFullYear(n.getFullYear() + 1);
              return n.toISOString().split('T')[0];
            }
            d.setFullYear(d.getFullYear() + 1);
            return d.toISOString().split('T')[0];
          };
          const empExpiry = indExpiries[empId] || application.ENDDATE || application.EXPIRYDATE || calcOneYr(empStart);

          await connection.execute(
            `INSERT INTO passes (id, requestId, employeeId, locationId, type, status, parentPassId, authorityAppNumber, accessCodes, startDate, expiryDate, passNumber, handoverBy, createdAt, updatedAt, projectId, contractNumber, contractName, clientCompany, clientApprovers, organizationId)
             VALUES (:id, :requestId, :employeeId, :locationId, :type, :status, :parentPassId, :authorityAppNumber, :accessCodes, :startDate, :expiryDate, :passNumber, :handoverBy, :createdAt, :updatedAt, :projectId, :contractNumber, :contractName, :clientCompany, :clientApprovers, :organizationId)`,
            {
              id: passId,
              requestId: req.params.id,
              employeeId: empId,
              locationId: application.LOCATIONID,
              type: application.TYPE || 'main',
              status: passStatus,
              parentPassId: application.PARENTPASSID || null,
              authorityAppNumber: application.AUTHORITYAPPNUMBER || null,
              accessCodes: application.ACCESSCODES || '[]',
              startDate: empStart,
              expiryDate: empExpiry,
              passNumber: passNumber,
              handoverBy: handoverBy || null,
              createdAt: application.CREATEDAT || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              projectId: application.PROJECTID || null,
              contractNumber: application.CONTRACTNUMBER || null,
              contractName: application.CONTRACTNAME || null,
              clientCompany: application.CLIENTCOMPANY || null,
              clientApprovers: application.CLIENTAPPROVERS || null,
              organizationId: application.ORGANIZATIONID || 'org-habari'
            }
          );
        }
      }

      await connection.commit();
      res.json({ ...toCamelCase(application), status: newStatus, employeeStatuses: employeeStatuses });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update employee status" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.get("/api/passes", authorize(['admin', 'approver', 'applier', 'viewer']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      let sql = `SELECT * FROM passes`;
      const binds: any = {};
      if (orgId) {
        sql += ` WHERE organizationId = :orgId`;
        binds.orgId = orgId;
      }
      sql += ` ORDER BY createdAt DESC`;

      const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });

      const passes = result.rows?.map((p: any) => {
        const camel = toCamelCase(p);
        return {
          ...camel,
          accessCodes: JSON.parse(p.ACCESSCODES || '[]'),
          authorityAppNumber: p.AUTHORITYAPPNUMBER
        };
      }) || [];

      res.json(passes);
    } catch (err) {
      console.error('Error fetching passes:', err);
      res.status(500).json({ error: "Failed to fetch passes" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/passes/batch", authorize(['admin', 'approver', 'applier']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { employeeIds, requestId: existingRequestId, ...commonData } = req.body;
      const requestId = (existingRequestId || req.body.requestId || Math.random().toString(36).substr(2, 9)).trim().toUpperCase();
      const { orgId } = await getTenantOrgId(req, connection);
      const effectiveOrgId = orgId || req.body.organizationId || 'org-habari';
      
      if (!Array.isArray(employeeIds)) {
        return res.status(400).json({ error: "employeeIds must be an array" });
      }

      // Filter commonData to only include valid columns for passes table
      const allowedPassFields = [
        'locationId', 'type', 'status', 'startDate', 'endDate', 'expiryDate', 
        'parentPassId', 'passNumber', 'cardNumber', 'authorityAppNumber', 'handoverBy', 'organizationId',
        'projectId', 'contractNumber', 'contractName', 'contractTitle', 'clientCompany', 'clientApprovers', 'remarks'
      ];
      const filteredCommonData: any = {};
      allowedPassFields.forEach(field => {
        if (commonData[field] !== undefined) filteredCommonData[field] = commonData[field];
      });
      filteredCommonData.organizationId = effectiveOrgId;

      // If existingRequestId is provided, it's a Normal Application (Request -> Application)
      // If NOT provided, it's a Direct Entry (skips flow)
      // Use isDirectOverride from frontend if provided (allows switching modes in the form)
      const isDirectEntry = req.body.isDirectOverride !== undefined ? req.body.isDirectOverride : !existingRequestId;
      
      // Auto-generate Pass Application Number for Direct Entry if blank
      let authorityAppNumber = filteredCommonData.authorityAppNumber;
      if (isDirectEntry && !authorityAppNumber) {
        const year = new Date().getFullYear();
        const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        authorityAppNumber = `DE-${year}-${random}`;
        filteredCommonData.authorityAppNumber = authorityAppNumber; // Ensure it's in common data for passes
      }

      // For Direct Entry, everything is 'collected'/'active' immediately
      // For Normal Application, use req.body.status or 'pending'
      const initialEmployeeStatus = isDirectEntry ? 'collected' : (req.body.status || 'pending');
      const initialRequestStatus = isDirectEntry ? 'completed' : (req.body.status || 'pending');
      const initialPassStatus = isDirectEntry ? 'active' : (req.body.status || 'pending');

      const employeeStatuses = employeeIds.reduce((acc: any, id: string) => ({ ...acc, [id]: initialEmployeeStatus }), {});
      
      let individualExpiries = req.body.individualExpiries || {};
      let individualStartDates = req.body.individualStartDates || {};

      if (!isDirectEntry) {
        // Fetch existing request to get its individualExpiries/individualStartDates if not provided in body
        const reqResult = await connection.execute(
          `SELECT individualExpiries, individualStartDates FROM passRequests WHERE id = :id`,
          [requestId],
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        if (reqResult.rows && reqResult.rows[0]) {
          const storedExpiries = JSON.parse(reqResult.rows[0].INDIVIDUALEXPIRIES || '{}');
          individualExpiries = { ...storedExpiries, ...individualExpiries };

          const storedStartDates = JSON.parse(reqResult.rows[0].INDIVIDUALSTARTDATES || '{}');
          individualStartDates = { ...storedStartDates, ...individualStartDates };
        }
      }

      const accessCodes = filteredCommonData.accessCodes || req.body.accessCodes || [];
      const accessCodeIds = req.body.accessCodeIds || [];

      // Validate Expiries
      try {
        await validatePassExpiries(connection, employeeIds, filteredCommonData, individualExpiries);
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }

      // Duplicate Main Pass Check for the batch
      if (filteredCommonData.type === 'main') {
        for (const empId of employeeIds) {
          const result = await connection.execute(
            `SELECT p.id FROM passes p 
             JOIN locations l ON p.locationId = l.id 
             WHERE p.employeeId = :employeeId 
             AND p.status = 'active' 
             AND p.type = 'main'
             AND l.categoryId = (SELECT categoryId FROM locations WHERE id = :locationId)`,
            { employeeId: empId, locationId: filteredCommonData.locationId },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );
          if (result.rows && result.rows.length > 0) {
            const empRes = await connection.execute(`SELECT name FROM employees WHERE id = :id`, [empId], { outFormat: oracledb.OUT_FORMAT_OBJECT });
            return res.status(400).json({ error: `Employee ${empRes.rows?.[0]?.NAME || empId} already has an active Main Pass for this category.` });
          }
        }
      }

      const newRequest = toOracleKeys({
        id: requestId,
        requesterId: req.body.requesterId || 'system',
        locationId: filteredCommonData.locationId,
        type: filteredCommonData.type || 'main',
        status: initialRequestStatus,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        employeeIds: JSON.stringify(employeeIds),
        employeeStatuses: JSON.stringify(employeeStatuses),
        accessCodes: JSON.stringify(accessCodes),
        individualExpiries: JSON.stringify(individualExpiries),
        individualStartDates: JSON.stringify(individualStartDates),
        authorityAppNumber: authorityAppNumber,
        parentPassId: filteredCommonData.parentPassId || null,
        startDate: filteredCommonData.startDate,
        endDate: filteredCommonData.endDate || filteredCommonData.expiryDate // Map to endDate for request
      });

      if (!existingRequestId) {
        const reqColumns = Object.keys(newRequest).join(', ');
        const reqPlaceholders = Object.keys(newRequest).map((_, i) => `:${i + 1}`).join(', ');
        
        await connection.execute(
          `INSERT INTO passRequests (${reqColumns}) VALUES (${reqPlaceholders})`,
          Object.values(newRequest)
        );
      } else {
        // Update existing request with potentially new dates and individual expiries from the application form
        const updates = toOracleKeys({
          status: initialRequestStatus,
          employeeStatuses: JSON.stringify(employeeStatuses),
          authorityAppNumber: commonData.authorityAppNumber || authorityAppNumber,
          startDate: filteredCommonData.startDate,
          endDate: filteredCommonData.endDate || filteredCommonData.expiryDate,
          individualExpiries: JSON.stringify(individualExpiries),
          individualStartDates: JSON.stringify(individualStartDates),
          updatedAt: new Date().toISOString()
        });
        const setClause = Object.keys(updates).map((key, i) => `${key} = :${i + 1}`).join(', ');
        await connection.execute(
          `UPDATE passRequests SET ${setClause} WHERE UPPER(id) = UPPER(:id)`,
          [...Object.values(updates), requestId]
        );
        
        // Clear old mappings and old passes if updating
        await connection.execute(`DELETE FROM passRequestEmployees WHERE UPPER(requestId) = UPPER(:id)`, [requestId]);
        await connection.execute(`DELETE FROM passRequestAccessCodes WHERE UPPER(requestId) = UPPER(:id)`, [requestId]);
        await connection.execute(`DELETE FROM passAccessCodes WHERE passId IN (SELECT id FROM passes WHERE UPPER(requestId) = UPPER(:id))`, [requestId]);
        await connection.execute(`DELETE FROM passes WHERE UPPER(requestId) = UPPER(:id)`, [requestId]);
      }

      // Populate mappings
      for (const empId of employeeIds) {
        await connection.execute(
          `INSERT INTO passRequestEmployees (id, requestId, employeeId, status) 
           VALUES (:id, :requestId, :employeeId, :status)`,
          {
            id: Math.random().toString(36).substr(2, 9),
            requestId: requestId,
            employeeId: empId,
            status: initialEmployeeStatus
          }
        );
      }

      for (const acId of accessCodeIds) {
        await connection.execute(
          `INSERT INTO passRequestAccessCodes (id, requestId, accessCodeId) 
           VALUES (:id, :requestId, :accessCodeId)`,
          {
            id: Math.random().toString(36).substr(2, 9),
            requestId: requestId,
            accessCodeId: acId
          }
        );
      }

      const results = [];
      // Use the individualExpiries defined above (which might have been merged from existing request)

      for (const empId of employeeIds) {
        const passId = Math.random().toString(36).substr(2, 9);
        
        let passNumber = null;
        if (initialPassStatus === 'active') {
          const year = new Date().getFullYear();
          const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
          passNumber = `PASS-${year}-${random}`;
        }

        const empStart = individualStartDates[empId] || filteredCommonData.startDate || new Date().toISOString().split('T')[0];
        const calcOneYr = (sStr?: string) => {
          const d = sStr ? new Date(sStr) : new Date();
          if (isNaN(d.getTime())) {
            const n = new Date();
            n.setFullYear(n.getFullYear() + 1);
            return n.toISOString().split('T')[0];
          }
          d.setFullYear(d.getFullYear() + 1);
          return d.toISOString().split('T')[0];
        };
        const empExpiry = individualExpiries[empId] || filteredCommonData.expiryDate || filteredCommonData.endDate || calcOneYr(empStart);

        const newPass = toOracleKeys({ 
          ...filteredCommonData, 
          employeeId: empId,
          requestId: requestId,
          accessCodes: JSON.stringify(accessCodes),
          id: passId, 
          status: initialPassStatus,
          type: filteredCommonData.type || 'main',
          parentPassId: filteredCommonData.parentPassId || null,
          passNumber: passNumber,
          startDate: empStart,
          expiryDate: empExpiry,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        
        const columns = Object.keys(newPass).join(', ');
        const placeholders = Object.keys(newPass).map((_, i) => `:${i + 1}`).join(', ');
        
        await connection.execute(
          `INSERT INTO passes (${columns}) VALUES (${placeholders})`,
          Object.values(newPass)
        );

        // Populate passAccessCodes
        for (const acId of accessCodeIds) {
          await connection.execute(
            `INSERT INTO passAccessCodes (id, passId, accessCodeId) VALUES (:id, :pId, :acId)`,
            {
              id: Math.random().toString(36).substr(2, 9),
              pId: passId,
              acId: acId
            }
          );
        }

        if ((filteredCommonData.type || 'main') === 'main') {
          await cleanupOldCategoryPasses(connection, empId, filteredCommonData.locationId, passId);
        }

        results.push({ id: passId, employeeId: empId });
      }
      
      await connection.commit();
      logAction(req, 'CREATE', 'pass', 'batch', `Created ${employeeIds.length} passes with request ${requestId} (Direct: ${isDirectEntry})`);
      res.json({ success: true, requestId, results });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create batch passes" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/passes", authorize(['admin', 'approver', 'applier']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      
      const { employeeId, locationId, type, expiryDate, parentPassId } = req.body;

      // Duplicate Main Pass Check: one Main Pass per category per person
      if (type === 'main') {
        const result = await connection.execute(
          `SELECT p.id FROM passes p 
           JOIN locations l ON p.locationId = l.id 
           WHERE p.employeeId = :employeeId 
           AND p.status = 'active' 
           AND p.type = 'main'
           AND l.categoryId = (SELECT categoryId FROM locations WHERE id = :locationId)`,
          { employeeId, locationId },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        if (result.rows && result.rows.length > 0) {
          return res.status(400).json({ error: "Employee already has an active Main Pass for this category." });
        }
      }

      // Strict Expiry Validation
      try {
        await validatePassExpiries(connection, [employeeId], { expiryDate, parentPassId }, {});
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }

      let passNumber = req.body.passNumber;
      if (req.body.status === 'active' && !passNumber) {
        const year = new Date().getFullYear();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        passNumber = `PASS-${year}-${random}`;
      }

      const { orgId } = await getTenantOrgId(req, connection);
      const effectiveOrgId = orgId || req.body.organizationId || 'org-habari';

      // Tenant Quotas & Usage Limits: maxPasses
      if (req.body.status === 'active') {
        const orgRes = await connection.execute(
          `SELECT maxPasses, name FROM organizations WHERE id = :id`,
          [effectiveOrgId],
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        if (orgRes.rows && orgRes.rows.length > 0) {
          const maxP = (orgRes.rows[0] as any).MAXPASSES;
          if (maxP && maxP > 0) {
            const pCountRes = await connection.execute(
              `SELECT COUNT(*) AS CNT FROM passes WHERE organizationId = :orgId AND status = 'active'`,
              [effectiveOrgId],
              { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );
            const currActive = (pCountRes.rows?.[0] as any)?.CNT || 0;
            if (currActive >= maxP) {
              return res.status(400).json({
                error: `Active gate pass quota reached for organization (${currActive}/${maxP} passes). Please upgrade your organization's license quota or archive inactive passes.`
              });
            }
          }
        }
      }

      const newPass = toOracleKeys({ 
        ...req.body, 
        organizationId: effectiveOrgId,
        accessCodes: JSON.stringify(req.body.accessCodes || []),
        parentPassId: req.body.parentPassId || null,
        id: Math.random().toString(36).substr(2, 9), 
        status: req.body.status || 'pending',
        type: req.body.type || 'main',
        passNumber: passNumber,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      
      const validPassColumns = [
        'ID', 'REQUESTID', 'EMPLOYEEID', 'LOCATIONID', 'TYPE', 'STATUS',
        'STARTDATE', 'EXPIRYDATE', 'ENDDATE', 'PARENTPASSID', 'PASSNUMBER',
        'CARDNUMBER', 'ACCESSCODES', 'AUTHORITYAPPNUMBER', 'REMARKS',
        'HANDOVERBY', 'CREATEDAT', 'UPDATEDAT', 'PROJECTID', 'CONTRACTNUMBER',
        'CONTRACTNAME', 'CONTRACTTITLE', 'CLIENTCOMPANY', 'CLIENTAPPROVERS',
        'ORGANIZATIONID'
      ];
      const passPayload: any = {};
      validPassColumns.forEach(col => {
        if (newPass[col] !== undefined) {
          passPayload[col] = newPass[col];
        }
      });

      const columns = Object.keys(passPayload).join(', ');
      const placeholders = Object.keys(passPayload).map((_, i) => `:${i + 1}`).join(', ');
      
      await connection.execute(
        `INSERT INTO passes (${columns}) VALUES (${placeholders})`,
        Object.values(passPayload)
      );

      if ((newPass.TYPE || newPass.type || 'main') === 'main') {
        await cleanupOldCategoryPasses(connection, employeeId, locationId, newPass.ID);
      }

      await connection.commit();
      
      logAction(req, 'CREATE', 'pass', newPass.ID, `Created ${newPass.TYPE} pass`);
      res.json({ ...toCamelCase(newPass), accessCodes: JSON.parse(newPass.ACCESSCODES) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create pass" });
    } finally {
      if (connection) await connection.close();
    }
  });
  const handlePassUpdate = async (req: express.Request, res: express.Response) => {
    let connection;
    try {
      connection = await getConnection();
      const result = await connection.execute(`SELECT * FROM passes WHERE id = :id`, [req.params.id], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const rawPass = result.rows?.[0] as any;
      if (!rawPass) return res.status(404).json({ error: "Pass not found" });

      const oldPass = toCamelCase(rawPass);
      // Parse JSON fields from DB
      oldPass.accessCodes = JSON.parse(rawPass.ACCESSCODES || '[]');
      
      const updatedPass = { ...oldPass, ...req.body };
      
      // Auto-generate Pass Number when status becomes active
      if (updatedPass.status === 'active' && !updatedPass.passNumber) {
        const year = new Date().getFullYear();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        req.body.passNumber = `PASS-${year}-${random}`;
      }

      const updates = toOracleKeys({ ...req.body, updatedAt: new Date().toISOString() });
      delete updates.ID;

      // Cascading deactivation: If Main pass is revoked/expired/inactive, update all supplementary passes tied to it
      const nonActiveStatuses = ['expired', 'inactive', 'revoked', 'archived', 'cancelled'];
      if (oldPass.type === 'main' && req.body.status && nonActiveStatuses.includes(req.body.status) && !nonActiveStatuses.includes(oldPass.status)) {
        await connection.execute(
          `UPDATE passes SET status = :status, updatedAt = :now 
           WHERE parentPassId = :id AND status NOT IN ('expired', 'inactive', 'revoked')`,
          { status: req.body.status, now: new Date().toISOString(), id: req.params.id }
        );
      }

      // Enforcement of Expiry constraints on Update
      if (req.body.expiryDate && req.body.expiryDate !== oldPass.expiryDate) {
        try {
          await validatePassExpiries(connection, [oldPass.employeeId], { expiryDate: req.body.expiryDate, parentPassId: oldPass.parentPassId }, {});
        } catch (err: any) {
          return res.status(400).json({ error: err.message });
        }
      }

      // Requirement 9: Authority Number Synchronization
      // If authorityAppNumber is updated, sync it for all passes in the same envelope (requestId)
      if (req.body.authorityAppNumber && req.body.authorityAppNumber !== oldPass.authorityAppNumber && oldPass.requestId) {
        await connection.execute(
          `UPDATE passes SET authorityAppNumber = :authNum WHERE requestId = :requestId`,
          { authNum: req.body.authorityAppNumber, requestId: oldPass.requestId }
        );
        // Also update the request itself
        await connection.execute(
          `UPDATE passRequests SET authorityAppNumber = :authNum WHERE id = :requestId`,
          { authNum: req.body.authorityAppNumber, requestId: oldPass.requestId }
        );
      }

      // Handle validation and synchronization logic when status becomes active or received
      if (['active', 'received'].includes(updatedPass.status) && !['active', 'received'].includes(oldPass.status)) {
        const sortedNewCodes = [...(updatedPass.accessCodes || [])].sort().join(',');
        const newStart = updatedPass.startDate ? new Date(updatedPass.startDate) : new Date();
        
        const allPassesResult = await connection.execute(
          `SELECT * FROM passes WHERE employeeId = :employeeId AND locationId = :locationId`, 
          [updatedPass.employeeId, updatedPass.locationId],
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const allPasses = (allPassesResult.rows || []).map((p: any) => {
          const camel = toCamelCase(p);
          return {
            ...camel,
            accessCodes: JSON.parse(p.ACCESSCODES || '[]')
          };
        });

      const otherActivePasses = allPasses.filter((p: any) => 
        p.id !== updatedPass.id && 
        ['active', 'received'].includes(p.status)
      );

      const duplicatePass = otherActivePasses.find((p: any) => 
        [...(p.accessCodes || [])].sort().join(',') === sortedNewCodes
      );

      if (duplicatePass) {
        const existingExpiry = duplicatePass.expiryDate ? new Date(duplicatePass.expiryDate) : null;
          if (!existingExpiry || newStart <= existingExpiry) {
            return res.status(400).json({ 
              error: "Duplicate Access Detected", 
              message: `This employee already has an active pass for this location with the exact same access codes. A new pass with identical codes can only be received as a renewal after the current one expires (${existingExpiry?.toLocaleDateString()}).` 
            });
          }
        }

        // Synchronize expiry dates to the earliest among all active/received passes for this location
        const allRelevantPasses = [updatedPass, ...otherActivePasses];
        let earliestExpiry: Date | null = null;
        
        allRelevantPasses.forEach((p: any) => {
          const expiryDate = p.expiryDate;
          if (expiryDate) {
            const d = new Date(expiryDate);
            if (!earliestExpiry || d < earliestExpiry) {
              earliestExpiry = d;
            }
          }
        });

        if (earliestExpiry) {
          const earliestExpiryStr = earliestExpiry.toISOString();
          updatedPass.expiryDate = earliestExpiryStr;
          
          // Update other passes in the DB
          for (const p of otherActivePasses) {
            await connection.execute(
              `UPDATE passes SET expiryDate = :expiryDate WHERE id = :id`,
              { expiryDate: earliestExpiryStr, id: p.id }
            );
          }
        }
      }

      // Update the pass itself
      if (updatedPass.expiryDate) updates.EXPIRYDATE = updatedPass.expiryDate;
      if (updates.ACCESSCODES) {
        updates.ACCESSCODES = JSON.stringify(updates.ACCESSCODES);
      }
      
      const validPassUpdateCols = [
        'REQUESTID', 'EMPLOYEEID', 'LOCATIONID', 'TYPE', 'STATUS',
        'STARTDATE', 'EXPIRYDATE', 'ENDDATE', 'PARENTPASSID', 'PASSNUMBER',
        'CARDNUMBER', 'ACCESSCODES', 'AUTHORITYAPPNUMBER', 'REMARKS',
        'HANDOVERBY', 'UPDATEDAT', 'PROJECTID', 'CONTRACTNUMBER',
        'CONTRACTNAME', 'CONTRACTTITLE', 'CLIENTCOMPANY', 'CLIENTAPPROVERS',
        'ORGANIZATIONID'
      ];
      const validUpdates: any = {};
      validPassUpdateCols.forEach(col => {
        if (updates[col] !== undefined) {
          validUpdates[col] = updates[col];
        }
      });
      
      if (Object.keys(validUpdates).length > 0) {
        const setClause = Object.keys(validUpdates).map(key => `${key} = :${key}`).join(', ');
        await connection.execute(
          `UPDATE passes SET ${setClause} WHERE id = :id`,
          { ...validUpdates, id: req.params.id }
        );
      }

      // Dependency logic: if main pass is cancelled/revoked/rejected/expired, update supplementary passes
      const finalStatuses = ['cancelled', 'revoked', 'rejected', 'expired'];
      if (oldPass.type === 'main' && finalStatuses.includes(req.body.status)) {
        await connection.execute(
          `UPDATE passes SET status = :status WHERE parentPassId = :id`,
          [req.body.status, oldPass.id]
        );
      }

      if (updatedPass.type === 'main' && ['active', 'approved', 'collected', 'received'].includes(updatedPass.status)) {
        await cleanupOldCategoryPasses(connection, updatedPass.employeeId, updatedPass.locationId, req.params.id);
      }

      await connection.commit();
      
      if (req.body.status && req.body.status !== oldPass.status) {
        logAction(req, 'STATUS_CHANGE', 'pass', req.params.id, `Pass status changed from ${oldPass.status} to ${req.body.status}`);
      } else {
        logAction(req, 'UPDATE', 'pass', req.params.id, `Updated pass details`);
      }
      res.json({ ...oldPass, ...req.body, expiryDate: updatedPass.expiryDate });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update pass" });
    } finally {
      if (connection) await connection.close();
    }
  };

  app.patch("/api/passes/:id", authorize(['admin', 'approver', 'applier']), handlePassUpdate);
  app.patch("/api/passes/:id/status", authorize(['admin', 'approver', 'applier']), handlePassUpdate);

  app.patch("/api/passes/bulk-status", authorize(['admin', 'approver', 'applier']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { passIds, status, remarks, handoverBy } = req.body;
      if (!Array.isArray(passIds)) return res.status(400).json({ error: "passIds must be an array" });
      
      const updatedAt = new Date().toISOString();
      const finalStatuses = ['cancelled', 'revoked', 'rejected', 'expired'];
      
      let targetPassStatus = status;
      // Note: We used to coerce 'collected' to 'active' here. 
      // Now we keep 'collected' as a distinct state for the "Collected -> Active" flow.

      for (const id of passIds) {
        // Fetch current pass
        const passResult = await connection.execute(`SELECT * FROM passes WHERE id = :id`, [id], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const currentPass = toCamelCase(passResult.rows?.[0] as any);
        if (!currentPass) continue;
        
        let passNumber = currentPass.passNumber;
        if (targetPassStatus === 'active' && !passNumber) {
          const year = new Date().getFullYear();
          const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
          passNumber = `PASS-${year}-${random}`;
        }

        const hBy = handoverBy || currentPass.handoverBy || null;

        await connection.execute(
          `UPDATE passes SET status = :status, updatedAt = :updatedAt, passNumber = :passNumber, remarks = :remarks, handoverBy = :handoverBy WHERE id = :id`,
          { status: targetPassStatus, updatedAt, passNumber: passNumber || null, remarks: remarks || null, handoverBy: hBy, id }
        );

        // Sync status to passRequests if linked to a request
        if (currentPass.requestId) {
          const reqResult = await connection.execute(`SELECT * FROM passRequests WHERE UPPER(id) = UPPER(:id)`, [currentPass.requestId], { outFormat: oracledb.OUT_FORMAT_OBJECT });
          const passReq = toCamelCase(reqResult.rows?.[0] as any);
          
          if (passReq) {
            const employeeStatuses = JSON.parse(passReq.employeeStatuses || '{}');
            const employeeIds = JSON.parse(passReq.employeeIds || '[]');
            
            const normalizedStatus = ['active', 'collected'].includes(targetPassStatus) ? 'collected' : targetPassStatus;
            employeeStatuses[currentPass.employeeId] = normalizedStatus;
            
            const nonCancelled = employeeIds.filter((empId: string) => 
              !['rejected', 'cancelled'].includes((employeeStatuses[empId] || '').toLowerCase())
            );

            let newReqStatus = passReq.status;
            if (nonCancelled.length > 0) {
              const allDone = nonCancelled.every((empId: string) => 
                ['collected', 'completed', 'active'].includes((employeeStatuses[empId] || '').toLowerCase())
              );
              const allAccepted = nonCancelled.every((empId: string) => 
                ['accepted', 'approved', 'collected', 'completed', 'active'].includes((employeeStatuses[empId] || '').toLowerCase())
              );
              const anyAccepted = nonCancelled.some((empId: string) => 
                ['accepted', 'approved', 'collected', 'completed', 'active'].includes((employeeStatuses[empId] || '').toLowerCase())
              );

              if (allDone) {
                newReqStatus = 'completed';
              } else if (allAccepted) {
                newReqStatus = 'accepted';
              } else if (anyAccepted) {
                newReqStatus = 'processing';
              } else {
                newReqStatus = 'pending';
              }
            }
            
            await connection.execute(
              `UPDATE passRequests SET employeeStatuses = :statuses, status = :status, updatedAt = :updatedAt WHERE UPPER(id) = UPPER(:id)`,
              { statuses: JSON.stringify(employeeStatuses), status: newReqStatus, updatedAt, id: currentPass.requestId }
            );

            // Record request history
            const histId = Math.random().toString(36).substr(2, 9);
            try {
              await connection.execute(
                `INSERT INTO requestHistory (id, requestId, userId, action, remarks, timestamp)
                 VALUES (:id, :requestId, :userId, :action, :remarks, :timestamp)`,
                {
                  id: histId,
                  requestId: currentPass.requestId,
                  userId: (req.headers['x-user-id'] as string) || 'system',
                  action: `PASS_STATUS_UPDATE (${targetPassStatus.toUpperCase()})`,
                  remarks: remarks || `Pass ${currentPass.passNumber || currentPass.id} status updated to "${targetPassStatus}"${hBy ? ` (Handover by: ${hBy})` : ''}`,
                  timestamp: updatedAt
                }
              );
            } catch (hErr) {
              console.error("Failed to log requestHistory on bulk pass update:", hErr);
            }
          }
        }

        // Dependency logic: if main pass is cancelled/revoked/rejected/expired, update supplementary passes
        if (currentPass.type === 'main' && finalStatuses.includes(targetPassStatus)) {
          await connection.execute(
            `UPDATE passes SET status = :status, updatedAt = :updatedAt, remarks = :remarks WHERE parentPassId = :id`,
            { status: targetPassStatus, updatedAt, remarks: `Revoked due to main pass revocation: ${remarks || ''}`, id }
          );
        }

        if (currentPass.type === 'main' && ['active', 'approved', 'collected', 'received'].includes(targetPassStatus)) {
          await cleanupOldCategoryPasses(connection, currentPass.employeeId, currentPass.locationId, currentPass.id);
        }
      }
      await connection.commit();
      
      logAction(req, 'UPDATE', 'pass', 'bulk', `Bulk updated ${passIds.length} passes to ${status}`);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to bulk update passes" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.patch("/api/passes/:id/revert-status", authorize(['admin', 'approver']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const result = await connection.execute(`SELECT * FROM passes WHERE id = :id`, [req.params.id]);
      const pass = result.rows?.[0] as any;
      if (!pass) return res.status(404).json({ error: "Pass not found" });

      if (pass.STATUS !== 'collected') {
        return res.status(400).json({ error: "Only collected passes can be reverted." });
      }

      await connection.execute(
        `UPDATE passes SET status = 'active', handoverBy = NULL, updatedAt = :now WHERE id = :id`,
        { now: new Date().toISOString(), id: req.params.id }
      );

      // Sync the request status too
      const requestId = pass.REQUESTID;
      if (requestId) {
        const reqResult = await connection.execute(`SELECT employeeStatuses FROM passRequests WHERE id = :id`, [requestId]);
        const statuses = JSON.parse(reqResult.rows?.[0]?.[0] || '{}');
        statuses[pass.EMPLOYEEID] = 'completed';
        
        await connection.execute(
          `UPDATE passRequests SET employeeStatuses = :statuses, status = 'processing', updatedAt = :now WHERE id = :id`,
          { statuses: JSON.stringify(statuses), now: new Date().toISOString(), id: requestId }
        );
      }

      await connection.commit();
      logAction(req, 'UPDATE', 'pass', req.params.id, `Reverted pass status to active`);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to revert status" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.delete("/api/passes/:id", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const result = await connection.execute(`SELECT * FROM passes WHERE id = :id`, [req.params.id]);
      const deletedPass = result.rows?.[0] as any;
      if (!deletedPass) return res.status(404).json({ error: "Pass not found" });

      await connection.execute(`DELETE FROM passes WHERE id = :id`, [req.params.id]);
      
      if (deletedPass.TYPE === 'main') {
        await connection.execute(`DELETE FROM passes WHERE parentPassId = :id`, [req.params.id]);
      }
      
      await connection.commit();
      logAction(req, 'DELETE', 'pass', req.params.id, `Deleted pass`);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete pass" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.delete("/api/locations/:id", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      
      // Check for active or pending passes
      const activePasses = await connection.execute(
        `SELECT COUNT(*) as count FROM passes WHERE locationId = :id AND status IN ('active', 'approved', 'processing', 'pending')`,
        [req.params.id]
      );
      const passCount = (activePasses.rows?.[0] as any).COUNT || 0;

      // Check for active or pending requests
      const activeRequests = await connection.execute(
        `SELECT COUNT(*) as count FROM passRequests WHERE locationId = :id AND status IN ('pending', 'processing', 'approved', 'forwarded')`,
        [req.params.id]
      );
      const requestCount = (activeRequests.rows?.[0] as any).COUNT || 0;

      if (passCount > 0 || requestCount > 0) {
        return res.status(400).json({ 
          error: "Deletion Blocked: This location has active/pending passes or applications. Please expire or cancel them before deleting this location." 
        });
      }

      // Requirement 3: Archive historical passes and requests associated with this location
      await connection.execute(
        `UPDATE passes SET status = 'archived' WHERE locationId = :id`,
        [req.params.id]
      );
      await connection.execute(
        `UPDATE passRequests SET status = 'archived' WHERE locationId = :id`,
        [req.params.id]
      );

      // Now delete dependent access codes
      await connection.execute(`DELETE FROM accessCodes WHERE locationId = :id`, [req.params.id]);

      await connection.execute(`DELETE FROM locations WHERE id = :id`, [req.params.id]);
      await connection.commit();
      logAction(req, 'DELETE', 'location', req.params.id, `Deleted location and archived associated passes`);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete location" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.delete("/api/accessCodes/:id", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      await connection.execute(`DELETE FROM accessCodes WHERE id = :id`, [req.params.id]);
      await connection.commit();
      logAction(req, 'DELETE', 'access_code', req.params.id, `Deleted access code`);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete access code" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.delete("/api/categories/:id", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      
      // Requirement 3: Archive historical passes and requests associated with locations in this category
      const locsResult = await connection.execute(`SELECT id FROM locations WHERE categoryId = :id`, [req.params.id], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const locationIds = (locsResult.rows || []).map((l: any) => l.ID || l.id);

      for (const locId of locationIds) {
        await connection.execute(`UPDATE passes SET status = 'archived' WHERE locationId = :id`, [locId]);
        await connection.execute(`UPDATE passRequests SET status = 'archived' WHERE locationId = :id`, [locId]);
        await connection.execute(`DELETE FROM accessCodes WHERE locationId = :id`, [locId]);
        await connection.execute(`DELETE FROM locations WHERE id = :id`, [locId]);
      }

      await connection.execute(`DELETE FROM categories WHERE id = :id`, [req.params.id]);
      await connection.commit();
      logAction(req, 'DELETE', 'category', req.params.id, `Deleted category and archived associated data`);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete category" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.delete("/api/passApplications/:id", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      
      // Requirement 3: Approved requests can only be deleted by admin
      const reqResult = await connection.execute(`SELECT status FROM passRequests WHERE UPPER(id) = UPPER(:id)`, [req.params.id], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const passReq = reqResult.rows?.[0] as any;
      const userRole = req.headers['x-user-role'] as string;

      if (passReq && passReq.STATUS === 'approved' && userRole !== 'admin') {
        return res.status(403).json({ error: "Only administrators can delete approved applications" });
      }

      // Cascade delete associated records
      await connection.execute(`DELETE FROM passAccessCodes WHERE passId IN (SELECT id FROM passes WHERE UPPER(requestId) = UPPER(:id))`, [req.params.id]);
      await connection.execute(`DELETE FROM passes WHERE UPPER(requestId) = UPPER(:id)`, [req.params.id]);
      await connection.execute(`DELETE FROM passRequestEmployees WHERE UPPER(requestId) = UPPER(:id)`, [req.params.id]);
      await connection.execute(`DELETE FROM passRequestAccessCodes WHERE UPPER(requestId) = UPPER(:id)`, [req.params.id]);
      await connection.execute(`DELETE FROM requestHistory WHERE UPPER(requestId) = UPPER(:id)`, [req.params.id]);
      await connection.execute(`DELETE FROM passRequests WHERE UPPER(id) = UPPER(:id)`, [req.params.id]);
      await connection.commit();
      logAction(req, 'DELETE', 'application', req.params.id, `Deleted application`);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete application" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // Detailed DB mapping and deletion safety check endpoint
  app.get("/api/users/:id/deletion-check", authorize(['admin', 'power_admin']), async (req, res) => {
    let connection;
    try {
      const currentUserId = req.headers['x-user-id'] as string;
      const targetId = req.params.id;
      connection = await getConnection();

      // 1. Fetch target user and their organizational mappings
      const userRes = await connection.execute(
        `SELECT id, email, role, displayName, department, division, project, status, phone, jobTitle FROM users WHERE id = :id`,
        [targetId],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const targetUser = toCamelCase((userRes.rows as any[])?.[0]);
      if (!targetUser) {
        return res.status(404).json({ error: "User account not found in database" });
      }

      const reasons: string[] = [];
      let canDelete = true;

      // 2. Self-deletion protection check
      const isSelf = targetId === currentUserId;
      if (isSelf) {
        canDelete = false;
        reasons.push("You cannot delete your own currently logged-in account.");
      }

      // 3. Master Platform Administrator protection check
      const isTargetPowerAdmin = targetUser.role === 'power_admin' || targetUser.email?.toLowerCase() === 'm.techsandgadgets@gmail.com';
      if (isTargetPowerAdmin) {
        canDelete = false;
        reasons.push("The Master Platform Administrator account is root protected and cannot be deleted.");
      }

      // 4. Active/pending pass requests mapping check (requester, approver, forwarded)
      const pendingRes = await connection.execute(
        `SELECT COUNT(*) as count FROM passRequests 
         WHERE (approverId = :id OR forwardedToId = :id OR requesterId = :id) 
           AND status NOT IN ('approved', 'rejected', 'completed', 'archived')`,
        { id: targetId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const pendingCount = pendingRes.rows?.[0]?.COUNT || 0;
      if (pendingCount > 0) {
        canDelete = false;
        reasons.push(`User is mapped to ${pendingCount} active/pending pass application(s) as requester, approver, or forwarded reviewer. Please reassign or conclude those requests before deletion.`);
      }

      // 5. Historical records count (completed applications, request history, audit logs)
      const historyRes = await connection.execute(
        `SELECT COUNT(*) as count FROM passRequests 
         WHERE (approverId = :id OR forwardedToId = :id OR requesterId = :id) 
           AND status IN ('approved', 'rejected', 'completed', 'archived')`,
        { id: targetId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const historicalCount = historyRes.rows?.[0]?.COUNT || 0;

      const reqHistoryRes = await connection.execute(
        `SELECT COUNT(*) as count FROM requestHistory WHERE userId = :id`,
        { id: targetId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const requestHistoryCount = reqHistoryRes.rows?.[0]?.COUNT || 0;

      const auditCountRes = await connection.execute(
        `SELECT COUNT(*) as count FROM auditLogs WHERE userId = :id OR LOWER(userEmail) = LOWER(:email)`,
        { id: targetId, email: targetUser.email },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const auditCount = auditCountRes.rows?.[0]?.COUNT || 0;

      res.json({
        canDelete,
        reasons,
        targetUser,
        isSelf,
        isPowerAdmin: isTargetPowerAdmin,
        pendingCount,
        historicalCount,
        requestHistoryCount,
        auditCount,
        systemMapping: {
          department: targetUser.department || 'Unassigned',
          division: targetUser.division || 'Unassigned',
          project: targetUser.project || 'Unassigned',
          role: targetUser.role,
          status: targetUser.status
        }
      });
    } catch (err: any) {
      console.error('Deletion check error:', err);
      res.status(500).json({ error: err.message || "Failed to perform user deletion check" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // GET single user profile with system mappings
  app.get("/api/users/:id", authorize(['admin', 'approver', 'applier', 'viewer', 'requester']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const result = await connection.execute(
        `SELECT id, email, role, displayName, photoURL, status, phone, jobTitle, department, division, project, createdAt, lastLogin, preferences FROM users WHERE id = :id`,
        [req.params.id],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const user = (result.rows || []).map(toCamelCase)[0];
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      if (user.preferences && typeof user.preferences === 'string') {
        try {
          user.preferences = JSON.parse(user.preferences);
        } catch (e) {}
      }
      res.json(user);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch user profile" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // Primary authoritative User Deletion Endpoint with full DB & System constraints
  app.delete("/api/users/:id", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      const currentUserId = req.headers['x-user-id'] as string;
      const userRole = ((req.headers['x-user-role'] as string) || '').toLowerCase().trim();
      const userEmail = ((req.headers['x-user-email'] as string) || '').toLowerCase().trim();
      const isPowerAdminUser = userRole === 'power_admin' || userEmail === 'm.techsandgadgets@gmail.com';

      connection = await getConnection();
      
      const adminCheck = await connection.execute(`SELECT role, email FROM users WHERE id = :id`, [currentUserId], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const currentUser = toCamelCase((adminCheck.rows as any[])?.[0]);
      
      const isAuthorized = isPowerAdminUser || currentUser?.role === 'admin' || currentUser?.role === 'power_admin' || currentUser?.email?.toLowerCase() === 'm.techsandgadgets@gmail.com';
      if (!isAuthorized) {
        return res.status(403).json({ error: "Only administrators can delete users" });
      }

      if (req.params.id === currentUserId) {
        return res.status(400).json({ error: "Cannot delete your own active account" });
      }

      // Check target user exists
      const targetUserRes = await connection.execute(
        `SELECT id, email, role, displayName, department, division, project FROM users WHERE id = :id`,
        [req.params.id],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const targetUser = toCamelCase((targetUserRes.rows as any[])?.[0]);
      if (!targetUser) {
        return res.status(404).json({ error: "User account not found" });
      }

      // Protect Master Platform Administrator
      if (targetUser.role === 'power_admin' || targetUser.email?.toLowerCase() === 'm.techsandgadgets@gmail.com') {
        return res.status(403).json({ error: "The Master Platform Administrator account is protected and cannot be deleted." });
      }

      // Check for pending pass applications linked to this user as requester, approver, or forwarded reviewer
      const pendingCheck = await connection.execute(
        `SELECT COUNT(*) as count FROM passRequests 
         WHERE (approverId = :id OR forwardedToId = :id OR requesterId = :id) 
           AND status NOT IN ('approved', 'rejected', 'completed', 'archived')`,
        { id: req.params.id },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const pendingCount = pendingCheck.rows?.[0]?.COUNT || 0;
      if (pendingCount > 0) {
        return res.status(400).json({ 
          error: `Cannot delete user: They are linked to ${pendingCount} active/pending pass application(s) as requester or approver. Please reassign or conclude those applications first.` 
        });
      }

      // Clear any live presence for this user
      activePresences.delete(req.params.id);

      // Perform clean DB deletion
      await connection.execute(`DELETE FROM users WHERE id = :id`, { id: req.params.id });
      await connection.commit();

      const targetLabel = targetUser.displayName || targetUser.email || req.params.id;
      logAction(req, 'DELETE', 'user', req.params.id, `Permanently deleted user account ${targetLabel} (${targetUser.email})`);
      res.json({ success: true, message: `User account ${targetLabel} deleted successfully.` });
    } catch (err: any) {
      console.error('Failed to delete user:', err);
      res.status(500).json({ error: err.message || "Failed to delete user" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.get("/api/accessCodes", authorize(['admin', 'approver', 'applier', 'viewer']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId, isPowerAdmin } = await getTenantOrgId(req, connection);
      let query = `SELECT * FROM accessCodes`;
      const binds: any = {};
      if (orgId && !isPowerAdmin) {
        query += ` WHERE (organizationId = :orgId OR isGlobal = 1 OR (organizationId IS NULL AND :isDefaultOrg = 1))`;
        binds.orgId = orgId;
        binds.isDefaultOrg = orgId === 'org-habari' ? 1 : 0;
      }
      query += ` ORDER BY areaCode ASC`;
      const result = await connection.execute(query, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      res.json(result.rows?.map(toCamelCase));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch access codes" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/accessCodes", authorize(['admin', 'power_admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      const isGlobal = req.body.isGlobal ? 1 : 0;
      const effectiveOrgId = isGlobal ? null : (orgId || req.body.organizationId || 'org-habari');
      const newCode = toOracleKeys({ 
        ...req.body, 
        id: Math.random().toString(36).substr(2, 9),
        organizationId: effectiveOrgId,
        isGlobal: isGlobal,
        securityLevel: req.body.securityLevel || 'Level 1: General Access'
      });
      
      await connection.execute(
        `INSERT INTO accessCodes (id, areaCode, accessArea, description, locationId, organizationId, isGlobal, securityLevel) 
         VALUES (:ID, :AREACODE, :ACCESSAREA, :DESCRIPTION, :LOCATIONID, :ORGANIZATIONID, :ISGLOBAL, :SECURITYLEVEL)`,
        newCode
      );
      await connection.commit();
      
      logAction(req, 'CREATE', 'access_code', newCode.ID || newCode.id, `Created access code ${newCode.AREACODE || newCode.areaCode}`);
      res.json(toCamelCase(newCode));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create access code" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.patch("/api/accessCodes/:id", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const updates = toOracleKeys(req.body);
      delete updates.ID;
      const setClause = Object.keys(updates).map(k => `${k} = :${k}`).join(', ');
      
      await connection.execute(
        `UPDATE accessCodes SET ${setClause} WHERE id = :id`,
        { ...updates, id: req.params.id }
      );
      await connection.commit();
      logAction(req, 'UPDATE', 'access_code', req.params.id, `Updated access code ${req.params.id}`);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update access code" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/accessCodes/batch", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      const effectiveOrgId = orgId || 'org-habari';
      const codes = Array.isArray(req.body) ? req.body : (req.body.accessCodes || []);
      const newCodes = codes.map((code: any) => toOracleKeys({
        ...code,
        id: Math.random().toString(36).substr(2, 9),
        organizationId: code.organizationId || effectiveOrgId
      }));
      
      for (const code of newCodes) {
        await connection.execute(
          `INSERT INTO accessCodes (id, areaCode, accessArea, description, locationId, organizationId) VALUES (:ID, :AREACODE, :ACCESSAREA, :DESCRIPTION, :LOCATIONID, :ORGANIZATIONID)`,
          code
        );
      }
      await connection.commit();
      
      logAction(req, 'BATCH_CREATE', 'access_code', 'batch', `Imported ${newCodes.length} access codes`);
      res.json(newCodes.map(toCamelCase));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to batch create access codes" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.get("/api/settings/company", async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      
      let activeOrgRes;
      if (orgId) {
        activeOrgRes = await connection.execute(
          `SELECT * FROM organizations WHERE id = :orgId`,
          { orgId },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
      }
      if (!activeOrgRes || !activeOrgRes.rows || activeOrgRes.rows.length === 0) {
        activeOrgRes = await connection.execute(
          `SELECT * FROM organizations WHERE isCurrent = 1`,
          [],
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
      }

      const compRes = await connection.execute(`SELECT * FROM companySettings WHERE id = '1'`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const comp = compRes.rows?.[0] ? toCamelCase(compRes.rows[0]) : {};

      if (activeOrgRes.rows && activeOrgRes.rows.length > 0) {
        const org = toCamelCase(activeOrgRes.rows[0]);
        res.json({
          ...comp,
          id: comp.id || '1',
          organizationId: org.id,
          companyName: org.name || comp.companyName,
          orgCode: org.code || comp.orgCode,
          appName: org.appName || org.name || comp.appName,
          primaryColor: org.primaryColor || comp.primaryColor || '#800020',
          poweredBy: org.poweredBy || comp.poweredBy || 'by Techsandgadgets.com',
          contactEmail: org.contactEmail || org.primaryAdminEmail || comp.contactEmail,
          contactPhone: org.contactPhone || comp.contactPhone,
          address: org.address || comp.address,
          licenseKey: org.licenseKey || comp.licenseKey,
          licenseTier: org.licenseTier || comp.licenseTier,
          licenseExpiry: org.licenseExpiry || comp.licenseExpiry,
          maxUsers: org.maxUsers,
          maxPasses: org.maxPasses,
          maxEmployees: org.maxEmployees,
          allowedDomains: org.allowedDomains,
          maintenanceActive: comp.maintenanceActive === 1 || comp.maintenanceActive === true,
          maintenanceMessage: comp.maintenanceMessage || null,
          maintenanceSeverity: comp.maintenanceSeverity || 'info',
          maintenanceEstimatedEnd: comp.maintenanceEstimatedEnd || null
        });
        return;
      }

      res.json({
        ...comp,
        maintenanceActive: comp.maintenanceActive === 1 || comp.maintenanceActive === true,
        maintenanceMessage: comp.maintenanceMessage || null,
        maintenanceSeverity: comp.maintenanceSeverity || 'info',
        maintenanceEstimatedEnd: comp.maintenanceEstimatedEnd || null
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch settings" });
    } finally {
      if (connection) await connection.close();
    }
  });
  app.post("/api/settings/company", authorize(['admin', 'power_admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId, isPowerAdmin } = await getTenantOrgId(req, connection);

      const updates = toOracleKeys(req.body);
      const validColumns = [
        'APPNAME', 'APPLOGOURL', 'COMPANYNAME', 'COMPANYLOGOURL', 
        'ADDRESS', 'CONTACTEMAIL', 'PRIMARYCOLOR', 'POWEREDBY'
      ];

      const filteredUpdates: any = {};
      validColumns.forEach(col => {
        if (updates[col] !== undefined) {
          filteredUpdates[col] = updates[col];
        }
      });

      if (Object.keys(filteredUpdates).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      // If user is Power Admin, they update global application branding & company identity
      if (isPowerAdmin) {
        const setClause = Object.keys(filteredUpdates).map((key, i) => `${key} = :${i + 1}`).join(', ');
        const values = Object.values(filteredUpdates);
        
        await connection.execute(
          `UPDATE companySettings SET ${setClause} WHERE id = '1'`,
          [...values]
        );
        await connection.commit();
        
        logAction(req, 'UPDATE', 'settings', 'company', `Platform Power Admin updated global application branding & identity`);
        return res.json({ id: '1', ...req.body });
      }

      // If client organization admin, they can update their own organization profile (name, address, email, primaryColor)
      if (orgId) {
        const orgUpdates: any = {};
        if (updates.COMPANYNAME) orgUpdates.name = updates.COMPANYNAME;
        if (updates.PRIMARYCOLOR) orgUpdates.primaryColor = updates.PRIMARYCOLOR;
        if (updates.CONTACTEMAIL) orgUpdates.contactEmail = updates.CONTACTEMAIL;
        if (updates.ADDRESS) orgUpdates.address = updates.ADDRESS;

        if (Object.keys(orgUpdates).length > 0) {
          const setClause = Object.keys(orgUpdates).map(k => `${k} = :${k}`).join(', ');
          await connection.execute(
            `UPDATE organizations SET ${setClause} WHERE id = :orgId`,
            { ...orgUpdates, orgId }
          );
          await connection.commit();
          logAction(req, 'UPDATE', 'settings', orgId, `Updated organization profile`);
          return res.json({ id: orgId, ...req.body });
        }
      }

      return res.status(403).json({ 
        error: "Global application branding & identity can only be modified by the Master Power Administrator." 
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update settings" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.get("/api/users", authorize(['admin', 'approver', 'applier', 'viewer', 'requester']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId, isPowerAdmin } = await getTenantOrgId(req, connection);
      const includePlatformAdmin = req.query.includePlatformAdmin === 'true';

      const conditions: string[] = [];
      const binds: any = {};

      if (!includePlatformAdmin) {
        conditions.push("role != 'power_admin' AND LOWER(email) != 'm.techsandgadgets@gmail.com'");
      }

      if (orgId && !isPowerAdmin) {
        conditions.push("(organizationId = :orgId OR organizationId IS NULL)");
        binds.orgId = orgId;
      } else if (req.query.organizationId) {
        conditions.push("organizationId = :orgId");
        binds.orgId = req.query.organizationId;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const result = await connection.execute(
        `SELECT id, email, role, displayName, photoURL, status, phone, jobTitle, department, division, project, organizationId, createdAt, lastLogin, preferences FROM users ${whereClause} ORDER BY displayName ASC`,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const rows = (result.rows || []).map((row: any) => {
        const item = toCamelCase(row);
        if (item.preferences && typeof item.preferences === 'string') {
          try {
            item.preferences = JSON.parse(item.preferences);
          } catch (e) {
            // keep raw or fallback
          }
        }
        return item;
      });
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch users" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // Current user profile and preferences endpoint
  app.get("/api/users/profile", authorize([]), async (req, res) => {
    let connection;
    try {
      const userId = (req.headers['x-user-id'] as string) || (req as any).user?.id;
      if (!userId || userId.toLowerCase() === 'system') {
        return res.status(401).json({ error: "Authentication required" });
      }
      connection = await getConnection();
      const result = await connection.execute(
        `SELECT id, email, role, displayName, photoURL, status, phone, jobTitle, department, division, project, organizationId, createdAt, lastLogin, preferences FROM users WHERE UPPER(id) = UPPER(:id)`,
        [userId],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if (!result.rows || result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }
      const user: any = toCamelCase(result.rows[0]);
      if (user.preferences && typeof user.preferences === 'string') {
        try {
          user.preferences = JSON.parse(user.preferences);
        } catch { /* ignore */ }
      }
      res.json(user);
    } catch (err) {
      console.error('Failed to get user profile:', err);
      res.status(500).json({ error: "Failed to get user profile" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.patch("/api/users/profile", authorize([]), async (req, res) => {
    let connection;
    try {
      const userId = (req.headers['x-user-id'] as string) || (req as any).user?.id;
      if (!userId || userId.toLowerCase() === 'system') {
        return res.status(401).json({ error: "Authentication required" });
      }
      connection = await getConnection();
      const currentRes = await connection.execute(
        `SELECT preferences FROM users WHERE UPPER(id) = UPPER(:id)`,
        [userId],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if (!currentRes.rows || currentRes.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      let existingPrefs: any = {};
      const rawPrefs = (currentRes.rows[0] as any)?.PREFERENCES || (currentRes.rows[0] as any)?.preferences;
      if (rawPrefs) {
        try {
          existingPrefs = typeof rawPrefs === 'string' ? JSON.parse(rawPrefs) : rawPrefs;
        } catch { /* ignore */ }
      }

      const updates: any = {};
      if (req.body.preferences) {
        const merged = { ...existingPrefs, ...req.body.preferences };
        updates.PREFERENCES = JSON.stringify(merged);
      }
      if (req.body.displayName) updates.DISPLAYNAME = req.body.displayName;
      if (req.body.phone) updates.PHONE = req.body.phone;
      if (req.body.photoURL) updates.PHOTOURL = req.body.photoURL;

      if (Object.keys(updates).length > 0) {
        const setClause = Object.keys(updates).map(k => `${k} = :${k}`).join(', ');
        await connection.execute(
          `UPDATE users SET ${setClause} WHERE UPPER(id) = UPPER(:id)`,
          { ...updates, id: userId }
        );
        await connection.commit();
      }

      res.json({ success: true });
    } catch (err) {
      console.error('Failed to update user profile:', err);
      res.status(500).json({ error: "Failed to update profile" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/users", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      const { email, password, displayName, role, department, division, project, jobTitle, phone } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      const effectiveOrgId = orgId || req.body.organizationId || 'org-habari';

      // Domain Whitelist & Seat Quota Verification
      const orgRes = await connection.execute(
        `SELECT name, allowedDomains, maxUsers, status FROM organizations WHERE id = :id`,
        [effectiveOrgId],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if (orgRes.rows && orgRes.rows.length > 0) {
        const org: any = toCamelCase(orgRes.rows[0]);
        // Domain whitelist
        if (org.allowedDomains && org.allowedDomains.trim()) {
          const emailDomain = email.trim().toLowerCase().split('@')[1];
          const allowed = org.allowedDomains.split(',').map((d: string) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
          if (allowed.length > 0 && !allowed.includes(emailDomain)) {
            return res.status(400).json({ 
              error: `Email domain '@${emailDomain}' is not permitted for organization '${org.name}'. Allowed domains: ${allowed.map((d: string) => '@' + d).join(', ')}` 
            });
          }
        }
        // User Seat Quota
        if (org.maxUsers && org.maxUsers > 0) {
          const userCountRes = await connection.execute(
            `SELECT COUNT(*) AS CNT FROM users WHERE organizationId = :orgId AND status = 'active'`,
            [effectiveOrgId],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );
          const activeCount = (userCountRes.rows?.[0] as any)?.CNT || 0;
          if (activeCount >= org.maxUsers) {
            return res.status(400).json({
              error: `User seat quota reached (${activeCount}/${org.maxUsers} seats used). Please contact your platform administrator to upgrade license capacity.`
            });
          }
        }
      }
      
      // Check if user with this email already exists
      const existing = await connection.execute(
        `SELECT id FROM users WHERE LOWER(email) = LOWER(:email)`,
        [email.trim()],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if (existing.rows && existing.rows.length > 0) {
        return res.status(400).json({ error: "A user with this email address already exists" });
      }

      const newId = Math.random().toString(36).substr(2, 9);
      const hashedPassword = bcrypt.hashSync(password, 10);
      const now = new Date().toISOString();

      const newUser = toOracleKeys({
        id: newId,
        email: email.trim().toLowerCase(),
        password: hashedPassword,
        role: role || 'requester',
        displayName: displayName || email.split('@')[0],
        photoURL: null,
        status: req.body.status || 'active',
        phone: phone || null,
        jobTitle: jobTitle || null,
        department: department || null,
        division: division || null,
        project: project || null,
        organizationId: effectiveOrgId,
        createdAt: now,
        lastLogin: null,
        preferences: JSON.stringify({ tableDensity: 'comfortable', dateFormat: 'DD/MM/YYYY', defaultLandingPage: '/' })
      });

      const cols = Object.keys(newUser).join(', ');
      const placeholders = Object.keys(newUser).map(k => `:${k}`).join(', ');

      await connection.execute(
        `INSERT INTO users (${cols}) VALUES (${placeholders})`,
        newUser
      );
      await connection.commit();

      logAction(req, 'CREATE', 'user', newId, `Created user account for ${email} (${role || 'requester'})`);
      
      const resUser: any = toCamelCase(newUser);
      delete resUser.password;
      if (resUser.preferences && typeof resUser.preferences === 'string') {
        try {
          resUser.preferences = JSON.parse(resUser.preferences);
        } catch (e) { /* ignore */ }
      }
      res.json(resUser);
    } catch (err: any) {
      console.error('Failed to create user:', err);
      res.status(500).json({ error: err.message || "Failed to create user" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.get("/api/auditLogs", authorize(['admin','power_admin']), async (req, res) => {
    const userRole = req.headers['x-user-role'] as string;
    if (userRole !== 'admin' && userRole !== 'power_admin') {
      return res.json([]);
    }
    let connection;
    try {
      connection = await getConnection();
      const { orgId, isPowerAdmin } = await getTenantOrgId(req, connection);
      const { userId, action, entityType, limit } = req.query;
      let sql = `SELECT * FROM auditLogs WHERE 1=1`;
      const binds: any = {};

      if (orgId && !isPowerAdmin) {
        // Standard org admin: strictly their organization's logs, excluding power admin and global system actions
        sql += ` AND organizationId = :orgId AND (userEmail IS NULL OR LOWER(userEmail) != 'm.techsandgadgets@gmail.com') AND userId != 'system'`;
        binds.orgId = orgId;
      } else if (!isPowerAdmin) {
        // Standard user with no org assigned cannot see cross-tenant or power admin logs
        sql += ` AND organizationId IS NULL AND (userEmail IS NULL OR LOWER(userEmail) != 'm.techsandgadgets@gmail.com') AND userId != 'system'`;
      } else if (req.query.organizationId) {
        // Power admin filtering by specific organization
        sql += ` AND organizationId = :orgId`;
        binds.orgId = req.query.organizationId;
      }

      if (userId && typeof userId === 'string' && userId.trim()) {
        sql += ` AND userId = :userId`;
        binds.userId = userId.trim();
      }
      if (action && typeof action === 'string' && action !== 'ALL') {
        sql += ` AND action = :action`;
        binds.action = action.trim();
      }
      if (entityType && typeof entityType === 'string' && entityType !== 'ALL') {
        sql += ` AND entityType = :entityType`;
        binds.entityType = entityType.trim();
      }

      sql += ` ORDER BY "TIMESTAMP" DESC`;

      if (limit && !isNaN(Number(limit))) {
        sql += ` FETCH FIRST ${Number(limit)} ROWS ONLY`;
      }

      const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      res.json(result.rows?.map(toCamelCase));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch logs" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // --- Real-Time User Presence & Heartbeat Endpoints ---
  app.post("/api/presence/heartbeat", authorize([]), (req, res) => {
    const userId = (req.headers['x-user-id'] as string) || req.body?.userId;
    if (!userId || userId.toLowerCase() === 'system') {
      return res.json({ ok: false, error: 'Anonymous or system user' });
    }

    const { email, displayName, role, organizationId, department, jobTitle, currentPage } = req.body || {};
    const now = Date.now();
    const existing = activePresences.get(userId);
    const orgId = organizationId !== undefined ? organizationId : (existing?.organizationId || (req.headers['x-user-org-id'] as string) || null);

    activePresences.set(userId, {
      userId,
      email: email || existing?.email || (req.headers['x-user-email'] as string) || '',
      displayName: displayName || existing?.displayName || (req.headers['x-user-name'] as string) || email || 'User',
      role: role || (req.headers['x-user-role'] as string) || existing?.role || 'viewer',
      organizationId: orgId,
      department: department || existing?.department || '',
      jobTitle: jobTitle || existing?.jobTitle || '',
      lastActive: now,
      connectedAt: existing?.connectedAt || now,
      currentPage: currentPage || existing?.currentPage || '/',
      ipAddress: ((req.headers['x-forwarded-for'] as string)?.split(',')[0]) || req.socket.remoteAddress || 'Local',
      userAgent: (req.headers['user-agent'] as string) || 'Browser'
    });

    cleanStalePresences();
    res.json({ ok: true, activeCount: activePresences.size });
  });

  app.post("/api/presence/logout", authorize([]), (req, res) => {
    const userId = (req.headers['x-user-id'] as string) || req.body?.userId;
    if (userId) {
      activePresences.delete(userId);
    }
    res.json({ ok: true });
  });

  app.get("/api/presence/online-users", authorize([]), async (req, res) => {
    cleanStalePresences();
    let tenantOrgId: string | null = null;
    let isPowerAdmin = false;
    let connection;
    try {
      connection = await getConnection();
      const tenantInfo = await getTenantOrgId(req, connection);
      tenantOrgId = tenantInfo.orgId;
      isPowerAdmin = tenantInfo.isPowerAdmin;
    } catch (e) {
      // fallback to header if db connection fails
      tenantOrgId = (req.headers['x-user-org-id'] as string) || null;
      isPowerAdmin = (req.headers['x-user-role'] as string) === 'power_admin';
    } finally {
      if (connection) await connection.close();
    }

    const now = Date.now();
    let presences = Array.from(activePresences.values());

    // If not power_admin, restrict to users in the same organization and exclude power_admin users
    if (!isPowerAdmin) {
      presences = presences.filter(p => {
        if (p.role === 'power_admin' || p.email?.toLowerCase() === 'm.techsandgadgets@gmail.com') return false;
        if (tenantOrgId) {
          return p.organizationId === tenantOrgId;
        }
        return true;
      });
    }

    const list = presences.map(p => {
      const inactiveSeconds = Math.floor((now - p.lastActive) / 1000);
      const status = inactiveSeconds < 90 ? 'online' : 'idle';
      return {
        ...p,
        status,
        secondsAgo: inactiveSeconds,
        sessionDurationMinutes: Math.floor((now - p.connectedAt) / 60000)
      };
    });

    res.json({
      onlineCount: list.filter(u => u.status === 'online').length,
      idleCount: list.filter(u => u.status === 'idle').length,
      totalActive: list.length,
      users: list
    });
  });


// --- In-App Notifications Endpoints ---
app.get("/api/notifications", authorize([]), async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  let connection;
  try {
    connection = await getConnection();
    const result = await connection.execute(
      `SELECT * FROM notifications WHERE userId = :userId ORDER BY "TIMESTAMP" DESC FETCH FIRST 50 ROWS ONLY`,
      [userId],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json((result.rows || []).map(toCamelCase));
  } catch (err) {
    console.error('Failed to fetch notifications:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  } finally {
    if (connection) await connection.close();
  }
});

app.patch("/api/notifications/mark-all-read", authorize([]), async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  let connection;
  try {
    connection = await getConnection();
    await connection.execute(
      `UPDATE notifications SET isRead = 1 WHERE userId = :userId AND isRead = 0`,
      { userId }
    );
    await connection.commit();
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to mark all notifications read:', err);
    res.status(500).json({ error: 'Failed to update notifications' });
  } finally {
    if (connection) await connection.close();
  }
});

app.patch("/api/notifications/:id/read", authorize([]), async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  let connection;
  try {
    connection = await getConnection();
    await connection.execute(
      `UPDATE notifications SET isRead = 1 WHERE id = :id AND userId = :userId`,
      { id: req.params.id, userId }
    );
    await connection.commit();
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to mark notification read:', err);
    res.status(500).json({ error: 'Failed to update notification' });
  } finally {
    if (connection) await connection.close();
  }
});
  // --- Super Admin User Reports & Analytics Endpoint ---
  app.get("/api/admin/user-reports", authorize(['admin', 'approver', 'applier', 'viewer', 'requester']), async (req, res) => {
    cleanStalePresences();
    let connection;
    try {
      connection = await getConnection();
      const { orgId, isPowerAdmin } = await getTenantOrgId(req, connection);
      
      // 1. Fetch registered organization users (strictly scoped to tenant if not power admin)
      let users: any[] = [];
      try {
        let usersSql = `SELECT id, email, role, displayName, photoURL, status, phone, jobTitle, department, division, project, organizationId, createdAt, lastLogin, preferences 
                        FROM users 
                        WHERE role != 'power_admin' AND LOWER(email) != 'm.techsandgadgets@gmail.com'`;
        const userBinds: any = {};
        if (orgId && !isPowerAdmin) {
          usersSql += ` AND organizationId = :orgId`;
          userBinds.orgId = orgId;
        } else if (!isPowerAdmin) {
          usersSql += ` AND organizationId IS NULL`;
        }
        usersSql += ` ORDER BY displayName ASC`;

        const usersResult = await connection.execute(
          usersSql,
          userBinds,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        users = (usersResult.rows || []).map(toCamelCase);
      } catch (uErr) {
        console.warn("User reports: users query warning:", uErr);
      }

      // 2. Aggregate pass application counts by requester
      const appCountsMap: Record<string, number> = {};
      try {
        let passSql = `SELECT requesterId, count(*) as count FROM passRequests WHERE 1=1`;
        const passBinds: any = {};
        if (orgId && !isPowerAdmin) {
          passSql += ` AND organizationId = :orgId`;
          passBinds.orgId = orgId;
        }
        passSql += ` GROUP BY requesterId`;

        const appCountsResult = await connection.execute(
          passSql,
          passBinds,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        (appCountsResult.rows || []).forEach((row: any) => {
          const r = toCamelCase(row);
          const reqId = r.requesterId || r.requesterid || r.REQUESTERID;
          if (reqId) {
            appCountsMap[String(reqId).toLowerCase()] = Number(r.count || r.COUNT) || 0;
          }
        });
      } catch (aErr) {
        console.warn("User reports: passRequests count aggregation warning:", aErr);
      }

      // 3. Aggregate approval decisions from requestHistory
      const approvalCountsMap: Record<string, number> = {};
      try {
        let histSql = `SELECT userId, count(*) as count FROM requestHistory WHERE (action LIKE '%STATUS_UPDATE%' OR action LIKE '%APPROV%' OR action LIKE '%REJECT%')`;
        const histBinds: any = {};
        if (orgId && !isPowerAdmin) {
          // requestHistory stores requestId pointing to passRequests, which has organizationId
          histSql += ` AND requestId IN (SELECT id FROM passRequests WHERE organizationId = :orgId)`;
          histBinds.orgId = orgId;
        }
        histSql += ` GROUP BY userId`;

        const histResult = await connection.execute(
          histSql,
          histBinds,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        (histResult.rows || []).forEach((row: any) => {
          const r = toCamelCase(row);
          const uId = r.userId || r.userid || r.USERID;
          if (uId) {
            approvalCountsMap[String(uId).toLowerCase()] = Number(r.count || r.COUNT) || 0;
          }
        });
      } catch (hErr) {
        console.warn("User reports: requestHistory count aggregation warning:", hErr);
      }

      // 4. Aggregate total audit actions logged per user (scoped to organization)
      const auditCountsMap: Record<string, { count: number; lastActionTime: string }> = {};
      try {
        let auditSql = `SELECT userId, userEmail, count(*) as count, max("TIMESTAMP") as lastActionTime 
                        FROM auditLogs 
                        WHERE 1=1`;
        const auditBinds: any = {};
        if (orgId && !isPowerAdmin) {
          auditSql += ` AND organizationId = :orgId AND (userEmail IS NULL OR LOWER(userEmail) != 'm.techsandgadgets@gmail.com') AND userId != 'system'`;
          auditBinds.orgId = orgId;
        }
        auditSql += ` GROUP BY userId, userEmail`;

        const auditCountResult = await connection.execute(
          auditSql,
          auditBinds,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        (auditCountResult.rows || []).forEach((row: any) => {
          const r = toCamelCase(row);
          const uId = r.userId || r.userid || r.USERID;
          const uEmail = r.userEmail || r.useremail || r.USEREMAIL;
          const count = Number(r.count || r.COUNT) || 0;
          const lastAction = r.lastActionTime || r.lastactiontime || r.LASTACTIONTIME || '';

          if (uId) {
            auditCountsMap[String(uId).toLowerCase()] = { count, lastActionTime: lastAction };
          }
          if (uEmail) {
            auditCountsMap[String(uEmail).toLowerCase()] = { count, lastActionTime: lastAction };
          }
        });
      } catch (audErr) {
        console.warn("User reports: auditLogs count aggregation warning:", audErr);
      }

      // 5. Recent authentication / security events (strictly tenant scoped)
      let recentAuthEvents: any[] = [];
      try {
        let eventsSql = `SELECT id, userId, userEmail, userName, action, entityType, entityId, details, "TIMESTAMP" as timestamp 
                         FROM auditLogs 
                         WHERE (entityType IN ('auth', 'user') OR action IN ('LOGIN', 'LOGOUT', 'RESET_PASSWORD', 'CREATE', 'UPDATE'))`;
        const eventBinds: any = {};
        if (orgId && !isPowerAdmin) {
          eventsSql += ` AND organizationId = :orgId AND (userEmail IS NULL OR LOWER(userEmail) != 'm.techsandgadgets@gmail.com') AND userId != 'system'`;
          eventBinds.orgId = orgId;
        }
        eventsSql += ` ORDER BY "TIMESTAMP" DESC FETCH FIRST 30 ROWS ONLY`;

        const authEventsResult = await connection.execute(
          eventsSql,
          eventBinds,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        recentAuthEvents = (authEventsResult.rows || []).map(toCamelCase);
      } catch (evErr) {
        try {
          // Fallback query if FETCH FIRST is unsupported in older Oracle versions
          let fallbackSql = `SELECT * FROM (
               SELECT id, userId, userEmail, userName, action, entityType, entityId, details, "TIMESTAMP" as timestamp 
               FROM auditLogs 
               WHERE (entityType IN ('auth', 'user') OR action IN ('LOGIN', 'LOGOUT', 'RESET_PASSWORD', 'CREATE', 'UPDATE'))`;
          const fbBinds: any = {};
          if (orgId && !isPowerAdmin) {
            fallbackSql += ` AND organizationId = :orgId AND (userEmail IS NULL OR LOWER(userEmail) != 'm.techsandgadgets@gmail.com') AND userId != 'system'`;
            fbBinds.orgId = orgId;
          }
          fallbackSql += ` ORDER BY "TIMESTAMP" DESC) WHERE ROWNUM <= 30`;

          const fallbackEvents = await connection.execute(
            fallbackSql,
            fbBinds,
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );
          recentAuthEvents = (fallbackEvents.rows || []).map(toCamelCase);
        } catch (evErr2) {
          console.warn("User reports: recentAuthEvents warning:", evErr2);
        }
      }

      // Build role & department distributions
      const roleDistribution: Record<string, number> = {};
      const departmentDistribution: Record<string, number> = {};
      let activeUsersCount = 0;
      let pendingUsersCount = 0;

      users.forEach((u: any) => {
        const role = u.role || 'requester';
        roleDistribution[role] = (roleDistribution[role] || 0) + 1;

        const dept = u.department || 'Unassigned';
        departmentDistribution[dept] = (departmentDistribution[dept] || 0) + 1;

        if (u.status === 'active') activeUsersCount++;
        if (u.status === 'pending') pendingUsersCount++;
      });

      const now = Date.now();
      let presences = Array.from(activePresences.values());
      // Tenant filtering for online presence
      if (!isPowerAdmin) {
        presences = presences.filter(p => {
          if (p.role === 'power_admin' || p.email?.toLowerCase() === 'm.techsandgadgets@gmail.com') return false;
          if (orgId) {
            return p.organizationId === orgId;
          }
          return true;
        });
      }

      const onlineList = presences.map(p => {
        const inactiveSeconds = Math.max(0, Math.floor((now - (p.lastActive || now)) / 1000));
        return {
          ...p,
          status: inactiveSeconds < 90 ? 'online' : 'idle',
          secondsAgo: inactiveSeconds,
          sessionDurationMinutes: Math.max(0, Math.floor((now - (p.connectedAt || now)) / 60000))
        };
      });

      // Build workload ranking
      const workloadRanking = users.map((u: any) => {
        const uId = (u.id || '').toLowerCase();
        const uEmail = (u.email || '').toLowerCase();
        const presence = activePresences.get(u.id);
        const isOnline = presence ? (now - presence.lastActive < 90000) : false;
        const auditStats = auditCountsMap[uId] || auditCountsMap[uEmail] || { count: 0, lastActionTime: u.lastLogin };

        return {
          userId: u.id || `usr-${Math.random().toString(36).substr(2, 6)}`,
          userEmail: u.email || '',
          userName: u.displayName || u.name || u.email || 'Unnamed User',
          role: u.role || 'requester',
          department: u.department || 'Unassigned',
          status: u.status || 'active',
          applicationsCreated: appCountsMap[uId] || appCountsMap[uEmail] || 0,
          approvalsProcessed: approvalCountsMap[uId] || approvalCountsMap[uEmail] || 0,
          totalActionsLogged: auditStats.count,
          lastActiveAt: isOnline ? new Date().toISOString() : (auditStats.lastActionTime || u.lastLogin || u.createdAt),
          isOnline
        };
      }).sort((a: any, b: any) => (b.totalActionsLogged + b.applicationsCreated + b.approvalsProcessed) - (a.totalActionsLogged + a.applicationsCreated + a.approvalsProcessed));

      res.json({
        totalUsers: users.length,
        activeUsers: activeUsersCount,
        onlineNowCount: onlineList.filter(u => u.status === 'online').length,
        idleCount: onlineList.filter(u => u.status === 'idle').length,
        pendingUsersCount,
        roleDistribution,
        departmentDistribution,
        onlineUsers: onlineList,
        workloadRanking,
        recentAuthEvents
      });
    } catch (err: any) {
      console.error("Failed to generate user reports:", err);
      // Even in worst case, return empty valid structure instead of 500
      res.json({
        totalUsers: 0,
        activeUsers: 0,
        onlineNowCount: 0,
        idleCount: 0,
        pendingUsersCount: 0,
        roleDistribution: {},
        departmentDistribution: {},
        onlineUsers: [],
        workloadRanking: [],
        recentAuthEvents: []
      });
    } finally {
      if (connection) await connection.close();
    }
  });

  // --- Company Structure Endpoints ---
  app.get("/api/divisions", authorize(['admin', 'approver', 'applier', 'viewer']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      let sql = `SELECT * FROM divisions WHERE status = 'active'`;
      const binds: any = {};
      if (orgId) {
        sql += ` AND (organizationId = :orgId OR organizationId IS NULL)`;
        binds.orgId = orgId;
      }
      sql += ` ORDER BY name ASC`;
      const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      res.json(result.rows?.map(toCamelCase));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch divisions" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/divisions", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      const effectiveOrgId = orgId || req.body.organizationId || 'org-habari';
      const newDivision = toOracleKeys({ 
        ...req.body, 
        id: Math.random().toString(36).substr(2, 9), 
        status: 'active',
        organizationId: effectiveOrgId
      });
      await connection.execute(
        `INSERT INTO divisions (id, name, status, organizationId) VALUES (:ID, :NAME, :STATUS, :ORGANIZATIONID)`,
        newDivision
      );
      await connection.commit();
      logAction(req, 'CREATE', 'division', newDivision.ID, `Created division ${newDivision.NAME}`);
      res.json(toCamelCase(newDivision));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create division" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.patch("/api/divisions/:id", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const updates = toOracleKeys(req.body);
      delete updates.ID;
      const setClause = Object.keys(updates).map(k => `${k} = :${k}`).join(', ');
      
      await connection.execute(
        `UPDATE divisions SET ${setClause} WHERE id = :id`,
        { ...updates, id: req.params.id }
      );
      await connection.commit();
      logAction(req, 'UPDATE', 'division', req.params.id, `Updated division ${req.params.id}`);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update division" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.delete("/api/divisions/:id", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const oracledb = (await import("oracledb")).default;
      const force = req.query.force === 'true';

      if (!force) {
        // Check for connected personnel
        const result = await connection.execute(
          `SELECT COUNT(*) as count FROM employees WHERE division = (SELECT name FROM divisions WHERE id = :id)`,
          [req.params.id],
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const count = result.rows?.[0]?.COUNT || 0;
        if (count > 0) {
          return res.status(400).json({ error: `Cannot delete division: ${count} personnel ${count === 1 ? 'is' : 'are'} still assigned to it.` });
        }
      }

      await connection.execute(`UPDATE divisions SET status = 'inactive' WHERE id = :id`, { id: req.params.id });
      await connection.commit();
      logAction(req, 'DELETE', 'division', req.params.id, `Deactivated division ${req.params.id}`);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete division" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.get("/api/projects", authorize(['admin', 'approver', 'applier', 'viewer']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      let sql = `SELECT * FROM projects WHERE status = 'active'`;
      const binds: any = {};
      if (orgId) {
        sql += ` AND (organizationId = :orgId OR organizationId IS NULL)`;
        binds.orgId = orgId;
      }
      sql += ` ORDER BY name ASC`;
      const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      res.json(result.rows?.map(toCamelCase));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch projects" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/projects", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      const effectiveOrgId = orgId || req.body.organizationId || 'org-habari';
      const projData = toOracleKeys({
        id: Math.random().toString(36).substr(2, 9),
        status: 'active',
        name: req.body.name,
        contractNumber: req.body.contractNumber || null,
        clientCompany: req.body.clientCompany || null,
        clientApprovers: req.body.clientApprovers || null,
        endDate: req.body.endDate || null,
        organizationId: effectiveOrgId
      });
      const cols = Object.keys(projData).join(', ');
      const placeholders = Object.keys(projData).map((_, i) => `:${i + 1}`).join(', ');
      await connection.execute(
        `INSERT INTO projects (${cols}) VALUES (${placeholders})`,
        Object.values(projData)
      );
      await connection.commit();
      logAction(req, 'CREATE', 'project', projData.ID, `Created project ${projData.NAME}`);
      res.json(toCamelCase(projData));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create project" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.patch("/api/projects/:id", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const updates = toOracleKeys(req.body);
      delete updates.ID;
      const setClause = Object.keys(updates).map(k => `${k} = :${k}`).join(', ');
      
      await connection.execute(
        `UPDATE projects SET ${setClause} WHERE id = :id`,
        { ...updates, id: req.params.id }
      );
      await connection.commit();
      logAction(req, 'UPDATE', 'project', req.params.id, `Updated project ${req.params.id}`);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update project" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.delete("/api/projects/:id", authorize(['admin','power_admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const oracledb = (await import("oracledb")).default;
      const force = req.query.force === 'true';

      if (!force) {
        // Check for active personnel or passes connected to this project
        const projResult = await connection.execute(`SELECT name FROM projects WHERE id = :id`, [req.params.id], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const projName = projResult.rows?.[0]?.NAME;

        if (projName) {
          const checkResult = await connection.execute(
            `SELECT (SELECT COUNT(*) FROM employees WHERE project = :name) as emp_count,
                    (SELECT COUNT(*) FROM passes WHERE status = 'active' AND locationId IN (SELECT id FROM locations WHERE name = :name)) as pass_count FROM dual`,
            { name: projName },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );

          const empCount = checkResult.rows?.[0]?.EMP_COUNT || 0;
          const passCount = checkResult.rows?.[0]?.PASS_COUNT || 0;
          if (empCount > 0 || passCount > 0) {
            return res.status(400).json({ error: `Cannot delete project: ${empCount} personnel and ${passCount} active passes are connected.` });
          }
        }
      }

      await connection.execute(`UPDATE projects SET status = 'inactive' WHERE id = :id`, { id: req.params.id });
      await connection.commit();
      logAction(req, 'DELETE', 'project', req.params.id, `Deactivated project ${req.params.id}`);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete project" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.get("/api/departments", authorize([]), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      let sql = `SELECT * FROM departments WHERE status = 'active'`;
      const binds: any = {};
      if (orgId) {
        sql += ` AND (organizationId = :orgId OR organizationId IS NULL)`;
        binds.orgId = orgId;
      }
      sql += ` ORDER BY name ASC`;
      const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      res.json(result.rows?.map(toCamelCase));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch departments" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/departments", authorize(['admin','power_admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      const effectiveOrgId = orgId || req.body.organizationId || 'org-habari';
      const newDept = toOracleKeys({ 
        ...req.body, 
        id: Math.random().toString(36).substr(2, 9), 
        status: 'active',
        organizationId: effectiveOrgId
      });
      await connection.execute(
        `INSERT INTO departments (id, name, status, organizationId) VALUES (:ID, :NAME, :STATUS, :ORGANIZATIONID)`,
        newDept
      );
      await connection.commit();
      logAction(req, 'CREATE', 'department', newDept.ID, `Created department ${newDept.NAME}`);
      res.json(toCamelCase(newDept));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create department" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.patch("/api/departments/:id", authorize(['admin','power_admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const updates = toOracleKeys(req.body);
      delete updates.ID;
      const setClause = Object.keys(updates).map(k => `${k} = :${k}`).join(', ');
      
      await connection.execute(
        `UPDATE departments SET ${setClause} WHERE id = :id`,
        { ...updates, id: req.params.id }
      );
      await connection.commit();
      logAction(req, 'UPDATE', 'department', req.params.id, `Updated department ${req.params.id}`);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update department" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.delete("/api/departments/:id", authorize(['admin','power_admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const oracledb = (await import("oracledb")).default;
      const force = req.query.force === 'true';

      if (!force) {
        // Check for connected personnel
        const result = await connection.execute(
          `SELECT COUNT(*) as count FROM employees WHERE department = (SELECT name FROM departments WHERE id = :id)`,
          [req.params.id],
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const count = result.rows?.[0]?.COUNT || 0;
        if (count > 0) {
          return res.status(400).json({ error: `Cannot delete department: ${count} personnel ${count === 1 ? 'is' : 'are'} still assigned to it.` });
        }
      }

      await connection.execute(`UPDATE departments SET status = 'inactive' WHERE id = :id`, { id: req.params.id });
      await connection.commit();
      logAction(req, 'DELETE', 'department', req.params.id, `Deactivated department ${req.params.id}`);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete department" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.patch("/api/users/profile", async (req, res) => {
    let connection;
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId || userId === 'System') {
        return res.status(401).json({ error: "Unauthorized" });
      }

      connection = await getConnection();
      const updates: any = toOracleKeys(req.body);
      delete updates.ID;
      delete updates.EMAIL; // Don't change login email directly from profile
      
      if (updates.PASSWORD) {
        updates.PASSWORD = bcrypt.hashSync(updates.PASSWORD, 10);
      }

      if (updates.PREFERENCES && typeof updates.PREFERENCES === 'object') {
        updates.PREFERENCES = JSON.stringify(updates.PREFERENCES);
      }
      
      const setClause = Object.keys(updates).map(key => `${key} = :${key}`).join(', ');
      
      await connection.execute(
        `UPDATE users SET ${setClause} WHERE id = :id`,
        { ...updates, id: userId }
      );
      await connection.commit();
      
      logAction(req, 'UPDATE', 'user', userId, `Updated own profile and settings`);
      res.json({ id: userId, ...toCamelCase(updates) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update profile" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.patch("/api/users/:id", async (req, res) => {
    let connection;
    try {
      const currentUserId = req.headers['x-user-id'] as string;
      const targetUserId = req.params.id;
      if (!currentUserId || currentUserId === 'System') {
        return res.status(401).json({ error: "Unauthorized" });
      }

      connection = await getConnection();
      
      // Check current user's role
      const adminCheck = await connection.execute(`SELECT role FROM users WHERE id = :id`, [currentUserId], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const currentUser = toCamelCase((adminCheck.rows as any[])?.[0]);
      const isAdmin = currentUser?.role === 'admin';
      const isSelf = currentUserId === targetUserId;

      if (!isAdmin && !isSelf) {
        return res.status(403).json({ error: "You do not have permission to update this user account" });
      }

      const updates: any = toOracleKeys(req.body);
      delete updates.ID;

      // Non-admins cannot alter their own role or status
      if (!isAdmin) {
        delete updates.ROLE;
        delete updates.STATUS;
        delete updates.EMAIL;
      }

      if (updates.PASSWORD) {
        updates.PASSWORD = bcrypt.hashSync(updates.PASSWORD, 10);
      }

      if (updates.PREFERENCES && typeof updates.PREFERENCES === 'object') {
        updates.PREFERENCES = JSON.stringify(updates.PREFERENCES);
      }

      if (Object.keys(updates).length === 0) {
        return res.json({ id: targetUserId });
      }

      const setClause = Object.keys(updates).map(key => `${key} = :${key}`).join(', ');
      
      await connection.execute(
        `UPDATE users SET ${setClause} WHERE id = :id`,
        { ...updates, id: targetUserId }
      );
      await connection.commit();
      
      if (updates.STATUS) {
        await createNotification(connection, {
          userId: targetUserId,
          type: 'account_status',
          title: 'Your account status changed',
          message: `Your account is now: ${updates.STATUS}`,
          entityType: 'user',
          entityId: targetUserId,
        });
      }
      const actionType = updates.STATUS === 'active' ? 'APPROVE_USER' : 'UPDATE';
      logAction(req, actionType, 'user', targetUserId, isSelf ? 'Updated own profile credentials/settings' : `Updated user credentials/role/status`);
      
      const sanitizedResponse = toCamelCase(updates);
      delete sanitizedResponse.password;
      res.json({ id: targetUserId, ...sanitizedResponse });
    } catch (err: any) {
      console.error('Failed to update user:', err);
      res.status(500).json({ error: err.message || "Failed to update user" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/users/:id/reset-password", authorize(['admin','power_admin']), async (req, res) => {
    let connection;
    try {
      const currentUserId = req.headers['x-user-id'] as string;
      connection = await getConnection();

      // Verify admin
      const adminCheck = await connection.execute(`SELECT role FROM users WHERE id = :id`, [currentUserId], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const currentUser = toCamelCase((adminCheck.rows as any[])[0]);
      if (currentUser?.role !== 'admin') {
        return res.status(403).json({ error: "Only admins can reset passwords" });
      }

      const newPassword = req.body?.newPassword || 'password123';
      const hashedPassword = bcrypt.hashSync(newPassword, 10);

      await connection.execute(
        `UPDATE users SET password = :password WHERE id = :id`,
        { password: hashedPassword, id: req.params.id }
      );
      await connection.commit();

      logAction(req, 'UPDATE', 'user', req.params.id, `Reset password for user`);
      res.json({ success: true, message: `Password reset successfully to ${newPassword}` });
    } catch (err: any) {
      console.error('Password reset failed:', err);
      res.status(500).json({ error: err.message || "Failed to reset password" });
    } finally {
      if (connection) await connection.close();
    }
  });


  // =========================================================================
  // --- SAAS BUSINESS ADMINISTRATION & MULTI-TENANT COMPANY LICENSING ---
  // Strictly Protected: Accessible exclusively to Global Power Admin (Software Vendor Root)
  // =========================================================================

  // 1. SaaS Business Platform Dashboard & Metrics
  app.get("/api/platform/dashboard", authorizePowerAdmin(), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      
      const [orgsRes, usersRes, compRes] = await Promise.all([
        connection.execute(`SELECT * FROM organizations`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }).catch(() => ({ rows: [] })),
        connection.execute(`SELECT role, status FROM users`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }),
        connection.execute(`SELECT * FROM companySettings`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })
      ]);

      const orgs = (orgsRes.rows || []).map(toCamelCase);
      const totalCompanies = orgs.length;
      const activeSubscriptions = orgs.filter(o => o.status === 'active' || !o.status).length;
      const suspendedCompanies = orgs.filter(o => o.status === 'suspended').length;
      const trialCompanies = orgs.filter(o => o.status === 'trial').length;

      const tierDistribution: Record<string, number> = {};
      let totalAllocatedSeats = 0;
      for (const o of orgs) {
        const tier = o.licenseTier || 'Enterprise';
        tierDistribution[tier] = (tierDistribution[tier] || 0) + 1;
        totalAllocatedSeats += Number(o.maxUsers || 50);
      }

      const activeCompany = compRes.rows && compRes.rows.length > 0 ? toCamelCase(compRes.rows[0]) : null;

      res.json({
        totalCompanies,
        activeSubscriptions,
        suspendedCompanies,
        trialCompanies,
        tierDistribution,
        totalAllocatedSeats,
        platformVersion: "v4.5.2 SaaS Enterprise Engine",
        vendor: "Techsandgadgets.com",
        leadArchitect: "Muhammad Haris",
        activeOrganization: activeCompany,
        systemHealth: {
          status: 'operational',
          dbConnected: true,
          uptimeSeconds: Math.floor(process.uptime()),
          oracleVersion: 'Oracle Database 23ai / Cloud Instance'
        }
      });
    } catch (err: any) {
      console.error('SaaS dashboard fetch failed:', err);
      res.status(500).json({ error: err.message || "Failed to load SaaS business dashboard" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // 2. Standardized SaaS Plans & Feature Matrix
  app.get("/api/platform/plans", authorizePowerAdmin(), (req, res) => {
    const plans = [
      {
        id: 'starter',
        name: 'Starter Edition',
        code: 'STR',
        badgeColor: 'blue',
        price: '$1,800',
        pricePerYear: 'USD 1,800 / yr',
        billingPeriod: '/ year',
        defaultMaxUsers: 5,
        maxUsers: 5,
        defaultMaxPasses: 500,
        maxPasses: 500,
        features: [
          'Up to 5 Administrator & Applier Seats',
          'Up to 500 Active Gate Passes',
          'Standard Pass Request & Approval Workflow',
          'Single Site Location & Access Matrix',
          'Email Notifications & Digital Pass Generation',
          'Standard 48-Hour Technical Support'
        ]
      },
      {
        id: 'professional',
        name: 'Professional Edition',
        code: 'PRO',
        badgeColor: 'emerald',
        price: '$4,500',
        pricePerYear: 'USD 4,500 / yr',
        billingPeriod: '/ year',
        defaultMaxUsers: 25,
        maxUsers: 25,
        defaultMaxPasses: 5000,
        maxPasses: 5000,
        features: [
          'Up to 25 Administrator & Applier Seats',
          'Up to 5,000 Active Gate Passes',
          'Multi-Tier Approval Hierarchy & Delegation',
          'Multi-Site Locations, Zones & Access Codes',
          'QID / Passport Expiry Alerts & Roster Management',
          'Audit Log Trails & Compliance Export',
          'Priority 12-Hour Support SLA'
        ],
        recommended: true
      },
      {
        id: 'enterprise',
        name: 'Enterprise Unlimited',
        code: 'ENT',
        badgeColor: 'purple',
        price: '$9,800',
        pricePerYear: 'USD 9,800 / yr',
        billingPeriod: '/ year',
        defaultMaxUsers: 9999,
        maxUsers: 'Unlimited',
        defaultMaxPasses: 999999,
        maxPasses: 'Unlimited',
        features: [
          'Unlimited Administrative & Operator Seats',
          'Unlimited Gate Passes & Access Applications',
          'White-Label Custom Corporate Branding & Domain',
          'Complete Gate Taxonomy & Multi-Zone Matrix',
          'Full Audit Trail with Archival Engine',
          'Realtime Attendance & Live Gate Telemetry',
          'Dedicated Account Architect (Techsandgadgets.com)'
        ]
      },
      {
        id: 'defense_gov',
        name: 'Government & Critical Infrastructure',
        code: 'GOV',
        badgeColor: 'amber',
        price: 'Custom',
        pricePerYear: 'Custom / High-Security',
        billingPeriod: 'Contract',
        defaultMaxUsers: 9999,
        maxUsers: 'Unlimited',
        defaultMaxPasses: 999999,
        maxPasses: 'Unlimited',
        features: [
          'High-Security Air-Gapped / Isolated Schema Deployment',
          'Strict Biometric & QID Verification Enforcement',
          'Custom Security Clearance & Approver Matrix',
          '24/7 Mission-Critical SLA & Dedicated On-Site Support',
          'Encrypted Audit Logs & Forensic Traceability'
        ]
      }
    ];

    res.json(plans);
  });

  // 3. List all Licensed Client Companies
  app.get("/api/platform/companies", authorizePowerAdmin(), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const result = await connection.execute(
        `SELECT * FROM organizations ORDER BY createdAt DESC`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      res.json((result.rows || []).map(toCamelCase));
    } catch (err: any) {
      console.error('Failed to list companies:', err);
      res.status(500).json({ error: err.message || "Failed to fetch licensed companies" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // 4. Provision & License a New Client Company
  app.post("/api/platform/companies/license", authorizePowerAdmin(), async (req, res) => {
    let connection;
    try {
      const {
        companyName,
        orgCode,
        appName,
        primaryAdminName,
        primaryAdminEmail,
        primaryAdminPassword,
        initialAdminPassword,
        contactPhone,
        address,
        primaryColor,
        licenseTier,
        licenseDuration,
        licenseExpiry,
        maxUsers,
        maxPasses,
        maxEmployees,
        allowedDomains,
        notes
      } = req.body;

      if (!companyName || !companyName.trim()) {
        return res.status(400).json({ error: "Company name is required." });
      }

      if (!primaryAdminEmail || !primaryAdminEmail.trim()) {
        return res.status(400).json({ error: "Primary administrator email is required." });
      }

      connection = await getConnection();
      const now = new Date().toISOString();
      const cleanCode = (orgCode || companyName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)).toUpperCase();
      const orgId = `org-${cleanCode.toLowerCase()}-${Math.random().toString(36).substr(2, 6)}`;

      // Calculate Expiry Date
      let calculatedExpiry = '2036-12-31';
      const nowYear = new Date().getFullYear();
      if (licenseDuration === '1year') {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 1);
        calculatedExpiry = d.toISOString().split('T')[0];
      } else if (licenseDuration === '2year') {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 2);
        calculatedExpiry = d.toISOString().split('T')[0];
      } else if (licenseDuration === '3year') {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 3);
        calculatedExpiry = d.toISOString().split('T')[0];
      } else if (licenseExpiry) {
        calculatedExpiry = licenseExpiry;
      }

      // Generate Official SaaS License Key
      const tierCode = (licenseTier || 'ENT').slice(0, 3).toUpperCase();
      const randomKeyPart = Math.random().toString(36).substring(2, 6).toUpperCase();
      const generatedLicenseKey = `TECH-${cleanCode}-${tierCode}-${randomKeyPart}-${nowYear}`;

      const clientAdminEmail = primaryAdminEmail.trim().toLowerCase();
      const clientAdminPass = primaryAdminPassword || initialAdminPassword || 'password123';
      const hashedPass = await bcrypt.hash(clientAdminPass, 10);
      const clientAdminDisplayName = primaryAdminName || `${companyName} Super Admin`;

      // 1. Insert into organizations table
      await connection.execute(
        `INSERT INTO organizations (
          id, name, code, appName, primaryColor, poweredBy, contactEmail, contactPhone,
          primaryAdminName, primaryAdminEmail, address, licenseKey, licenseTier, licenseExpiry,
          maxUsers, maxPasses, maxEmployees, allowedDomains, status, isCurrent, notes, createdAt, updatedAt
        ) VALUES (
          :id, :name, :code, :appName, :primaryColor, 'by Techsandgadgets.com', :contactEmail, :contactPhone,
          :primaryAdminName, :primaryAdminEmail, :address, :licenseKey, :licenseTier, :licenseExpiry,
          :maxUsers, :maxPasses, :maxEmployees, :allowedDomains, 'active', 0, :notes, :createdAt, :updatedAt
        )`,
        {
          id: orgId,
          name: companyName,
          code: cleanCode,
          appName: appName || companyName,
          primaryColor: primaryColor || '#800020',
          contactEmail: clientAdminEmail,
          contactPhone: contactPhone || null,
          primaryAdminName: clientAdminDisplayName,
          primaryAdminEmail: clientAdminEmail,
          address: address || 'Doha, Qatar',
          licenseKey: generatedLicenseKey,
          licenseTier: licenseTier || 'Enterprise Edition',
          licenseExpiry: calculatedExpiry,
          maxUsers: maxUsers || (licenseTier === 'Starter' ? 5 : licenseTier === 'Professional' ? 25 : 500),
          maxPasses: maxPasses || (licenseTier === 'Starter' ? 500 : licenseTier === 'Professional' ? 5000 : 50000),
          maxEmployees: maxEmployees || (licenseTier === 'Starter' ? 200 : licenseTier === 'Professional' ? 2000 : 25000),
          allowedDomains: allowedDomains || null,
          notes: notes || `Licensed by Techsandgadgets.com Platform Owner on ${now.split('T')[0]}`,
          createdAt: now,
          updatedAt: now
        }
      );

      // 2. Provision or update the Client's Super Admin account
      const userCheck = await connection.execute(
        `SELECT id FROM users WHERE LOWER(email) = LOWER(:email)`,
        [clientAdminEmail]
      );

      if (userCheck.rows && userCheck.rows.length > 0) {
        await connection.execute(
          `UPDATE users SET displayName = :name, password = :pwd, role = 'admin', status = 'active', department = 'Administration', jobTitle = 'Organization Super Admin' WHERE LOWER(email) = LOWER(:email)`,
          { name: clientAdminDisplayName, pwd: hashedPass, email: clientAdminEmail }
        );
      } else {
        const newUserId = `user-${Math.random().toString(36).substr(2, 7)}`;
        await connection.execute(
          `INSERT INTO users (id, email, password, role, displayName, photoURL, status, department, jobTitle, createdAt)
           VALUES (:id, :email, :password, 'admin', :name, :photoURL, 'active', 'Administration', 'Organization Super Admin', :createdAt)`,
          {
            id: newUserId,
            email: clientAdminEmail,
            password: hashedPass,
            name: clientAdminDisplayName,
            photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(clientAdminDisplayName)}&background=800020&color=fff`,
            createdAt: now
          }
        );
      }

      // 3. Log Audit Trail
      const auditId = Math.random().toString(36).substr(2, 9);
      await connection.execute(
        `INSERT INTO auditLogs (id, userId, userEmail, userName, action, entityType, entityId, details, timestamp)
         VALUES (:id, 'poweradmin', 'm.techsandgadgets@gmail.com', 'Muhammad Haris (Power Admin)', 'LICENSE_COMPANY_PROVISIONED', 'organization', :orgId, :details, :timestamp)`,
        {
          id: auditId,
          orgId,
          details: `Provisioned & Licensed new company "${companyName}" (${cleanCode}) under Tier "${licenseTier || 'Enterprise'}". License Key: ${generatedLicenseKey}. Primary Admin: ${clientAdminEmail}.`,
          timestamp: now
        }
      );

      await connection.commit();

      const welcomePackage = {
        companyName,
        orgCode: cleanCode,
        portalUrl: `${req.protocol}://${req.get('host')}`,
        licenseKey: generatedLicenseKey,
        licenseTier: licenseTier || 'Enterprise Edition',
        licenseExpiry: calculatedExpiry,
        primaryAdminEmail: clientAdminEmail,
        primaryAdminPassword: clientAdminPass,
        seatQuota: `${maxUsers || (licenseTier === 'Starter' ? 5 : 25)} Admin/Applier Seats`,
        passQuota: `${maxPasses || (licenseTier === 'Starter' ? 500 : 5000)} Gate Passes`,
        issuedAt: now,
        vendor: "Techsandgadgets.com (Muhammad Haris)",
        supportContact: "m.techsandgadgets@gmail.com | +974 Support"
      };

      res.json({
        success: true,
        message: `Successfully provisioned and licensed ${companyName}!`,
        organizationId: orgId,
        licenseKey: generatedLicenseKey,
        welcomePackage
      });
    } catch (err: any) {
      console.error('Failed to license company:', err);
      res.status(500).json({ error: err.message || "Failed to license company" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // 5. Update & Renew Company License / Subscription
  app.put("/api/platform/companies/:id/license", authorizePowerAdmin(), async (req, res) => {
    let connection;
    try {
      const orgId = req.params.id;
      const {
        name,
        code,
        licenseTier,
        licenseExpiry,
        maxUsers,
        maxPasses,
        status,
        contactPhone,
        notes,
        renewYears
      } = req.body;

      connection = await getConnection();
      const orgRes = await connection.execute(
        `SELECT * FROM organizations WHERE id = :id`,
        [orgId],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      if (!orgRes.rows || orgRes.rows.length === 0) {
        return res.status(404).json({ error: "Company organization not found" });
      }

      const existingOrg = toCamelCase(orgRes.rows[0]);
      let newExpiry = licenseExpiry || existingOrg.licenseExpiry;

      if (renewYears && Number(renewYears) > 0) {
        const baseDate = existingOrg.licenseExpiry ? new Date(existingOrg.licenseExpiry) : new Date();
        baseDate.setFullYear(baseDate.getFullYear() + Number(renewYears));
        newExpiry = baseDate.toISOString().split('T')[0];
      }

      const now = new Date().toISOString();
      const { statusReason, maxEmployees, allowedDomains } = req.body;

      await connection.execute(
        `UPDATE organizations SET 
          name = :name,
          code = :code,
          licenseTier = :licenseTier,
          licenseExpiry = :licenseExpiry,
          maxUsers = :maxUsers,
          maxPasses = :maxPasses,
          maxEmployees = :maxEmployees,
          allowedDomains = :allowedDomains,
          status = :status,
          statusReason = :statusReason,
          contactPhone = :contactPhone,
          notes = :notes,
          updatedAt = :now
         WHERE id = :id`,
        {
          name: name || existingOrg.name,
          code: code || existingOrg.code,
          licenseTier: licenseTier || existingOrg.licenseTier,
          licenseExpiry: newExpiry || existingOrg.licenseExpiry,
          maxUsers: maxUsers !== undefined ? maxUsers : existingOrg.maxUsers,
          maxPasses: maxPasses !== undefined ? maxPasses : existingOrg.maxPasses,
          maxEmployees: maxEmployees !== undefined ? maxEmployees : existingOrg.maxEmployees,
          allowedDomains: allowedDomains !== undefined ? allowedDomains : existingOrg.allowedDomains,
          status: status || existingOrg.status || 'active',
          statusReason: statusReason !== undefined ? statusReason : existingOrg.statusReason,
          contactPhone: contactPhone || existingOrg.contactPhone,
          notes: notes || existingOrg.notes,
          now,
          id: orgId
        }
      );

      await connection.commit();
      orgStatusCache.delete(orgId);

      logAction(req, 'UPDATE_LICENSE', 'organization', orgId, `Updated license & quotas for ${existingOrg.name} (Tier: ${licenseTier || existingOrg.licenseTier}, Expiry: ${newExpiry}, Status: ${status || existingOrg.status})`);
      
      res.json({
        success: true,
        message: `License updated successfully for ${existingOrg.name}`,
        licenseExpiry: newExpiry
      });
    } catch (err: any) {
      console.error('Failed to update company license:', err);
      res.status(500).json({ error: err.message || "Failed to update company license" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // 5b. Update Organization Status & Suspension Engine
  app.put("/api/platform/companies/:id/status", authorizePowerAdmin(), async (req, res) => {
    let connection;
    try {
      const orgId = req.params.id;
      const { status, statusReason } = req.body;
      if (!['active', 'read_only', 'suspended', 'terminated'].includes(status)) {
        return res.status(400).json({ error: "Invalid status. Allowed values: active, read_only, suspended, terminated" });
      }
      connection = await getConnection();
      const now = new Date().toISOString();
      await connection.execute(
        `UPDATE organizations SET status = :status, statusReason = :statusReason, updatedAt = :now WHERE id = :id`,
        { status, statusReason: statusReason || null, now, id: orgId }
      );
      await connection.commit();
      orgStatusCache.delete(orgId);
      logAction(req, 'UPDATE_ORG_STATUS', 'organization', orgId, `Changed organization status to ${status.toUpperCase()} (${statusReason || 'No reason provided'})`);
      res.json({ success: true, status, statusReason });
    } catch (err: any) {
      console.error('Failed to update organization status:', err);
      res.status(500).json({ error: err.message || "Failed to update organization status" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // 5c. Global Maintenance Banner Broadcast Endpoints
  app.get("/api/platform/maintenance", async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const compRes = await connection.execute(
        `SELECT maintenanceActive, maintenanceMessage, maintenanceSeverity, maintenanceEstimatedEnd FROM companySettings WHERE id = '1'`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const row = compRes.rows?.[0] ? toCamelCase(compRes.rows[0]) : {};
      res.json({
        maintenanceActive: row.maintenanceActive === 1 || row.maintenanceActive === true,
        maintenanceMessage: row.maintenanceMessage || '',
        maintenanceSeverity: row.maintenanceSeverity || 'info',
        maintenanceEstimatedEnd: row.maintenanceEstimatedEnd || null
      });
    } catch (err: any) {
      console.error('Failed to get maintenance settings:', err);
      res.status(500).json({ error: "Failed to get maintenance settings" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/platform/maintenance", authorizePowerAdmin(), async (req, res) => {
    let connection;
    try {
      const { maintenanceActive, maintenanceMessage, maintenanceSeverity, maintenanceEstimatedEnd } = req.body;
      connection = await getConnection();
      await connection.execute(
        `UPDATE companySettings SET 
          maintenanceActive = :active,
          maintenanceMessage = :msg,
          maintenanceSeverity = :sev,
          maintenanceEstimatedEnd = :endTime
         WHERE id = '1'`,
        {
          active: maintenanceActive ? 1 : 0,
          msg: maintenanceMessage || null,
          sev: maintenanceSeverity || 'info',
          endTime: maintenanceEstimatedEnd || null
        }
      );
      await connection.commit();
      logAction(req, 'BROADCAST_MAINTENANCE', 'system', 'global', `Updated maintenance broadcast banner. Active: ${!!maintenanceActive}`);
      res.json({
        success: true,
        maintenanceActive: !!maintenanceActive,
        maintenanceMessage: maintenanceMessage || '',
        maintenanceSeverity: maintenanceSeverity || 'info',
        maintenanceEstimatedEnd: maintenanceEstimatedEnd || null
      });
    } catch (err: any) {
      console.error('Failed to update maintenance settings:', err);
      res.status(500).json({ error: err.message || "Failed to update maintenance settings" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // 6. Get Client Welcome Package & License Certificate
  app.get("/api/platform/companies/:id/package", authorizePowerAdmin(), async (req, res) => {
    let connection;
    try {
      const orgId = req.params.id;
      connection = await getConnection();
      const orgRes = await connection.execute(
        `SELECT * FROM organizations WHERE id = :id`,
        [orgId],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      if (!orgRes.rows || orgRes.rows.length === 0) {
        return res.status(404).json({ error: "Organization not found" });
      }

      const org = toCamelCase(orgRes.rows[0]);
      const welcomePackage = {
        companyName: org.name,
        orgCode: org.code,
        portalUrl: `${req.protocol}://${req.get('host')}`,
        licenseKey: org.licenseKey,
        licenseTier: org.licenseTier,
        licenseExpiry: org.licenseExpiry,
        primaryAdminEmail: org.primaryAdminEmail || org.contactEmail,
        primaryAdminPassword: "Set during provisioning (or reset via Reset Password action)",
        seatQuota: `${org.maxUsers || 50} User Seats`,
        passQuota: `${org.maxPasses || 5000} Gate Passes`,
        issuedAt: org.createdAt || new Date().toISOString(),
        status: org.status || 'active',
        vendor: "Techsandgadgets.com (Muhammad Haris)",
        supportContact: "m.techsandgadgets@gmail.com"
      };

      res.json(welcomePackage);
    } catch (err: any) {
      console.error('Failed to get welcome package:', err);
      res.status(500).json({ error: err.message || "Failed to generate welcome package" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // 7. Activate / Switch Active Operating Organization Instance
  app.post("/api/platform/companies/:id/activate", authorizePowerAdmin(), async (req, res) => {
    let connection;
    try {
      const orgId = req.params.id;
      connection = await getConnection();

      const orgRes = await connection.execute(
        `SELECT * FROM organizations WHERE id = :id`,
        [orgId],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      if (!orgRes.rows || orgRes.rows.length === 0) {
        return res.status(404).json({ error: "Company not found" });
      }

      const org = toCamelCase(orgRes.rows[0]);

      // Set all organizations to isCurrent = 0
      await connection.execute(`UPDATE organizations SET isCurrent = 0`);

      // Set target organization to isCurrent = 1
      await connection.execute(`UPDATE organizations SET isCurrent = 1 WHERE id = :id`, [orgId]);

      // Synchronize companySettings (id = '1') so portal branding instantly transforms
      await connection.execute(
        `UPDATE companySettings SET 
          companyName = :name,
          orgCode = :code,
          appName = :appName,
          primaryColor = :color,
          poweredBy = :poweredBy,
          contactEmail = :email,
          address = :address,
          licenseKey = :licenseKey,
          licenseTier = :licenseTier,
          licenseExpiry = :licenseExpiry
        WHERE id = '1'`,
        {
          name: org.name,
          code: org.code || 'CORE',
          appName: org.appName || org.name,
          color: org.primaryColor || '#800020',
          poweredBy: org.poweredBy || 'by Techsandgadgets.com',
          email: org.contactEmail || org.primaryAdminEmail || 'info@client.com',
          address: org.address || 'Doha, Qatar',
          licenseKey: org.licenseKey || 'N/A',
          licenseTier: org.licenseTier || 'Enterprise Edition',
          licenseExpiry: org.licenseExpiry || '2036-12-31'
        }
      );

      await connection.commit();

      logAction(req, 'SWITCH_ACTIVE_ORG', 'organization', orgId, `Switched active organization instance to ${org.name} (${org.code})`);
      res.json({
        success: true,
        message: `Successfully set ${org.name} as the active portal organization instance!`,
        organization: org
      });
    } catch (err: any) {
      console.error('Failed to activate organization:', err);
      res.status(500).json({ error: err.message || "Failed to activate organization" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // 8. Reset Client Administrator Password
  app.post("/api/platform/companies/:id/reset-password", authorizePowerAdmin(), async (req, res) => {
    let connection;
    try {
      const orgId = req.params.id;
      const { newPassword } = req.body;
      const targetPassword = newPassword?.trim() || 'password123';

      connection = await getConnection();

      const orgRes = await connection.execute(
        `SELECT * FROM organizations WHERE id = :id`,
        [orgId],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      if (!orgRes.rows || orgRes.rows.length === 0) {
        return res.status(404).json({ error: "Company not found" });
      }

      const org = toCamelCase(orgRes.rows[0]);
      const adminEmail = (org.primaryAdminEmail || org.contactEmail)?.trim().toLowerCase();

      if (!adminEmail) {
        return res.status(400).json({ error: "No primary admin email configured for this organization." });
      }

      const hashedPassword = await bcrypt.hash(targetPassword, 10);

      // Check if user exists
      const userRes = await connection.execute(
        `SELECT id FROM users WHERE LOWER(email) = :email`,
        [adminEmail]
      );

      if (userRes.rows && userRes.rows.length > 0) {
        await connection.execute(
          `UPDATE users SET password = :pwd, status = 'active' WHERE LOWER(email) = :email`,
          { pwd: hashedPassword, email: adminEmail }
        );
      } else {
        const newUserId = `user-${Math.random().toString(36).substr(2, 7)}`;
        const now = new Date().toISOString();
        await connection.execute(
          `INSERT INTO users (id, email, password, role, displayName, photoURL, status, department, jobTitle, createdAt)
           VALUES (:id, :email, :password, 'admin', :name, :photoURL, 'active', 'Administration', 'Organization Super Admin', :createdAt)`,
          {
            id: newUserId,
            email: adminEmail,
            password: hashedPassword,
            name: org.primaryAdminName || `${org.name} Super Admin`,
            photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(org.name)}&background=800020&color=fff`,
            createdAt: now
          }
        );
      }

      await connection.commit();

      logAction(req, 'RESET_ADMIN_PASSWORD', 'user', adminEmail, `Reset password for organization ${org.name} admin (${adminEmail})`);
      res.json({
        success: true,
        message: `Password for ${adminEmail} successfully updated to: ${targetPassword}`,
        adminEmail,
        newPassword: targetPassword
      });
    } catch (err: any) {
      console.error('Failed to reset admin password:', err);
      res.status(500).json({ error: err.message || "Failed to reset admin password" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // 9. Delete / De-provision a Client Company
  app.delete("/api/platform/companies/:id", authorizePowerAdmin(), async (req, res) => {
    let connection;
    try {
      const orgId = req.params.id;
      connection = await getConnection();

      const orgRes = await connection.execute(
        `SELECT name, isCurrent FROM organizations WHERE id = :id`,
        [orgId],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      if (!orgRes.rows || orgRes.rows.length === 0) {
        return res.status(404).json({ error: "Company not found" });
      }

      const org = toCamelCase(orgRes.rows[0]);
      if (org.isCurrent === 1 || org.isCurrent === true) {
        return res.status(400).json({ error: "Cannot delete the default active system profile." });
      }

      await connection.execute(`DELETE FROM organizations WHERE id = :id`, [orgId]);
      await connection.commit();

      logAction(req, 'DELETE', 'organization', orgId, `Removed licensed company record ${org.name}`);
      res.json({ success: true, message: `Company ${org.name} removed successfully` });
    } catch (err: any) {
      console.error('Failed to delete company:', err);
      res.status(500).json({ error: err.message || "Failed to delete company" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // 8. Full Database JSON Snapshot Export (For Global Vendor Backup)
  app.get("/api/platform/snapshot-export", authorizePowerAdmin(), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const [
        company,
        organizations,
        divisions,
        projects,
        departments,
        categories,
        locations,
        accessCodes,
        employees,
        passes,
        passRequests,
        users,
        auditLogs
      ] = await Promise.all([
        connection.execute(`SELECT * FROM companySettings`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }),
        connection.execute(`SELECT * FROM organizations`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }).catch(() => ({ rows: [] })),
        connection.execute(`SELECT * FROM divisions`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }),
        connection.execute(`SELECT * FROM projects`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }),
        connection.execute(`SELECT * FROM departments`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }),
        connection.execute(`SELECT * FROM categories`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }),
        connection.execute(`SELECT * FROM locations`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }),
        connection.execute(`SELECT * FROM accessCodes`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }),
        connection.execute(`SELECT * FROM employees`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }),
        connection.execute(`SELECT * FROM passes`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }),
        connection.execute(`SELECT * FROM passRequests`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }),
        connection.execute(`SELECT id, email, role, displayName, photoURL, status, jobTitle, department, division, project, createdAt FROM users`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }),
        connection.execute(`SELECT * FROM auditLogs ORDER BY timestamp DESC`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })
      ]);

      const snapshot = {
        meta: {
          exportTimestamp: new Date().toISOString(),
          version: "v4.5.2 SaaS Enterprise Engine",
          vendor: "Techsandgadgets.com",
          architect: "Muhammad Haris"
        },
        company: (company.rows || []).map(toCamelCase)[0] || null,
        organizations: (organizations.rows || []).map(toCamelCase),
        divisions: (divisions.rows || []).map(toCamelCase),
        projects: (projects.rows || []).map(toCamelCase),
        departments: (departments.rows || []).map(toCamelCase),
        categories: (categories.rows || []).map(toCamelCase),
        locations: (locations.rows || []).map(toCamelCase),
        accessCodes: (accessCodes.rows || []).map(toCamelCase),
        employees: (employees.rows || []).map(toCamelCase),
        passes: (passes.rows || []).map(toCamelCase),
        passRequests: (passRequests.rows || []).map(toCamelCase),
        users: (users.rows || []).map(toCamelCase),
        auditLogs: (auditLogs.rows || []).map(toCamelCase)
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=accessone-platform-backup-${Date.now()}.json`);
      res.json(snapshot);
    } catch (err: any) {
      console.error('Snapshot export failed:', err);
      res.status(500).json({ error: err.message || "Failed to generate snapshot export" });
    } finally {
      if (connection) await connection.close();
    }
  });

  debugLog('Core API routes initialized');

  // --- API 404 Handler ---
  app.use("/api/*", (req, res) => {
    res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
  });

  // --- Global API Error Handler ---
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled API Error:', err);
    if (res.headersSent) {
      return next(err);
    }
    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error"
    });
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      debugLog('Vite middleware added');
    } catch (viteErr: any) {
      debugLog(`Vite setup failed: ${viteErr.message}`);
    }
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // --- Expiration & Archival Logic ---
  async function checkExpirations() {
    const now = new Date().toISOString();
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    let connection;
    try {
      connection = await getConnection();
      
      // Expire passes whose expiryDate has passed
      await connection.execute(
        `UPDATE passes SET status = 'expired', updatedAt = :now WHERE status != 'expired' AND expiryDate < :now`,
        { now }
      );
      
      // Expire supplementary passes if their parent is expired or inactive
      await connection.execute(
        `UPDATE passes p1 SET p1.status = 'expired', p1.updatedAt = :now 
         WHERE p1.type = 'supplementary' AND p1.status NOT IN ('expired', 'inactive', 'revoked') 
         AND EXISTS (SELECT 1 FROM passes p2 WHERE p2.id = p1.parentPassId AND p2.status IN ('expired', 'inactive', 'revoked'))`,
        { now }
      );

      // Auto-archive applications 90 days after reaching Stage 3 (completed/collected) or terminal state (cancelled/rejected/revoked)
      await connection.execute(
        `UPDATE passRequests 
         SET status = 'archived', updatedAt = :now 
         WHERE status IN ('completed', 'collected', 'cancelled', 'rejected', 'revoked') 
         AND updatedAt < :ninetyDaysAgo`,
        { now, ninetyDaysAgo }
      );
      
      // Notify org admins about passes expiring within 48 hours (once per pass)
      try {
        const soonThreshold = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        const expiringResult = await connection.execute(
          `SELECT p.id, p.organizationId FROM passes p
           WHERE p.status = 'active' AND p.expiryDate IS NOT NULL AND p.expiryDate <= :threshold AND p.expiryDate > :nowStr
           AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.entityType = 'pass' AND n.entityId = p.id AND n.type = 'expiring_soon')`,
          { threshold: soonThreshold, nowStr: now },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        for (const pass of (expiringResult.rows || []) as any[]) {
          const orgId = pass.ORGANIZATIONID || pass.organizationId;
          if (!orgId) continue;
          const adminsResult = await connection.execute(
            `SELECT id FROM users WHERE organizationId = :orgId AND role IN ('admin','power_admin')`,
            { orgId },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );
          for (const admin of (adminsResult.rows || []) as any[]) {
            await createNotification(connection, {
              userId: admin.ID || admin.id,
              organizationId: orgId,
              type: 'expiring_soon',
              title: 'Pass expiring soon',
              message: `Pass ${pass.ID || pass.id} is expiring within 48 hours.`,
              entityType: 'pass',
              entityId: pass.ID || pass.id,
            });
          }
        }
      } catch (notifErr) {
        console.error('Failed to send pass-expiring notifications:', notifErr);
      }

      await connection.commit();
    } catch (err) {
      console.error('Expiration / Archival check failed:', err);
    } finally {
      if (connection) await connection.close();
    }
  }

  // Check every minute
  setInterval(checkExpirations, 60000);
  // Initial check
  checkExpirations();

  app.listen(PORT, "0.0.0.0", () => {
    debugLog(`Server running on http://localhost:${PORT}`);
  });
  } catch (err: any) {
    debugLog(`CRITICAL: Server failed to start: ${err.message}`);
    console.error('CRITICAL: Server failed to start:', err);
  }
}

startServer();
