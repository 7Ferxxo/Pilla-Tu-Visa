require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: false });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const ai = require('./ai');
const emailService = require('./email');

const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || DEFAULT_SESSION_TTL_MS);
const sessions = new Map();

let SESSIONS_TABLE_READY = false;
async function ensureSessionsTable() {
  if (SESSIONS_TABLE_READY) return;
  await db.pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(128) NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      role VARCHAR(20) NOT NULL,
      username VARCHAR(80) NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (token),
      INDEX idx_sessions_expires_at (expires_at),
      INDEX idx_sessions_user_id (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  SESSIONS_TABLE_READY = true;
}

function computeExpiryMs() {
  const ttl = Number.isFinite(SESSION_TTL_MS) && SESSION_TTL_MS > 0 ? SESSION_TTL_MS : DEFAULT_SESSION_TTL_MS;
  return Date.now() + ttl;
}

async function createSession({ userId, role, username }) {
  await ensureSessionsTable();
  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = computeExpiryMs();

  await db.pool.execute(
    'INSERT INTO sessions (token, user_id, role, username, expires_at) VALUES (?,?,?,?,?)',
    [token, userId, String(role || 'admin'), String(username || ''), expiresAt]
  );

  sessions.set(token, { userId, role: String(role || 'admin'), username: String(username || ''), expiresAt });
  return token;
}

async function deleteSession(token) {
  if (!token) return;
  sessions.delete(token);
  try {
    await ensureSessionsTable();
    await db.pool.execute('DELETE FROM sessions WHERE token = ? LIMIT 1', [token]);
  } catch {
  }
}

async function getSession(token) {
  if (!token) return null;

  const cached = sessions.get(token);
  if (cached && typeof cached.expiresAt === 'number' && Date.now() <= cached.expiresAt) {
    const newExpires = computeExpiryMs();
    cached.expiresAt = newExpires;
    sessions.set(token, cached);
    try {
      await ensureSessionsTable();
      await db.pool.execute('UPDATE sessions SET expires_at = ? WHERE token = ? LIMIT 1', [newExpires, token]);
    } catch {
    }
    return cached;
  }

  await ensureSessionsTable();
  const [rows] = await db.pool.query(
    'SELECT user_id AS userId, role, username, expires_at AS expiresAt FROM sessions WHERE token = ? LIMIT 1',
    [token]
  );
  const s = rows && rows[0];
  if (!s) return null;

  if (typeof s.expiresAt === 'number' && Date.now() > s.expiresAt) {
    await deleteSession(token);
    return null;
  }

  const refreshed = {
    userId: s.userId,
    role: s.role,
    username: s.username,
    expiresAt: computeExpiryMs(),
  };

  sessions.set(token, refreshed);
  await db.pool.execute('UPDATE sessions SET expires_at = ? WHERE token = ? LIMIT 1', [refreshed.expiresAt, token]);
  return refreshed;
}

async function requireAuth(req, res, next) {
  const hdr = String(req.get('authorization') || '').trim();
  const m = hdr.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1] : '';
  let session;
  try {
    session = await getSession(token);
  } catch (e) {
    console.error('Error leyendo sesión:', e);
    return res.status(500).json({ ok: false, mensaje: 'Error validando sesión' });
  }
  if (!session) {
    return res.status(401).json({ ok: false, mensaje: 'No autorizado' });
  }
  req.authToken = token;
  req.auth = session;
  next();
}

function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    const role = req.auth && req.auth.role ? String(req.auth.role) : '';
    if (!allowed.includes(role)) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permisos' });
    }
    next();
  };
}

