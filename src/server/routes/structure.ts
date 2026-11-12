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

// structure routes (moved verbatim from server.ts; shared helpers come from the route context)
export function registerStructureRoutes(app: express.Express, ctx: RouteContext) {
  const { oracledb, logAction, authorize, getConnection, toCamelCase, toOracleKeys, getTenantOrgId } = ctx;
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
      logger.error('Unhandled error', { err: err });
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
        id: newId(), 
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
      logger.error('Unhandled error', { err: err });
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
      logger.error('Unhandled error', { err: err });
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
      logger.error('Unhandled error', { err: err });
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
      logger.error('Unhandled error', { err: err });
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
        id: newId(),
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
      logger.error('Unhandled error', { err: err });
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
      logger.error('Unhandled error', { err: err });
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
      logger.error('Unhandled error', { err: err });
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
      logger.error('Unhandled error', { err: err });
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
        id: newId(), 
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
      logger.error('Unhandled error', { err: err });
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
      logger.error('Unhandled error', { err: err });
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
      logger.error('Unhandled error', { err: err });
      res.status(500).json({ error: "Failed to delete department" });
    } finally {
      if (connection) await connection.close();
    }
  });

}
