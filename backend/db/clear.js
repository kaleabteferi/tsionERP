const db = require('./index');
require('dotenv').config();

async function clearData() {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Clear dependent/transactional data first.
    await client.query('DELETE FROM payments');
    await client.query('DELETE FROM sales_reports');
    await client.query('DELETE FROM returns');
    await client.query('DELETE FROM deliveries');
    await client.query('DELETE FROM inventory_transactions');

    // Clear master/demo entities.
    await client.query('DELETE FROM supermarkets');
    await client.query('DELETE FROM pricing');
    await client.query('DELETE FROM price_letters');

    // Keep warehouse_stock singleton row but reset values.
    await client.query(`
      UPDATE warehouse_stock
      SET current_qty = 0,
          total_received = 0,
          updated_at = NOW()
    `);

    await client.query('COMMIT');
    console.log('✅ All demo data cleared. Database is ready for fresh entries.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Clear failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
  }

  process.exit(0);
}

clearData();
