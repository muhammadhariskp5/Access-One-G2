import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { debugLog, logger } from "../log.ts";
import { syncRequestEmployees, findMissingEmployees, attachPeople } from "../requestLinks.ts";
import { newId, newRef, nextSequenceValue } from "../ids.ts";
import { SYSTEM_USER_ID } from "../integrity.ts";
import { signSessionToken, verifySessionToken, setSessionCookie, clearSessionCookie, getSessionToken } from "../session.ts";
import { realtimeClients, pendingNotificationUsers, publishChange, flushNotificationPushes, REALTIME_RESOURCE_MAP } from "../realtime.ts";
import type { RealtimeClient } from "../realtime.ts";
import { authRateLimit } from "../rateLimit.ts";
import { validate, schemas, createSchemas } from "../validation.ts";
import type { RouteContext } from "../context.ts";
import { pageClause } from "../employeeQuery.ts";
import { respondDelta } from "../syncStamp.ts";
import { parseApplicationListQuery, buildApplicationList, applicationTabClause, applicationOrderBy, mapApplicationRow, APPLICATION_LIST_COLUMNS, APPLICATION_COUNT_COLUMNS, APP_EXPORT_MAX } from "../applicationQuery.ts";

// applications routes (moved verbatim from server.ts; shared helpers come from the route context)
export function registerApplicationRoutes(app: express.Express, ctx: RouteContext) {
  const { oracledb, logAction, createNotification, notifyAdmins, cleanupOldCategoryPasses, authorize, validatePassExpiries, getConnection, toCamelCase, toOracleKeys, getTenantOrgId, getDbEngine } = ctx;
  app.get("/api/passApplications", authorize(['admin', 'approver', 'applier', 'viewer']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);

      // Paged mode (Applications screen): the database searches, filters, rolls up each
      // application's status from its people and pages the list.
      // ?page=&pageSize=&q=&status=&type=&from=&to=&sort=newest|oldest&tab=active|archived  or  &all=1
      // Returns { items, total, page, pageSize, activeCount, archivedCount }.
      if (req.query.page !== undefined || req.query.all !== undefined) {
        const f = parseApplicationListQuery(req.query as Record<string, unknown>);
        const engine = getDbEngine();
        const { from, where, binds } = buildApplicationList(f, orgId || null);
        const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT };
        const countRes = await connection.execute(`SELECT ${APPLICATION_COUNT_COLUMNS} FROM ${from} WHERE ${where}`, binds, opts);
        const c: any = countRes.rows?.[0] || {};
        const all = Number(c.CNT ?? c.cnt ?? 0);
        const archivedCount = Number(c.ARCHIVEDCNT ?? c.archivedCnt ?? c.archivedcnt ?? 0);
        const activeCount = all - archivedCount;
        // History is kept in full but only listed on a search (2+ characters); its count still shows.
        const historyHidden = f.tab === 'archived' && f.q.length < 2;
        const total = historyHidden ? 0 : f.tab === 'active' ? activeCount : f.tab === 'archived' ? archivedCount : all;
        const limit = f.all ? APP_EXPORT_MAX : f.pageSize;
        const offset = f.all ? 0 : (f.page - 1) * f.pageSize;
        let items: any[] = [];
        if (total > 0) {
          const rowsRes = await connection.execute(
            `SELECT ${APPLICATION_LIST_COLUMNS} FROM ${from} WHERE ${where}${applicationTabClause(f)} ${applicationOrderBy(f)} ${pageClause(engine, offset, limit)}`,
            binds, opts
          );
          items = await attachPeople(connection, (rowsRes.rows || []).map((r: any) => mapApplicationRow(r, toCamelCase)));
        }
        return res.json({ items, total, page: f.all ? 1 : f.page, pageSize: limit, activeCount, archivedCount });
      }

      const mapRequest = (r: any) => ({
        ...toCamelCase(r),
        employeeIds: JSON.parse(r.EMPLOYEEIDS || '[]'),
        employeeStatuses: JSON.parse(r.EMPLOYEESTATUSES || '{}'),
        temporaryNames: JSON.parse(r.TEMPORARYNAMES || '[]'),
        accessCodes: JSON.parse(r.ACCESSCODES || '[]'),
        individualExpiries: JSON.parse(r.INDIVIDUALEXPIRIES || '{}'),
        individualStartDates: JSON.parse(r.INDIVIDUALSTARTDATES || '{}')
      });
      // Delta refresh (?since=cursor): only rows changed since the browser's last fetch
      // People on each application come from the link table (attachPeople)
      if (await respondDelta(req, res, connection, 'passRequests', orgId || null, mapRequest, items => attachPeople(connection, items))) return;

      let sql = `SELECT * FROM passRequests WHERE deletedAt IS NULL`;
      const binds: any = {};
      if (orgId) {
        sql += ` AND organizationId = :orgId`;
        binds.orgId = orgId;
      }
      sql += ` ORDER BY createdAt DESC`;

      const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });

      const requests = await attachPeople(connection, result.rows?.map(mapRequest) || []);

      res.json(requests);
    } catch (err) {
      logger.error('Unhandled error', { err: err });
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

      const missing = await findMissingEmployees(connection, employeeIds);
      if (missing.length > 0) {
        return res.status(400).json({ error: `Unknown employee(s): ${missing.slice(0, 5).join(', ')}` });
      }

      employeeIds.forEach((id: string) => {
        employeeStatuses[id] = req.body.employeeStatuses?.[id] || req.body.status || 'pending';
      });

      const allowedFields = [
        'locationId', 'purpose', 'startDate', 'endDate',
        'status', 'authorityAppNumber', 'parentPassId', 'remarks', 'expiryDate', 'type',
        'projectId', 'contractNumber', 'contractName', 'contractTitle', 'clientCompany', 'clientApprovers'
      ];
      const filteredBody: any = {};
      allowedFields.forEach(field => {
        if (req.body[field] !== undefined) filteredBody[field] = req.body[field];
      });

      // The requester is whoever is signed in (from the verified session), never a client value.
      filteredBody.requesterId = (req.headers['x-user-id'] as string) || SYSTEM_USER_ID;

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
      const requestId = newRef();
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

      // Populate passRequestEmployees mapping table (status + per-person expiry)
      await syncRequestEmployees(connection, requestId);

      // Populate passRequestAccessCodes mapping table
      const accessCodeIds = Array.from(new Set(req.body.accessCodeIds || []));
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

      await connection.commit();

      // Dispatch in-app notifications to admins/approvers and requester
      try {
        const callerName = (req.headers['x-user-name'] as string) || 'Applicant';
        const requesterId = filteredBody.requesterId;
        await notifyAdmins(connection, effectiveOrgId, {
          type: 'application_new',
          title: `New Application Submitted: #${requestId}`,
          message: `${callerName} submitted pass application #${requestId} for ${employeeIds.length} personnel.`,
          entityType: 'application',
          entityId: requestId,
          link: `/applications/${requestId}`,
          priority: 'normal',
          excludeUserId: requesterId
        });

        if (requesterId && requesterId !== 'system') {
          await createNotification(connection, {
            userId: requesterId,
            organizationId: effectiveOrgId,
            type: 'application_submitted',
            title: `Application Submitted: #${requestId}`,
            message: `Your pass application #${requestId} has been submitted for review.`,
            entityType: 'application',
            entityId: requestId,
            link: `/applications/${requestId}`,
            priority: 'normal'
          });
        }
      } catch (notifErr) {
        logger.error('Failed to dispatch application notifications', { err: notifErr });
      }

      logAction(req, 'CREATE', 'application', requestId, `Created pass application for ${employeeIds.length} employees`);
      res.json({
        ...newRequest,
        id: requestId,
        employeeIds: employeeIds,
        employeeStatuses: employeeStatuses
      });
    } catch (err) {
      logger.error('Unhandled error', { err: err });
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

          const passId = newId();
          const year = new Date().getFullYear();
          const random = await nextSequenceValue(connection, `PASS-${year}`);
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

    await syncRequestEmployees(connection, applicationId);

    return employeeStatuses;
  }

  app.patch("/api/passApplications/:id", authorize(['admin', 'approver', 'applier']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();

      const allowedUpdateFields = [
        'locationId', 'purpose', 'startDate', 'endDate',
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
      const histId = newId();
      const actionText = req.body.status ? `STATUS_UPDATE (${req.body.status})` : 'DATA_UPDATE';
      const remarkText = req.body.approvalRemarks || req.body.remarks || `Application updated: ${req.body.status || 'data change'}`;
      try {
        await connection.execute(
          `INSERT INTO requestHistory (id, requestId, userId, action, remarks, timestamp)
           VALUES (:id, :requestId, :userId, :action, :remarks, :timestamp)`,
          { id: histId, requestId: req.params.id, userId: (req.headers['x-user-id'] as string) || 'system', action: actionText, remarks: remarkText, timestamp: new Date().toISOString() }
        );
      } catch (hErr) {
        logger.error("Failed to log requestHistory", { err: hErr });
      }

      // Keep the employee ↔ application mapping table in step with employeeIds / statuses
      if (req.body.employeeIds !== undefined || req.body.employeeStatuses !== undefined || req.body.status !== undefined) {
        await syncRequestEmployees(connection, req.params.id);
      }

      await connection.commit();

      logAction(req, 'UPDATE', 'application', req.params.id, `Updated application: ${req.body.status || 'data update'}`);
      res.json({ id: req.params.id, ...updates });
    } catch (err) {
      logger.error('Unhandled error', { err: err });
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
      const { status, remarks, approvalRemarks } = req.body;
      const now = new Date().toISOString();

      const result = await connection.execute(`SELECT * FROM passRequests WHERE UPPER(id) = UPPER(:id)`, [req.params.id]);
      const application = result.rows?.[0] as any;
      if (!application) return res.status(404).json({ error: "Application not found" });

      const updates: any = { status, updatedAt: now };
      if (remarks) updates.remarks = remarks;
      if (approvalRemarks) updates.approvalRemarks = approvalRemarks;
      // The approver is whoever is signed in (verified session), never a client-supplied value.
      const actorId = (req.headers['x-user-id'] as string) || SYSTEM_USER_ID;
      updates.approverId = actorId;

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
      const histId = newId();
      try {
        await connection.execute(
          `INSERT INTO requestHistory (id, requestId, userId, action, remarks, timestamp)
           VALUES (:id, :requestId, :userId, :action, :remarks, :timestamp)`,
          {
            id: histId,
            requestId: application.ID || application.id || req.params.id,
            userId: actorId,
            action: `STATUS_CHANGE (${(status || '').toUpperCase()})`,
            remarks: approvalRemarks || remarks || `Application status changed to ${status}`,
            timestamp: now
          }
        );
      } catch (hErr) {
        logger.error("Failed to log request history", { err: hErr });
      }

      await syncRequestEmployees(connection, req.params.id);
      await connection.commit();
      const notifyUserId = application.REQUESTERID || application.requesterId;
      if (notifyUserId && notifyUserId !== 'system') {
        const normSt = (status || '').toLowerCase();
        let notifType = 'application_status';
        let notifTitle = `Application Status Update: #${req.params.id}`;
        let notifMessage = `Your pass application status changed to: ${status}`;
        let notifPriority: 'normal' | 'high' | 'urgent' = 'normal';

        if (normSt === 'approved') {
          notifType = 'application_approved';
          notifTitle = `Application Approved: #${req.params.id}`;
          notifMessage = `Congratulations! Your pass application #${req.params.id} has been approved.`;
          notifPriority = 'high';
        } else if (normSt === 'rejected') {
          notifType = 'application_rejected';
          notifTitle = `Application Rejected: #${req.params.id}`;
          notifMessage = `Pass application #${req.params.id} was rejected${remarks ? ': ' + remarks : '.'}`;
          notifPriority = 'urgent';
        } else if (normSt === 'completed' || normSt === 'collected') {
          notifType = 'pass_issued';
          notifTitle = `Passes Ready / Issued: #${req.params.id}`;
          notifMessage = `Passes for application #${req.params.id} are ready/issued.`;
          notifPriority = 'high';
        }

        await createNotification(connection, {
          userId: notifyUserId,
          organizationId: application.ORGANIZATIONID || application.organizationId || null,
          type: notifType,
          title: notifTitle,
          message: notifMessage,
          entityType: 'application',
          entityId: req.params.id,
          link: `/applications/${req.params.id}`,
          priority: notifPriority,
        });
      }
      logAction(req, 'STATUS_CHANGE', 'application', req.params.id, `Changed status to ${status}`);
      res.json({ id: req.params.id, status, ...updates });
    } catch (err) {
      logger.error('Unhandled error', { err: err });
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
      logger.error("Failed to fetch application history", { err: err });
      res.status(500).json({ error: "Failed to fetch application history" });
    } finally {
      if (connection) await connection.close();
    }
  };

  app.get("/api/passApplications/:id/history", authorize(['admin', 'approver', 'applier', 'viewer']), getAppHistoryHandler);

  // The people on one application with their details and latest pass on it (the Applications
  // screen's expanded card), so the screen doesn't need the full employee and pass lists.
  app.get("/api/passApplications/:id/roster", authorize(['admin', 'approver', 'applier', 'viewer']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT };
      const binds: Record<string, unknown> = { id: req.params.id };
      if (orgId) binds.orgId = orgId;
      const found = await connection.execute(
        `SELECT id FROM passRequests WHERE id = :id AND deletedAt IS NULL${orgId ? ' AND organizationId = :orgId' : ''}`,
        binds, opts
      );
      if (!found.rows?.length) return res.status(404).json({ error: "Application not found" });
      const r = await connection.execute(
        `SELECT pre.employeeId AS employeeId, e.name AS name, e.employeeId AS employeeCode, e.qatarId AS qatarId,
                e.jobTitle AS jobTitle, e.department AS department,
                lp.id AS passId, lp.passNumber AS passNumber, lp.status AS passStatus,
                lp.startDate AS passStartDate, lp.expiryDate AS passExpiryDate
           FROM passRequestEmployees pre
           LEFT JOIN employees e ON e.id = pre.employeeId
           LEFT JOIN (
             SELECT p.id, p.requestId, p.employeeId, p.passNumber, p.status, p.startDate, p.expiryDate,
                    ROW_NUMBER() OVER (PARTITION BY p.employeeId ORDER BY p.createdAt DESC, p.id DESC) AS rn
               FROM passes p WHERE p.requestId = :id AND p.deletedAt IS NULL
           ) lp ON lp.employeeId = pre.employeeId AND lp.rn = 1
          WHERE pre.requestId = :id`,
        { id: req.params.id }, opts
      );
      const g = (row: any, k: string) => row[k.toUpperCase()] ?? row[k] ?? null;
      res.json(((r.rows || []) as any[]).map(row => ({
        employeeId: g(row, 'employeeId'),
        name: g(row, 'name'),
        employeeCode: g(row, 'employeeCode'),
        qatarId: g(row, 'qatarId'),
        jobTitle: g(row, 'jobTitle'),
        department: g(row, 'department'),
        pass: g(row, 'passId') ? {
          id: g(row, 'passId'), passNumber: g(row, 'passNumber'), status: g(row, 'passStatus'),
          startDate: g(row, 'passStartDate'), expiryDate: g(row, 'passExpiryDate'),
        } : null,
      })));
    } catch (err) {
      logger.error('Unhandled error', { err: err });
      res.status(500).json({ error: "Failed to load application roster" });
    } finally {
      if (connection) await connection.close();
    }
  });
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
      await syncRequestEmployees(connection, req.params.id);

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
            const passId = newId();
            const year = new Date().getFullYear();
            const random = await nextSequenceValue(connection, `PASS-${year}`);
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
      const histId = newId();
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
        logger.error("Failed to insert request history", { err: hErr });
      }

      await connection.commit();

      // Dispatch in-app notification to requester
      try {
        const notifyUserId = application.REQUESTERID || application.requesterId;
        if (notifyUserId && notifyUserId !== 'system') {
          const isTerminal = status === 'completed' || status === 'collected';
          await createNotification(connection, {
            userId: notifyUserId,
            organizationId: application.ORGANIZATIONID || application.organizationId || null,
            type: isTerminal ? 'pass_issued' : 'application_status',
            title: `Passes Update: #${req.params.id}`,
            message: `${employeeIds.length} personnel pass status updated to "${status}".`,
            entityType: 'application',
            entityId: req.params.id,
            link: `/applications/${req.params.id}`,
            priority: isTerminal ? 'high' : 'normal'
          });
        }
      } catch (notifErr) {
        logger.error('Failed to notify on member status update', { err: notifErr });
      }

      logAction(req, 'MEMBER_STATUS_CHANGE', 'application', req.params.id, `Updated ${employeeIds.length} members status to ${status}`);
      res.json({ success: true, employeeStatuses, status: newStatus });
    } catch (err) {
      logger.error('Unhandled error', { err: err });
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
      await syncRequestEmployees(connection, req.params.id);

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
          const passId = newId();
          const year = new Date().getFullYear();
          const random = await nextSequenceValue(connection, `PASS-${year}`);
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
      logger.error('Unhandled error', { err: err });
      res.status(500).json({ error: "Failed to update employee status" });
    } finally {
      if (connection) await connection.close();
    }
  });

}
