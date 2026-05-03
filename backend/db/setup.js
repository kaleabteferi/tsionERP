const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function setup() {
  // First connect to postgres to create DB if needed
  const adminPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });

  const dbName = process.env.DB_NAME || 'tsion_erp';

  try {
    const res = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]
    );
    if (res.rows.length === 0) {
      await adminPool.query(`CREATE DATABASE ${dbName}`);
      console.log(`✓ Database "${dbName}" created`);
    } else {
      console.log(`✓ Database "${dbName}" already exists`);
    }
  } finally {
    await adminPool.end();
  }

  // Now connect to the app DB and run schema
  const appPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: dbName,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });

  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await appPool.query(sql);
    console.log('✓ Schema applied successfully');
  } finally {
    await appPool.end();
  }

  console.log('\n✅ Database setup complete!');
  console.log('Run "npm run db:seed" to add sample data.\n');
}

setup().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