function rateLimit({ windowMs, max }) {
  const hits = new Map();
  const win = Number(windowMs) || 60_000;
  const limit = Number(max) || 60;

  return (req, res, next) => {
    const ip = String(req.ip || req.connection?.remoteAddress || 'unknown');
    const now = Date.now();
    const entry = hits.get(ip);

    if (!entry || now > entry.resetAt) {
      hits.set(ip, { count: 1, resetAt: now + win });
      return next();
    }

    entry.count += 1;
    if (entry.count > limit) {
      return res.status(429).json({ ok: false, mensaje: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' });
    }

    next();
  };
}

let USUARIOS_SCHEMA_CACHE = null;

const INIT_USERS_SQL_PATH = path.join(__dirname, 'sql', 'init_users.sql');
let USUARIOS_TABLE_READY = false;

function splitSqlStatements(sqlText) {
  return String(sqlText || '')
    .split(/;\s*(?:\r?\n|$)/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function ensureUsuariosTable() {
  if (USUARIOS_TABLE_READY) return;

  let sqlText;
  try {
    sqlText = fs.readFileSync(INIT_USERS_SQL_PATH, 'utf8');
  } catch (e) {
    throw new Error(
      `No se pudo leer el archivo de inicialización de usuarios (${INIT_USERS_SQL_PATH}). ` +
        'Asegúrate de que exista en el deploy.'
    );
  }

  const statements = splitSqlStatements(sqlText);
  const createStatements = statements.filter((s) => /^CREATE\s+TABLE\b/i.test(s));
  if (createStatements.length === 0) {
    throw new Error('El SQL de inicialización de usuarios no contiene CREATE TABLE');
  }

  for (const stmt of createStatements) {
    await db.pool.query(stmt);
  }

  const [cols] = await db.pool.query('SHOW COLUMNS FROM usuarios');
  const names = new Set((cols || []).map((c) => String(c.Field || '').toLowerCase()));

  if (!names.has('email')) {
    try {
      await db.pool.execute('ALTER TABLE usuarios ADD COLUMN email VARCHAR(120) NULL AFTER username');
      names.add('email');
    } catch {
    }
  }

  if (!names.has('role')) {
    try {
      await db.pool.execute("ALTER TABLE usuarios ADD COLUMN role ENUM('admin','editor','viewer') NOT NULL DEFAULT 'admin' AFTER email");
      names.add('role');
    } catch {
    }
  }

  const defaultAdminEmail = String(process.env.DEFAULT_ADMIN_EMAIL || 'admin@pillatuvisa.com')
    .trim()
    .toLowerCase();
  const defaultAdminHash = String(
    process.env.DEFAULT_ADMIN_PASSWORD_HASH || '$2b$12$IcobK/3zX1hm8XD98rGL4uVJNJb1ALLyMvf9Cn3r3uTCmsBt89JJW'
  ).trim();
  const defaultAdminRole = String(process.env.DEFAULT_ADMIN_ROLE || 'admin').trim();

  const passCol = names.has('password_hash') ? 'password_hash' : (names.has('password') ? 'password' : null);
  const canInsert = Boolean(passCol) && names.has('username');
  if (canInsert) {
    const columns = ['username'];
    const values = ['admin'];

    if (names.has('email')) {
      columns.push('email');
      values.push(defaultAdminEmail);
    }

    columns.push(passCol);
    values.push(defaultAdminHash);

    if (names.has('role')) {
      columns.push('role');
      values.push(defaultAdminRole);
    }

    const placeholders = columns.map(() => '?').join(',');
    await db.pool.execute(
      `INSERT IGNORE INTO usuarios (${columns.join(',')}) VALUES (${placeholders})`,
      values
    );
  }

  USUARIOS_TABLE_READY = true;
}

async function getUsuariosSchema() {
  if (USUARIOS_SCHEMA_CACHE) return USUARIOS_SCHEMA_CACHE;
  await ensureUsuariosTable();
  const [cols] = await db.pool.query('SHOW COLUMNS FROM usuarios');
  const names = new Set((cols || []).map((c) => String(c.Field || '').toLowerCase()));
  const schema = {
    hasEmail: names.has('email'),
    hasRole: names.has('role'),
    hasPasswordHash: names.has('password_hash'),
    hasPassword: names.has('password'),
  };
  USUARIOS_SCHEMA_CACHE = schema;
  return schema;
}

let POTENCIALES_TABLE_READY = false;
async function ensurePotencialesTable() {
  if (POTENCIALES_TABLE_READY) return;
  await db.pool.query(`
    CREATE TABLE IF NOT EXISTS potenciales (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      nombre VARCHAR(120) NOT NULL,
      email VARCHAR(180) NOT NULL,
      telefono VARCHAR(60) DEFAULT NULL,
      mensaje TEXT DEFAULT NULL,
      ip VARCHAR(80) DEFAULT NULL,
      user_agent VARCHAR(255) DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_potenciales_created_at (created_at),
      INDEX idx_potenciales_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  POTENCIALES_TABLE_READY = true;
}

let RECIBOS_TABLE_READY = false;
async function ensureRecibosTable() {
  if (RECIBOS_TABLE_READY) return;
  await db.pool.query(`
    CREATE TABLE IF NOT EXISTS recibos (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      nombre VARCHAR(120) NOT NULL,
      email VARCHAR(180) NOT NULL,
      concepto VARCHAR(255) NOT NULL,
      monto DECIMAL(10,2) NOT NULL,
      metodo VARCHAR(60) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_recibos_created_at (created_at),
      INDEX idx_recibos_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  RECIBOS_TABLE_READY = true;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function looksLikeBcryptHash(value) {
  const s = String(value || '');
  return /^\$2[aby]\$\d\d\$/.test(s);
}

function safeEqualString(a, b) {
  const aa = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

const RECEIPTS_DIR = path.join(__dirname, 'storage', 'recibos');
const RECEIPT_TEMPLATE_PATH = path.join(__dirname, 'templates', 'recibo.html');
let RECEIPT_TEMPLATE_CACHE = null;

function ensureReceiptsDir() {
  try {
    fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
  } catch (e) {
    console.error('No se pudo crear el directorio de recibos:', e);
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderTemplate(tpl, data) {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => data[key] ?? '');
}

function formatDateDMY(d = new Date()) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function formatMoney(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(2) : String(value ?? '');
}

function getReceiptTemplate() {
  if (RECEIPT_TEMPLATE_CACHE) return RECEIPT_TEMPLATE_CACHE;
  RECEIPT_TEMPLATE_CACHE = fs.readFileSync(RECEIPT_TEMPLATE_PATH, 'utf8');
  return RECEIPT_TEMPLATE_CACHE;
}

function getStoredReceiptPath(id) {
  return path.join(RECEIPTS_DIR, `${id}.html`);
}

function getStoredReceiptMetaPath(id) {
  return path.join(RECEIPTS_DIR, `${id}.json`);
}

async function saveReceiptHtml({ reciboId, html }) {
  ensureReceiptsDir();
  const filePath = getStoredReceiptPath(reciboId);
  await fs.promises.writeFile(filePath, html, 'utf8');
  return filePath;
}

async function saveReceiptMeta({ reciboId, meta }) {
  ensureReceiptsDir();
  const filePath = getStoredReceiptMetaPath(reciboId);
  await fs.promises.writeFile(filePath, JSON.stringify(meta, null, 2), 'utf8');
  return filePath;
}

async function readReceiptMeta(reciboId) {
  try {
    const filePath = getStoredReceiptMetaPath(reciboId);
    const txt = await fs.promises.readFile(filePath, 'utf8');
    const meta = JSON.parse(txt);
    if (!meta || typeof meta !== 'object') return null;
    return meta;
  } catch {
    return null;
  }
}

function buildBaseUrl(req) {
  const configured = String(process.env.BASE_URL || '').trim();
  if (configured) return configured.replace(/\/$/, '');

  const proto = req.protocol;
  const host = req.get('host');
  return `${proto}://${host}`;
}

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/imagenes', express.static(path.join(__dirname, 'public', 'Imagenes')));

app.get('/recibo.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'recibo.css'));
});

app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/', (req, res) => {
  res.send('Pilla Tu Visa API funcionando 🚀');
});

app.get('/health', async (req, res) => {
  let dbOk = false;
  try {
    if (db && db.dbState && db.dbState.configured === false) {
      dbOk = false;
    } else {
      await db.pool.query('SELECT 1');
      dbOk = true;
    }
  } catch {
    dbOk = false;
  }
  res.status(200).json({ ok: true, dbOk, dbConfigured: !(db && db.dbState && db.dbState.configured === false) });
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.post('/api/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 25 }), async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, mensaje: 'Ingresa usuario y contraseña.' });
  }

  try {
    const schema = await getUsuariosSchema();
    const identifier = String(username).trim();
    const identifierLower = identifier.toLowerCase();

    const passCol = schema.hasPasswordHash ? 'password_hash' : (schema.hasPassword ? 'password' : null);
    if (!passCol) {
      return res.status(500).json({ ok: false, mensaje: 'La tabla usuarios no tiene columna de contraseña' });
    }

    const selectCols = [
      'id',
      'username',
      `${passCol} AS password_hash`,
      schema.hasEmail ? 'email' : 'NULL AS email',
      schema.hasRole ? 'role' : `'admin' AS role`,
    ].join(', ');

    const where = schema.hasEmail
      ? 'WHERE LOWER(username) = ? OR LOWER(email) = ?'
      : 'WHERE LOWER(username) = ?';
    const params = schema.hasEmail ? [identifierLower, identifierLower] : [identifierLower];

    const [rows] = await db.pool.query(
      `SELECT ${selectCols} FROM usuarios ${where} LIMIT 1`,
      params
    );
    const user = rows && rows[0];

    if (!user) {
      return res.status(401).json({ ok: false, mensaje: 'Usuario o contraseña incorrectos' });
    }

    const stored = String(user.password_hash || '');
    const inputPassword = String(password || '').trim();
    let matches = false;

    if (stored && looksLikeBcryptHash(stored)) {
      matches = await bcrypt.compare(inputPassword, stored);
    } else if (stored) {
      matches = safeEqualString(inputPassword, stored);
      if (matches) {
        const upgraded = await bcrypt.hash(inputPassword, 12);
        await db.pool.execute(
          `UPDATE usuarios SET ${passCol} = ? WHERE id = ? LIMIT 1`,
          [upgraded, user.id]
        );
      }
    }

    if (!matches) {
      return res.status(401).json({ ok: false, mensaje: 'Usuario o contraseña incorrectos' });
    }

    const token = await createSession({
      userId: user.id,
      role: user.role || 'admin',
      username: user.username,
    });
    res.json({
      ok: true,
      token,
      role: user.role || 'admin',
      username: user.username,
      email: user.email,
    });
  } catch (error) {
    console.error('Error en /api/login:', error);
    res.status(500).json({ ok: false, mensaje: 'No se pudo iniciar sesión' });
  }
});

app.post('/api/logout', requireAuth, async (req, res) => {
  try {
    await deleteSession(req.authToken);
  } catch (e) {
    console.error('Error en /api/logout:', e);
  }
  res.json({ ok: true });
});

app.post('/api/recover', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), async (req, res) => {
  const { email } = req.body || {};
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) {
    return res.status(400).json({ ok: false, mensaje: 'Ingresa el correo asociado a tu cuenta.' });
  }

  const genericResponse = 'Si tu correo está registrado, te enviaremos instrucciones para recuperar el acceso.';

  try {
    const schema = await getUsuariosSchema();
    if (!schema.hasEmail) {
      return res.status(400).json({
        ok: false,
        mensaje: 'La tabla usuarios no tiene columna email. Agrega un campo email para habilitar recuperación por correo.',
      });
    }

    const [rows] = await db.pool.query(
      'SELECT id, username, email FROM usuarios WHERE LOWER(email) = ? LIMIT 1',
      [normalized]
    );
    const user = rows && rows[0];

    if (!user) {
      return res.json({ ok: true, mensaje: genericResponse });
    }

    if (!emailService.hasEmailConfig()) {
      return res.status(500).json({
        ok: false,
        mensaje: 'Falta configurar EMAIL_USER y EMAIL_PASS en backend/.env para enviar correos.',
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await db.pool.execute(
      'UPDATE usuarios SET reset_token = ?, reset_expires = ? WHERE id = ? LIMIT 1',
      [tokenHash, expiresAt, user.id]
    );

    const baseUrl = buildBaseUrl(req);
    const resetUrl = `${baseUrl}/login/reset.html?token=${token}`;

    await emailService.sendRecoveryEmail({
      to: user.email,
      username: user.username,
      resetUrl,
      expiresAt,
    });

    res.json({ ok: true, mensaje: genericResponse });
  } catch (error) {
    console.error('Error en /api/recover:', error);
    res.status(500).json({ ok: false, mensaje: 'No se pudo procesar la solicitud de recuperación.' });
  }
});

app.post('/api/reset-password', rateLimit({ windowMs: 15 * 60 * 1000, max: 15 }), async (req, res) => {
  const { token, password } = req.body || {};
  const cleanToken = String(token || '').trim();
  const cleanPassword = String(password || '').trim();

  if (!cleanToken || !cleanPassword) {
    return res.status(400).json({ ok: false, mensaje: 'Faltan datos para restablecer la contraseña.' });
  }

  if (cleanPassword.length < 8) {
    return res.status(400).json({ ok: false, mensaje: 'La nueva contraseña debe tener al menos 8 caracteres.' });
  }

  try {
    const tokenHash = sha256Hex(cleanToken);
    const [rows] = await db.pool.query(
      'SELECT id FROM usuarios WHERE reset_token = ? AND reset_expires IS NOT NULL AND reset_expires > NOW() LIMIT 1',
      [tokenHash]
    );
    const user = rows && rows[0];

    if (!user) {
      return res.status(400).json({ ok: false, mensaje: 'El enlace de recuperación es inválido o ya expiró.' });
    }

    const schema = await getUsuariosSchema();
    const passCol = schema.hasPasswordHash ? 'password_hash' : (schema.hasPassword ? 'password' : null);
    if (!passCol) {
      return res.status(500).json({ ok: false, mensaje: 'La tabla usuarios no tiene columna de contraseña' });
    }

    const newHash = await bcrypt.hash(cleanPassword, 12);
    await db.pool.execute(
      `UPDATE usuarios SET ${passCol} = ?, reset_token = NULL, reset_expires = NULL WHERE id = ? LIMIT 1`,
      [newHash, user.id]
    );

    res.json({ ok: true, mensaje: 'Tu contraseña se actualizó correctamente. Ya puedes iniciar sesión.' });
  } catch (error) {
    console.error('Error en /api/reset-password:', error);
    res.status(500).json({ ok: false, mensaje: 'No se pudo restablecer la contraseña.' });
  }
});

app.post('/api/potenciales', rateLimit({ windowMs: 15 * 60 * 1000, max: 40 }), async (req, res) => {
  const { nombre, email, telefono, mensaje } = req.body || {};
  const cleanNombre = String(nombre || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanTelefono = String(telefono || '').trim();
  const cleanMensaje = String(mensaje || '').trim();

  if (!cleanNombre || !cleanEmail) {
    return res.status(400).json({ ok: false, mensaje: 'Por favor ingresa al menos tu nombre y email.' });
  }

  try {
    await ensurePotencialesTable();
    const ip = String(req.ip || req.connection?.remoteAddress || '').slice(0, 80);
    const ua = String(req.get('user-agent') || '').slice(0, 255);

    await db.pool.execute(
      'INSERT INTO potenciales (nombre, email, telefono, mensaje, ip, user_agent) VALUES (?,?,?,?,?,?)',
      [cleanNombre, cleanEmail, cleanTelefono || null, cleanMensaje || null, ip || null, ua || null]
    );

    res.json({ ok: true, mensaje: 'Hemos recibido tu solicitud, te contactaremos pronto.' });
  } catch (error) {
    console.error('Error en /api/potenciales:', error);
    res.status(500).json({ ok: false, mensaje: 'No se pudo guardar tu solicitud.' });
  }
});

app.get('/api/potenciales', requireAuth, requireRole(['admin', 'editor']), async (req, res) => {
  const limitRaw = Number(req.query && req.query.limit ? req.query.limit : 200);
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;

  try {
    await ensurePotencialesTable();
    const [rows] = await db.pool.query(
      'SELECT id, nombre, email, telefono, mensaje, created_at FROM potenciales ORDER BY created_at DESC, id DESC LIMIT ?',
      [limit]
    );
    res.json({ ok: true, potenciales: rows || [] });
  } catch (error) {
    console.error('Error listando potenciales:', error);
    res.status(500).json({ ok: false, mensaje: 'No se pudieron cargar los potenciales.' });
  }
});

app.get('/clients', requireAuth, async (req, res) => {
  try {
    await ensureRecibosTable();
    const [rows] = await db.pool.query(
      'SELECT id, nombre, email FROM recibos ORDER BY id DESC LIMIT 200'
    );
    res.json({ ok: true, clients: rows });
  } catch (error) {
    console.error('Error al listar clientes:', error);
    res.status(500).json({ ok: false, error: true, mensaje: 'Error al cargar clientes' });
  }
});

app.post('/ai/tips', requireAuth, async (req, res) => {
  const { perfil, fechaCita } = req.body || {};
  try {
    const client = ai.buildClient();
    const system = 'Eres un asistente para preparar entrevistas de visa. Responde en español, claro y profesional. No menciones que eres IA. No uses emojis.';
    const user = [
      'Genera un texto listo para copiar y enviar al cliente con: (1) 6-10 preguntas probables para la entrevista, (2) 6 consejos rápidos, (3) recordatorios de documentos.',
      `Perfil del cliente: ${String(perfil || '').trim() || 'No especificado'}`,
      `Fecha de cita: ${String(fechaCita || '').trim() || 'No especificada'}`,
      'Formato: usa encabezados cortos y viñetas. Sé práctico.',
    ].join('\n');

    const text = await client.chat({ system, user, temperature: 0.5 });
    res.json({ ok: true, text });
  } catch (error) {
    if (error && error.code === 'NO_OPENAI_KEY') {
      return res.status(501).json({ ok: false, mensaje: 'Falta configurar OPENAI_API_KEY en backend/.env' });
    }
    console.error('Error IA tips:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al generar tips' });
  }
});

app.post('/ai/resultado', requireAuth, async (req, res) => {
  const { estado, detalle } = req.body || {};
  if (!estado) {
    return res.status(400).json({ ok: false, mensaje: 'Falta estado' });
  }

  try {
    const client = ai.buildClient();
    const system = 'Eres un redactor profesional de mensajes para clientes. Responde en español. No menciones que eres IA. No uses emojis.';
    const user = [
      'Redacta un mensaje corto (80-140 palabras) para el cliente sobre el resultado de su visa. Debe sonar humano y respetuoso.',
      `Estado: ${String(estado).trim()}`,
      `Detalles: ${String(detalle || '').trim() || 'No especificados'}`,
      'Si es denegada, incluye pasos siguientes concretos sin sonar alarmista. Si es aprobada, felicita y sugiere próximos pasos.',
    ].join('\n');

    const text = await client.chat({ system, user, temperature: 0.6 });
    res.json({ ok: true, text });
  } catch (error) {
    if (error && error.code === 'NO_OPENAI_KEY') {
      return res.status(501).json({ ok: false, mensaje: 'Falta configurar OPENAI_API_KEY en backend/.env' });
    }
    console.error('Error IA resultado:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al redactar mensaje' });
  }
});

app.post('/email/test', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!emailService.hasEmailConfig()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Falta configurar EMAIL_USER y EMAIL_PASS en backend/.env',
      });
    }

    const { to } = req.body || {};
    const host = req.get('host');
    const proto = req.protocol;
    const baseUrl = `${proto}://${host}`;

    const info = await emailService.sendTestEmail({ to, baseUrl });
    res.json({ ok: true, mensaje: 'Correo de prueba enviado', messageId: info && info.messageId });
  } catch (error) {
    console.error('Error enviando correo de prueba:', error);
    res.status(500).json({
      ok: false,
      mensaje: 'No se pudo enviar el correo de prueba',
      code: error && error.code ? String(error.code) : undefined,
      error: error && error.message ? String(error.message) : String(error),
    });
  }
});

app.get('/recibo/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).send('ID inválido');
  }

  try {
    const stored = getStoredReceiptPath(id);
    if (fs.existsSync(stored)) {
      return res.sendFile(stored);
    }
  } catch (e) {
    console.error('Error verificando recibo guardado:', e);
  }

  let template;
  try {
    template = getReceiptTemplate();
  } catch (e) {
    console.error('No se pudo leer el template del recibo:', e);
    return res.status(500).send('Error al cargar el template del recibo');
  }

  try {
    await ensureRecibosTable();
    const [rows] = await db.pool.execute(
      'SELECT id, nombre, email, concepto, monto, metodo FROM recibos WHERE id = ? LIMIT 1',
      [id]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).send('Recibo no encontrado');
    }

    const r = rows[0];

    const fechaEmision = formatDateDMY(new Date());
    const montoFmt = formatMoney(r.monto);

    const html = renderTemplate(template, {
      id: escapeHtml(r.id),
      fechaEmision: escapeHtml(fechaEmision),
      nombre: escapeHtml(r.nombre),
      email: escapeHtml(r.email),
      metodo: escapeHtml(r.metodo),
      concepto: escapeHtml(r.concepto),
      monto: escapeHtml(montoFmt),
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('Error al generar recibo:', error);
    res.status(500).send('Error al generar el recibo');
  }
});

