import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { debugLog, logger } from "../log.ts";
import { syncRequestEmployees } from "../requestLinks.ts";
import { newId, newRef, nextSequenceValue } from "../ids.ts";
import { signSessionToken, verifySessionToken, setSessionCookie, clearSessionCookie, getSessionToken } from "../session.ts";
import { realtimeClients, pendingNotificationUsers, publishChange, flushNotificationPushes, REALTIME_RESOURCE_MAP } from "../realtime.ts";
import type { RealtimeClient } from "../realtime.ts";
import { authRateLimit } from "../rateLimit.ts";
import { validate, schemas, createSchemas } from "../validation.ts";
import type { RouteContext } from "../context.ts";

// admin routes (moved verbatim from server.ts; shared helpers come from the route context)
export function registerAdminRoutes(app: express.Express, ctx: RouteContext) {
  const { bcrypt, oracledb, logAction, activePresences, authorize, getConnection, toCamelCase, toOracleKeys, getTenantOrgId } = ctx;
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

      // The location's access codes are retired with it (soft delete; passes keep their codes)
      const locDel = { id: req.params.id, deletedAt: new Date().toISOString(), deletedBy: String(req.headers['x-user-id'] || '') };
      await connection.execute(`UPDATE accessCodes SET status = 'deleted', deletedAt = :deletedAt, deletedBy = :deletedBy WHERE locationId = :id AND deletedAt IS NULL`, locDel);

      await connection.execute(`UPDATE locations SET deletedAt = :deletedAt, deletedBy = :deletedBy WHERE id = :id`, locDel);
      await connection.commit();
      logAction(req, 'DELETE', 'location', req.params.id, `Deleted location and archived associated passes`);
      res.json({ success: true });
    } catch (err) {
      logger.error('Unhandled error', { err: err });
      res.status(500).json({ error: "Failed to delete location" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.delete("/api/accessCodes/:id", authorize(['admin']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      await connection.execute(
        `UPDATE accessCodes SET status = 'deleted', deletedAt = :deletedAt, deletedBy = :deletedBy WHERE id = :id`,
        { id: req.params.id, deletedAt: new Date().toISOString(), deletedBy: String(req.headers['x-user-id'] || '') }
      );
      await connection.commit();
      logAction(req, 'DELETE', 'access_code', req.params.id, `Deleted access code`);
      res.json({ success: true });
    } catch (err) {
      logger.error('Unhandled error', { err: err });
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

      const catDel = { deletedAt: new Date().toISOString(), deletedBy: String(req.headers['x-user-id'] || '') };
      for (const locId of locationIds) {
        await connection.execute(`UPDATE passes SET status = 'archived' WHERE locationId = :id`, [locId]);
        await connection.execute(`UPDATE passRequests SET status = 'archived' WHERE locationId = :id`, [locId]);
        await connection.execute(`UPDATE accessCodes SET status = 'deleted', deletedAt = :deletedAt, deletedBy = :deletedBy WHERE locationId = :id AND deletedAt IS NULL`, { ...catDel, id: locId });
        await connection.execute(`UPDATE locations SET deletedAt = :deletedAt, deletedBy = :deletedBy WHERE id = :id AND deletedAt IS NULL`, { ...catDel, id: locId });
      }

      await connection.execute(`UPDATE categories SET deletedAt = :deletedAt, deletedBy = :deletedBy WHERE id = :id`, { id: req.params.id, deletedAt: new Date().toISOString(), deletedBy: String(req.headers['x-user-id'] || '') });
      await connection.commit();
      logAction(req, 'DELETE', 'category', req.params.id, `Deleted category and archived associated data`);
      res.json({ success: true });
    } catch (err) {
      logger.error('Unhandled error', { err: err });
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

      // Soft delete: the application, its passes and its history are kept (status 'deleted').
      // Only the derived employee-link rows are removed, so it disappears from employee pages.
      const appDel = { id: req.params.id, deletedAt: new Date().toISOString(), deletedBy: String(req.headers['x-user-id'] || '') };
      await connection.execute(`UPDATE passes SET status = 'deleted', deletedAt = :deletedAt, deletedBy = :deletedBy WHERE UPPER(requestId) = UPPER(:id)`, appDel);
      await connection.execute(`UPDATE passRequests SET status = 'deleted', deletedAt = :deletedAt, deletedBy = :deletedBy WHERE UPPER(id) = UPPER(:id)`, appDel);
      await connection.execute(`DELETE FROM passRequestEmployees WHERE UPPER(requestId) = UPPER(:id)`, [req.params.id]);
      await connection.execute(
        `INSERT INTO requestHistory (id, requestId, userId, action, remarks, timestamp) VALUES (:hid, :id, :userId, 'DELETED', 'Application deleted', :ts)`,
        { hid: newId(), id: req.params.id, userId: appDel.deletedBy || 'system', ts: appDel.deletedAt }
      );
      await connection.commit();
      logAction(req, 'DELETE', 'application', req.params.id, `Deleted application`);
      res.json({ success: true });
    } catch (err) {
      logger.error('Unhandled error', { err: err });
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
      const isTargetPowerAdmin = targetUser.role === 'power_admin';
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
      logger.error('Deletion check error', { err: err });
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
      logger.error('Unhandled error', { err: err });
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
      const isPowerAdminUser = userRole === 'power_admin';

      connection = await getConnection();

      const adminCheck = await connection.execute(`SELECT role, email FROM users WHERE id = :id`, [currentUserId], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const currentUser = toCamelCase((adminCheck.rows as any[])?.[0]);

      const isAuthorized = isPowerAdminUser || currentUser?.role === 'admin' || currentUser?.role === 'power_admin';
      if (!isAuthorized) {
        return res.status(403).json({ error: "Only administrators can delete users" });
      }

      if (req.params.id === currentUserId) {
        return res.status(400).json({ error: "Cannot delete your own active account" });
      }

      // Check target user exists
      const targetUserRes = await connection.execute(
        `SELECT id, email, role, displayName, department, division, project FROM users WHERE id = :id AND deletedAt IS NULL`,
        [req.params.id],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const targetUser = toCamelCase((targetUserRes.rows as any[])?.[0]);
      if (!targetUser) {
        return res.status(404).json({ error: "User account not found" });
      }
      if (targetUser.role === 'system') {
        return res.status(403).json({ error: "The system account records automatic actions and cannot be deleted." });
      }

      // Protect Master Platform Administrator
      if (targetUser.role === 'power_admin') {
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

      // Soft delete: the row stays so applications, history and notifications keep resolving to
      // this person's name. Sign-in is removed: the email is released (so it can be registered
      // again), the password can no longer match, and open sessions are refused (status check in
      // authorize). The original email is kept in the audit entry below.
      await connection.execute(
        `UPDATE users SET status = 'deleted', email = :anonEmail, password = :lockedPassword,
           resetTokenHash = NULL, resetTokenExpiry = NULL, deletedAt = :deletedAt, deletedBy = :deletedBy
         WHERE id = :id`,
        {
          id: req.params.id,
          anonEmail: `deleted.${req.params.id}@deleted.invalid`,
          lockedPassword: `!deleted-${crypto.randomBytes(16).toString('hex')}`,
          deletedAt: new Date().toISOString(),
          deletedBy: currentUserId || ''
        }
      );
      await connection.commit();

      const targetLabel = targetUser.displayName || targetUser.email || req.params.id;
      logAction(req, 'DELETE', 'user', req.params.id, `Deleted user account ${targetLabel} (${targetUser.email}); record kept for history, sign-in removed`);
      res.json({ success: true, message: `User account ${targetLabel} deleted successfully.` });
    } catch (err: any) {
      logger.error('Failed to delete user', { err: err });
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
      let query = `SELECT * FROM accessCodes WHERE deletedAt IS NULL`;
      const binds: any = {};
      if (orgId && !isPowerAdmin) {
        query += ` AND (organizationId = :orgId OR isGlobal = 1 OR (organizationId IS NULL AND :isDefaultOrg = 1))`;
        binds.orgId = orgId;
        binds.isDefaultOrg = orgId === 'org-habari' ? 1 : 0;
      }
      query += ` ORDER BY areaCode ASC`;
      const result = await connection.execute(query, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      res.json(result.rows?.map(toCamelCase));
    } catch (err) {
      logger.error('Unhandled error', { err: err });
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
        id: newId(),
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
      logger.error('Unhandled error', { err: err });
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
      logger.error('Unhandled error', { err: err });
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
        id: newId(),
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
      logger.error('Unhandled error', { err: err });
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
      logger.error('Unhandled error', { err: err });
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
      logger.error('Unhandled error', { err: err });
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

      const conditions: string[] = ["deletedAt IS NULL", "role <> 'system'"];
      const binds: any = {};

      if (!includePlatformAdmin) {
        conditions.push("role != 'power_admin'");
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
      logger.error('Unhandled error', { err: err });
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
      logger.error('Failed to get user profile', { err: err });
      res.status(500).json({ error: "Failed to get user profile" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.patch("/api/users/profile", authorize([]), validate(schemas.userUpdate), async (req, res) => {
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
      logger.error('Failed to update user profile', { err: err });
      res.status(500).json({ error: "Failed to update profile" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/users", authorize(['admin']), validate(schemas.userCreate), async (req, res) => {
    let connection;
    try {
      const { email, password, displayName, role, department, division, project, jobTitle, phone } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }
      if (String(password).length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      const requestedRole = String(role || 'viewer').toLowerCase();
      const actorIsPowerAdmin = String(req.headers['x-user-role'] || '') === 'power_admin';
      if (!['admin', 'approver', 'applier', 'requester', 'viewer', ...(actorIsPowerAdmin ? ['power_admin'] : [])].includes(requestedRole)) {
        return res.status(400).json({ error: "Invalid role" });
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

      const createdUserId = newId();
      const hashedPassword = bcrypt.hashSync(password, 12);
      const now = new Date().toISOString();

      const newUser = toOracleKeys({
        id: createdUserId,
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

      logAction(req, 'CREATE', 'user', createdUserId, `Created user account for ${email} (${role || 'requester'})`);

      const resUser: any = toCamelCase(newUser);
      delete resUser.password;
      if (resUser.preferences && typeof resUser.preferences === 'string') {
        try {
          resUser.preferences = JSON.parse(resUser.preferences);
        } catch (e) { /* ignore */ }
      }
      res.json(resUser);
    } catch (err: any) {
      logger.error('Failed to create user', { err: err });
      res.status(500).json({ error: err.message || "Failed to create user" });
    } finally {
      if (connection) await connection.close();
    }
  });

}
