// Load .env before any other module reads process.env (session secret, log level, ...).
import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";
import { debugLog, logger } from "./src/server/log.ts";
import { syncRequestEmployees, loadPeople, savePeople } from "./src/server/requestLinks.ts";
import { installSyncStamps, checkSyncStamps } from "./src/server/syncStamp.ts";
import { businessToday, BUSINESS_TZ } from "./src/server/businessDate.ts";
import { registerDashboardRoutes } from "./src/server/routes/dashboard.ts";
import { registerScopeRoutes } from "./src/server/routes/scope.ts";
import { enforceForeignKeys, ensureSystemUser, repairCaseMismatches, clearDanglingMainPassLinks } from "./src/server/integrity.ts";
import { newId, newRef, nextSequenceValue } from "./src/server/ids.ts";
import { signSessionToken, verifySessionToken, setSessionCookie, clearSessionCookie, getSessionToken } from "./src/server/session.ts";
import { realtimeClients, pendingNotificationUsers, publishChange, flushNotificationPushes, REALTIME_RESOURCE_MAP } from "./src/server/realtime.ts";
import type { RealtimeClient } from "./src/server/realtime.ts";
import { authRateLimit } from "./src/server/rateLimit.ts";
import { validate, schemas, createSchemas } from "./src/server/validation.ts";
import { registerAuthRoutes } from "./src/server/routes/auth.ts";
import { registerEmployeeRoutes } from "./src/server/routes/employees.ts";
import { registerResourceRoutes } from "./src/server/routes/resources.ts";
import { registerApplicationRoutes } from "./src/server/routes/applications.ts";
import { registerPassRoutes } from "./src/server/routes/passes.ts";
import { registerAdminRoutes } from "./src/server/routes/admin.ts";
import { registerActivityRoutes } from "./src/server/routes/activity.ts";
import { registerStructureRoutes } from "./src/server/routes/structure.ts";
import { registerUserRoutes } from "./src/server/routes/users.ts";
import { registerPlatformRoutes } from "./src/server/routes/platform.ts";
import type { RouteContext } from "./src/server/context.ts";

debugLog(`Server script started. NODE_ENV: ${process.env.NODE_ENV}, PORT: ${process.env.PORT}`);

// An uncaught exception leaves the process in an unknown state: log it, shut down cleanly and
// let the process manager (pm2) start a fresh process.
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception, shutting down', { err: err });
  debugLog(`Uncaught Exception: ${err?.stack || err?.message || err}`);
  (globalThis as any).__accessOneShutdown?.('uncaughtException', 1) ?? process.exit(1);
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
    const { initializeDatabase, getConnection, getDbEngine, closeDatabase } = await import("./src/db.ts");
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
        id: newId(),
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
        logger.error('Failed to log action', { err: err });
      } finally {
        if (connection) await connection.close();
      }
    }

// --- In-App Notification System Helpers ---
interface NotificationParams {
  userId: string;
  organizationId?: string | null;
  type: string;
  title: string;
  message?: string;
  entityType?: string | null;
  entityId?: string | null;
  link?: string | null;
  priority?: 'normal' | 'high' | 'urgent';
}

async function createNotification(connection: any, params: NotificationParams) {
  try {
    const notif = {
      id: newId(),
      userId: params.userId,
      organizationId: params.organizationId || null,
      type: params.type,
      title: params.title,
      message: params.message || '',
      entityType: params.entityType || null,
      entityId: params.entityId || null,
      link: params.link || null,
      priority: params.priority || 'normal',
      timestamp: new Date().toISOString(),
    };
    if (notif.userId) pendingNotificationUsers.add(String(notif.userId));
    try {
      await connection.execute(
        `INSERT INTO notifications (id, userId, organizationId, type, title, message, entityType, entityId, link, priority, isRead, "TIMESTAMP")
         VALUES (:id, :userId, :organizationId, :type, :title, :message, :entityType, :entityId, :link, :priority, 0, :timestamp)`,
        notif
      );
    } catch (colErr: any) {
      // Fallback if link or priority column not yet present
      await connection.execute(
        `INSERT INTO notifications (id, userId, organizationId, type, title, message, entityType, entityId, isRead, "TIMESTAMP")
         VALUES (:id, :userId, :organizationId, :type, :title, :message, :entityType, :entityId, 0, :timestamp)`,
        {
          id: notif.id,
          userId: notif.userId,
          organizationId: notif.organizationId,
          type: notif.type,
          title: notif.title,
          message: notif.message,
          entityType: notif.entityType,
          entityId: notif.entityId,
          timestamp: notif.timestamp
        }
      );
    }
    await connection.commit();
    return notif;
  } catch (err) {
    logger.error('Failed to create notification', { err: err });
    return null;
  }
}

async function notifyAdmins(connection: any, orgId: string | null | undefined, params: Omit<NotificationParams, 'userId'> & { excludeUserId?: string }) {
  try {
    let sql = `SELECT id FROM users WHERE role IN ('admin', 'power_admin', 'approver') AND (status = 'active' OR status IS NULL)`;
    const binds: any = {};
    if (orgId) {
      sql += ` AND (organizationId = :orgId OR role = 'power_admin')`;
      binds.orgId = orgId;
    }
    if (params.excludeUserId) {
      sql += ` AND id != :excludeUserId`;
      binds.excludeUserId = params.excludeUserId;
    }
    const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const users = (result.rows || []) as any[];
    for (const u of users) {
      const uId = u.ID || u.id;
      if (uId) {
        await createNotification(connection, {
          ...params,
          userId: uId,
          organizationId: orgId
        });
      }
    }
  } catch (err) {
    logger.error('Failed to notify admins', { err: err });
  }
}