app.get('/recibos', requireAuth, async (req, res) => {
  const limitRaw = Number(req.query.limit ?? 200);
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;

  try {
    await ensureRecibosTable();
    const [rows] = await db.pool.query(
      `SELECT id, nombre, email, concepto, monto, metodo FROM recibos ORDER BY id DESC LIMIT ${limit}`
    );

    const enriched = await Promise.all(
      (rows || []).map(async (r) => {
        const meta = await readReceiptMeta(r.id);
        return {
          ...r,
          notas: meta && typeof meta.notas === 'string' ? meta.notas : '',
        };
      })
    );

    res.json({ ok: true, recibos: enriched });
  } catch (error) {
    console.error('Error al listar recibos:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al cargar recibos' });
  }
});

app.delete('/recibos/:id', requireAuth, requireRole('admin'), async (req, res) => {

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ ok: false, mensaje: 'ID inválido' });
  }

  try {
    await ensureRecibosTable();
    const [result] = await db.pool.execute('DELETE FROM recibos WHERE id = ? LIMIT 1', [id]);
    const affected = result && typeof result.affectedRows === 'number' ? result.affectedRows : 0;
    if (!affected) {
      return res.status(404).json({ ok: false, mensaje: 'Recibo no encontrado' });
    }

    try {
      await fs.promises.unlink(getStoredReceiptPath(id));
    } catch {}
    try {
      await fs.promises.unlink(getStoredReceiptMetaPath(id));
    } catch {}

    res.json({ ok: true, mensaje: 'Recibo eliminado', id });
  } catch (error) {
    console.error('Error al eliminar recibo:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar recibo' });
  }
});

