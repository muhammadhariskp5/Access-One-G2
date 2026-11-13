import oracledb from 'oracledb';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import initSqlJs from 'sql.js';
import { logger } from './server/log.ts';

dotenv.config();

let activeEngine: 'oracle' | 'sqlite' = 'sqlite';
export function getDbEngine() {
  return activeEngine;
}

let sqliteDbInstance: any = null;
// SQLITE_PATH lets tests use their own throwaway database file.
const sqliteDbPath = process.env.SQLITE_PATH || path.join(process.cwd(), 'local_accessone.sqlite');

function persistDb() {
  if (!sqliteDbInstance) return;
  try {
    // Atomic save: write a temp file, then rename over the real one, so a crash or kill
    // mid-write can never leave a truncated database file.
    const data = sqliteDbInstance.export();
    const tmpPath = `${sqliteDbPath}.tmp`;
    fs.writeFileSync(tmpPath, Buffer.from(data));
    fs.renameSync(tmpPath, sqliteDbPath);
  } catch (err) {
    logger.error('Failed to persist SQLite DB', { err: err });
  }
}

let persistDebounceTimer: any = null;
function queuePersist() {
  if (persistDebounceTimer) clearTimeout(persistDebounceTimer);
  persistDebounceTimer = setTimeout(persistDb, 150);
}

function syncSchemaCache() {
  if (!sqliteDbInstance) return;
  try {
    const tablesRes = sqliteDbInstance.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'user_tab%'");
    if (tablesRes && tablesRes[0]) {
      for (const row of tablesRes[0].values) {
        const tName = String(row[0]).toUpperCase();
        sqliteDbInstance.run("INSERT OR IGNORE INTO user_tables_cache (table_name) VALUES (?)", [tName]);
        const colsRes = sqliteDbInstance.exec(`PRAGMA table_info("${row[0]}")`);
        if (colsRes && colsRes[0]) {
          for (const colRow of colsRes[0].values) {
            const cName = String(colRow[1]).toUpperCase();
            sqliteDbInstance.run("INSERT OR IGNORE INTO user_tab_cols_cache (table_name, column_name) VALUES (?, ?)", [tName, cName]);
          }
        }
      }
    }
  } catch (e) {
    // ignore
  }
}

function adaptSql(sql: string): string {
  let s = sql.trim();
  // user_tables and user_tab_cols compatibility
  s = s.replace(/\buser_tables\b/gi, 'user_tables_cache');
  s = s.replace(/\buser_tab_cols\b/gi, 'user_tab_cols_cache');
  // Oracle types
  s = s.replace(/\bVARCHAR2\s*\(\s*\d+\s*\)/gi, 'TEXT');
  s = s.replace(/\bCLOB\b/gi, 'TEXT');
  s = s.replace(/\bNUMBER\s*\(\s*1\s*\)/gi, 'INTEGER');
  s = s.replace(/\bNUMBER\s*\(\s*\d+\s*\)/gi, 'NUMERIC');
  s = s.replace(/\bNUMBER\b/gi, 'NUMERIC');
  // Oracle FETCH FIRST
  s = s.replace(/FETCH\s+FIRST\s+(\d+)\s+ROWS\s+ONLY/gi, 'LIMIT $1');
  // Oracle ALTER TABLE tbl ADD (colDef)
  s = s.replace(/ALTER\s+TABLE\s+(\w+)\s+ADD\s*\(([\s\S]+)\)\s*$/i, (m, tbl, colDef) => {
    let cleanDef = colDef
      .replace(/VARCHAR2\s*\(\s*\d+\s*\)/gi, 'TEXT')
      .replace(/NUMBER\s*\(\s*1\s*\)/gi, 'INTEGER')
      .replace(/NUMBER\s*\(\s*\d+\s*\)/gi, 'NUMERIC')
      .replace(/CLOB/gi, 'TEXT');
    return `ALTER TABLE ${tbl} ADD COLUMN ${cleanDef}`;
  });
  // Handle UPDATE passes p1 SET p1.status = ...
  s = s.replace(/UPDATE\s+(\w+)\s+\w+\s+SET\s+([^\s=]+)\./gi, 'UPDATE $1 SET ');
  s = s.replace(/,\s*[a-zA-Z0-9_]+\.([a-zA-Z0-9_]+)\s*=/g, ', $1 =');
  return s;
}

export async function getSqliteConnection() {
  if (!sqliteDbInstance) {
    const SQL = await initSqlJs();
    if (fs.existsSync(sqliteDbPath)) {
      try {
        const filebuffer = fs.readFileSync(sqliteDbPath);
        sqliteDbInstance = new SQL.Database(filebuffer);
      } catch (err) {
        sqliteDbInstance = new SQL.Database();
      }
    } else {
      sqliteDbInstance = new SQL.Database();
    }
    sqliteDbInstance.run(`
      CREATE TABLE IF NOT EXISTS user_tables_cache (table_name TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS user_tab_cols_cache (table_name TEXT, column_name TEXT, PRIMARY KEY (table_name, column_name));
    `);
    syncSchemaCache();

    process.on('beforeExit', persistDb);
    // SIGINT/SIGTERM are handled by the server's graceful shutdown, which calls closeDatabase().
  }

  return {
    async execute(sql: any, binds?: any, options?: any) {
      if (typeof sql !== 'string') {
        sql = String(sql);
      }
      let adapted = adaptSql(sql);
      const isCreateOrAlter = /^\s*(CREATE|ALTER|DROP)\b/i.test(adapted);
      const isSelect = /^\s*(SELECT|PRAGMA|WITH)\b/i.test(adapted);

      let resultRows: any[] = [];
      let rowsAffected = 0;

      if (isSelect) {
        let stmt: any;
        try {
          if (Array.isArray(binds)) {
            const paramSql = adapted.replace(/:([a-zA-Z0-9_]+)/g, () => `?`);
            stmt = sqliteDbInstance.prepare(paramSql);
            stmt.bind(binds.map(sanitizeBindValue));
          } else if (binds && typeof binds === 'object') {
            const namedBinds: any = {};
            for (const [k, v] of Object.entries(binds)) {
              namedBinds[k.startsWith(':') ? k : `:${k}`] = sanitizeBindValue(v);
            }
            stmt = sqliteDbInstance.prepare(adapted);
            stmt.bind(namedBinds);
          } else {
            stmt = sqliteDbInstance.prepare(adapted);
          }

          while (stmt.step()) {
            const rawObj = stmt.getAsObject();
            const upperObj: any = {};
            for (const [k, v] of Object.entries(rawObj)) {
              upperObj[k.toUpperCase()] = v;
              upperObj[k] = v;
            }
            resultRows.push(upperObj);
          }
          stmt.free();
        } catch (err: any) {
          if (stmt) try { stmt.free(); } catch (_) {}
          throw err;
        }
      } else {
        try {
          if (Array.isArray(binds)) {
            const paramSql = adapted.replace(/:([a-zA-Z0-9_]+)/g, () => `?`);
            sqliteDbInstance.run(paramSql, binds.map(sanitizeBindValue));
          } else if (binds && typeof binds === 'object') {
            const namedBinds: any = {};
            for (const [k, v] of Object.entries(binds)) {
              namedBinds[k.startsWith(':') ? k : `:${k}`] = sanitizeBindValue(v);
            }
            sqliteDbInstance.run(adapted, namedBinds);
          } else {
            sqliteDbInstance.run(adapted);
          }
          rowsAffected = sqliteDbInstance.getRowsModified();
          if (isCreateOrAlter) {
            syncSchemaCache();
          }
          queuePersist();
        } catch (err: any) {
          throw err;
        }
      }

      return {
        rows: resultRows,
        rowsAffected
      };
    },
    async executeMany(sql: any, bindsArray: any[], options?: any) {
      let totalModified = 0;
      if (Array.isArray(bindsArray)) {
        for (const item of bindsArray) {
          const res = await this.execute(sql, item, options);
          totalModified += res.rowsAffected || 0;
        }
      }
      return { rowsAffected: totalModified };
    },
    async commit() {
      persistDb();
    },
    async rollback() {
      // autocommit
    },
    async close() {
      persistDb();
    }
  };
}

