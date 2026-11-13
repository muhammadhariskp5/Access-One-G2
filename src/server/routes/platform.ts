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
import { integrityReport, enforceForeignKeys, repairCaseMismatches } from "../integrity.ts";

// platform routes (moved verbatim from server.ts; shared helpers come from the route context)
export function registerPlatformRoutes(app: express.Express, ctx: RouteContext) {
  const { bcrypt, oracledb, logAction, orgStatusCache, authorizePowerAdmin, getConnection, toCamelCase, getDbEngine } = ctx;
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
        connection.execute(`SELECT * FROM organizations WHERE deletedAt IS NULL`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }).catch(() => ({ rows: [] })),
        connection.execute(`SELECT role, status FROM users WHERE deletedAt IS NULL AND role <> 'system'`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }),
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
        vendor: process.env.VENDOR_NAME || "Techsandgadgets.com",
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
      logger.error('SaaS dashboard fetch failed', { err: err });
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
        `SELECT * FROM organizations WHERE deletedAt IS NULL ORDER BY createdAt DESC`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      res.json((result.rows || []).map(toCamelCase));
    } catch (err: any) {
      logger.error('Failed to list companies', { err: err });
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
      const orgId = `org-${cleanCode.toLowerCase()}-${newRef(6).toLowerCase()}`;

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
      const randomKeyPart = newRef(8);
      const generatedLicenseKey = `TECH-${cleanCode}-${tierCode}-${randomKeyPart}-${nowYear}`;

      const clientAdminEmail = primaryAdminEmail.trim().toLowerCase();
      const clientAdminPass = String(primaryAdminPassword || initialAdminPassword || '').trim() || crypto.randomBytes(9).toString('base64url');
      if (clientAdminPass.length < 8) return res.status(400).json({ error: 'Admin password must be at least 8 characters' });
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
        const newUserId = newId();
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
      const auditId = newId();
      await connection.execute(
        `INSERT INTO auditLogs (id, userId, userEmail, userName, action, entityType, entityId, details, timestamp)
         VALUES (:id, :actorId, :actorEmail, :actorEmail, 'LICENSE_COMPANY_PROVISIONED', 'organization', :orgId, :details, :timestamp)`,
        {
          id: auditId,
          actorId: (req.headers['x-user-id'] as string) || 'system',
          actorEmail: (req.headers['x-user-email'] as string) || 'system',
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
        vendor: process.env.VENDOR_NAME || "Techsandgadgets.com",
        supportContact: process.env.SUPPORT_CONTACT || ''
      };

      res.json({
        success: true,
        message: `Successfully provisioned and licensed ${companyName}!`,
        organizationId: orgId,
        licenseKey: generatedLicenseKey,
        welcomePackage
      });
    } catch (err: any) {
      logger.error('Failed to license company', { err: err });
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
      logger.error('Failed to update company license', { err: err });
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
      logger.error('Failed to update organization status', { err: err });
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
      logger.error('Failed to get maintenance settings', { err: err });
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
      logger.error('Failed to update maintenance settings', { err: err });
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
        vendor: process.env.VENDOR_NAME || "Techsandgadgets.com",
        supportContact: process.env.SUPPORT_CONTACT || ''
      };

      res.json(welcomePackage);
    } catch (err: any) {
      logger.error('Failed to get welcome package', { err: err });
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
      logger.error('Failed to activate organization', { err: err });
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
      const targetPassword = String(newPassword || '').trim() || crypto.randomBytes(9).toString('base64url');
      if (targetPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

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
        const newUserId = newId();
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
      logger.error('Failed to reset admin password', { err: err });
      res.status(500).json({ error: err.message || "Failed to reset admin password" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // Referential integrity report (read-only): orphan rows per relation and whether the database
  // enforces it with a foreign key.
  app.get("/api/platform/integrity", authorizePowerAdmin(), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const engine = getDbEngine();
      const relations = await integrityReport(connection, engine);
      res.json({
        engine,
        generatedAt: new Date().toISOString(),
        clean: relations.every(r => r.orphans === 0 && !r.error),
        orphans: relations.reduce((s, r) => s + r.orphans, 0),
        repairable: relations.reduce((s, r) => s + r.caseOnlyMismatches, 0),
        enforced: relations.filter(r => r.constraint === 'enforced').length,
        total: relations.length,
        relations
      });
    } catch (err: any) {
      logger.error('Integrity report failed', { err: err });
      res.status(500).json({ error: "Failed to build integrity report" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // Re-points references that differ from their record's ID only in letter case. Lossless: each
  // fixed row now points at the record it already meant; nothing is deleted.
  app.post("/api/platform/integrity/repair", authorizePowerAdmin(), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const fixed = await repairCaseMismatches(connection);
      await connection.commit();
      const total = fixed.reduce((s, f) => s + f.fixed, 0);
      logAction(req, 'UPDATE', 'database', 'case-repair', `Re-pointed ${total} reference(s) differing only in letter case`);
      res.json({ fixed, total });
    } catch (err: any) {
      try { await connection?.rollback(); } catch { /* ignore */ }
      logger.error('Case repair failed', { err: err });
      res.status(500).json({ error: "Failed to repair references" });
    } finally {
      if (connection) await connection.close();
    }
  });

  // Adds the foreign keys for relations that are clean (never changes data). Run after cleaning up
  // orphans the report listed; also runs once automatically as a data migration.
  app.post("/api/platform/integrity/enforce", authorizePowerAdmin(), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const result = await enforceForeignKeys(connection, getDbEngine());
      logAction(req, 'UPDATE', 'database', 'foreign-keys', `Foreign keys added: ${result.added.join(', ') || 'none'}`);
      res.json(result);
    } catch (err: any) {
      logger.error('Enforcing foreign keys failed', { err: err });
      res.status(500).json({ error: "Failed to add foreign keys" });
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
        `SELECT name, isCurrent FROM organizations WHERE id = :id AND deletedAt IS NULL`,
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

      // Soft delete: the company's employees, passes, applications and history stay intact and
      // keep resolving to it; its users can no longer sign in (status 'deleted' is blocked).
      await connection.execute(
        `UPDATE organizations SET status = 'deleted', isCurrent = 0, deletedAt = :deletedAt, deletedBy = :deletedBy WHERE id = :id`,
        { id: orgId, deletedAt: new Date().toISOString(), deletedBy: String(req.headers['x-user-id'] || '') }
      );
      await connection.commit();
      orgStatusCache.delete(orgId);

      logAction(req, 'DELETE', 'organization', orgId, `Removed licensed company record ${org.name}`);
      res.json({ success: true, message: `Company ${org.name} removed successfully` });
    } catch (err: any) {
      logger.error('Failed to delete company', { err: err });
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
          vendor: process.env.VENDOR_NAME || "Techsandgadgets.com",
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
      logger.error('Snapshot export failed', { err: err });
      res.status(500).json({ error: err.message || "Failed to generate snapshot export" });
    } finally {
      if (connection) await connection.close();
    }
  });

  debugLog('Core API routes initialized');

}