app.post('/tips', requireAuth, async (req, res) => {
  const { clienteId, fechaCita, perfil, mensaje } = req.body;

  if (!clienteId || !fechaCita || !mensaje) {
    return res.status(400).json({ error: true, mensaje: 'Faltan datos obligatorios' });
  }

  try {
    await ensureRecibosTable();
    const id = Number(clienteId);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: true, mensaje: 'Cliente inválido' });
    }

    const [rows] = await db.pool.execute('SELECT id, nombre, email FROM recibos WHERE id = ? LIMIT 1', [id]);
    const client = rows && rows[0];
    if (!client || !client.email) {
      return res.status(404).json({ error: true, mensaje: 'Cliente no encontrado o sin email' });
    }

    if (!emailService.hasEmailConfig()) {
      return res.status(400).json({
        error: true,
        mensaje: 'Falta configurar EMAIL_USER y EMAIL_PASS en backend/.env',
      });
    }

    const info = await emailService.sendTipsEmail({
      to: client.email,
      clienteNombre: client.nombre,
      fechaCita,
      perfil,
      mensaje,
      baseUrl: buildBaseUrl(req),
    });

    res.json({
      error: false,
      mensaje: 'Tips enviados correctamente',
      messageId: info && info.messageId ? info.messageId : undefined,
    });
  } catch (error) {
    console.error('Error enviando tips:', error);
    res.status(500).json({ error: true, mensaje: 'No se pudieron enviar los tips' });
  }
});

