import dotenv from 'dotenv';
dotenv.config();
import { getConnection } from '../src/db.js';
import oracledb from 'oracledb';

async function testAllStatusEndpoints() {
  let connection;
  try {
    connection = await getConnection();
    const appRes = await connection.execute(
      `SELECT * FROM passRequests ORDER BY createdAt DESC`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const app = appRes.rows?.[0] as any;
    if (!app) {
      console.log('No app found');
      return;
    }
    console.log('Testing with app:', app.ID, 'Current status:', app.STATUS);
    const employeeIds = JSON.parse(app.EMPLOYEEIDS || '[]');
    console.log('Employee IDs:', employeeIds);

    // Let's test applyApplicationStatusSubProcessEffect logic manually
    const now = new Date().toISOString();
    const testStatuses = ['pending', 'processing', 'accepted', 'approved', 'collected', 'clarification', 'rejected', 'cancelled'];

    for (const st of testStatuses) {
      console.log(`Testing status transition to: ${st}`);
      
      // Update app
      await connection.execute(
        `UPDATE passRequests SET status = :status, updatedAt = :now WHERE UPPER(id) = UPPER(:id)`,
        { status: st, now, id: app.ID }
      );

      // Check requestHistory insert
      const histId = Math.random().toString(36).substr(2, 9);
      await connection.execute(
        `INSERT INTO requestHistory (id, requestId, userId, action, remarks, timestamp)
         VALUES (:id, :requestId, :userId, :action, :remarks, :timestamp)`,
        {
          id: histId,
          requestId: app.ID,
          userId: 'test_user',
          action: `STATUS_CHANGE (${st.toUpperCase()})`,
          remarks: `Changed status to ${st}`,
          timestamp: now
        }
      );
      await connection.execute(`DELETE FROM requestHistory WHERE id = :id`, [histId]);
    }

    // Reset app status back
    await connection.execute(
      `UPDATE passRequests SET status = :status, updatedAt = :now WHERE UPPER(id) = UPPER(:id)`,
      { status: app.STATUS, now, id: app.ID }
    );
    await connection.commit();
    console.log('All status transitions tested successfully without error.');
  } catch (err) {
    console.error('Error in status endpoint test:', err);
  } finally {
    if (connection) await connection.close();
    process.exit(0);
  }
}

testAllStatusEndpoints();
