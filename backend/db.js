const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const mysql = require('mysql2');

function requireEnv(name, { allowEmpty = false } = {}) {
  const value = process.env[name];
  if (value === undefined || value === null) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  if (!allowEmpty && String(value).trim() === '') {
    throw new Error(`La variable de entorno ${name} no puede estar vacía`);
  }
  return value;
}

const pickEnv = (candidates, { allowEmpty = false } = {}) => {
  for (const name of candidates) {
    const val = process.env[name];
    if (val === undefined || val === null) continue;
    if (!allowEmpty && String(val).trim() === '') continue;
    return val;
  }
  throw new Error(`Faltan variables de entorno: ${candidates.join(' / ')}`);
};

// Soporta ambos esquemas: DB_* (local) y MYSQL* (Railway)
const host = pickEnv(['DB_HOST', 'MYSQLHOST']);
const user = pickEnv(['DB_USER', 'MYSQLUSER']);
const password = pickEnv(['DB_PASSWORD', 'MYSQLPASSWORD'], { allowEmpty: true });
const database = pickEnv(['DB_NAME', 'MYSQLDATABASE']);
const port = Number(pickEnv(['DB_PORT', 'MYSQLPORT']));

if (!Number.isInteger(port)) {
  throw new Error('DB_PORT debe ser un número entero');
}

const pool = mysql.createPool({
  host,
  user,
  password,
  database,
  port,
});

async function testConnection() {
  try {
    const connection = await pool.promise().getConnection();
    console.log('✅ Conectado a MySQL correctamente');
    connection.release();
  } catch (err) {
    console.error('❌ Error conectando a MySQL:', err.message);
    throw err;
  }
}

module.exports = { pool: pool.promise(), testConnection };