app.post('/resultado', requireAuth, async (req, res) => {
  const { clienteId, estado, detalle, mensaje } = req.body;

  if (!clienteId || !estado || !mensaje) {
    return res.status(400).json({ error: true, mensaje: 'Faltan datos obligatorios' });
  }

  try {
    await ensureRecibosTable();
    const id = Number(clienteId);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: true, mensaje: 'Cliente inválido' });
    }

    const [rows] = await db.pool.execute('SELECT id, nombre, email FROM recibos WHERE id = ? LIMIT 1', [id]);
    const client = rows && rows[0];
    if (!client || !client.email) {
      return res.status(404).json({ error: true, mensaje: 'Cliente no encontrado o sin email' });
    }

    if (!emailService.hasEmailConfig()) {
      return res.status(400).json({
        error: true,
        mensaje: 'Falta configurar EMAIL_USER y EMAIL_PASS en backend/.env',
      });
    }

    const info = await emailService.sendResultadoEmail({
      to: client.email,
      clienteNombre: client.nombre,
      estado,
      detalle,
      mensaje,
      baseUrl: buildBaseUrl(req),
    });

    res.json({
      error: false,
      mensaje: 'Resultado notificado correctamente',
      messageId: info && info.messageId ? info.messageId : undefined,
    });
  } catch (error) {
    console.error('Error notificando resultado:', error);
    res.status(500).json({ error: true, mensaje: 'No se pudo notificar el resultado' });
  }
});

