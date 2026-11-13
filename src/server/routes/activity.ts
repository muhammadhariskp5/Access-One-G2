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

// activity routes (moved verbatim from server.ts; shared helpers come from the route context)
export function registerActivityRoutes(app: express.Express, ctx: RouteContext) {
  const { oracledb, createNotification, scanPassExpiries, activePresences, cleanStalePresences, authorize, getConnection, toCamelCase, getTenantOrgId } = ctx;
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
          sql += ` AND organizationId = :orgId AND (userId IS NULL OR userId NOT IN (SELECT id FROM users WHERE role = 'power_admin')) AND userId != 'system'`;
          binds.orgId = orgId;
        } else if (!isPowerAdmin) {
          // Standard user with no org assigned cannot see cross-tenant or power admin logs
          sql += ` AND organizationId IS NULL AND (userId IS NULL OR userId NOT IN (SELECT id FROM users WHERE role = 'power_admin')) AND userId != 'system'`;
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

        // Keyset paging: newest first; `before` = timestamp of the oldest entry already shown.
        if (typeof req.query.before === 'string' && req.query.before) {
          sql += ` AND "TIMESTAMP" < :before`;
          binds.before = req.query.before;
        }
        // Refresh: only entries at or after the newest one already shown (the screen drops the
        // ones it has by id), so a refresh with nothing new returns nothing.
        if (typeof req.query.since === 'string' && req.query.since) {
          sql += ` AND "TIMESTAMP" >= :since`;
          binds.since = req.query.since;
        }

        sql += ` ORDER BY "TIMESTAMP" DESC`;

        // Bounded page size: default 500, max 5000 (an audit table grows without limit).
        const pageSize = Math.min(Math.max(parseInt(String(limit || ''), 10) || 500, 1), 5000);
        sql += ` FETCH FIRST ${pageSize} ROWS ONLY`;

        const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        res.json(result.rows?.map(toCamelCase));
      } catch (err) {
        logger.error('Unhandled error', { err: err });
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
          if (p.role === 'power_admin') return false;
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
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 200);
    const unreadOnly = req.query.unreadOnly === 'true' || req.query.unreadOnly === '1';
    const typeFilter = (req.query.type as string)?.trim();

    let connection;
    try {
      connection = await getConnection();
      let query = `SELECT * FROM notifications WHERE userId = :userId`;
      const binds: any = { userId };

      if (unreadOnly) {
        query += ` AND isRead = 0`;
      }
      if (typeFilter && typeFilter !== 'all') {
        if (typeFilter === 'expiries') {
          query += ` AND type IN ('expiring_soon', 'expiring_48h', 'expiring_7d', 'expiring_30d', 'expired')`;
        } else if (typeFilter === 'applications') {
          query += ` AND (type LIKE 'application%' OR entityType = 'application')`;
        } else if (typeFilter === 'passes') {
          query += ` AND (type LIKE 'pass%' OR type IN ('expiring_soon', 'expiring_48h', 'expiring_7d', 'expiring_30d', 'expired') OR entityType = 'pass')`;
        } else if (typeFilter === 'broadcast') {
          query += ` AND type IN ('system_broadcast', 'broadcast', 'security_alert')`;
        } else {
          query += ` AND type = :typeFilter`;
          binds.typeFilter = typeFilter;
        }
      }

      query += ` ORDER BY "TIMESTAMP" DESC FETCH FIRST :limit ROWS ONLY`;
      binds.limit = limit;

      const result = await connection.execute(
        query,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      res.json((result.rows || []).map(toCamelCase));
    } catch (err) {
      logger.error('Failed to fetch notifications', { err: err });
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
      logger.error('Failed to mark all notifications read', { err: err });
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
      logger.error('Failed to mark notification read', { err: err });
      res.status(500).json({ error: 'Failed to update notification' });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.delete("/api/notifications/:id", authorize([]), async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    let connection;
    try {
      connection = await getConnection();
      await connection.execute(
        `DELETE FROM notifications WHERE id = :id AND userId = :userId`,
        { id: req.params.id, userId }
      );
      await connection.commit();
      res.json({ ok: true });
    } catch (err) {
      logger.error('Failed to delete notification', { err: err });
      res.status(500).json({ error: 'Failed to delete notification' });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.delete("/api/notifications", authorize([]), async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    const deleteAll = req.query.all === 'true';
    let connection;
    try {
      connection = await getConnection();
      if (deleteAll) {
        await connection.execute(
          `DELETE FROM notifications WHERE userId = :userId`,
          { userId }
        );
      } else {
        await connection.execute(
          `DELETE FROM notifications WHERE userId = :userId AND isRead = 1`,
          { userId }
        );
      }
      await connection.commit();
      res.json({ ok: true });
    } catch (err) {
      logger.error('Failed to clear notifications', { err: err });
      res.status(500).json({ error: 'Failed to clear notifications' });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/notifications/broadcast", authorize(['admin', 'power_admin']), async (req, res) => {
    const { title, message, priority, targetRole, organizationId } = req.body;
    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' });
    }

    let connection;
    try {
      connection = await getConnection();
      const { orgId, isPowerAdmin } = await getTenantOrgId(req, connection);
      const targetOrgId = isPowerAdmin ? (organizationId || null) : orgId;

      let userSql = `SELECT id, organizationId FROM users WHERE status = 'active'`;
      const binds: any = {};
      if (targetOrgId) {
        userSql += ` AND (organizationId = :targetOrgId OR role = 'power_admin')`;
        binds.targetOrgId = targetOrgId;
      }
      if (targetRole && targetRole !== 'all') {
        userSql += ` AND role = :targetRole`;
        binds.targetRole = targetRole;
      }

      const usersResult = await connection.execute(userSql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const targetUsers = (usersResult.rows || []) as any[];

      let sentCount = 0;
      for (const u of targetUsers) {
        const uId = u.ID || u.id;
        if (uId) {
          await createNotification(connection, {
            userId: uId,
            organizationId: u.ORGANIZATIONID || u.organizationId || targetOrgId,
            type: 'system_broadcast',
            title: title.trim(),
            message: message.trim(),
            entityType: 'system',
            priority: priority || 'high',
            link: '/notifications'
          });
          sentCount++;
        }
      }

      res.json({ success: true, count: sentCount });
    } catch (err) {
      logger.error('Failed to send broadcast notification', { err: err });
      res.status(500).json({ error: 'Failed to send broadcast notification' });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/notifications/check-expiries", authorize(['admin', 'power_admin', 'approver', 'applier']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const count = await scanPassExpiries(connection);
      res.json({ success: true, count });
    } catch (err) {
      logger.error('Failed to scan pass expiries', { err: err });
      res.status(500).json({ error: 'Failed to scan pass expiries' });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/notifications/test", authorize([]), async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      const notif = await createNotification(connection, {
        userId,
        organizationId: orgId,
        type: 'general',
        title: 'In-App Notification Test',
        message: 'The in-app notification system is active, fully connected, and working in real time.',
        entityType: 'system',
        link: '/notifications',
        priority: 'normal'
      });
      res.json({ success: true, notification: notif });
    } catch (err) {
      logger.error('Failed to send test notification', { err: err });
      res.status(500).json({ error: 'Failed to send test notification' });
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
                          WHERE role != 'power_admin' AND role <> 'system' AND deletedAt IS NULL`;
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
          logger.warn("User reports: users query warning", { err: uErr });
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
          logger.warn("User reports: passRequests count aggregation warning", { err: aErr });
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
          logger.warn("User reports: requestHistory count aggregation warning", { err: hErr });
        }

        // 4. Aggregate total audit actions logged per user (scoped to organization)
        const auditCountsMap: Record<string, { count: number; lastActionTime: string }> = {};
        try {
          let auditSql = `SELECT userId, userEmail, count(*) as count, max("TIMESTAMP") as lastActionTime 
                          FROM auditLogs 
                          WHERE 1=1`;
          const auditBinds: any = {};
          if (orgId && !isPowerAdmin) {
            auditSql += ` AND organizationId = :orgId AND (userId IS NULL OR userId NOT IN (SELECT id FROM users WHERE role = 'power_admin')) AND userId != 'system'`;
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
          logger.warn("User reports: auditLogs count aggregation warning", { err: audErr });
        }

        // 5. Recent authentication / security events (strictly tenant scoped)
        let recentAuthEvents: any[] = [];
        try {
          let eventsSql = `SELECT id, userId, userEmail, userName, action, entityType, entityId, details, "TIMESTAMP" as timestamp 
                           FROM auditLogs 
                           WHERE (entityType IN ('auth', 'user') OR action IN ('LOGIN', 'LOGOUT', 'RESET_PASSWORD', 'CREATE', 'UPDATE'))`;
          const eventBinds: any = {};
          if (orgId && !isPowerAdmin) {
            eventsSql += ` AND organizationId = :orgId AND (userId IS NULL OR userId NOT IN (SELECT id FROM users WHERE role = 'power_admin')) AND userId != 'system'`;
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
              fallbackSql += ` AND organizationId = :orgId AND (userId IS NULL OR userId NOT IN (SELECT id FROM users WHERE role = 'power_admin')) AND userId != 'system'`;
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
            logger.warn("User reports: recentAuthEvents warning", { err: evErr2 });
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
            if (p.role === 'power_admin') return false;
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
            userId: u.id || newId(),
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
        logger.error("Failed to generate user reports", { err: err });
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

}
