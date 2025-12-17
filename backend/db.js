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

const host = requireEnv('DB_HOST');
const user = requireEnv('DB_USER');
const password = requireEnv('DB_PASSWORD', { allowEmpty: true });
const database = requireEnv('DB_NAME');
const port = Number(requireEnv('DB_PORT'));

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
