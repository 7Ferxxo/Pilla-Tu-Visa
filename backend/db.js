const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const mysql = require('mysql2');

function pickEnvOptional(candidates, { allowEmpty = false } = {}) {
  for (const name of candidates) {
    const val = process.env[name];
    if (val === undefined || val === null) continue;
    if (!allowEmpty && String(val).trim() === '') continue;
    return val;
  }
  return undefined;
}

function parseMysqlUrl(urlString) {
  // Soporta mysql://user:pass@host:3306/dbname
  const u = new URL(String(urlString));
  const protocol = String(u.protocol || '').toLowerCase();
  if (!protocol.startsWith('mysql')) {
    throw new Error('La URL de DB no es mysql://');
  }

  const host = u.hostname;
  const port = u.port ? Number(u.port) : 3306;
  const user = decodeURIComponent(u.username || '');
  const password = decodeURIComponent(u.password || '');
  const database = String(u.pathname || '').replace(/^\//, '');

  if (!host) throw new Error('La URL de DB no incluye host');
  if (!user) throw new Error('La URL de DB no incluye usuario');
  if (!database) throw new Error('La URL de DB no incluye base de datos');
  if (!Number.isInteger(port)) throw new Error('El puerto en la URL de DB no es válido');

  return { host, port, user, password, database };
}

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

// Soporta ambos esquemas: DB_* (local) y MYSQL* (Railway), incluyendo variantes con guion bajo.
// También soporta URL tipo mysql://... (MYSQL_URL / DATABASE_URL) por si Railway cambia nombres.
const dbUrl = pickEnvOptional(['DB_URL', 'MYSQL_URL', 'DATABASE_URL']);

const explicitHost = pickEnvOptional(['DB_HOST', 'MYSQLHOST', 'MYSQL_HOST']);
const explicitUser = pickEnvOptional(['DB_USER', 'MYSQLUSER', 'MYSQL_USER']);
const explicitPassword = pickEnvOptional(['DB_PASSWORD', 'MYSQLPASSWORD', 'MYSQL_PASSWORD'], { allowEmpty: true });
const explicitDatabase = pickEnvOptional(['DB_NAME', 'MYSQLDATABASE', 'MYSQL_DATABASE']);
const explicitPortRaw = pickEnvOptional(['DB_PORT', 'MYSQLPORT', 'MYSQL_PORT']);

let host;
let user;
let password;
let database;
let port;

if (explicitHost || explicitUser || explicitDatabase || explicitPortRaw) {
  host = pickEnv(['DB_HOST', 'MYSQLHOST', 'MYSQL_HOST']);
  user = pickEnv(['DB_USER', 'MYSQLUSER', 'MYSQL_USER']);
  password = pickEnv(['DB_PASSWORD', 'MYSQLPASSWORD', 'MYSQL_PASSWORD'], { allowEmpty: true });
  database = pickEnv(['DB_NAME', 'MYSQLDATABASE', 'MYSQL_DATABASE']);
  port = Number(pickEnv(['DB_PORT', 'MYSQLPORT', 'MYSQL_PORT']));
} else if (dbUrl) {
  ({ host, user, password, database, port } = parseMysqlUrl(dbUrl));
} else {
  // Mensaje de error más útil para Railway
  host = pickEnv(['DB_HOST', 'MYSQLHOST', 'MYSQL_HOST']);
}

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
