import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { debugLog, logger } from "../log.ts";
import { readPeople, savePeople } from "../requestLinks.ts";
import { newId, newRef, nextSequenceValue } from "../ids.ts";
import { signSessionToken, verifySessionToken, setSessionCookie, clearSessionCookie, getSessionToken } from "../session.ts";
import { realtimeClients, pendingNotificationUsers, publishChange, flushNotificationPushes, REALTIME_RESOURCE_MAP } from "../realtime.ts";
import type { RealtimeClient } from "../realtime.ts";
import { authRateLimit } from "../rateLimit.ts";
import { validate, schemas, createSchemas } from "../validation.ts";
import type { RouteContext } from "../context.ts";

// resources routes (moved verbatim from server.ts; shared helpers come from the route context)
export function registerResourceRoutes(app: express.Express, ctx: RouteContext) {
  const { oracledb, logAction, authorize, getConnection, toCamelCase, toOracleKeys, getTenantOrgId } = ctx;
  app.get("/api/locations", authorize(['admin', 'approver', 'applier', 'viewer']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId, isPowerAdmin } = await getTenantOrgId(req, connection);
      let query = `SELECT * FROM locations WHERE deletedAt IS NULL`;
      const binds: any = {};
      if (orgId && !isPowerAdmin) {
        query += ` AND (organizationId = :orgId OR isGlobal = 1 OR (organizationId IS NULL AND :isDefaultOrg = 1))`;
        binds.orgId = orgId;
        binds.isDefaultOrg = orgId === 'org-habari' ? 1 : 0;
      }
      query += ` ORDER BY name ASC`;
      const result = await connection.execute(query, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      res.json(result.rows?.map(toCamelCase));
    } catch (err) {
      logger.error('Unhandled error', { err: err });
      res.status(500).json({ error: "Failed to fetch locations" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/locations", authorize(['admin', 'power_admin']), validate(createSchemas.location), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId, isPowerAdmin } = await getTenantOrgId(req, connection);
      const isGlobal = req.body.isGlobal ? 1 : 0;
      const effectiveOrgId = isGlobal ? null : (orgId || req.body.organizationId || 'org-habari');
      const newLocation = toOracleKeys({ 
        ...req.body, 
        id: newId(),
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
      logger.error('Unhandled error', { err: err });
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
        id: newId(),
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
      logger.error('Unhandled error', { err: err });
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
      let query = `SELECT * FROM categories WHERE deletedAt IS NULL`;
      const binds: any = {};
      if (orgId && !isPowerAdmin) {
        query += ` AND (organizationId = :orgId OR (organizationId IS NULL AND :isDefaultOrg = 1))`;
        binds.orgId = orgId;
        binds.isDefaultOrg = orgId === 'org-habari' ? 1 : 0;
      }
      query += ` ORDER BY name ASC`;
      const result = await connection.execute(query, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      res.json(result.rows?.map(toCamelCase));
    } catch (err) {
      logger.error('Unhandled error', { err: err });
      res.status(500).json({ error: "Failed to fetch categories" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/categories", authorize(['admin']), validate(createSchemas.category), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      const effectiveOrgId = orgId || req.body.organizationId || 'org-habari';
      const newCategory = toOracleKeys({ 
        ...req.body, 
        id: newId(),
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
      logger.error('Unhandled error', { err: err });
      res.status(500).json({ error: "Failed to create category" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.patch("/api/locations/:id", authorize(['admin']), validate(schemas.location), async (req, res) => {
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
      logger.error('Unhandled error', { err: err });
      res.status(500).json({ error: "Failed to update location" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.patch("/api/categories/:id", authorize(['admin']), validate(schemas.category), async (req, res) => {
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
      logger.error('Unhandled error', { err: err });
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
          const rnd = await nextSequenceValue(connection, `PASS-${year}`);
          const num = `PASS-${year}-${rnd}`;
          await connection.execute(`UPDATE passes SET passNumber = :num WHERE id = :pId`, { num, pId });
        }
        await connection.commit();
      }
      // Sync pending applications whose employeeStatuses might have been incorrectly set to processing on creation
      const pendingApps = await connection.execute(
        `SELECT id FROM passRequests WHERE LOWER(status) IN ('pending', 'under_review')`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if (pendingApps.rows && pendingApps.rows.length > 0) {
        const ids = (pendingApps.rows as any[]).map(r => String(r.ID ?? r.id));
        const peopleById = await readPeople(connection, ids);
        for (const [appId, people] of peopleById) {
          const empStatuses = { ...people.employeeStatuses };
          let changed = false;
          people.employeeIds.forEach((id: string) => {
            if (empStatuses[id] === 'processing') {
              empStatuses[id] = 'pending';
              changed = true;
            }
          });
          if (changed) await savePeople(connection, appId, { ...people, employeeStatuses: empStatuses });
        }
        await connection.commit();
      }
    } catch (err) {
      logger.error("ensurePassesAndExpiriesSynced error", { err: err });
    }
  }

}
