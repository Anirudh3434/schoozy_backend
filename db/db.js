import mysql from 'mysql2';
import dotenv from 'dotenv';
dotenv.config();



console.log('DB_HOST=', process.env.DB_HOST);
console.log('DB_USER=', process.env.DB_USER);
console.log('DB_PASSWORD=', process.env.DB_PASSWORD);
console.log('DB_NAME=', process.env.DB_NAME);

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const db = mysql.createConnection(dbConfig);

db.connect((err) => {
  if (err) {
    console.error('❌ Error connecting to MySQL:', err);
  } else {
    console.log('✅ Connected to MySQL');
  }
});

export default db;
