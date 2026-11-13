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

// auth routes (moved verbatim from server.ts; shared helpers come from the route context)
export function registerAuthRoutes(app: express.Express, ctx: RouteContext) {
  const { bcrypt, oracledb, logAction, authorize, getConnection, toCamelCase } = ctx;
    // --- Auth Endpoints ---
    app.post("/api/auth/register", authRateLimit(20, 5), validate(schemas.register), async (req, res) => {
      const { email, password, displayName } = req.body;
      const trimmedEmail = email?.trim().toLowerCase();
      if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        return res.status(400).json({ error: "A valid email is required." });
      }
      if (typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters." });
      }
      if (!displayName || !String(displayName).trim()) {
        return res.status(400).json({ error: "Name is required." });
      }

      let connection;
      try {
        connection = await getConnection();

        // Check if email already exists
        const emailCheck = await connection.execute(`SELECT id FROM users WHERE email = :email`, [trimmedEmail]);
        if (emailCheck.rows && emailCheck.rows.length > 0) {
          return res.status(400).json({ error: "Email already in use. Please sign in instead." });
        }

        // Check if display name already exists
        const nameCheck = await connection.execute(`SELECT id FROM users WHERE displayName = :displayName AND deletedAt IS NULL`, [displayName]);
        if (nameCheck.rows && nameCheck.rows.length > 0) {
          return res.status(400).json({ error: "Username already taken. Please choose another." });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const orgIdToAssign = (req.body.organizationId as string) || 'org-habari';

        // Domain Whitelist, Quota, and Suspension Check for target organization
        try {
          const orgRes = await connection.execute(
            `SELECT id, name, status, statusReason, allowedDomains, maxUsers FROM organizations WHERE id = :id`,
            [orgIdToAssign],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
          );
          if (orgRes.rows && orgRes.rows.length > 0) {
            const targetOrg: any = toCamelCase(orgRes.rows[0]);
            const oStatus = (targetOrg.status || 'active').toLowerCase();
            if (oStatus === 'suspended' || oStatus === 'terminated' || oStatus === 'deleted') {
              return res.status(403).json({
                error: `Registration Denied: Organization '${targetOrg.name}' is currently ${oStatus.toUpperCase()}. New user registrations are restricted.`
              });
            }

            // Domain Whitelist
            if (targetOrg.allowedDomains && targetOrg.allowedDomains.trim()) {
              const emailDomain = trimmedEmail.split('@')[1];
              const allowed = targetOrg.allowedDomains.split(',').map((d: string) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
              if (allowed.length > 0 && !allowed.includes(emailDomain)) {
                return res.status(400).json({
                  error: `Email domain '@${emailDomain}' is not permitted for organization '${targetOrg.name}'. Allowed domains: ${allowed.map((d: string) => '@' + d).join(', ')}`
                });
              }
            }

            // User Seat Quota
            if (targetOrg.maxUsers && targetOrg.maxUsers > 0) {
              const uCountRes = await connection.execute(
                `SELECT COUNT(*) AS CNT FROM users WHERE organizationId = :orgId AND status = 'active'`,
                [orgIdToAssign],
                { outFormat: oracledb.OUT_FORMAT_OBJECT }
              );
              const activeSeats = (uCountRes.rows?.[0] as any)?.CNT || 0;
              if (activeSeats >= targetOrg.maxUsers) {
                return res.status(400).json({
                  error: `User seat quota reached for organization '${targetOrg.name}' (${activeSeats}/${targetOrg.maxUsers} seats allocated). Please contact your platform administrator.`
                });
              }
            }
          }
        } catch (checkErr) {
          logger.error("Error validating organization quotas during registration", { err: checkErr });
        }

        const newUser = {
          id: crypto.randomUUID(),
          email: trimmedEmail,
          password: hashedPassword,
          displayName,
          // Self-registered accounts always start as pending viewers; an admin approves them.
          // (The first platform owner is created from BOOTSTRAP_ADMIN_* env vars, see src/db.ts.)
          role: 'viewer',
          status: 'pending',
          photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=800020&color=fff`,
          organizationId: orgIdToAssign
        };

        await connection.execute(
          `INSERT INTO users (id, email, password, role, displayName, photoURL, status, organizationId) 
           VALUES (:id, :email, :password, :role, :displayName, :photoURL, :status, :organizationId)`,
          newUser
        );
        await connection.commit();

        logAction(req, 'REGISTER', 'auth', newUser.id, `User ${newUser.email} registered as ${newUser.role}`, {
          userId: newUser.id,
          userEmail: newUser.email,
          userName: newUser.displayName,
          organizationId: newUser.organizationId || null
        });
        // No session token: the account is pending until an admin approves it.
        const { password: _, ...userWithoutPassword } = newUser;
        res.json(userWithoutPassword);
      } catch (err: any) {
        logger.error('Registration Error', { err: err });
        let errorMessage = "Registration failed";
        if (err.errorNum === 1017) {
          errorMessage = "Database connection failed: Invalid credentials.";
        } else if (err.errorNum === 28000) {
          errorMessage = "Database account is locked. Please unlock it in the Oracle Cloud console.";
        }
        res.status(500).json({ error: errorMessage });
      } finally {
        if (connection) await connection.close();
      }
    });

    app.post("/api/auth/login", authRateLimit(50, 10), validate(schemas.login), async (req, res) => {
      const { email, password } = req.body;
      const trimmedEmail = email?.trim().toLowerCase();

      let connection;
      try {
        connection = await getConnection();
        const result = await connection.execute(
          `SELECT id, email, password, role, displayName, photoURL, status, organizationId FROM users WHERE LOWER(email) = LOWER(:email)`,
          [trimmedEmail],
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const user = result.rows?.[0] as any;
        if (!user || !(await bcrypt.compare(password, user.PASSWORD || user.password))) {
          return res.status(401).json({ error: "Invalid credentials" });
        }

        if (user.STATUS !== 'active' && user.status !== 'active') {
          return res.status(403).json({ error: "Account pending approval. Please contact an administrator." });
        }

        logAction(req, 'LOGIN', 'auth', user.ID || user.id, `User ${user.EMAIL || user.email} logged in`, {
          userId: user.ID || user.id,
          userEmail: user.EMAIL || user.email,
          userName: user.DISPLAYNAME || user.displayName || user.EMAIL || user.email,
          organizationId: user.ORGANIZATIONID || user.organizationId || null
        });

        // Update lastLogin timestamp in database
        const nowIso = new Date().toISOString();
        try {
          await connection.execute(
            `UPDATE users SET lastLogin = :now WHERE id = :id`,
            { now: nowIso, id: user.ID || user.id }
          );
          await connection.commit();
        } catch (uErr) {
          logger.error('Failed to update lastLogin', { err: uErr });
        }

        const userCamel = toCamelCase(user);
        userCamel.lastLogin = nowIso;
        userCamel.organizationId = user.ORGANIZATIONID || user.organizationId || null;

        // Attach organization details if user has an assigned organization
        if (userCamel.organizationId) {
          try {
            const orgRes = await connection.execute(
              `SELECT id, name, code, appName, primaryColor, licenseTier, status, statusReason, maxUsers, maxPasses, maxEmployees, allowedDomains FROM organizations WHERE id = :id`,
              [userCamel.organizationId],
              { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );
            if (orgRes.rows && orgRes.rows.length > 0) {
              userCamel.organization = toCamelCase(orgRes.rows[0]);

              // Power Admin override check
              const isPowerAdminUser = userCamel.role === 'power_admin';
              const orgStatus = (userCamel.organization.status || 'active').toLowerCase();

              if (!isPowerAdminUser && (orgStatus === 'suspended' || orgStatus === 'terminated' || orgStatus === 'deleted')) {
                return res.status(403).json({
                  error: `Access Denied: Your organization account (${userCamel.organization.name}) is ${orgStatus.toUpperCase()}. ${userCamel.organization.statusReason ? 'Reason: ' + userCamel.organization.statusReason + '. ' : ''}Please contact platform administration.`,
                  code: "ORG_SUSPENDED",
                  orgStatus
                });
              }
            }
          } catch (orgErr) {
            logger.error("Failed to fetch organization for logged in user", { err: orgErr });
          }
        }

        const { password: _, ...userWithoutPassword } = userCamel;
      setSessionCookie(res, signSessionToken({ id: userCamel.id, email: userCamel.email, role: userCamel.role, organizationId: userCamel.organizationId }));
      res.json(userWithoutPassword);
      } catch (err: any) {
        logger.error('Login Error', { err: err });
        let errorMessage = "Login failed";
        if (err.errorNum === 1017) {
          errorMessage = "Database connection failed: Invalid credentials.";
        } else if (err.errorNum === 28000) {
          errorMessage = "Database account is locked. Please unlock it in the Oracle Cloud console.";
        }
        res.status(500).json({ error: errorMessage });
      } finally {
        if (connection) await connection.close();
      }
    });

    app.get("/api/auth/me", authorize([]), async (req, res) => {
      let connection;
      try {
        connection = await getConnection();
        const userId = req.headers['x-user-id'] as string;
        const userRes = await connection.execute(
          `SELECT * FROM users WHERE UPPER(id) = UPPER(:id) OR UPPER(email) = UPPER(:email)`,
          { id: userId, email: req.headers['x-user-email'] as string },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        if (!userRes.rows || userRes.rows.length === 0) {
          return res.status(404).json({ error: "User profile not found" });
        }
        const user = userRes.rows[0] as any;
        const userCamel = toCamelCase(user);
        userCamel.organizationId = user.ORGANIZATIONID || user.organizationId || null;

        if (userCamel.organizationId) {
          try {
            const orgRes = await connection.execute(
              `SELECT id, name, code, appName, primaryColor, licenseTier, status, statusReason, maxUsers, maxPasses, maxEmployees, allowedDomains FROM organizations WHERE id = :id`,
              [userCamel.organizationId],
              { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );
            if (orgRes.rows && orgRes.rows.length > 0) {
              userCamel.organization = toCamelCase(orgRes.rows[0]);
            }
          } catch (orgErr) {
            logger.error("Failed to fetch organization for current user", { err: orgErr });
          }
        }
        const { password: _, ...userWithoutPassword } = userCamel;
        res.json(userWithoutPassword);
      } catch (err) {
        logger.error("Error in /api/auth/me", { err: err });
        res.status(500).json({ error: "Failed to fetch user profile" });
      } finally {
        if (connection) await connection.close();
      }
    });

  async function sendResetPasswordEmail(toEmail: string, toName: string, rawToken: string) {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      debugLog('BREVO_API_KEY not set; skipping password reset email send.');
      return;
    }
    const fromEmail = process.env.BREVO_SENDER_EMAIL || 'no-reply@example.com';
    const fromName = process.env.BREVO_SENDER_NAME || 'AccessOne';
    try {
      const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': apiKey,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: fromName, email: fromEmail },
          to: [{ email: toEmail, name: toName || 'there' }],
          subject: 'Your AccessOne password reset code',
          htmlContent: `<p>Hi ${toName || 'there'},</p><p>Your password reset code is:</p><h2 style="letter-spacing:2px;">${rawToken}</h2><p>This code expires in 15 minutes. If you did not request this, you can safely ignore this email.</p>`
        })
      });
      if (!resp.ok) {
        const errText = await resp.text();
        debugLog(`Brevo email send failed: ${resp.status} ${errText}`);
      }
    } catch (e: any) {
      debugLog(`Brevo email send error: ${e?.message || e}`);
    }
  }

  app.post("/api/auth/forgot-password", authRateLimit(20, 5), validate(schemas.forgotPassword), async (req, res) => {
    const { email } = req.body;
    const trimmedEmail = (email || '').trim().toLowerCase();
    let connection;
    try {
      connection = await getConnection();
      const result = await connection.execute(
        `SELECT id, displayName FROM users WHERE email = :email`,
        [trimmedEmail],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const user = result.rows?.[0] as any;
      if (user) {
        const rawToken = crypto.randomBytes(6).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await connection.execute(
          `UPDATE users SET resetTokenHash = :hash, resetTokenExpiry = :expiry WHERE email = :email`,
          [tokenHash, expiry, trimmedEmail]
        );
        await connection.commit();
        await sendResetPasswordEmail(trimmedEmail, user.DISPLAYNAME || user.displayName, rawToken);
      }
      // Always return the same generic response so this endpoint can't be used to enumerate registered emails.
      res.json({ message: "If an account with that email exists, a password reset code has been sent." });
    } catch (err: any) {
      logger.error('Forgot Password Error', { err: err });
      res.status(500).json({ error: "Failed to process password reset request" });
    } finally {
      if (connection) await connection.close();
    }
  });

  app.post("/api/auth/reset-password", authRateLimit(20, 10), validate(schemas.resetPassword), async (req, res) => {
    const { email, token, newPassword } = req.body;
    const trimmedEmail = email?.trim().toLowerCase();

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Reset code and new password are required." });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    let connection;
    try {
      connection = await getConnection();
      const result = await connection.execute(
        `SELECT id, resetTokenHash, resetTokenExpiry FROM users WHERE email = :email`,
        [trimmedEmail],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      const user = result.rows?.[0] as any;
      if (!user) {
        return res.status(400).json({ error: "Invalid or expired reset code." });
      }

      const storedHash = user.RESETTOKENHASH || user.resetTokenHash;
      const expiry = user.RESETTOKENEXPIRY || user.resetTokenExpiry;
      const providedHash = crypto.createHash('sha256').update(token).digest('hex');

      const hashBuf = Buffer.from(providedHash);
      const storedBuf = Buffer.from(storedHash || '');
      const validHash = !!storedHash && hashBuf.length === storedBuf.length && crypto.timingSafeEqual(hashBuf, storedBuf);
      const validExpiry = !!expiry && Date.now() < new Date(expiry).getTime();

      if (!validHash || !validExpiry) {
        return res.status(400).json({ error: "Invalid or expired reset code." });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await connection.execute(
        `UPDATE users SET password = :password, resetTokenHash = NULL, resetTokenExpiry = NULL WHERE email = :email`,
        [hashedPassword, trimmedEmail]
      );
      await connection.commit();

      logAction(req, 'RESET_PASSWORD', 'auth', user.ID || user.id, `Password reset for ${trimmedEmail}`, {
        userId: user.ID || user.id,
        userEmail: user.EMAIL || user.email,
        userName: user.DISPLAYNAME || user.displayName || user.EMAIL || user.email,
        organizationId: user.ORGANIZATIONID || user.organizationId || null
      });
      res.json({ message: "Password reset successfully" });
    } catch (err: any) {
      logger.error('Reset Password Error', { err: err });
      res.status(500).json({ error: "Failed to reset password" });
    } finally {
      if (connection) await connection.close();
    }
  });


    app.get("/api/auth/check-availability", async (req, res) => {
      const { email, displayName } = req.query;
      let connection;
      try {
        connection = await getConnection();
        if (email) {
          const result = await connection.execute(`SELECT id FROM users WHERE email = :email`, [email.toString().toLowerCase()]);
          return res.json({ available: result.rows?.length === 0 });
        }
        if (displayName) {
          const result = await connection.execute(`SELECT id FROM users WHERE displayName = :displayName AND deletedAt IS NULL`, [displayName.toString()]);
          return res.json({ available: result.rows?.length === 0 });
        }
        res.status(400).json({ error: "Missing parameters" });
      } catch (err) {
        logger.error('Unhandled error', { err: err });
        res.status(500).json({ error: "Check failed" });
      } finally {
        if (connection) await connection.close();
      }
    });

}
