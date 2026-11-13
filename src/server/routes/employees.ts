import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { debugLog, logger } from "../log.ts";
import { cancelEmployeesOnApplications, syncRequestEmployees } from "../requestLinks.ts";
import { newId, newRef, nextSequenceValue } from "../ids.ts";
import { signSessionToken, verifySessionToken, setSessionCookie, clearSessionCookie, getSessionToken } from "../session.ts";
import { realtimeClients, pendingNotificationUsers, publishChange, flushNotificationPushes, REALTIME_RESOURCE_MAP } from "../realtime.ts";
import type { RealtimeClient } from "../realtime.ts";
import { authRateLimit } from "../rateLimit.ts";
import { validate, schemas, createSchemas } from "../validation.ts";
import type { RouteContext } from "../context.ts";
import { respondDelta } from "../syncStamp.ts";
import { parseEmployeeListQuery, buildEmployeeFilter, orderBy, pageClause, duplicateReasonsFor, countDuplicates, EMPLOYEE_EXPORT_MAX } from "../employeeQuery.ts";

// employees routes (moved verbatim from server.ts; shared helpers come from the route context)
export function registerEmployeeRoutes(app: express.Express, ctx: RouteContext) {
  const { oracledb, logAction, authorize, validateEmployeeReferences, getConnection, toCamelCase, toOracleKeys, getTenantOrgId, normalizeDateStr, getDbEngine } = ctx;
  // --- Data Endpoints ---
  app.get("/api/employees", authorize(['admin', 'approver', 'applier', 'viewer']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);

      // Paged mode (the Employees page): ?page=&pageSize=&q=&type=&status=&division=&department=
      // &project=&duplicates=1&sort=&order=  or  &all=1 for export/print.
      // Returns { items, total, page, pageSize, duplicateCount }.
      if (req.query.page !== undefined || req.query.all !== undefined) {
        const f = parseEmployeeListQuery(req.query as Record<string, unknown>);
        const { where, binds } = buildEmployeeFilter(f, orgId || null);
        const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT };
        const countRes = await connection.execute(`SELECT COUNT(*) AS cnt FROM employees WHERE ${where}`, binds, opts);
        const total = Number((countRes.rows?.[0] as any)?.CNT ?? (countRes.rows?.[0] as any)?.cnt ?? 0);
        const limit = f.all ? EMPLOYEE_EXPORT_MAX : f.pageSize;
        const offset = f.all ? 0 : (f.page - 1) * f.pageSize;
        const rowsRes = await connection.execute(
          `SELECT * FROM employees WHERE ${where} ${orderBy(f)} ${pageClause(getDbEngine(), offset, limit)}`,
          binds, opts
        );
        const items = (rowsRes.rows || []).map(toCamelCase);
        const reasons = await duplicateReasonsFor(connection, items.map((e: any) => e.id), orgId || null);
        for (const e of items as any[]) if (reasons[e.id]) e.duplicateReasons = reasons[e.id];
        const duplicateCount = await countDuplicates(connection, orgId || null);
        return res.json({ items, total, page: f.all ? 1 : f.page, pageSize: limit, duplicateCount });
      }

      // Delta refresh (?since=cursor): only rows changed since the browser's last fetch
      if (await respondDelta(req, res, connection, 'employees', orgId || null, toCamelCase)) return;

      let sql = `SELECT * FROM employees WHERE deletedAt IS NULL`;
      const binds: any = {};
      if (orgId) {
        sql += ` AND organizationId = :orgId`;
        binds.orgId = orgId;
      }
      const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      res.json(result.rows?.map(toCamelCase));
    } catch (err) {
      logger.error('Unhandled error', { err: err });
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
         WHERE re.employeeId = :id AND r.deletedAt IS NULL
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
        `SELECT * FROM passes WHERE employeeId = :id AND deletedAt IS NULL ORDER BY createdAt DESC`,
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
      logger.error('Unhandled error', { err: err });
      res.status(500).json({ error: "Failed to fetch employee details" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/employees", authorize(['admin', 'approver', 'applier']), validate(schemas.employee), async (req, res) => {
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
        id: newId() 
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
      logger.error('Unhandled error', { err: err });
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

      const { orgId, isPowerAdmin } = await getTenantOrgId(req, connection);
      const effectiveOrgId = (req.headers['x-user-org-id'] as string) || orgId || 'org-habari';
      const IMPORT_DATE_FIELDS = ['passportExpiry', 'visaExpiry', 'qidVisaExpiry', 'safetyInductionDate', 'birthDate'];

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
        // Only a power admin may import into another organization; everyone else imports into their own.
        const itemOrgId = (isPowerAdmin && empData.organizationId) ? empData.organizationId : effectiveOrgId;

        // Dates arrive in whatever format the spreadsheet used: store them as YYYY-MM-DD, and skip
        // (and report) a row whose date can't be read rather than storing an unusable value.
        const badDate = IMPORT_DATE_FIELDS.find(f => {
          const raw = empData[f];
          if (raw === undefined || raw === null || String(raw).trim() === '') return false;
          const iso = normalizeDateStr(raw);
          if (!iso) return true;
          empData[f] = iso;
          return false;
        });
        if (badDate) {
          results.skipped++;
          results.duplicates.push(`${empData.firstName || ''} ${empData.lastName || ''} - Error: unreadable date in ${badDate} ("${empData[badDate]}")`);
          continue;
        }
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
          id: newId() 
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
      logger.error('Batch Import Error', { err: err });
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
      logger.error('Unhandled error', { err: err });
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
      await cancelEmployeesOnApplications(connection, ids, String(req.headers['x-user-id'] || ''));

      await connection.execute(
        `UPDATE employees SET deletedAt = '${new Date().toISOString()}', status = 'inactive' WHERE id IN (${placeholders})`,
        ids
      );
      await connection.commit();
      logAction(req, 'DELETE', 'employee', 'bulk', `Deleted ${ids.length} employees and cancelled associated active passes/applications`);
      res.json({ success: true });
    } catch (err: any) {
      logger.error('Unhandled error', { err: err });
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
      await cancelEmployeesOnApplications(connection, [empId], String(req.headers['x-user-id'] || ''));

      // Soft delete: keep the person's record so their pass history stays meaningful
      await connection.execute(
        `UPDATE employees SET deletedAt = :deletedAt, deletedBy = :deletedBy, status = 'inactive' WHERE id = :empId`,
        { deletedAt: new Date().toISOString(), deletedBy: String(req.headers['x-user-id'] || ''), empId }
      );
      await connection.commit();
      logAction(req, 'DELETE', 'employee', empId, `Deleted employee ${empId} and cancelled associated passes/applications`);
      res.json({ success: true });
    } catch (err: any) {
      logger.error('Unhandled error', { err: err });
      res.status(500).json({ error: "Failed to delete employee", details: err.message });
    } finally {
      if (connection) await connection.close();
    }
  });
  app.patch("/api/employees/:id", authorize(['admin', 'approver', 'applier']), validate(schemas.employee), async (req, res) => {
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
      logger.error('Unhandled error', { err: err });
      res.status(500).json({ error: "Failed to update employee" });
    } finally {
      if (connection) await connection.close();
    }
  });

}
