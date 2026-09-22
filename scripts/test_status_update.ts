import dotenv from 'dotenv';
dotenv.config();
import { getConnection } from '../src/db.js';
import oracledb from 'oracledb';

async function testStatusUpdates() {
  let connection;
  try {
    console.log('Connecting to database...');
    connection = await getConnection();
    console.log('Connected.');

    // Fetch one application to test with
    const res = await connection.execute(
      `SELECT * FROM passRequests ORDER BY createdAt DESC`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rows = res.rows || [];
    console.log(`Found ${rows.length} applications.`);

    if (rows.length > 0) {
      const app = rows[0] as any;
      console.log(`Testing application: ID=${app.ID}, STATUS=${app.STATUS}`);

      // Test reading employee statuses
      const empStatuses = JSON.parse(app.EMPLOYEESTATUSES || '{}');
      const empIds = JSON.parse(app.EMPLOYEEIDS || '[]');
      console.log('Employee IDs:', empIds);
      console.log('Employee Statuses:', empStatuses);

      // Let's test a sample UPDATE statement to check if Oracle throws any error or constraint violation
      console.log('Attempting test dry update...');
      const testUpdate = await connection.execute(
        `UPDATE passRequests SET updatedAt = :now WHERE UPPER(id) = UPPER(:id)`,
        { now: new Date().toISOString(), id: app.ID }
      );
      console.log('Test update rowsAffected:', testUpdate.rowsAffected);

      // Check passes for this application
      const passRes = await connection.execute(
        `SELECT id, employeeId, status, requestId FROM passes WHERE UPPER(requestId) = UPPER(:id)`,
        { id: app.ID },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      console.log('Passes for this application:', passRes.rows);

      // Test inserting into requestHistory
      const histId = Math.random().toString(36).substr(2, 9);
      const histRes = await connection.execute(
        `INSERT INTO requestHistory (id, requestId, userId, action, remarks, timestamp)
         VALUES (:id, :requestId, :userId, :action, :remarks, :timestamp)`,
        {
          id: histId,
          requestId: app.ID,
          userId: 'test_user',
          action: 'TEST_ACTION',
          remarks: 'Testing requestHistory insertion',
          timestamp: new Date().toISOString()
        }
      );
      console.log('History insert rowsAffected:', histRes.rowsAffected);

      // Rollback the test history
      await connection.execute(`DELETE FROM requestHistory WHERE id = :id`, [histId]);
      await connection.commit();
      console.log('Test completed successfully with no SQL errors.');
    }
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    if (connection) await connection.close();
    process.exit(0);
  }
}

testStatusUpdates();