// Sends expiry reminders. It never changes pass status: expiry is decided only by the daily
// lifecycle job (business-date based). `expiredAt` = the timestamp that job stamped on the passes
// it just expired, so exactly those get an "expired" notice (no flood of historical ones).
async function scanPassExpiries(connection: any, expiredAt?: string): Promise<number> {
  let createdCount = 0;
  const now = new Date();
  const nowStr = now.toISOString();
  const twoDaysLater = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    // 1. Passes the daily job has just expired
    const expiredRes = expiredAt ? await connection.execute(
      `SELECT p.id, p.passNumber, p.employeeId, p.organizationId, p.expiryDate FROM passes p
       WHERE p.status = 'expired' AND p.updatedAt = :expiredAt
       AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.entityType = 'pass' AND n.entityId = p.id AND n.type = 'expired')`,
      { expiredAt },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    ) : { rows: [] };
    for (const pass of (expiredRes.rows || []) as any[]) {
      const pId = pass.ID || pass.id;
      const pNum = pass.PASSNUMBER || pass.passNumber || pId;
      const orgId = pass.ORGANIZATIONID || pass.organizationId;
      const expDate = (pass.EXPIRYDATE || pass.expiryDate || '').split('T')[0];

      await notifyAdmins(connection, orgId, {
        type: 'expired',
        title: `Pass Expired: ${pNum}`,
        message: `Pass #${pNum} expired on ${expDate}. Status has been updated to expired.`,
        entityType: 'pass',
        entityId: pId,
        link: '/status-management',
        priority: 'urgent'
      });
      createdCount++;
    }

    // 2. Passes expiring in 48 hours
    const urgent48Res = await connection.execute(
      `SELECT p.id, p.passNumber, p.employeeId, p.organizationId, p.expiryDate FROM passes p
       WHERE p.status = 'active' AND p.expiryDate IS NOT NULL 
       AND p.expiryDate <= :twoDaysLater AND p.expiryDate >= :nowStr
       AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.entityType = 'pass' AND n.entityId = p.id AND n.type = 'expiring_48h')`,
      { twoDaysLater, nowStr },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    for (const pass of (urgent48Res.rows || []) as any[]) {
      const pId = pass.ID || pass.id;
      const pNum = pass.PASSNUMBER || pass.passNumber || pId;
      const orgId = pass.ORGANIZATIONID || pass.organizationId;
      const expDate = (pass.EXPIRYDATE || pass.expiryDate || '').split('T')[0];

      await notifyAdmins(connection, orgId, {
        type: 'expiring_48h',
        title: `Urgent: Pass Expiring in 48h (${pNum})`,
        message: `Pass #${pNum} expires on ${expDate} (within 48 hours). Please initiate renewal or access review.`,
        entityType: 'pass',
        entityId: pId,
        link: '/status-management',
        priority: 'urgent'
      });
      createdCount++;
    }

    // 3. Passes expiring in 7 days
    const warn7Res = await connection.execute(
      `SELECT p.id, p.passNumber, p.employeeId, p.organizationId, p.expiryDate FROM passes p
       WHERE p.status = 'active' AND p.expiryDate IS NOT NULL 
       AND p.expiryDate <= :sevenDaysLater AND p.expiryDate > :twoDaysLater
       AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.entityType = 'pass' AND n.entityId = p.id AND n.type = 'expiring_7d')`,
      { sevenDaysLater, twoDaysLater },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    for (const pass of (warn7Res.rows || []) as any[]) {
      const pId = pass.ID || pass.id;
      const pNum = pass.PASSNUMBER || pass.passNumber || pId;
      const orgId = pass.ORGANIZATIONID || pass.organizationId;
      const expDate = (pass.EXPIRYDATE || pass.expiryDate || '').split('T')[0];

      await notifyAdmins(connection, orgId, {
        type: 'expiring_7d',
        title: `Warning: Pass Expiring in 7 Days (${pNum})`,
        message: `Pass #${pNum} expires on ${expDate}. Renewal submission recommended.`,
        entityType: 'pass',
        entityId: pId,
        link: '/status-management',
        priority: 'high'
      });
      createdCount++;
    }

    // 4. Passes expiring in 30 days
    const notice30Res = await connection.execute(
      `SELECT p.id, p.passNumber, p.employeeId, p.organizationId, p.expiryDate FROM passes p
       WHERE p.status = 'active' AND p.expiryDate IS NOT NULL 
       AND p.expiryDate <= :thirtyDaysLater AND p.expiryDate > :sevenDaysLater
       AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.entityType = 'pass' AND n.entityId = p.id AND n.type = 'expiring_30d')`,
      { thirtyDaysLater, sevenDaysLater },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    for (const pass of (notice30Res.rows || []) as any[]) {
      const pId = pass.ID || pass.id;
      const pNum = pass.PASSNUMBER || pass.passNumber || pId;
      const orgId = pass.ORGANIZATIONID || pass.organizationId;
      const expDate = (pass.EXPIRYDATE || pass.expiryDate || '').split('T')[0];

      await notifyAdmins(connection, orgId, {
        type: 'expiring_30d',
        title: `Notice: Pass Expiring in 30 Days (${pNum})`,
        message: `Pass #${pNum} expires on ${expDate}. Access pass will require extension or renewal.`,
        entityType: 'pass',
        entityId: pId,
        link: '/status-management',
        priority: 'normal'
      });
      createdCount++;
    }

    await connection.commit();
  } catch (scanErr) {
    logger.error('Failed in scanPassExpiries', { err: scanErr });
  }
  return createdCount;
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

    // --- Supersede Old Category Passes Helper ---
    // Pass records are NEVER deleted: they are the audit trail of who held access where and when.
    // When a new Main Pass for a category goes live (collected/active), any older still-live Main Pass
    // for the same person + category (and its supplementary passes) is marked 'replaced'.
    // Already-terminal passes (expired/revoked/cancelled/replaced) are left untouched as history.
    async function cleanupOldCategoryPasses(connection: any, employeeId: string, locationId: string, excludePassId?: string) {
      if (!employeeId || !locationId) return;
      try {
        const oracledb = (await import("oracledb")).default;

        // Only supersede once the new pass is actually live; an issued-but-not-collected pass
        // must not cut off the person's current valid pass.
        if (excludePassId) {
          const newRes = await connection.execute(
            `SELECT status, passNumber FROM passes WHERE id = :id`,
            [excludePassId],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );
          const newRow: any = newRes.rows?.[0];
          const newStatus = String(newRow?.STATUS || newRow?.status || '').toLowerCase();
          if (!['active', 'collected', 'received'].includes(newStatus)) return;
        }

        // Find category ID of the location
        const locRes = await connection.execute(
          `SELECT categoryId FROM locations WHERE id = :locationId`,
          [locationId],
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const categoryId = locRes.rows?.[0]?.CATEGORYID || locRes.rows?.[0]?.categoryId;
        if (!categoryId) return;

        // Find older still-live main passes for this employee in locations under the same category
        const res = await connection.execute(
          `SELECT p.id, p.type, p.status, p.requestId FROM passes p
           JOIN locations l ON p.locationId = l.id
           WHERE p.employeeId = :employeeId
           AND l.categoryId = :categoryId`,
          { employeeId, categoryId },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const terminal = ['expired', 'cancelled', 'revoked', 'replaced', 'superseded', 'inactive', 'rejected', 'deleted'];
        const now = new Date().toISOString();
        const replacedBy = excludePassId || 'new pass';
        const affectedRequests: string[] = [];

        for (const r of (res.rows || []) as any[]) {
          const pid = r.ID || r.id;
          if (!pid || pid === excludePassId) continue;
          const s = (r.STATUS || r.status || '').toLowerCase();
          const ptype = (r.TYPE || r.type || '').toLowerCase();
          if (ptype !== 'main' || terminal.includes(s)) continue;
          const rid = r.REQUESTID || r.requestId;
          if (rid) affectedRequests.push(rid);

          await connection.execute(
            `UPDATE passes SET status = 'replaced', updatedAt = :now,
               remarks = SUBSTR(COALESCE(remarks, '') || ' [Replaced by pass ' || :replacedBy || ' on ' || :today || ']', 1, 1000)
             WHERE id = :id`,
            { now, replacedBy, today: now.substring(0, 10), id: pid }
          );
          // Supplementary passes hang off the old main pass; they are superseded with it.
          await connection.execute(
            `UPDATE passes SET status = 'replaced', updatedAt = :now
             WHERE parentPassId = :id AND LOWER(status) NOT IN ('expired', 'cancelled', 'revoked', 'replaced', 'superseded', 'inactive', 'rejected')`,
            { now, id: pid }
          );
        }
        // Close the old application line(s) in the same transaction
        await closeApplicationsForEndedPasses(connection, now, affectedRequests);
      } catch (err) {
        logger.error('Failed to supersede old category passes', { err: err });
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
        logger.error("Error checking org status", { err: err });
      }
      return { status: 'active' };
    }

    // --- Account status (sessions end when an account is deleted or deactivated) ---
    // A signed session cookie stays valid until it expires, so the account itself is re-checked.
    // Cached for 10 s per user, like the organization status above.
    const userStatusCache = new Map<string, { active: boolean; timestamp: number }>();
    async function isAccountActive(userId: string): Promise<boolean> {
      const now = Date.now();
      const cached = userStatusCache.get(userId);
      if (cached && now - cached.timestamp < 10000) return cached.active;
      try {
        const conn = await getConnection();
        try {
          const r = await conn.execute(`SELECT status, deletedAt FROM users WHERE id = :id`, [userId], { outFormat: oracledb.OUT_FORMAT_OBJECT });
          const row: any = r.rows?.[0];
          const status = String(row?.STATUS ?? row?.status ?? 'active').toLowerCase();
          const active = !!row && !(row.DELETEDAT ?? row.deletedAt) && status === 'active';
          userStatusCache.set(userId, { active, timestamp: now });
          return active;
        } finally {
          await conn.close();
        }
      } catch (err) {
        logger.error('Error checking account status', { err: err });
        return true; // the request itself will fail if the database is down
      }
    }

    // --- Authorization Middleware ---
    const authorize = (roles: string[] = []) => {
      return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const sessionToken = getSessionToken(req);
    const verifiedSession = sessionToken ? verifySessionToken(sessionToken) : null;

    if (!verifiedSession || !verifiedSession.id) {
      if (req.path === '/api/health' || req.path.startsWith('/api/auth')) {
        return next();
      }
      return res.status(401).json({ error: "Unauthorized: Please log in." });
    }

    if (!(await isAccountActive(String(verifiedSession.id)))) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Your account is no longer active. Please contact an administrator." });
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
        const isPowerAdminUser = userRole === 'power_admin';

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
          
          if (orgStatus === 'suspended' || orgStatus === 'terminated' || orgStatus === 'deleted') {
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
    const sessionToken = getSessionToken(req);
    const verifiedSession = sessionToken ? verifySessionToken(sessionToken) : null;

    if (!verifiedSession || !verifiedSession.id) {
      return res.status(401).json({ error: "Unauthorized: Please log in." });
    }

    req.headers['x-user-id'] = String(verifiedSession.id);
    req.headers['x-user-email'] = String(verifiedSession.email || '').toLowerCase().trim();
    req.headers['x-user-role'] = String(verifiedSession.role || 'viewer').toLowerCase().trim();
    req.headers['x-user-org-id'] = verifiedSession.organizationId ? String(verifiedSession.organizationId) : '';

    const userRole = String(verifiedSession.role || 'viewer').toLowerCase().trim();
    const userEmail = String(verifiedSession.email || '').toLowerCase().trim();

        const isPowerAdminUser = userRole === 'power_admin';

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
      if (d === null || d === undefined || d === '') return null;
      // Real calendar date check (rejects 31/02, month 13, ...)
      const valid = (y: number, m: number, day: number) => {
        const t = new Date(Date.UTC(y, m - 1, day));
        return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
      };
      // Excel stores dates as serial day numbers (1 = 1900-01-01, epoch 1899-12-30)
      const serial = typeof d === 'number' ? d : (/^\d{5}(\.\d+)?$/.test(String(d).trim()) ? Number(String(d).trim()) : NaN);
      if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
        const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
        return t.toISOString().substring(0, 10);
      }
      if (d instanceof Date) {
        if (isNaN(d.getTime())) return null;
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
      const str = String(d).trim();
      if (!str) return null;
      
      const ymdMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
      if (ymdMatch) {
        if (!valid(+ymdMatch[1], +ymdMatch[2], +ymdMatch[3])) return null;
        return `${ymdMatch[1]}-${ymdMatch[2].padStart(2, '0')}-${ymdMatch[3].padStart(2, '0')}`;
      }

      // Day-first (DD/MM/YYYY), the local convention
      const dmyMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
      if (dmyMatch) {
        if (!valid(+dmyMatch[3], +dmyMatch[2], +dmyMatch[1])) return null;
        return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
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
        logger.error('Failed to archive audit logs', { err: err });
      } finally {
        if (connection) await connection.close();
      }
    }

    // Database initialization is non-blocking to allow the server to start immediately
    // and show the connection status in the UI.
    debugLog('Initializing database...');
    // Readiness: API requests and startup jobs wait for schema initialisation to finish.
    // Set once migrations and the startup lifecycle run have finished (exposed via /api/health).
    var startupComplete = false;
    var dbReady: Promise<void> = initializeDatabase().then(() => {
      debugLog('Database initialization completed (success)');
      // Run archiving task after DB is ready
      archiveAuditLogs();
    }).catch(err => {
      debugLog(`CRITICAL: Database initialization failed: ${err.message}`);
      logger.error('CRITICAL: Database initialization failed. The application may not function correctly.', { err: err });
    });
    
    const app = express();
    // Readiness gate: API requests wait until schema initialisation has finished.
    app.use('/api', async (req, _res, next) => {
      if (req.path !== '/health') { try { await dbReady; } catch { /* surfaced by the request itself */ } }
      next();
    });
    const PORT = Number(process.env.PORT) || 3000;
    // Version of the built web app being served (written by the Vite build); empty in development.
    let DEPLOYED_VERSION = '';
    try {
      DEPLOYED_VERSION = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'dist', 'version.json'), 'utf8')).version || '';
    } catch { /* development / no build */ }

    // Security Hardening: Disable x-powered-by banner
    app.disable('x-powered-by');
    // Behind nginx on the same host: take the client IP from X-Forwarded-For (used by rate limiting).
    app.set('trust proxy', 'loopback');

    // Standard HTTP Security Headers (compatible with iFrame embedding)
    app.use((_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('X-XSS-Protection', '0');
      if (process.env.NODE_ENV === 'production') {
        // HTTPS only (nginx terminates TLS for this domain)
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        // Only this site's own scripts may run; images may come from https (avatars, user photos).
        // frame-ancestors is intentionally not set: the app supports being embedded in an iframe.
        res.setHeader('Content-Security-Policy', [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          "connect-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'"
        ].join('; '));
      }
      next();
    });

    app.use(express.json({ limit: '20mb' }));
    app.use(express.urlencoded({ extended: true, limit: '20mb' }));

    // Identity headers are set only by authorize() from the verified session; drop any copies
    // a client sends so they can never be trusted or logged by mistake.
    app.use((req, _res, next) => {
      delete req.headers['x-user-id'];
      delete req.headers['x-user-email'];
      delete req.headers['x-user-role'];
      delete req.headers['x-user-org-id'];
      next();
    });

    // Access log: one line per API request when it finishes. Query strings are not logged
    // (they can contain personal data such as search terms).
    app.use((req, res, next) => {
      if (!req.path.startsWith('/api/') || req.path === '/api/events') return next();
      const started = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        const fields = {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Math.round(ms),
          user: (req.headers['x-user-id'] as string) || undefined
        };
        if (res.statusCode >= 500) logger.error('request', fields);
        else if (res.statusCode >= 400) logger.warn('request', fields);
        else logger.debug('request', fields);
      });
      next();
    });

    // CSRF protection: a browser on another site cannot add custom headers to a request to this
    // origin (no CORS is enabled), so every cookie-authenticated write must carry X-Requested-With.
    // The tab-close presence beacon cannot set headers and only marks the sender offline.
    app.use((req, res, next) => {
      const method = req.method.toUpperCase();
      if (['GET', 'HEAD', 'OPTIONS'].includes(method) || !req.path.startsWith('/api/')) return next();
      if (String(req.headers['authorization'] || '').startsWith('Bearer ')) return next();
      if (req.path === '/api/presence/logout') return next();
      if (req.headers['x-requested-with'] !== 'AccessOne') {
        return res.status(403).json({ error: "Request blocked (missing CSRF header)." });
      }
      next();
    });

    app.post("/api/auth/logout", (req, res) => {
      clearSessionCookie(res);
      res.json({ success: true });
    });

    // Realtime: after a successful write has been sent (i.e. committed), announce which lists changed.
    app.use((req, res, next) => {
      const method = req.method.toUpperCase();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || !req.path.startsWith('/api/')) return next();
      res.on('finish', () => {
        if (res.statusCode < 400) {
          const group = req.path.split('/')[2] || '';
          const affected = REALTIME_RESOURCE_MAP[group];
          if (affected) {
            // Writes are audited, so the audit log changes too. Org comes from the verified session (set by authorize()).
            publishChange([...affected, 'auditLogs'], (req.headers['x-user-org-id'] as string) || null);
          }
        }
        flushNotificationPushes();
      });
      next();
    });

    // API routes FIRST
    app.get("/api/health", async (req, res) => {
      let connection;
      try {
        connection = await getConnection();
        res.json({ status: "ok", dbConnected: true, engine: getDbEngine(), ready: startupComplete, version: DEPLOYED_VERSION || undefined });
      } catch (err: any) {
        logger.error('Health check DB error', { err: err });
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

    // Realtime change feed. The client opens this once (with its Bearer token) and receives
    // {"resources": [...]} whenever lists it can see change; it then refetches only those.
    app.get("/api/events", authorize(), (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // stop nginx buffering the stream
      res.flushHeaders();
      res.write('retry: 5000\n\n');
      if (DEPLOYED_VERSION) res.write(`data: ${JSON.stringify({ version: DEPLOYED_VERSION })}\n\n`);

      const role = String(req.headers['x-user-role'] || '');
      const email = String(req.headers['x-user-email'] || '');
      const client: RealtimeClient = {
        res,
        userId: String(req.headers['x-user-id'] || ''),
        orgId: String(req.headers['x-user-org-id'] || ''),
        isPowerAdmin: role === 'power_admin'
      };
      realtimeClients.add(client);

      // Comment line every 25s keeps proxies (nginx default 60s read timeout) from closing an idle stream.
      const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25000);
      req.on('close', () => {
        clearInterval(keepAlive);
        realtimeClients.delete(client);
      });
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

    const isPowerAdmin = rawRole === 'power_admin';

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
        logger.error('Error fetching user organization in getTenantOrgId', { err: e });
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
    // Shared helpers handed to the feature route modules (src/server/routes/*).
    const routeCtx: RouteContext = {
      bcrypt,
      oracledb,
      logAction,
      createNotification,
      notifyAdmins,
      scanPassExpiries,
      activePresences,
      cleanStalePresences,
      cleanupOldCategoryPasses,
      orgStatusCache,
      getCachedOrgStatus,
      authorize,
      authorizePowerAdmin,
      validateEmployeeReferences,
      normalizeDateStr,
      validatePassExpiries,
      archiveAuditLogs,
      getConnection,
      getDbEngine,
      initializeDatabase,
      closeDatabase,
      toCamelCase,
      toOracleKeys,
      getTenantOrgId,
      closeApplicationsForEndedPasses,
      safeFilename,
      safeDirname,
      shared: {}
    };
  // Application routes accept the ID in any letter case, but rows they write (history, passes,
  // links) must carry the ID exactly as stored, or they point at nothing. Resolve it once here.
  app.param('id', async (req, res, next, id) => {
    // Runs before the route's authorize(); no lookup for requests that carry no session at all.
    if (!req.path.startsWith('/api/passApplications/') || !getSessionToken(req)) return next();
    let conn;
    try {
      conn = await getConnection();
      const r = await conn.execute(`SELECT id FROM passRequests WHERE UPPER(id) = UPPER(:id)`, [String(id)], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const row: any = r.rows?.[0];
      if (row) req.params.id = String(row.ID ?? row.id);
      next();
    } catch (err) {
      next(err);
    } finally {
      if (conn) await conn.close();
    }
  });

  registerAuthRoutes(app, routeCtx);
  registerEmployeeRoutes(app, routeCtx);
  registerResourceRoutes(app, routeCtx);
  registerApplicationRoutes(app, routeCtx);
  registerPassRoutes(app, routeCtx);
  registerAdminRoutes(app, routeCtx);
  registerActivityRoutes(app, routeCtx);
  registerDashboardRoutes(app, routeCtx);
  registerScopeRoutes(app, routeCtx);
  registerStructureRoutes(app, routeCtx);
  registerUserRoutes(app, routeCtx);
  registerPlatformRoutes(app, routeCtx);
  // --- API 404 Handler ---
  app.use("/api/*", (req, res) => {
    res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
  });

  // --- Global API Error Handler ---
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled API Error', { err: err });
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
  // Pass lifecycle is evaluated against the business calendar date (default Qatar time),
  // not the server's UTC clock: a pass valid "to 12 Nov" is valid for the whole of 12 Nov local time.
  // (businessToday: src/server/businessDate.ts)

  // Statuses after which a pass no longer grants access. These records are kept forever as history.
  const TERMINAL_PASS_STATUSES = ['expired', 'revoked', 'cancelled', 'replaced', 'superseded', 'inactive', 'rejected', 'deleted'];
  // Per-person application statuses meaning "a pass was issued for this person" — once the pass ends,
  // that person's line on the application is closed with the pass outcome.
  const POST_ISSUE_EMP_STATUSES = ['issued', 'collected', 'completed', 'active', 'ready_for_collection'];
  // Application statuses that are already closed.
  const CLOSED_APP_STATUSES = ['archived', 'rejected', 'cancelled', 'expired', 'replaced', 'revoked', 'deleted'];

  // Close application lines whose passes have ended, and close the application when every line is closed.
  // Called (a) by the daily lifecycle job for passes that reached their date, and (b) inside the
  // same transaction as any route that ends a pass, scoped to that pass's application(s).
  async function closeApplicationsForEndedPasses(connection: any, nowIso: string, onlyRequestIds?: string[]): Promise<number> {
    let appsChanged = 0;
    const closedList = CLOSED_APP_STATUSES.map(s => `'${s}'`).join(', ');
    const binds: Record<string, string> = {};
    let scope = '';
    if (onlyRequestIds) {
      const ids = Array.from(new Set(onlyRequestIds.filter(Boolean).map(String)));
      if (ids.length === 0) return 0;
      ids.forEach((id, i) => { binds[`r${i}`] = id.toUpperCase(); });
      scope = ` AND UPPER(r.id) IN (${ids.map((_, i) => `:r${i}`).join(', ')})`;
    }
    const appsRes = await connection.execute(
      `SELECT r.id, r.status FROM passRequests r
       WHERE LOWER(r.status) NOT IN (${closedList})${scope}
       AND EXISTS (SELECT 1 FROM passes p WHERE UPPER(p.requestId) = UPPER(r.id)
                   AND LOWER(p.status) IN ('expired', 'replaced', 'superseded', 'revoked'))`,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    for (const app of (appsRes.rows || []) as any[]) {
      const appId = String(app.ID || app.id);
      const people = await loadPeople(connection, appId);
      const empIds = people.employeeIds;
      const statuses: Record<string, string> = { ...people.employeeStatuses };

      const passRes = await connection.execute(
        `SELECT employeeId, status, updatedAt FROM passes WHERE UPPER(requestId) = UPPER(:id)`,
        [appId],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      // Latest pass state per employee on this application
      const passStateByEmp: Record<string, string> = {};
      const passUpdatedByEmp: Record<string, string> = {};
      for (const p of (passRes.rows || []) as any[]) {
        const empId = p.EMPLOYEEID || p.employeeId;
        const st = String(p.STATUS || p.status || '').toLowerCase();
        const upd = String(p.UPDATEDAT || p.updatedAt || '');
        if (!empId) continue;
        if (!passUpdatedByEmp[empId] || upd > passUpdatedByEmp[empId]) {
          passStateByEmp[empId] = st;
          passUpdatedByEmp[empId] = upd;
        }
      }

      let changed = false;
      const closedLines: string[] = [];
      for (const empId of empIds) {
        const cur = String(statuses[empId] || app.STATUS || app.status || '').toLowerCase();
        const ps = passStateByEmp[empId];
        if (!ps || !POST_ISSUE_EMP_STATUSES.includes(cur)) continue;
        let next: string | null = null;
        if (ps === 'expired') next = 'expired';
        else if (ps === 'replaced' || ps === 'superseded') next = 'replaced';
        else if (ps === 'revoked') next = 'cancelled';
        if (next && next !== cur) {
          statuses[empId] = next;
          closedLines.push(`${empId}→${next}`);
          changed = true;
        }
      }
      if (!changed) continue;
      appsChanged++;

      // Roll up: the application closes only when no line is still in progress or holding a live pass.
      const lineStates = empIds.map(id => String(statuses[id] || '').toLowerCase());
      const closedLine = (s: string) => ['expired', 'replaced', 'cancelled', 'rejected', 'revoked'].includes(s);
      let appStatus = String(app.STATUS || app.status || 'pending').toLowerCase();
      if (lineStates.length > 0 && lineStates.every(closedLine)) {
        const real = lineStates.filter(s => s !== 'cancelled' && s !== 'rejected');
        if (real.length > 0 && real.every(s => s === 'replaced')) appStatus = 'replaced';
        else if (real.length > 0) appStatus = 'expired';
      }

      await connection.execute(
        `UPDATE passRequests SET status = :status, updatedAt = :updatedAt WHERE id = :id`,
        { status: appStatus, updatedAt: nowIso, id: appId }
      );
      await savePeople(connection, appId, { ...people, employeeStatuses: statuses });
      await connection.execute(
        `INSERT INTO requestHistory (id, requestId, userId, action, remarks, timestamp)
         VALUES (:id, :requestId, :userId, :action, :remarks, :timestamp)`,
        {
          id: crypto.randomBytes(6).toString('hex'),
          requestId: appId,
          userId: 'system',
          action: appStatus === 'expired' || appStatus === 'replaced' ? `AUTO_CLOSED (${appStatus})` : 'AUTO_LINE_CLOSED',
          remarks: `Pass lifecycle: ${closedLines.join(', ')}`,
          timestamp: nowIso
        }
      );
    }
    return appsChanged;
  }

  // ===================== Daily lifecycle job =====================
  // Pass validity is date-based, so the date-based work runs ONCE per business day (00:05 business
  // time), not on a timer. Changes made by users (revoke/replace/collect) are applied immediately
  // in their own request's transaction, so nothing here needs to poll for them.
  // A row in jobRuns (job + business date) records each run and acts as a lock, so the job never
  // runs twice for the same day, and a missed day (server was down at 00:05) is caught up on start.
  const DAILY_JOB = 'daily-lifecycle';
  const DAILY_JOB_MINUTE = 5; // 00:05 business time

  async function runDailyLifecycle(today: string) {
    const runId = `${DAILY_JOB}:${today}`;
    const now = new Date().toISOString();
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const terminalList = TERMINAL_PASS_STATUSES.map(s => `'${s}'`).join(', ');
    let connection;
    try {
      connection = await getConnection();

      // Claim today's run. If the row already exists, today's run is done (or running elsewhere).
      try {
        await connection.execute(
          `INSERT INTO jobRuns (id, startedAt, status) VALUES (:id, :startedAt, 'running')`,
          { id: runId, startedAt: now }
        );
        await connection.commit();
      } catch {
        return;
      }

      try {
        // 2. Expire live passes whose last valid day (business calendar) has passed.
        //    Terminal statuses are never overwritten, so the real end reason (revoked/replaced/cancelled) is kept.
        const expiredMain = await connection.execute(
          `UPDATE passes SET status = 'expired', updatedAt = :now
           WHERE LOWER(status) NOT IN (${terminalList})
           AND expiryDate IS NOT NULL AND SUBSTR(expiryDate, 1, 10) < :today`,
          { now, today }
        );

        // 3. Supplementary passes whose parent main pass is no longer live
        const expiredSupp = await connection.execute(
          `UPDATE passes SET status = 'expired', updatedAt = :now
           WHERE type = 'supplementary' AND LOWER(status) NOT IN (${terminalList})
           AND parentPassId IN (SELECT id FROM passes WHERE LOWER(status) IN ('expired', 'inactive', 'revoked'))`,
          { now }
        );
        const expiredCount = (expiredMain?.rowsAffected || 0) + (expiredSupp?.rowsAffected || 0);

        // 4. Close application lines / applications for passes that just expired
        const appsClosed = expiredCount > 0 ? await closeApplicationsForEndedPasses(connection, now) : 0;

        // Expiry reminders (30 / 7 / 2 days ahead) and "expired" notices for passes expired above
        try {
          await scanPassExpiries(connection, now);
        } catch (notifErr) {
          logger.error('[DailyJob] scanPassExpiries failed', { err: notifErr });
        }

        // 5. Archive applications 90 days after completion or a terminal state
        const archived = await connection.execute(
          `UPDATE passRequests
           SET status = 'archived', updatedAt = :now
           WHERE status IN ('completed', 'collected', 'cancelled', 'rejected', 'revoked', 'expired', 'replaced')
           AND updatedAt < :ninetyDaysAgo`,
          { now, ninetyDaysAgo }
        );

        await connection.execute(
          `UPDATE jobRuns SET status = 'done', finishedAt = :finishedAt WHERE id = :id`,
          { finishedAt: new Date().toISOString(), id: runId }
        );
        await connection.commit();

        logger.info(`[DailyJob] ${today}: ${expiredCount} passes expired, ${appsClosed} applications updated, ${archived?.rowsAffected || 0} archived.`);
        const changedLists: string[] = [];
        if (expiredCount > 0) changedLists.push('passes');
        if (appsClosed > 0 || (archived?.rowsAffected || 0) > 0) changedLists.push('passApplications');
        publishChange(changedLists, null);
        flushNotificationPushes();
      } catch (jobErr) {
        // Roll back the partial work and release the claim so the run is retried.
        logger.error(`[DailyJob] ${today} failed`, { err: jobErr });
        try { await connection.rollback(); } catch { /* ignore */ }
        try {
          await connection.execute(`DELETE FROM jobRuns WHERE id = :id`, [runId]);
          await connection.commit();
        } catch { /* ignore */ }
        setTimeout(() => runDailyLifecycle(today), 15 * 60 * 1000);
      }
    } catch (err) {
      logger.error('[DailyJob] could not start', { err: err });
    } finally {
      if (connection) await connection.close();
    }
  }

  // Milliseconds until the next 00:05 in the business timezone.
  function msUntilNextDailyRun(): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: BUSINESS_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date());
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value || 0);
    const secondsNow = get('hour') * 3600 + get('minute') * 60 + get('second');
    let wait = DAILY_JOB_MINUTE * 60 - secondsNow;
    if (wait <= 0) wait += 24 * 3600;
    return wait * 1000 + 1000;
  }

  function scheduleDailyLifecycle() {
    setTimeout(async () => {
      await runDailyLifecycle(businessToday());
      scheduleDailyLifecycle();
    }, msUntilNextDailyRun());
  }

  // ===================== One-time data migrations =====================
  // Each migration runs exactly once per database and is recorded in schemaMigrations.
  // Never edit a migration that has shipped; add a new one instead.
  const DATA_MIGRATIONS: { id: string; run: (conn: any) => Promise<void> }[] = [
    {
      // Applications edited before the sync fix left passRequestEmployees out of step.
      id: '2026-11-12-rebuild-passRequestEmployees',
      run: async (conn) => {
        const res = await conn.execute(`SELECT id FROM passRequests`, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        for (const r of (res.rows || []) as any[]) {
          await syncRequestEmployees(conn, r.ID || r.id);
        }
      }
    },
    {
      // The employee page looks links up by employee, and every sync looks them up by application.
      id: '2026-11-12-index-passRequestEmployees',
      run: async (conn) => {
        for (const sql of [
          `CREATE INDEX idx_pre_request ON passRequestEmployees (requestId)`,
          `CREATE INDEX idx_pre_employee ON passRequestEmployees (employeeId)`
        ]) {
          try { await conn.execute(sql); } catch (e: any) {
            if (!/ORA-00955|ORA-01408|already exists/i.test(String(e?.message))) throw e;
          }
        }
      }
    },
    {
      // Applications whose passes had already ended before the lifecycle fix.
      id: '2026-11-12-close-applications-for-ended-passes',
      run: async (conn) => { await closeApplicationsForEndedPasses(conn, new Date().toISOString()); }
    },
    {
      // Legacy rows created before multi-tenancy belong to the original organization. Runs once;
      // items created later without an organization (global/platform items) are left alone.
      id: '2026-11-12-backfill-legacy-organization',
      run: async (conn) => {
        await conn.execute(`UPDATE locations SET organizationId = 'org-habari' WHERE organizationId IS NULL AND (isGlobal IS NULL OR isGlobal = 0)`);
        await conn.execute(`UPDATE categories SET organizationId = 'org-habari' WHERE organizationId IS NULL`);
        await conn.execute(`UPDATE accessCodes SET organizationId = 'org-habari' WHERE organizationId IS NULL`);
      }
    },
    {
      // Indexes for the lookups the app actually performs. Expression indexes on UPPER()/LOWER()
      // make the existing case-insensitive comparisons index lookups instead of full table scans.
      id: '2026-11-12-core-lookup-indexes',
      run: async (conn) => {
        const indexes = [
          `CREATE INDEX idx_req_upper_id ON passRequests (UPPER(id))`,
          `CREATE INDEX idx_req_org ON passRequests (organizationId)`,
          `CREATE INDEX idx_req_requester ON passRequests (requesterId)`,
          `CREATE INDEX idx_pass_upper_req ON passes (UPPER(requestId))`,
          `CREATE INDEX idx_pass_employee ON passes (employeeId)`,
          `CREATE INDEX idx_pass_location ON passes (locationId)`,
          `CREATE INDEX idx_pass_parent ON passes (parentPassId)`,
          `CREATE INDEX idx_pass_org ON passes (organizationId)`,
          `CREATE INDEX idx_pass_number ON passes (passNumber)`,
          `CREATE INDEX idx_hist_upper_req ON requestHistory (UPPER(requestId))`,
          `CREATE INDEX idx_emp_org ON employees (organizationId)`,
          `CREATE INDEX idx_loc_category ON locations (categoryId)`,
          `CREATE INDEX idx_user_lower_email ON users (LOWER(email))`,
          `CREATE INDEX idx_user_org ON users (organizationId)`,
          `CREATE INDEX idx_notif_user ON notifications (userId)`,
          `CREATE INDEX idx_audit_org ON auditLogs (organizationId)`,
          `CREATE INDEX idx_audit_ts ON auditLogs ("TIMESTAMP")`,
          `CREATE INDEX idx_pac_pass ON passAccessCodes (passId)`
        ];
        for (const sql of indexes) {
          try { await conn.execute(sql); } catch (e: any) {
            // Already exists / column already indexed / column not present in an older schema
            if (!/ORA-00955|ORA-01408|ORA-00904|already exists|no such column/i.test(String(e?.message))) throw e;
          }
        }
      }
    },
    {
      // Foreign keys, so the database itself rejects dangling references. Link rows whose
      // application or pass no longer exists are derived data (rebuilt from passRequests) and are
      // removed first; this replaces the cleanup that used to run on every startup. Every other
      // relation is only enforced when it is already clean; nothing else is changed or deleted.
      // Relations with orphans stay unenforced and show up in /api/platform/integrity.
      id: '2026-11-13-foreign-keys',
      run: async (conn) => {
        await conn.execute(`DELETE FROM passRequestEmployees WHERE requestId NOT IN (SELECT id FROM passRequests)`);
        await conn.execute(`DELETE FROM passRequestEmployees WHERE employeeId NOT IN (SELECT id FROM employees)`);
        await conn.execute(`DELETE FROM passRequestAccessCodes WHERE requestId NOT IN (SELECT id FROM passRequests)`);
        await conn.execute(`DELETE FROM passAccessCodes WHERE passId NOT IN (SELECT id FROM passes)`);
        await conn.commit(); // ALTER TABLE commits implicitly on Oracle; make the cleanup explicit first
        await enforceForeignKeys(conn, getDbEngine());
      }
    },
    {
      // People, access codes and organizations are now soft-deleted, so they can be constrained
      // too. Automatic actions recorded as 'system' get a real (non-login) account row, references
      // that differ from their record's ID only in letter case are re-pointed to it, and then every
      // relation that is clean gets its foreign key. Anything still dangling is left untouched and
      // listed under Data Integrity in the platform portal.
      id: '2026-11-13-system-account-case-repair-foreign-keys',
      run: async (conn) => {
        await ensureSystemUser(conn);
        await repairCaseMismatches(conn);
        await conn.commit();
        await enforceForeignKeys(conn, getDbEngine());
      }
    },
    {
      // Production report (2026-11-13): 4 applications pointed at 2 main passes that the old
      // startup routine had erased. Clear those links (old IDs kept in each application's
      // history), then protect the last relation.
      id: '2026-11-13-clear-dangling-main-pass-links',
      run: async (conn) => {
        await clearDanglingMainPassLinks(conn);
        await conn.commit();
        await enforceForeignKeys(conn, getDbEngine());
      }
    },
    {
      // Server-side pass list: each person's own expiry now lives on the link row, and the list
      // looks passes up by exact application ID + employee (the older index is on UPPER(requestId)).
      id: '2026-11-13-pass-list-expiry-and-indexes',
      run: async (conn) => {
        const res = await conn.execute(`SELECT id FROM passRequests`, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        for (const r of (res.rows || []) as any[]) {
          await syncRequestEmployees(conn, r.ID || r.id);
        }
        for (const sql of [
          `CREATE INDEX idx_passes_request ON passes (requestId, employeeId)`
        ]) {
          try { await conn.execute(sql); } catch (e: any) {
            if (!/ORA-00955|ORA-01408|already exists/i.test(String(e?.message))) throw e;
          }
        }
      }
    },
    {
      // Delta list refresh: the database stamps syncAt on every change to employees, passes and
      // applications, so browsers fetch only what changed instead of whole lists.
      id: '2026-11-13-sync-stamps',
      run: async (conn) => { await installSyncStamps(conn, getDbEngine()); }
    },
    {
      // The link table becomes the record of who is on each application: rebuild every
      // application's rows with each person's own status (NULL = follows the application),
      // dates and list order.
      id: '2026-11-14-link-table-people',
      run: async (conn) => {
        const res = await conn.execute(`SELECT id FROM passRequests`, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        for (const r of (res.rows || []) as any[]) {
          await syncRequestEmployees(conn, r.ID || r.id);
        }
      }
    }
  ];

  async function runDataMigrations() {
    let conn;
    try {
      conn = await getConnection();
      const doneRes = await conn.execute(`SELECT id FROM schemaMigrations`, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const done = new Set(((doneRes.rows || []) as any[]).map(r => r.ID || r.id));
      for (const m of DATA_MIGRATIONS) {
        if (done.has(m.id)) continue;
        try {
          await m.run(conn);
          await conn.execute(
            `INSERT INTO schemaMigrations (id, appliedAt) VALUES (:id, :appliedAt)`,
            { id: m.id, appliedAt: new Date().toISOString() }
          );
          await conn.commit();
          logger.info(`[Migration] applied ${m.id}`);
        } catch (err) {
          try { await conn.rollback(); } catch { /* ignore */ }
          logger.error(`[Migration] ${m.id} failed; will retry on next start`, { err: err });
          break; // keep order: later migrations may depend on this one
        }
      }
    } catch (err) {
      logger.error('[Migration] runner failed', { err: err });
    } finally {
      if (conn) await conn.close();
    }
  }

  // Startup: migrations first, then catch up today's lifecycle run if it hasn't happened yet,
  // then schedule the next one.
  (async () => {
    try { await dbReady; } catch { /* logged above */ }
    await runDataMigrations();
    try {
      const c = await getConnection();
      try { await checkSyncStamps(c, getDbEngine()); } finally { await c.close(); }
    } catch (err) { logger.error('[Sync] startup check failed', { err: err }); }
    await runDailyLifecycle(businessToday());
    scheduleDailyLifecycle();
    startupComplete = true;
  })();

  // Production sits behind nginx on the same host, so bind to loopback only; the app port is
  // then unreachable from outside. Override with HOST if the deployment differs.
  const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');
  const httpServer = app.listen(PORT, HOST, () => {
    debugLog(`Server running on http://localhost:${PORT}`);
  });

  // Graceful shutdown (pm2 restart/reload sends SIGINT): stop taking requests, close live
  // event streams, flush/close the database, then exit. Forced exit after 10s.
  let shuttingDown = false;
  const shutdown = async (signal: string, code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[Shutdown] ${signal} received, closing...`);
    const force = setTimeout(() => process.exit(code || 1), 10_000);
    force.unref();
    httpServer.close();
    for (const c of realtimeClients) { try { c.res.end(); } catch { /* ignore */ } }
    realtimeClients.clear();
    try { await closeDatabase(); } catch (err) { logger.error('[Shutdown] database close failed', { err: err }); }
    process.exit(code);
  };
  (globalThis as any).__accessOneShutdown = shutdown;
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err: any) {
    debugLog(`CRITICAL: Server failed to start: ${err.message}`);
    logger.error('CRITICAL: Server failed to start', { err: err });
  }
}

startServer();