app.post('/register', requireAuth, async (req, res) => {
  const { nombre, email: emailAddress, concepto, monto, metodo, notas } = req.body;

  if (!nombre || !emailAddress || !concepto || !monto || !metodo) {
    return res.status(400).json({
      error: true,
      mensaje: 'Faltan datos obligatorios',
    });
  }

  try {
    await ensureRecibosTable();
    const sql = `
      INSERT INTO recibos (nombre, email, concepto, monto, metodo)
      VALUES (?, ?, ?, ?, ?)
    `;

    const [result] = await db.pool.execute(sql, [
      nombre,
      emailAddress,
      concepto,
      monto,
      metodo,
    ]);

    const reciboId = result.insertId;

    const notasText = String(notas ?? '').trim();

    let receiptHtml = null;
    let receiptSaved = false;
    let receiptSaveError = null;
    try {
      const template = getReceiptTemplate();
      const fechaEmision = formatDateDMY(new Date());
      const montoFmt = formatMoney(monto);

      receiptHtml = renderTemplate(template, {
        id: escapeHtml(reciboId),
        fechaEmision: escapeHtml(fechaEmision),
        nombre: escapeHtml(nombre),
        email: escapeHtml(emailAddress),
        metodo: escapeHtml(metodo),
        concepto: escapeHtml(concepto),
        monto: escapeHtml(montoFmt),
      });

      await saveReceiptHtml({ reciboId, html: receiptHtml });
      await saveReceiptMeta({
        reciboId,
        meta: {
          notas: notasText,
          fechaEmision: fechaEmision,
        },
      });
      receiptSaved = true;
    } catch (err) {
      receiptSaveError = 'No se pudo guardar el recibo en el servidor.';
      console.error('Error guardando recibo HTML:', err);
    }

    let emailSent = false;
    let emailError = null;
    try {
      if (!emailService.hasEmailConfig()) {
        emailError = 'Falta configurar EMAIL_USER y EMAIL_PASS en backend/.env para enviar correos.';
      } else {
        const host = req.get('host');
        const proto = req.protocol;
        const baseUrl = `${proto}://${host}`;
        const reciboUrl = `${baseUrl}/recibo/${reciboId}`;

        const montoFmt = formatMoney(monto);

        await emailService.sendReceiptEmail({
          to: emailAddress,
          clienteNombre: nombre,
          reciboId,
          monto: montoFmt,
          concepto,
          metodo,
          reciboUrl,
          receiptHtml,
          baseUrl,
        });

        emailSent = true;
      }
    } catch (err) {
      emailError = 'No se pudo enviar el correo.';
      console.error('Error enviando correo:', err);
    }

    res.status(201).json({
      error: false,
      mensaje: 'Recibo guardado correctamente',
      reciboId,
      reciboUrl: `/recibo/${reciboId}`,
      receiptSaved,
      receiptSaveError,
      emailSent,
      emailError,
    });
  } catch (error) {
    console.error('Error al guardar recibo:', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al guardar en la base de datos',
    });
  }
});

app.get('/test-db', async (req, res) => {
  try {
    const [rows] = await db.pool.query('SELECT 1');
    res.json({ ok: true, rows });
  } catch (error) {
    console.error('Test DB error', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
const BIND_HOST = String(process.env.BIND_HOST || '').trim();
const server = BIND_HOST
  ? app.listen(PORT, BIND_HOST, () => {
    console.log(`Servidor escuchando en ${BIND_HOST}:${PORT}`);
  })
  : app.listen(PORT, () => {
    const addr = server.address && server.address();
    const human = addr && typeof addr === 'object' ? `${addr.address}:${addr.port}` : `:${PORT}`;
    console.log(`Servidor escuchando en ${human}`);
  });

process.on('SIGTERM', () => {
  try {
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5_000).unref();
  } catch {
    process.exit(0);
  }
});

db.testConnection()
  .then(async () => {
    try {
      await ensureUsuariosTable();
    } catch (e) {
      console.error('WARN: No se pudo inicializar la tabla usuarios:', e && e.message ? e.message : e);
    }
  })
  .catch(() => {});



