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

// users routes (moved verbatim from server.ts; shared helpers come from the route context)
export function registerUserRoutes(app: express.Express, ctx: RouteContext) {
  const { bcrypt, oracledb, logAction, createNotification, authorize, getConnection, toCamelCase } = ctx;
  // Update a user account.
  //  - Identity comes only from the verified session (authorize()).
  //  - Only allow-listed fields can be written; column names never come from the request.
  //  - A user may edit their own profile; changing their own password requires the current one.
  //  - An org admin may manage users in their own organization only; only a power_admin may
  //    grant power_admin, move users between organizations, or edit a power_admin.
  const SELF_EDITABLE_USER_FIELDS: Record<string, string> = {
    displayName: 'DISPLAYNAME', photoURL: 'PHOTOURL', phone: 'PHONE', preferences: 'PREFERENCES'
  };
  const ADMIN_EDITABLE_USER_FIELDS: Record<string, string> = {
    ...SELF_EDITABLE_USER_FIELDS,
    role: 'ROLE', status: 'STATUS', jobTitle: 'JOBTITLE', department: 'DEPARTMENT',
    division: 'DIVISION', project: 'PROJECT', email: 'EMAIL'
  };
  const ASSIGNABLE_ROLES = ['admin', 'approver', 'applier', 'requester', 'viewer'];
  const USER_STATUSES = ['pending', 'active', 'inactive', 'suspended'];
  const MIN_PASSWORD_LENGTH = 8;

  app.patch("/api/users/:id", authorize([]), validate(schemas.userUpdate), async (req, res) => {
    let connection;
    try {
      const actorId = String(req.headers['x-user-id'] || '');
      const actorRole = String(req.headers['x-user-role'] || '');
      const actorOrg = String(req.headers['x-user-org-id'] || '');
      const targetUserId = req.params.id;
      const isSelf = actorId === targetUserId;
      const isPowerAdmin = actorRole === 'power_admin';
      const isOrgAdmin = actorRole === 'admin';
      // Decide before any lookup, so non-admins can't probe which user IDs exist
      if (!isPowerAdmin && !isOrgAdmin && !isSelf) {
        return res.status(403).json({ error: "You do not have permission to update this user account" });
      }

      connection = await getConnection();
      const tRes = await connection.execute(
        `SELECT id, role, organizationId, password FROM users WHERE id = :id AND deletedAt IS NULL AND role <> 'system'`,
        [targetUserId],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const target: any = tRes.rows?.[0];
      if (!target) return res.status(404).json({ error: "User not found" });
      const targetRole = String(target.ROLE || target.role || '');
      const targetOrg = String(target.ORGANIZATIONID || target.organizationId || '');

      // Who may edit whom
      let asAdmin = false;
      if (isPowerAdmin) {
        asAdmin = true;
      } else if (isOrgAdmin && !isSelf) {
        if (!actorOrg || targetOrg !== actorOrg || targetRole === 'power_admin') {
          return res.status(403).json({ error: "You can only manage users in your own organization" });
        }
        asAdmin = true;
      } else if (isOrgAdmin && isSelf) {
        asAdmin = true; // may edit own profile fields; role/status changes on self are blocked below
      } else if (!isSelf) {
        return res.status(403).json({ error: "You do not have permission to update this user account" });
      }

      const allowed = asAdmin ? ADMIN_EDITABLE_USER_FIELDS : SELF_EDITABLE_USER_FIELDS;
      const updates: Record<string, any> = {};
      for (const [field, column] of Object.entries(allowed)) {
        if (req.body[field] !== undefined) updates[column] = req.body[field];
      }

      // Nobody changes their own role or status (prevents self-escalation / self-lockout)
      if (isSelf) { delete updates.ROLE; delete updates.STATUS; }

      if (updates.ROLE !== undefined) {
        const role = String(updates.ROLE).toLowerCase();
        const assignable = isPowerAdmin ? [...ASSIGNABLE_ROLES, 'power_admin'] : ASSIGNABLE_ROLES;
        if (!assignable.includes(role)) return res.status(400).json({ error: "Invalid role" });
        updates.ROLE = role;
      }
      if (updates.STATUS !== undefined) {
        const status = String(updates.STATUS).toLowerCase();
        if (!USER_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });
        updates.STATUS = status;
      }
      if (updates.EMAIL !== undefined) {
        const email = String(updates.EMAIL).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Invalid email" });
        updates.EMAIL = email;
      }
      if (isPowerAdmin && req.body.organizationId !== undefined) {
        updates.ORGANIZATIONID = req.body.organizationId || null;
      }
      if (updates.PREFERENCES !== undefined && typeof updates.PREFERENCES === 'object') {
        updates.PREFERENCES = JSON.stringify(updates.PREFERENCES);
      }

      // Password: own change needs the current password; admins resetting others use /reset-password
      if (req.body.password) {
        const newPassword = String(req.body.password);
        if (!isSelf) return res.status(400).json({ error: "Use Reset Password to change another user's password" });
        if (newPassword.length < MIN_PASSWORD_LENGTH) {
          return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
        }
        const currentHash = target.PASSWORD || target.password || '';
        if (!req.body.currentPassword || !(await bcrypt.compare(String(req.body.currentPassword), currentHash))) {
          return res.status(400).json({ error: "Current password is incorrect" });
        }
        updates.PASSWORD = await bcrypt.hash(newPassword, 12);
      }

      if (Object.keys(updates).length === 0) {
        return res.json({ id: targetUserId });
      }

      const setClause = Object.keys(updates).map(key => `${key} = :${key}`).join(', ');
      await connection.execute(
        `UPDATE users SET ${setClause} WHERE id = :id`,
        { ...updates, id: targetUserId }
      );

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
      await connection.commit();

      const actionType = updates.STATUS === 'active' ? 'APPROVE_USER' : 'UPDATE';
      logAction(req, actionType, 'user', targetUserId, isSelf ? 'Updated own profile' : `Updated user ${Object.keys(updates).filter(k => k !== 'PASSWORD').join(', ').toLowerCase()}`);

      const response: any = toCamelCase(updates);
      delete response.password;
      res.json({ id: targetUserId, ...response });
    } catch (err: any) {
      logger.error('Failed to update user', { err: err });
      res.status(500).json({ error: "Failed to update user" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // Admin password reset: sets the given password, or generates a random temporary one
  // and returns it once. Org admins can reset only users in their own organization.
  app.post("/api/users/:id/reset-password", authorize(['admin', 'power_admin']), async (req, res) => {
    let connection;
    try {
      const actorRole = String(req.headers['x-user-role'] || '');
      const actorOrg = String(req.headers['x-user-org-id'] || '');
      connection = await getConnection();

      const tRes = await connection.execute(
        `SELECT id, role, organizationId FROM users WHERE id = :id AND deletedAt IS NULL AND role <> 'system'`,
        [req.params.id],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const target: any = tRes.rows?.[0];
      if (!target) return res.status(404).json({ error: "User not found" });
      if (actorRole !== 'power_admin') {
        const targetOrg = String(target.ORGANIZATIONID || target.organizationId || '');
        if (!actorOrg || targetOrg !== actorOrg || String(target.ROLE || target.role) === 'power_admin') {
          return res.status(403).json({ error: "You can only reset passwords for users in your own organization" });
        }
      }

      const provided = typeof req.body?.newPassword === 'string' ? req.body.newPassword.trim() : '';
      if (provided && provided.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      }
      const temporaryPassword = provided || crypto.randomBytes(9).toString('base64url'); // 12 chars

      await connection.execute(
        `UPDATE users SET password = :password WHERE id = :id`,
        { password: await bcrypt.hash(temporaryPassword, 12), id: req.params.id }
      );
      await connection.commit();

      logAction(req, 'UPDATE', 'user', req.params.id, `Reset password for user`);
      // The generated password is returned once so the admin can hand it over; it is never logged.
      res.json({ success: true, temporaryPassword: provided ? undefined : temporaryPassword });
    } catch (err: any) {
      logger.error('Password reset failed', { err: err });
      res.status(500).json({ error: "Failed to reset password" });
    } finally {
      if (connection) await connection.close();
    }
  });

}