const defaultWalletPath = path.join(process.cwd(), 'wallet');
let resolvedWalletPath = defaultWalletPath;

// Detect wallet directory: prioritize local ./wallet if it contains wallet files, otherwise check TNS_ADMIN
const localHasWallet = fs.existsSync(path.join(defaultWalletPath, 'cwallet.sso')) ||
                       fs.existsSync(path.join(defaultWalletPath, 'ewallet.pem')) ||
                       fs.existsSync(path.join(defaultWalletPath, 'tnsnames.ora'));

if (localHasWallet) {
  resolvedWalletPath = defaultWalletPath;
} else if (process.env.TNS_ADMIN) {
  const customTns = process.env.TNS_ADMIN.trim().replace(/^[\"']+|[\"']+$/g, '');
  const candidate = customTns.endsWith('.sso') || customTns.endsWith('.ora') ? path.dirname(customTns) : customTns;
  if (fs.existsSync(candidate)) {
    resolvedWalletPath = candidate;
  }
}
process.env.TNS_ADMIN = resolvedWalletPath;

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB]; // Handle CLOBs as strings
oracledb.fetchTypeHandler = function(columnMetadata) {
  if (columnMetadata.dbType === oracledb.DB_TYPE_CLOB) {
    return { type: oracledb.STRING };
  }
};

// Use alias from tnsnames.ora or full connection string
const rawConnectString = process.env.ORACLE_CONNECTION_STRING || 'accessonedev_low';
let cleanedConnectString = rawConnectString.trim().replace(/^[\"']+|[\"']+$/g, '');
// If connection string contains the full description with accessonedev_low, use accessonedev_low alias from tnsnames.ora
if (cleanedConnectString.includes('accessonedev_low')) {
  cleanedConnectString = 'accessonedev_low';
}

const dbConfig: oracledb.PoolAttributes = {
  connectString: cleanedConnectString,
  // Credentials come only from the environment (.env on the server). No defaults in code.
  user: process.env.ORACLE_USER || 'ACCESSONE_APP',
  password: process.env.ORACLE_PASSWORD || '',
  walletLocation: resolvedWalletPath,
  walletPassword: process.env.ORACLE_WALLET_PASSWORD || '',
  poolMin: 2,
  poolMax: 10,
  poolIncrement: 1,
  poolTimeout: 60,
  queueTimeout: 60000,
};

let pool: oracledb.Pool | null = null;

export function sanitizeBindValue(val: any): any {
  if (val === undefined) {
    return null;
  }
  if (val !== null && typeof val === 'object' && !(val instanceof Date) && !(val instanceof Buffer)) {
    if ('val' in val || 'dir' in val || 'type' in val || 'maxSize' in val) {
      return val;
    }
    try {
      return JSON.stringify(val);
    } catch (e) {
      return String(val);
    }
  }
  return val;
}

export function sanitizeBinds(binds: any): any {
  if (!binds) return binds;
  if (Array.isArray(binds)) {
    return binds.map(sanitizeBindValue);
  }
  if (typeof binds === 'object') {
    const cleaned: any = {};
    for (const key of Object.keys(binds)) {
      cleaned[key] = sanitizeBindValue(binds[key]);
    }
    return cleaned;
  }
  return binds;
}

// Graceful shutdown: flush the SQLite file / drain the Oracle pool.
export async function closeDatabase() {
  if (persistDebounceTimer) { clearTimeout(persistDebounceTimer); persistDebounceTimer = null; }
  persistDb();
  if (pool) {
    try { await pool.close(10); } catch (err) { logger.error('[DB] pool close failed', { err: err }); }
    pool = null;
  }
}

export async function getConnection() {
  const hasWalletFiles = fs.existsSync(path.join(resolvedWalletPath, 'cwallet.sso')) || 
                         fs.existsSync(path.join(resolvedWalletPath, 'ewallet.pem')) ||
                         fs.existsSync(path.join(resolvedWalletPath, 'tnsnames.ora'));

  // If wallet files are provided, connect directly to Oracle Autonomous Database
  if (hasWalletFiles) {
    try {
      if (!pool) {
        if (!process.env.ORACLE_PASSWORD) {
          throw new Error('ORACLE_PASSWORD is not set. Add ORACLE_PASSWORD (and ORACLE_WALLET_PASSWORD if the wallet is encrypted) to .env.');
        }
        pool = await oracledb.createPool(dbConfig);
        logger.info('[DB] Oracle Autonomous Database connection pool created successfully.');
      }
      const conn = await pool.getConnection();
      activeEngine = 'oracle';
      const originalExecute = conn.execute.bind(conn);
      conn.execute = function(sql: any, binds?: any, options?: any) {
        const cleanedBinds = sanitizeBinds(binds);
        if (options !== undefined) {
          return originalExecute(sql, cleanedBinds, options);
        }
        if (binds !== undefined) {
          return originalExecute(sql, cleanedBinds);
        }
        return originalExecute(sql);
      };
      return conn;
    } catch (err: any) {
      logger.error('[DB] Failed connecting to Oracle Autonomous Database', { err: err });
      throw err;
    }
  }

  // Production must never silently run on a blank local file: refuse instead of falling back.
  // (ALLOW_SQLITE=true is only for deliberate local smoke tests of a production build.)
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SQLITE !== 'true') {
    throw new Error(`Oracle wallet not found in ${resolvedWalletPath} (need cwallet.sso / ewallet.pem / tnsnames.ora). Refusing to fall back to SQLite in production.`);
  }

  // Development / tests only: local SQLite file when no wallet is present
  activeEngine = 'sqlite';
  return await getSqliteConnection();
}

export async function initializeDatabase() {
  let connection;
  try {
    connection = await getConnection();
    logger.info('Database connection successful.');

    // Create tables if they don't exist
    // Note: Oracle doesn't have "CREATE TABLE IF NOT EXISTS"
    // We'll use a helper to check and create
    
    const tables = [
      `CREATE TABLE users (
        id VARCHAR2(50) PRIMARY KEY,
        email VARCHAR2(255) UNIQUE NOT NULL,
        password VARCHAR2(255) NOT NULL,
        role VARCHAR2(50) NOT NULL,
        displayName VARCHAR2(255),
        photoURL VARCHAR2(1000),
        status VARCHAR2(50) DEFAULT 'pending'
      )`,
      `CREATE TABLE employees (
        id VARCHAR2(50) PRIMARY KEY,
        firstName VARCHAR2(255),
        lastName VARCHAR2(255),
        firstNameAlt VARCHAR2(255),
        lastNameAlt VARCHAR2(255),
        passportNumber VARCHAR2(255),
        passportExpiry VARCHAR2(50),
        visaNumber VARCHAR2(255),
        visaExpiry VARCHAR2(50),
        qatarId VARCHAR2(255),
        employeeType VARCHAR2(50),
        sponsorName VARCHAR2(255),
        division VARCHAR2(255),
        department VARCHAR2(255),
        project VARCHAR2(255),
        jobTitle VARCHAR2(255),
        mobileNumber VARCHAR2(50),
        email VARCHAR2(255),
        employeeId VARCHAR2(50),
        name VARCHAR2(255),
        status VARCHAR2(50) DEFAULT 'active'
      )`,
      `CREATE TABLE locations (
        id VARCHAR2(50) PRIMARY KEY,
        name VARCHAR2(255) NOT NULL,
        code VARCHAR2(50),
        description VARCHAR2(1000),
        categoryId VARCHAR2(50),
        status VARCHAR2(50) DEFAULT 'active'
      )`,
      `CREATE TABLE categories (
        id VARCHAR2(50) PRIMARY KEY,
        name VARCHAR2(255) NOT NULL,
        organizationId VARCHAR2(50)
      )`,
      `CREATE TABLE passRequests (
        id VARCHAR2(50) PRIMARY KEY,
        requesterId VARCHAR2(50),
        approverId VARCHAR2(50),
        locationId VARCHAR2(50),
        purpose VARCHAR2(1000),
        startDate VARCHAR2(50),
        endDate VARCHAR2(50),
        status VARCHAR2(50) DEFAULT 'pending',
        createdAt VARCHAR2(50),
        updatedAt VARCHAR2(50),
        employeeIds CLOB, -- JSON array of IDs (Legacy - will transition to mapping table)
        employeeStatuses CLOB, -- JSON object of statuses
        authorityAppNumber VARCHAR2(255),
        parentPassId VARCHAR2(50),
        forwardedToId VARCHAR2(50),
        temporaryNames CLOB, -- JSON array of names
        individualExpiries CLOB, -- JSON object of expiries
        individualStartDates CLOB, -- JSON object of start dates
        accessCodes CLOB, -- JSON array of codes (Legacy - will transition to mapping table)
        remarks VARCHAR2(1000), -- User comments (New)
        approvalRemarks VARCHAR2(1000), -- Approver comments (New)
        projectId VARCHAR2(50),
        contractNumber VARCHAR2(255),
        contractName VARCHAR2(255),
        contractTitle VARCHAR2(255),
        expiryDate VARCHAR2(50),
        clientCompany VARCHAR2(255),
        clientApprovers VARCHAR2(2000)
      )`,
      `CREATE TABLE passRequestEmployees (
        id VARCHAR2(50) PRIMARY KEY,
        requestId VARCHAR2(50) NOT NULL,
        employeeId VARCHAR2(50) NOT NULL,
        status VARCHAR2(50) DEFAULT 'pending',
        expiryDate VARCHAR2(50)
      )`,
      `CREATE TABLE passRequestAccessCodes (
        id VARCHAR2(50) PRIMARY KEY,
        requestId VARCHAR2(50) NOT NULL,
        accessCodeId VARCHAR2(50) NOT NULL
      )`,
      `CREATE TABLE passAccessCodes (
        id VARCHAR2(50) PRIMARY KEY,
        passId VARCHAR2(50) NOT NULL,
        accessCodeId VARCHAR2(50) NOT NULL
      )`,
      `CREATE TABLE requestHistory (
        id VARCHAR2(50) PRIMARY KEY,
        requestId VARCHAR2(50) NOT NULL,
        userId VARCHAR2(50) NOT NULL,
        action VARCHAR2(50) NOT NULL,
        remarks VARCHAR2(1000),
        timestamp VARCHAR2(50) NOT NULL
      )`,
      `CREATE TABLE passes (
        id VARCHAR2(50) PRIMARY KEY,
        requestId VARCHAR2(50),
        employeeId VARCHAR2(50),
        locationId VARCHAR2(50),
        type VARCHAR2(50) DEFAULT 'main',
        status VARCHAR2(50) DEFAULT 'pending',
        startDate VARCHAR2(50),
        expiryDate VARCHAR2(50),
        endDate VARCHAR2(50),
        parentPassId VARCHAR2(50),
        passNumber VARCHAR2(100),
        cardNumber VARCHAR2(100),
        accessCodes CLOB, -- JSON array of codes
        authorityAppNumber VARCHAR2(255),
        remarks VARCHAR2(1000),
        handoverBy VARCHAR2(255),
        createdAt VARCHAR2(50),
        updatedAt VARCHAR2(50),
        projectId VARCHAR2(50),
        contractNumber VARCHAR2(255),
        contractName VARCHAR2(255),
        contractTitle VARCHAR2(255),
        clientCompany VARCHAR2(255),
        clientApprovers VARCHAR2(2000)
      )`,
      `CREATE TABLE accessCodes (
        id VARCHAR2(50) PRIMARY KEY,
        areaCode VARCHAR2(50),
        accessArea VARCHAR2(255),
        description VARCHAR2(1000),
        locationId VARCHAR2(50),
        status VARCHAR2(50) DEFAULT 'active',
        organizationId VARCHAR2(50)
      )`,
      `CREATE TABLE auditLogs (
        id VARCHAR2(50) PRIMARY KEY,
        userId VARCHAR2(50),
        userEmail VARCHAR2(255),
        userName VARCHAR2(255),
        action VARCHAR2(255),
        entityType VARCHAR2(255),
        entityId VARCHAR2(50),
        details VARCHAR2(4000),
        timestamp VARCHAR2(50),
        organizationId VARCHAR2(50)
      )`,
      `CREATE TABLE auditLogs_archive (
        id VARCHAR2(50) PRIMARY KEY,
        userId VARCHAR2(50),
        userEmail VARCHAR2(255),
        userName VARCHAR2(255),
        action VARCHAR2(255),
        entityType VARCHAR2(255),
        entityId VARCHAR2(50),
        details VARCHAR2(4000),
        timestamp VARCHAR2(50),
        organizationId VARCHAR2(50)
      )`,
      `CREATE TABLE companySettings (
        id VARCHAR2(50) PRIMARY KEY,
        appName VARCHAR2(255),
        appLogoUrl VARCHAR2(1000),
        companyName VARCHAR2(255),
        companyLogoUrl VARCHAR2(1000),
        address VARCHAR2(255),
        contactEmail VARCHAR2(255),
        primaryColor VARCHAR2(50),
        poweredBy VARCHAR2(255),
        licenseKey VARCHAR2(255),
        licenseTier VARCHAR2(50) DEFAULT 'Enterprise',
        licenseExpiry VARCHAR2(50),
        orgCode VARCHAR2(50)
      )`,
      `CREATE TABLE organizations (
        id VARCHAR2(50) PRIMARY KEY,
        name VARCHAR2(255) NOT NULL,
        code VARCHAR2(50),
        appName VARCHAR2(255),
        appLogoUrl VARCHAR2(1000),
        companyLogoUrl VARCHAR2(1000),
        address VARCHAR2(255),
        contactEmail VARCHAR2(255),
        primaryColor VARCHAR2(50),
        poweredBy VARCHAR2(255),
        licenseKey VARCHAR2(255),
        licenseTier VARCHAR2(50) DEFAULT 'Enterprise',
        licenseExpiry VARCHAR2(50),
        status VARCHAR2(50) DEFAULT 'active',
        isCurrent NUMBER(1) DEFAULT 0,
        createdAt VARCHAR2(50),
        updatedAt VARCHAR2(50)
      )`,
      `CREATE TABLE divisions (
        id VARCHAR2(50) PRIMARY KEY,
        name VARCHAR2(255) NOT NULL,
        status VARCHAR2(50) DEFAULT 'active'
      )`,
      `CREATE TABLE projects (
        id VARCHAR2(50) PRIMARY KEY,
        name VARCHAR2(255) NOT NULL,
        contractNumber VARCHAR2(255),
        clientCompany VARCHAR2(255),
        clientApprovers VARCHAR2(2000),
        endDate VARCHAR2(50),
        status VARCHAR2(50) DEFAULT 'active'
      )`,
      `CREATE TABLE departments (
        id VARCHAR2(50) PRIMARY KEY,
        name VARCHAR2(255) NOT NULL,
        status VARCHAR2(50) DEFAULT 'active'
      )`,

      `CREATE TABLE notifications (
        id VARCHAR2(50) PRIMARY KEY,
        userId VARCHAR2(50) NOT NULL,
        organizationId VARCHAR2(50),
        type VARCHAR2(50) NOT NULL,
        title VARCHAR2(255) NOT NULL,
        message VARCHAR2(1000),
        entityType VARCHAR2(50),
        entityId VARCHAR2(50),
        link VARCHAR2(255),
        priority VARCHAR2(50) DEFAULT 'normal',
        isRead NUMBER(1) DEFAULT 0,
        "TIMESTAMP" VARCHAR2(50)
      )`,
      // Ledger of one-time data migrations that have been applied (each runs exactly once).
      `CREATE TABLE schemaMigrations (
        id VARCHAR2(100) PRIMARY KEY,
        appliedAt VARCHAR2(50) NOT NULL
      )`,
      // Counters for sequential document numbers (one row per series, e.g. PASS-2026).
      `CREATE TABLE sequenceCounters (
        seqKey VARCHAR2(100) PRIMARY KEY,
        currentValue NUMBER NOT NULL
      )`,
      // Ledger of scheduled job runs; the primary key (job + business date) also acts as a run lock.
      `CREATE TABLE jobRuns (
        id VARCHAR2(150) PRIMARY KEY,
        startedAt VARCHAR2(50) NOT NULL,
        finishedAt VARCHAR2(50),
        status VARCHAR2(20) NOT NULL
      )`    ];

    for (const sql of tables) {
      try {
        const tableName = sql.match(/CREATE TABLE (\w+)/i)?.[1];
        if (!tableName) {
          logger.error('Could not extract table name from SQL', { err: sql });
          continue;
        }
        
        // Check if table exists
        const checkSql = `SELECT table_name FROM user_tables WHERE table_name = UPPER(:name)`;
        const result = await connection.execute(checkSql, [tableName]);
        
        if (result.rows && result.rows.length === 0) {
          logger.info(`Creating table ${tableName}...`);
          await connection.execute(sql);
          logger.info(`Table ${tableName} created successfully.`);
        } else {
          logger.info(`Table ${tableName} already exists.`);
        }
        if (tableName.toLowerCase() === 'users') {
            const userColumns = [
              { name: 'STATUS', type: "VARCHAR2(50) DEFAULT 'pending'" },
              { name: 'PHONE', type: "VARCHAR2(50)" },
              { name: 'JOBTITLE', type: "VARCHAR2(255)" },
              { name: 'DEPARTMENT', type: "VARCHAR2(255)" },
              { name: 'DIVISION', type: "VARCHAR2(255)" },
              { name: 'PROJECT', type: "VARCHAR2(255)" },
              { name: 'CREATEDAT', type: "VARCHAR2(50)" },
              { name: 'LASTLOGIN', type: "VARCHAR2(50)" },
              { name: 'PREFERENCES', type: "CLOB" },
              { name: 'ORGANIZATIONID', type: "VARCHAR2(50)" },

              { name: 'RESETTOKENHASH', type: "VARCHAR2(255)" },
              { name: 'RESETTOKENEXPIRY', type: "VARCHAR2(50)" }            ];
            for (const col of userColumns) {
              const colCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'USERS' AND column_name = '${col.name}'`;
              const colResult = await connection.execute(colCheckSql);
              if (colResult.rows && colResult.rows.length === 0) {
                await connection.execute(`ALTER TABLE users ADD (${col.name} ${col.type})`);
                logger.info(`Added ${col.name} column to users table.`);
              }
            }
          } else if (tableName.toLowerCase() === 'locations') {
            // Check if categoryId column exists in locations table
            const colCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'LOCATIONS' AND column_name = 'CATEGORYID'`;
            const colResult = await connection.execute(colCheckSql);
            if (colResult.rows && colResult.rows.length === 0) {
              await connection.execute(`ALTER TABLE locations ADD (categoryId VARCHAR2(50))`);
              logger.info('Added categoryId column to locations table.');
            }
            // Check if status column exists in locations table
            const statusColCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'LOCATIONS' AND column_name = 'STATUS'`;
            const statusColResult = await connection.execute(statusColCheckSql);
            if (statusColResult.rows && statusColResult.rows.length === 0) {
              await connection.execute(`ALTER TABLE locations ADD (status VARCHAR2(50) DEFAULT 'active')`);
              logger.info('Added status column to locations table.');
            }
            // Check if organizationId column exists in locations table
            const orgColCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'LOCATIONS' AND column_name = 'ORGANIZATIONID'`;
            const orgColResult = await connection.execute(orgColCheckSql);
            if (orgColResult.rows && orgColResult.rows.length === 0) {
              await connection.execute(`ALTER TABLE locations ADD (organizationId VARCHAR2(50))`);
              logger.info('Added organizationId column to locations table.');
            }
            // Global Port & Security Level
            const locCols = [
              { name: 'ISGLOBAL', type: 'NUMBER(1) DEFAULT 0' },
              { name: 'SECURITYLEVEL', type: "VARCHAR2(100) DEFAULT 'Level 1: General Access'" }
            ];
            for (const col of locCols) {
              const cCheck = await connection.execute(`SELECT column_name FROM user_tab_cols WHERE table_name = 'LOCATIONS' AND column_name = '${col.name}'`);
              if (cCheck.rows && cCheck.rows.length === 0) {
                await connection.execute(`ALTER TABLE locations ADD (${col.name} ${col.type})`);
                logger.info(`Added ${col.name} column to locations table.`);
              }
            }
          } else if (tableName.toLowerCase() === 'employees') {
            // Check if name column exists in employees table
            const colCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'EMPLOYEES' AND column_name = 'NAME'`;
            const colResult = await connection.execute(colCheckSql);
            if (colResult.rows && colResult.rows.length === 0) {
              await connection.execute(`ALTER TABLE employees ADD (name VARCHAR2(255))`);
              logger.info('Added name column to employees table.');
            }
            // Check if employeeId column exists in employees table
            const empIdCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'EMPLOYEES' AND column_name = 'EMPLOYEEID'`;
            const empIdResult = await connection.execute(empIdCheckSql);
            if (empIdResult.rows && empIdResult.rows.length === 0) {
              await connection.execute(`ALTER TABLE employees ADD (employeeId VARCHAR2(50))`);
              logger.info('Added employeeId column to employees table.');
            }

            // Ensure all other columns exist
            const allColumns = [
              { name: 'FIRSTNAMEALT', type: 'VARCHAR2(255)' },
              { name: 'LASTNAMEALT', type: 'VARCHAR2(255)' },
              { name: 'PASSPORTNUMBER', type: 'VARCHAR2(255)' },
              { name: 'PASSPORTEXPIRY', type: 'VARCHAR2(50)' },
              { name: 'VISANUMBER', type: 'VARCHAR2(255)' },
              { name: 'VISAEXPIRY', type: 'VARCHAR2(50)' },
              { name: 'QATARID', type: 'VARCHAR2(255)' },
              { name: 'EMPLOYEETYPE', type: 'VARCHAR2(50)' },
              { name: 'SPONSORNAME', type: 'VARCHAR2(255)' },
              { name: 'DIVISION', type: 'VARCHAR2(255)' },
              { name: 'DEPARTMENT', type: 'VARCHAR2(255)' },
              { name: 'PROJECT', type: 'VARCHAR2(255)' },
              { name: 'JOBTITLE', type: 'VARCHAR2(255)' },
              { name: 'MOBILENUMBER', type: 'VARCHAR2(50)' },
              { name: 'EMAIL', type: 'VARCHAR2(255)' },
              { name: 'QIDVISANUMBER', type: 'VARCHAR2(255)' },
              { name: 'QIDVISAEXPIRY', type: 'VARCHAR2(50)' },
              { name: 'SAFETYINDUCTIONDATE', type: 'VARCHAR2(50)' },
              { name: 'STATUS', type: "VARCHAR2(50) DEFAULT 'active'" },
              { name: 'ORGANIZATIONID', type: 'VARCHAR2(50)' }
            ];

            for (const col of allColumns) {
              const colCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'EMPLOYEES' AND column_name = '${col.name}'`;
              const colResult = await connection.execute(colCheckSql);
              if (colResult.rows && colResult.rows.length === 0) {
                await connection.execute(`ALTER TABLE employees ADD (${col.name} ${col.type})`);
                logger.info(`Added ${col.name} column to employees table.`);
              }
            }
          } else if (tableName.toLowerCase() === 'passrequests') {
            const columns = [
              { name: 'REQUESTERID', type: 'VARCHAR2(50)' },
              { name: 'APPROVERID', type: 'VARCHAR2(50)' },
              { name: 'LOCATIONID', type: 'VARCHAR2(50)' },
              { name: 'PURPOSE', type: 'VARCHAR2(1000)' },
              { name: 'STARTDATE', type: 'VARCHAR2(50)' },
              { name: 'ENDDATE', type: 'VARCHAR2(50)' },
              { name: 'STATUS', type: 'VARCHAR2(50) DEFAULT \'pending\'' },
              { name: 'CREATEDAT', type: 'VARCHAR2(50)' },
              { name: 'UPDATEDAT', type: 'VARCHAR2(50)' },
              { name: 'EMPLOYEEIDS', type: 'CLOB' },
              { name: 'EMPLOYEESTATUSES', type: 'CLOB' },
              { name: 'AUTHORITYAPPNUMBER', type: 'VARCHAR2(255)' },
              { name: 'PARENTPASSID', type: 'VARCHAR2(50)' },
              { name: 'FORWARDEDTOID', type: 'VARCHAR2(50)' },
              { name: 'TEMPORARYNAMES', type: 'CLOB' },
              { name: 'INDIVIDUALEXPIRIES', type: 'CLOB' },
              { name: 'INDIVIDUALSTARTDATES', type: 'CLOB' },
              { name: 'ACCESSCODES', type: 'CLOB' },
              { name: 'REMARKS', type: 'VARCHAR2(1000)' },
              { name: 'APPROVALREMARKS', type: 'VARCHAR2(1000)' },
              { name: 'PROJECTID', type: 'VARCHAR2(50)' },
              { name: 'CONTRACTNUMBER', type: 'VARCHAR2(255)' },
              { name: 'CONTRACTNAME', type: 'VARCHAR2(255)' },
              { name: 'CLIENTCOMPANY', type: 'VARCHAR2(255)' },
              { name: 'CLIENTAPPROVERS', type: 'VARCHAR2(2000)' },
              { name: 'ORGANIZATIONID', type: 'VARCHAR2(50)' },
              // Written by every application create; was missing here, so fresh databases failed.
              { name: 'TYPE', type: 'VARCHAR2(50) DEFAULT \'main\'' }
            ];
            for (const col of columns) {
              const colCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'PASSREQUESTS' AND column_name = '${col.name}'`;
              const colResult = await connection.execute(colCheckSql);
              if (colResult.rows && colResult.rows.length === 0) {
                await connection.execute(`ALTER TABLE passRequests ADD (${col.name} ${col.type})`);
                logger.info(`Added ${col.name} column to passRequests table.`);
              }
            }
          } else if (tableName.toLowerCase() === 'passes') {
            const columns = [
              { name: 'REQUESTID', type: 'VARCHAR2(50)' },
              { name: 'EMPLOYEEID', type: 'VARCHAR2(50)' },
              { name: 'LOCATIONID', type: 'VARCHAR2(50)' },
              { name: 'TYPE', type: 'VARCHAR2(50) DEFAULT \'main\'' },
              { name: 'STATUS', type: 'VARCHAR2(50) DEFAULT \'pending\'' },
              { name: 'STARTDATE', type: 'VARCHAR2(50)' },
              { name: 'EXPIRYDATE', type: 'VARCHAR2(50)' },
              { name: 'PARENTPASSID', type: 'VARCHAR2(50)' },
              { name: 'AUTHORITYAPPNUMBER', type: 'VARCHAR2(255)' },
              { name: 'PASSNUMBER', type: 'VARCHAR2(100)' },
              { name: 'ACCESSCODES', type: 'CLOB' },
              { name: 'REMARKS', type: 'VARCHAR2(1000)' },
              { name: 'HANDOVERBY', type: 'VARCHAR2(255)' },
              { name: 'CREATEDAT', type: 'VARCHAR2(50)' },
              { name: 'UPDATEDAT', type: 'VARCHAR2(50)' },
              { name: 'PROJECTID', type: 'VARCHAR2(50)' },
              { name: 'CONTRACTNUMBER', type: 'VARCHAR2(255)' },
              { name: 'CONTRACTNAME', type: 'VARCHAR2(255)' },
              { name: 'CLIENTCOMPANY', type: 'VARCHAR2(255)' },
              { name: 'CLIENTAPPROVERS', type: 'VARCHAR2(2000)' },
              { name: 'ORGANIZATIONID', type: 'VARCHAR2(50)' }
            ];
            for (const col of columns) {
              const colCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'PASSES' AND column_name = '${col.name}'`;
              const colResult = await connection.execute(colCheckSql);
              if (colResult.rows && colResult.rows.length === 0) {
                await connection.execute(`ALTER TABLE passes ADD (${col.name} ${col.type})`);
                logger.info(`Added ${col.name} column to passes table.`);
              }
            }
          } else if (tableName.toLowerCase() === 'projects') {
            const columns = [
              { name: 'ENDDATE', type: 'VARCHAR2(50)' },
              { name: 'CONTRACTNUMBER', type: 'VARCHAR2(255)' },
              { name: 'CLIENTCOMPANY', type: 'VARCHAR2(255)' },
              { name: 'CLIENTAPPROVERS', type: 'VARCHAR2(2000)' },
              { name: 'ORGANIZATIONID', type: 'VARCHAR2(50)' }
            ];
            for (const col of columns) {
              const colCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'PROJECTS' AND column_name = '${col.name}'`;
              const colResult = await connection.execute(colCheckSql);
              if (colResult.rows && colResult.rows.length === 0) {
                await connection.execute(`ALTER TABLE projects ADD (${col.name} ${col.type})`);
                logger.info(`Added ${col.name} column to projects table.`);
              }
            }
          } else if (tableName.toLowerCase() === 'divisions') {
            const colCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'DIVISIONS' AND column_name = 'ORGANIZATIONID'`;
            const colResult = await connection.execute(colCheckSql);
            if (colResult.rows && colResult.rows.length === 0) {
              await connection.execute(`ALTER TABLE divisions ADD (organizationId VARCHAR2(50))`);
              logger.info('Added organizationId column to divisions table.');
            }
          } else if (tableName.toLowerCase() === 'departments') {
            const colCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'DEPARTMENTS' AND column_name = 'ORGANIZATIONID'`;
            const colResult = await connection.execute(colCheckSql);
            if (colResult.rows && colResult.rows.length === 0) {
              await connection.execute(`ALTER TABLE departments ADD (organizationId VARCHAR2(50))`);
              logger.info('Added organizationId column to departments table.');
            }
          } else if (tableName.toLowerCase() === 'auditlogs' || tableName.toLowerCase() === 'auditlogs_archive') {
            const upperTbl = tableName.toUpperCase();
            const colCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = '${upperTbl}' AND column_name = 'ORGANIZATIONID'`;
            const colResult = await connection.execute(colCheckSql);
            if (colResult.rows && colResult.rows.length === 0) {
              await connection.execute(`ALTER TABLE ${tableName} ADD (organizationId VARCHAR2(50))`);
              logger.info(`Added organizationId column to ${tableName} table.`);
            }
          } else if (tableName.toLowerCase() === 'accesscodes') {
            // Check if status column exists in accessCodes table
            const colCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'ACCESSCODES' AND column_name = 'STATUS'`;
            const colResult = await connection.execute(colCheckSql);
            if (colResult.rows && colResult.rows.length === 0) {
              await connection.execute(`ALTER TABLE accessCodes ADD (status VARCHAR2(50) DEFAULT 'active')`);
              logger.info('Added status column to accessCodes table.');
            }
            const orgColCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'ACCESSCODES' AND column_name = 'ORGANIZATIONID'`;
            const orgColResult = await connection.execute(orgColCheckSql);
            if (orgColResult.rows && orgColResult.rows.length === 0) {
              await connection.execute(`ALTER TABLE accessCodes ADD (organizationId VARCHAR2(50))`);
              logger.info('Added organizationId column to accessCodes table.');
            }
            // Global Access Code & Security Clearance Tier
            const accCols = [
              { name: 'ISGLOBAL', type: 'NUMBER(1) DEFAULT 0' },
              { name: 'SECURITYLEVEL', type: "VARCHAR2(100) DEFAULT 'Level 1: General Access'" }
            ];
            for (const col of accCols) {
              const cCheck = await connection.execute(`SELECT column_name FROM user_tab_cols WHERE table_name = 'ACCESSCODES' AND column_name = '${col.name}'`);
              if (cCheck.rows && cCheck.rows.length === 0) {
                await connection.execute(`ALTER TABLE accessCodes ADD (${col.name} ${col.type})`);
                logger.info(`Added ${col.name} column to accessCodes table.`);
              }
            }
          } else if (tableName.toLowerCase() === 'categories') {
            const orgColCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'CATEGORIES' AND column_name = 'ORGANIZATIONID'`;
            const orgColResult = await connection.execute(orgColCheckSql);
            if (orgColResult.rows && orgColResult.rows.length === 0) {
              await connection.execute(`ALTER TABLE categories ADD (organizationId VARCHAR2(50))`);
              logger.info('Added organizationId column to categories table.');
            }
      const defaultOrgColCheckSql = "SELECT column_name FROM user_tab_cols WHERE table_name = 'CATEGORIES' AND column_name = 'ISDEFAULTORG'";
      const defaultOrgColResult = await connection.execute(defaultOrgColCheckSql);
      if (defaultOrgColResult.rows && defaultOrgColResult.rows.length === 0) {
        await connection.execute('ALTER TABLE categories ADD (isDefaultOrg NUMBER(1) DEFAULT 0)');
        logger.info('Added isDefaultOrg column to categories table.');
      }
          } else if (tableName.toLowerCase() === 'companysettings') {
            const columns = [
              { name: 'APPNAME', type: 'VARCHAR2(255)' },
              { name: 'APPLOGOURL', type: 'VARCHAR2(1000)' },
              { name: 'COMPANYNAME', type: 'VARCHAR2(255)' },
              { name: 'COMPANYLOGOURL', type: 'VARCHAR2(1000)' },
              { name: 'POWEREDBY', type: 'VARCHAR2(255)' },
              { name: 'LICENSEKEY', type: 'VARCHAR2(255)' },
              { name: 'LICENSETIER', type: "VARCHAR2(50) DEFAULT 'Enterprise'" },
              { name: 'LICENSEEXPIRY', type: 'VARCHAR2(50)' },
              { name: 'ORGCODE', type: 'VARCHAR2(50)' },
              { name: 'MAINTENANCEACTIVE', type: 'NUMBER(1) DEFAULT 0' },
              { name: 'MAINTENANCEMESSAGE', type: 'VARCHAR2(1000)' },
              { name: 'MAINTENANCELEVEL', type: "VARCHAR2(50) DEFAULT 'warning'" },
              { name: 'MAINTENANCESTART', type: 'VARCHAR2(50)' },
              { name: 'MAINTENANCEEND', type: 'VARCHAR2(50)' },
              { name: 'MAINTENANCEDISMISSIBLE', type: 'NUMBER(1) DEFAULT 1' }
            ];
            for (const col of columns) {
              const colCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'COMPANYSETTINGS' AND column_name = '${col.name}'`;
              const colResult = await connection.execute(colCheckSql);
              if (colResult.rows && colResult.rows.length === 0) {
                await connection.execute(`ALTER TABLE companySettings ADD (${col.name} ${col.type})`);
                logger.info(`Added ${col.name} column to companySettings table.`);
              }
            }
          } else if (tableName.toLowerCase() === 'organizations') {
            const columns = [
              { name: 'PRIMARYADMINEMAIL', type: 'VARCHAR2(255)' },
              { name: 'PRIMARYADMINNAME', type: 'VARCHAR2(255)' },
              { name: 'CONTACTPHONE', type: 'VARCHAR2(100)' },
              { name: 'MAXUSERS', type: 'NUMBER(10) DEFAULT 50' },
              { name: 'MAXPASSES', type: 'NUMBER(10) DEFAULT 5000' },
              { name: 'MAXEMPLOYEES', type: 'NUMBER(10) DEFAULT 500' },
              { name: 'ALLOWEDDOMAINS', type: 'VARCHAR2(1000)' },
              { name: 'STATUSREASON', type: 'VARCHAR2(1000)' },
              { name: 'NOTES', type: 'VARCHAR2(2000)' },
              { name: 'FEATURES', type: 'VARCHAR2(2000)' },
              { name: 'LICENSETIER', type: "VARCHAR2(100) DEFAULT 'Enterprise'" },
              { name: 'LICENSEKEY', type: 'VARCHAR2(255)' },
              { name: 'LICENSEEXPIRY', type: 'VARCHAR2(50)' },
              { name: 'STATUS', type: "VARCHAR2(50) DEFAULT 'active'" }
            ];
            for (const col of columns) {
              const colCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'ORGANIZATIONS' AND column_name = '${col.name}'`;
              const colResult = await connection.execute(colCheckSql);
              if (colResult.rows && colResult.rows.length === 0) {
                await connection.execute(`ALTER TABLE organizations ADD (${col.name} ${col.type})`);
                logger.info(`Added ${col.name} column to organizations table.`);
              }
            }
          } else if (tableName.toLowerCase() === 'notifications') {
            const notifColumns = [
              { name: 'LINK', type: 'VARCHAR2(255)' },
              { name: 'PRIORITY', type: "VARCHAR2(50) DEFAULT 'normal'" }
            ];
            for (const col of notifColumns) {
              const colCheckSql = `SELECT column_name FROM user_tab_cols WHERE table_name = 'NOTIFICATIONS' AND column_name = '${col.name}'`;
              const colResult = await connection.execute(colCheckSql);
              if (colResult.rows && colResult.rows.length === 0) {
                await connection.execute(`ALTER TABLE notifications ADD (${col.name} ${col.type})`);
                logger.info(`Added ${col.name} column to notifications table.`);
              }
            }
          }
      } catch (err) {
        logger.error(`Error processing table`, { err: err });
      }
    }


    // Insert default categories if not exists
    const catCheck = await connection.execute(`SELECT id FROM categories`);
    if (catCheck.rows && catCheck.rows.length === 0) {
      const defaultCats = [
        ['1', 'Industrial Cities'],
        ['2', 'Airports'],
        ['3', 'Ports']
      ];
      for (const cat of defaultCats) {
        await connection.execute(`INSERT INTO categories (id, name) VALUES (:id, :name)`, cat);
      }
      await connection.commit();
      logger.info('Default categories created.');
    }

    // Insert default company settings if not exists
    const settingsCheck = await connection.execute(`SELECT id FROM companySettings`);
    if (settingsCheck.rows && settingsCheck.rows.length === 0) {
      await connection.execute(
        `INSERT INTO companySettings (id, appName, companyName, address, contactEmail, primaryColor, poweredBy, licenseKey, licenseTier, licenseExpiry, orgCode) 
         VALUES (:id, :appName, :companyName, :address, :contactEmail, :primaryColor, :poweredBy, :licenseKey, :licenseTier, :licenseExpiry, :orgCode)`,
        [
          '1', 
          'AccessOne', 
          'Habari Engineering', 
          'Doha, Qatar', 
          'info@habariengineering.com', 
          '#800020', 
          'by Techsandgadgets.com',
          'LIC-ENT-2026-HARIS-CORE',
          'Enterprise Lifetime',
          '2036-12-31',
          'HABARI-01'
        ]
      );
      await connection.commit();
      logger.info('Default company settings created.');
    }

    // Seed default organization in organizations table if not exists
    try {
      const orgCheck = await connection.execute(`SELECT id FROM organizations WHERE id = 'org-habari'`);
      if (orgCheck.rows && orgCheck.rows.length === 0) {
        await connection.execute(
          `INSERT INTO organizations (id, name, code, appName, primaryColor, poweredBy, contactEmail, address, licenseKey, licenseTier, licenseExpiry, status, isCurrent, createdAt, updatedAt)
           VALUES (:id, :name, :code, :appName, :primaryColor, :poweredBy, :contactEmail, :address, :licenseKey, :licenseTier, :licenseExpiry, :status, :isCurrent, :createdAt, :updatedAt)`,
          {
            id: 'org-habari',
            name: 'Habari Engineering',
            code: 'HABARI-01',
            appName: 'AccessOne',
            primaryColor: '#800020',
            poweredBy: 'by Techsandgadgets.com',
            contactEmail: 'info@habariengineering.com',
            address: 'Doha, Qatar',
            licenseKey: 'LIC-ENT-2026-HARIS-CORE',
            licenseTier: 'Enterprise Lifetime',
            licenseExpiry: '2036-12-31',
            status: 'active',
            isCurrent: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        );
        await connection.commit();
      }
    } catch (orgErr) {
      logger.error('Non-critical organization seed warning', { err: orgErr });
    }

    // Bootstrap the first platform owner (power_admin) — only when none exists, and only from
    // environment variables. No accounts or passwords are hard-coded, and existing accounts are
    // never modified here (roles/status are managed in the app).
    //   BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD (min 12 chars), BOOTSTRAP_ADMIN_NAME (optional)
    try {
      const paCheck = await connection.execute(`SELECT id FROM users WHERE role = 'power_admin'`);
      const hasPowerAdmin = !!(paCheck.rows && paCheck.rows.length > 0);
      const bootEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
      const bootPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
      if (!hasPowerAdmin) {
        if (!bootEmail || bootPassword.length < 12) {
          logger.warn('No power_admin account exists. Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (12+ chars) and restart to create one.');
        } else {
          const existing = await connection.execute(`SELECT id FROM users WHERE LOWER(email) = :email`, [bootEmail]);
          if (existing.rows && existing.rows.length > 0) {
            // Promote the named existing account; its password is left as is.
            await connection.execute(`UPDATE users SET role = 'power_admin', status = 'active' WHERE LOWER(email) = :email`, [bootEmail]);
          } else {
            const displayName = process.env.BOOTSTRAP_ADMIN_NAME || 'Platform Owner';
            await connection.execute(
              `INSERT INTO users (id, email, password, role, displayName, status, createdAt)
               VALUES (:id, :email, :password, 'power_admin', :displayName, 'active', :createdAt)`,
              {
                id: crypto.randomUUID(),
                email: bootEmail,
                password: await bcrypt.hash(bootPassword, 12),
                displayName,
                createdAt: new Date().toISOString()
              }
            );
          }
          await connection.commit();
          logger.info(`Bootstrapped power_admin account for ${bootEmail}. Remove BOOTSTRAP_ADMIN_PASSWORD from the environment now.`);
        }
      }
    } catch (userErr) {
      logger.error('Power admin bootstrap failed', { err: userErr });
    }

    // Soft delete: records with history value are marked deleted, never removed.
    for (const table of ['employees', 'passes', 'passRequests', 'locations', 'categories', 'users', 'accessCodes', 'organizations']) {
      for (const col of ['deletedAt', 'deletedBy']) {
        try {
          await connection.execute(`SELECT ${col} FROM ${table} WHERE 1=0`);
        } catch (err: any) {
          if (/ORA-00904|no such column/i.test(String(err?.message))) {
            await connection.execute(`ALTER TABLE ${table} ADD (${col} VARCHAR2(50))`);
            await connection.commit();
            logger.info(`Added ${col} column to ${table}.`);
          }
        }
      }
    }

    // Each person's own expiry on an application (mirrors passRequests.individualExpiries)
    try {
      await connection.execute(`SELECT expiryDate FROM passRequestEmployees WHERE 1=0`);
    } catch (err: any) {
      if (/ORA-00904|no such column/i.test(String(err?.message))) {
        await connection.execute(`ALTER TABLE passRequestEmployees ADD (expiryDate VARCHAR2(50))`);
        await connection.commit();
        logger.info('Added expiryDate column to passRequestEmployees.');
      }
    }

    // Migration: Add individualExpiries and individualStartDates to passRequests if missing
    try {
      await connection.execute(`SELECT individualExpiries FROM passRequests WHERE 1=0`);
    } catch (err: any) {
      if (err.message.includes('ORA-00904')) {
        logger.info('Adding individualExpiries column to passRequests...');
        await connection.execute(`ALTER TABLE passRequests ADD (individualExpiries CLOB)`);
        await connection.commit();
      }
    }

    try {
      await connection.execute(`SELECT individualStartDates FROM passRequests WHERE 1=0`);
    } catch (err: any) {
      if (err.message.includes('ORA-00904')) {
        logger.info('Adding individualStartDates column to passRequests...');
        await connection.execute(`ALTER TABLE passRequests ADD (individualStartDates CLOB)`);
        await connection.commit();
      }
    }

    try {
      await connection.execute(`SELECT contractTitle FROM passRequests WHERE 1=0`);
    } catch (err: any) {
      if (err.message.includes('ORA-00904')) {
        logger.info('Adding contractTitle column to passRequests...');
        await connection.execute(`ALTER TABLE passRequests ADD (contractTitle VARCHAR2(255))`);
        await connection.commit();
      }
    }

    try {
      await connection.execute(`SELECT expiryDate FROM passRequests WHERE 1=0`);
    } catch (err: any) {
      if (err.message.includes('ORA-00904')) {
        logger.info('Adding expiryDate column to passRequests...');
        await connection.execute(`ALTER TABLE passRequests ADD (expiryDate VARCHAR2(50))`);
        await connection.commit();
      }
    }

    // Migration: Add cardNumber, endDate, contractTitle to passes if missing
    try {
      await connection.execute(`SELECT cardNumber FROM passes WHERE 1=0`);
    } catch (err: any) {
      if (err.message.includes('ORA-00904')) {
        logger.info('Adding cardNumber column to passes...');
        await connection.execute(`ALTER TABLE passes ADD (cardNumber VARCHAR2(100))`);
        await connection.commit();
      }
    }

    try {
      await connection.execute(`SELECT endDate FROM passes WHERE 1=0`);
    } catch (err: any) {
      if (err.message.includes('ORA-00904')) {
        logger.info('Adding endDate column to passes...');
        await connection.execute(`ALTER TABLE passes ADD (endDate VARCHAR2(50))`);
        await connection.commit();
      }
    }

    try {
      await connection.execute(`SELECT contractTitle FROM passes WHERE 1=0`);
    } catch (err: any) {
      if (err.message.includes('ORA-00904')) {
        logger.info('Adding contractTitle column to passes...');
        await connection.execute(`ALTER TABLE passes ADD (contractTitle VARCHAR2(255))`);
        await connection.commit();
      }
    }

    // Update null timestamps
    await connection.execute(`UPDATE passes SET createdAt = :now WHERE createdAt IS NULL`, [new Date().toISOString()]);
    await connection.execute(`UPDATE passes SET updatedAt = :now WHERE updatedAt IS NULL`, [new Date().toISOString()]);
    await connection.execute(`UPDATE passRequests SET createdAt = :now WHERE createdAt IS NULL`, [new Date().toISOString()]);
    await connection.execute(`UPDATE passRequests SET updatedAt = :now WHERE updatedAt IS NULL`, [new Date().toISOString()]);

    // (The one-time organizationId backfill for legacy locations/categories/accessCodes is now a
    // recorded data migration in server.ts, so global items created later are not reassigned.)

    // (Dangling link-row cleanup no longer runs on every startup: it ran once in the
    // '2026-11-13-foreign-keys' migration, and foreign keys now prevent new dangling rows.)

    await connection.commit();
    logger.info('Database integrity check and timestamp updates completed.');

  } catch (err) {
    logger.error('Database initialization failed', { err: err });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        logger.error('Unhandled error', { err: err });
      }
    }
  }
}
