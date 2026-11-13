import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { debugLog, logger } from "../log.ts";
import { syncRequestEmployees, findMissingEmployees } from "../requestLinks.ts";
import { newId, newRef, nextSequenceValue } from "../ids.ts";
import { SYSTEM_USER_ID } from "../integrity.ts";
import { signSessionToken, verifySessionToken, setSessionCookie, clearSessionCookie, getSessionToken } from "../session.ts";
import { realtimeClients, pendingNotificationUsers, publishChange, flushNotificationPushes, REALTIME_RESOURCE_MAP } from "../realtime.ts";
import type { RealtimeClient } from "../realtime.ts";
import { authRateLimit } from "../rateLimit.ts";
import { validate, schemas, createSchemas } from "../validation.ts";
import type { RouteContext } from "../context.ts";

// passes routes (moved verbatim from server.ts; shared helpers come from the route context)
export function registerPassRoutes(app: express.Express, ctx: RouteContext) {
  const { oracledb, logAction, cleanupOldCategoryPasses, authorize, validatePassExpiries, getConnection, toCamelCase, toOracleKeys, getTenantOrgId, closeApplicationsForEndedPasses } = ctx;
  app.get("/api/passes", authorize(['admin', 'approver', 'applier', 'viewer']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      let sql = `SELECT * FROM passes WHERE deletedAt IS NULL`;
      const binds: any = {};
      if (orgId) {
        sql += ` AND organizationId = :orgId`;
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
      logger.error('Error fetching passes', { err: err });
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
      // Use the application's ID exactly as stored. (Upper-casing the incoming ID made rows of
      // older, mixed-case applications point at an ID that doesn't exist.)
      let requestId = String(existingRequestId || req.body.requestId || '').trim();
      if (requestId) {
        const found = await connection.execute(`SELECT id FROM passRequests WHERE UPPER(id) = UPPER(:id)`, [requestId], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const row: any = found.rows?.[0];
        requestId = row ? String(row.ID ?? row.id) : requestId.toUpperCase();
      } else {
        requestId = newRef();
      }
      const { orgId } = await getTenantOrgId(req, connection);
      const effectiveOrgId = orgId || req.body.organizationId || 'org-habari';

      if (!Array.isArray(employeeIds)) {
        return res.status(400).json({ error: "employeeIds must be an array" });
      }
      const missing = await findMissingEmployees(connection, employeeIds);
      if (missing.length > 0) {
        return res.status(400).json({ error: `Unknown employee(s): ${missing.slice(0, 5).join(', ')}` });
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
        const random = await nextSequenceValue(connection, `DE-${year}`, 3);
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
        requesterId: (req.headers['x-user-id'] as string) || SYSTEM_USER_ID, // verified session, never a client value
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
        // Previous passes of this application are superseded (kept for history, hidden from lists)
        await connection.execute(
          `UPDATE passes SET status = 'replaced', deletedAt = :now, remarks = SUBSTR(COALESCE(remarks, '') || ' [Superseded by application edit]', 1, 1000) WHERE UPPER(requestId) = UPPER(:id) AND deletedAt IS NULL`,
          { now: new Date().toISOString(), id: requestId }
        );
      }

      // Populate mappings
      for (const empId of employeeIds) {
        await connection.execute(
          `INSERT INTO passRequestEmployees (id, requestId, employeeId, status) 
           VALUES (:id, :requestId, :employeeId, :status)`,
          {
            id: newId(),
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
            id: newId(),
            requestId: requestId,
            accessCodeId: acId
          }
        );
      }

      const results = [];
      // Use the individualExpiries defined above (which might have been merged from existing request)

      for (const empId of employeeIds) {
        const passId = newId();

        let passNumber = null;
        if (initialPassStatus === 'active') {
          const year = new Date().getFullYear();
          const random = await nextSequenceValue(connection, `PASS-${year}`);
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
              id: newId(),
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
      logger.error('Unhandled error', { err: err });
      res.status(500).json({ error: "Failed to create batch passes" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/passes", authorize(['admin', 'approver', 'applier']), validate(createSchemas.pass), async (req, res) => {
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
        const random = await nextSequenceValue(connection, `PASS-${year}`);
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
        id: newId(), 
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
      logger.error('Unhandled error', { err: err });
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
        const random = await nextSequenceValue(connection, `PASS-${year}`);
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

      // Pass ended by a user (revoked/expired/replaced): close its application line in the same transaction
      if (req.body.status && req.body.status !== oldPass.status && oldPass.requestId &&
          ['expired', 'revoked', 'replaced', 'superseded'].includes(String(req.body.status).toLowerCase())) {
        await closeApplicationsForEndedPasses(connection, new Date().toISOString(), [oldPass.requestId]);
      }

      await connection.commit();

      if (req.body.status && req.body.status !== oldPass.status) {
        logAction(req, 'STATUS_CHANGE', 'pass', req.params.id, `Pass status changed from ${oldPass.status} to ${req.body.status}`);
      } else {
        logAction(req, 'UPDATE', 'pass', req.params.id, `Updated pass details`);
      }
      res.json({ ...oldPass, ...req.body, expiryDate: updatedPass.expiryDate });
    } catch (err) {
      logger.error('Unhandled error', { err: err });
      res.status(500).json({ error: "Failed to update pass" });
    } finally {
      if (connection) await connection.close();
    }
  };

  app.patch("/api/passes/:id", authorize(['admin', 'approver', 'applier']), validate(schemas.pass), handlePassUpdate);
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
          const random = await nextSequenceValue(connection, `PASS-${year}`);
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
            const histId = newId();
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
              logger.error("Failed to log requestHistory on bulk pass update", { err: hErr });
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

        if (currentPass.requestId) {
          if (['expired', 'revoked', 'replaced', 'superseded'].includes(String(targetPassStatus).toLowerCase())) {
            await closeApplicationsForEndedPasses(connection, updatedAt, [currentPass.requestId]);
          }
          await syncRequestEmployees(connection, currentPass.requestId);
        }
      }
      await connection.commit();

      logAction(req, 'UPDATE', 'pass', 'bulk', `Bulk updated ${passIds.length} passes to ${status}`);
      res.json({ success: true });
    } catch (err) {
      logger.error('Unhandled error', { err: err });
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
        await syncRequestEmployees(connection, requestId);
      }

      await connection.commit();
      logAction(req, 'UPDATE', 'pass', req.params.id, `Reverted pass status to active`);
      res.json({ success: true });
    } catch (err) {
      logger.error('Unhandled error', { err: err });
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

      // Soft delete (status 'deleted' + deletedAt); supplementary passes go with their main pass
      const delBinds = { id: req.params.id, deletedAt: new Date().toISOString(), deletedBy: String(req.headers['x-user-id'] || '') };
      await connection.execute(`UPDATE passes SET status = 'deleted', deletedAt = :deletedAt, deletedBy = :deletedBy WHERE id = :id`, delBinds);
      if ((deletedPass.TYPE || deletedPass.type) === 'main') {
        await connection.execute(`UPDATE passes SET status = 'deleted', deletedAt = :deletedAt, deletedBy = :deletedBy WHERE parentPassId = :id`, delBinds);
      }

      await connection.commit();
      logAction(req, 'DELETE', 'pass', req.params.id, `Deleted pass`);
      res.json({ success: true });
    } catch (err) {
      logger.error('Unhandled error', { err: err });
      res.status(500).json({ error: "Failed to delete pass" });
    } finally {
      if (connection) await connection.close();
    }
  });

}
