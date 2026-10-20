import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

console.log('DATABASE_URL set =', !!process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('❌ Unexpected PG pool error:', err);
});

// Test connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Error connecting to Postgres (Neon):', err.message);
  } else {
    console.log('✅ Connected to Postgres (Neon) at', res.rows[0].now);
  }
});

export default pool;
