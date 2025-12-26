const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: false });
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

const dbState = {
  configured: false,
  missing: [],
  source: null,
};

function computeMissingExplicit() {
  const missing = [];
  if (!pickEnvOptional(['DB_HOST', 'MYSQLHOST', 'MYSQL_HOST'])) missing.push('DB_HOST/MYSQLHOST/MYSQL_HOST');
  if (!pickEnvOptional(['DB_USER', 'MYSQLUSER', 'MYSQL_USER'])) missing.push('DB_USER/MYSQLUSER/MYSQL_USER');
  if (pickEnvOptional(['DB_PASSWORD', 'MYSQLPASSWORD', 'MYSQL_PASSWORD'], { allowEmpty: true }) === undefined) {
    missing.push('DB_PASSWORD/MYSQLPASSWORD/MYSQL_PASSWORD');
  }
  if (!pickEnvOptional(['DB_NAME', 'MYSQLDATABASE', 'MYSQL_DATABASE'])) missing.push('DB_NAME/MYSQLDATABASE/MYSQL_DATABASE');
  if (!pickEnvOptional(['DB_PORT', 'MYSQLPORT', 'MYSQL_PORT'])) missing.push('DB_PORT/MYSQLPORT/MYSQL_PORT');
  return missing;
}

function createDummyPool(message) {
  const err = new Error(message);
  const reject = async () => {
    throw err;
  };
  return {
    query: reject,
    execute: reject,
    getConnection: reject,
  };
}

let pool;
try {
  if (explicitHost || explicitUser || explicitDatabase || explicitPortRaw) {
    const missing = computeMissingExplicit();
    if (missing.length > 0) {
      dbState.configured = false;
      dbState.missing = missing;
      dbState.source = 'explicit';
      pool = createDummyPool(`DB no configurada: faltan variables (${missing.join(', ')})`);
    } else {
      host = pickEnv(['DB_HOST', 'MYSQLHOST', 'MYSQL_HOST']);
      user = pickEnv(['DB_USER', 'MYSQLUSER', 'MYSQL_USER']);
      password = pickEnv(['DB_PASSWORD', 'MYSQLPASSWORD', 'MYSQL_PASSWORD'], { allowEmpty: true });
      database = pickEnv(['DB_NAME', 'MYSQLDATABASE', 'MYSQL_DATABASE']);
      port = Number(pickEnv(['DB_PORT', 'MYSQLPORT', 'MYSQL_PORT']));
      if (!Number.isInteger(port)) throw new Error('DB_PORT debe ser un número entero');
      dbState.configured = true;
      dbState.source = 'explicit';
      pool = mysql.createPool({ host, user, password, database, port });
    }
  } else if (dbUrl) {
    ({ host, user, password, database, port } = parseMysqlUrl(dbUrl));
    if (!Number.isInteger(port)) throw new Error('DB_PORT debe ser un número entero');
    dbState.configured = true;
    dbState.source = 'url';
    pool = mysql.createPool({ host, user, password, database, port });
  } else {
    const missing = ['DB_HOST/MYSQLHOST/MYSQL_HOST'];
    dbState.configured = false;
    dbState.missing = missing;
    dbState.source = 'none';
    pool = createDummyPool(`DB no configurada: faltan variables (${missing.join(', ')})`);
  }
} catch (e) {
  dbState.configured = false;
  dbState.missing = dbState.missing && dbState.missing.length ? dbState.missing : ['config inválida'];
  dbState.source = dbState.source || 'error';
  pool = createDummyPool(`DB no configurada: ${e && e.message ? e.message : 'config inválida'}`);
}

async function testConnection() {
  try {
    if (!dbState.configured) {
      console.warn('⚠️ DB no configurada. La app iniciará, pero la DB no responderá hasta configurar variables.');
      return false;
    }
    const connection = await pool.promise().getConnection();
    console.log('✅ Conectado a MySQL correctamente');
    connection.release();
    return true;
  } catch (err) {
    console.error('❌ Error conectando a MySQL:', err.message);
    throw err;
  }
}

module.exports = {
  pool: typeof pool.promise === 'function' ? pool.promise() : pool,
  testConnection,
  dbState,
};
