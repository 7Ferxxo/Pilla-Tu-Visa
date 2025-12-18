require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const ai = require('./ai');
const emailService = require('./email');
const jwt = require('jsonwebtoken');

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

function getAdminPassword() {
  return String(process.env.ADMIN_PASSWORD || '').trim();
}

function parseExtraAdmins() {
  const raw = String(process.env.ADMIN_USERS || '').trim();
  if (!raw) return [];
  return raw.split(',').map((entry) => {
    const parts = entry.split(':').map((p) => String(p || '').trim());
    const username = parts[0];
    const password = parts[1];
    const role = parts[2] || 'admin';
    if (!username || !password) return null;
    return { username, password, role };
  }).filter(Boolean);
}

function getAuthUsers() {
  const users = [];
  const adminPass = getAdminPassword();
  if (adminPass) {
    users.push({ username: 'admin', password: adminPass, role: 'admin' });
  }
  const extras = parseExtraAdmins();
  return users.concat(extras);
}

function hasAuthConfig() {
  return Boolean(String(process.env.JWT_SECRET || '').trim() && getAuthUsers().length > 0);
}

function verificarToken(req, res, next) {
  if (!hasAuthConfig()) {
    return res.status(503).json({ ok: false, mensaje: 'Auth no configurado en backend/.env' });
  }

  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  const token = authHeader && String(authHeader).startsWith('Bearer ')
    ? String(authHeader).slice('Bearer '.length).trim()
    : null;

  if (!token) {
    return res.status(401).json({ ok: false, mensaje: 'Token de autenticación faltante' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ ok: false, mensaje: 'Token inválido o expirado' });
    }
    req.user = user;
    next();
  });
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

app.post('/api/login', (req, res) => {
  if (!hasAuthConfig()) {
    return res.status(503).json({ ok: false, mensaje: 'Falta JWT_SECRET o ADMIN_PASSWORD/ADMIN_USERS en backend/.env' });
  }

  const { username, password } = req.body || {};
  const providedUser = String(username || '').trim();
  const providedPass = String(password || '').trim();

  if (!providedUser || !providedPass) {
    return res.status(400).json({ ok: false, mensaje: 'Faltan credenciales' });
  }

  const users = getAuthUsers();
  const found = users.find((u) => u.username.toLowerCase() === providedUser.toLowerCase());
  console.log('Intento de login:', providedUser, 'usuarios disponibles:', users.map((u) => u.username));
  if (!found) {
    return res.status(401).json({ ok: false, mensaje: 'Usuario o contraseña incorrectos' });
  }

  const storedPass = String(found.password || '').trim();
  if (storedPass !== providedPass) {
    console.log('Intento de login fallido para usuario:', providedUser);
    return res.status(401).json({ ok: false, mensaje: 'Usuario o contraseña incorrectos' });
  }

  const role = found.role || 'admin';
  const token = jwt.sign({ role, username: found.username }, process.env.JWT_SECRET, { expiresIn: '2h' });
  res.json({ ok: true, token, role, username: found.username, mensaje: 'Login correcto' });
});

app.post('/api/potenciales', async (req, res) => {
  const { nombre, email: emailAddress, telefono, mensaje } = req.body || {};

  const safeNombre = String(nombre || '').trim();
  const safeEmail = String(emailAddress || '').trim();
  const safeTelefono = String(telefono || '').trim();
  const safeMensaje = String(mensaje || '').trim();

  if (!safeNombre || !safeEmail) {
    return res.status(400).json({ ok: false, mensaje: 'Nombre y email son obligatorios.' });
  }

  try {
    const sql = `
      INSERT INTO potenciales_clientes (nombre, email, telefono, mensaje, estado)
      VALUES (?, ?, ?, ?, ?)
    `;

    const [result] = await db.pool.execute(sql, [
      safeNombre,
      safeEmail,
      safeTelefono,
      safeMensaje,
      'nuevo',
    ]);

    const potencialId = result.insertId;

    let emailSent = false;
    let emailError = null;
    try {
      if (!emailService.hasEmailConfig()) {
        emailError = 'EMAIL_USER/EMAIL_PASS no configurados. No se envió correo.';
      } else {
        await emailService.sendLeadNotification({
          nombre: safeNombre,
          email: safeEmail,
          telefono: safeTelefono,
          mensaje: safeMensaje,
        });
        emailSent = true;
      }
    } catch (err) {
      emailError = 'No se pudo enviar la notificación por correo.';
      console.error('Error enviando email de cliente potencial:', err);
    }

    res.status(201).json({
      ok: true,
      mensaje: 'Hemos recibido tu solicitud, te contactaremos muy pronto.',
      potencialId,
      emailSent,
      emailError,
    });
  } catch (error) {
    console.error('Error al guardar cliente potencial:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al guardar tus datos. Inténtalo más tarde.' });
  }
});

app.get('/api/potenciales', verificarToken, async (req, res) => {
  try {
    const [rows] = await db.pool.query(
      'SELECT id, nombre, email, telefono, mensaje, creado_en, estado FROM potenciales_clientes ORDER BY creado_en DESC LIMIT 200'
    );
    res.json({ ok: true, items: rows || [] });
  } catch (error) {
    console.error('Error al listar clientes potenciales:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al cargar clientes potenciales' });
  }
});

app.post('/api/potenciales/:id/estado', verificarToken, async (req, res) => {
  const id = Number(req.params.id);
  const { estado } = req.body || {};

  const safeEstado = String(estado || '').trim().toLowerCase();
  const allowed = {
    nuevo: 'nuevo',
    contactado: 'contactado',
    descartado: 'descartado',
  };

  const finalEstado = allowed[safeEstado];

  if (!Number.isInteger(id) || !finalEstado) {
    return res.status(400).json({ ok: false, mensaje: 'Datos inválidos para actualizar estado.' });
  }

  try {
    const [result] = await db.pool.execute(
      'UPDATE potenciales_clientes SET estado = ? WHERE id = ? LIMIT 1',
      [finalEstado, id]
    );

    const affected = result && typeof result.affectedRows === 'number' ? result.affectedRows : 0;
    if (!affected) {
      return res.status(404).json({ ok: false, mensaje: 'Cliente potencial no encontrado.' });
    }

    res.json({ ok: true, mensaje: 'Estado actualizado correctamente.', id, estado: finalEstado });
  } catch (error) {
    console.error('Error al actualizar estado de cliente potencial:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar el estado.' });
  }
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.get('/cajaderecibos.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'caja-de-recibos', 'cajaderecibos.html'));
});

app.get('/clients', async (req, res) => {
  try {
    const [rows] = await db.pool.query(
      'SELECT id, nombre, email FROM recibos ORDER BY id DESC LIMIT 200'
    );
    res.json({ ok: true, clients: rows });
  } catch (error) {
    console.error('Error al listar clientes:', error);
    res.status(500).json({ ok: false, error: true, mensaje: 'Error al cargar clientes' });
  }
});

app.post('/ai/tips', async (req, res) => {
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

app.post('/ai/resultado', async (req, res) => {
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

app.get('/recibos', verificarToken, async (req, res) => {
  const limitRaw = Number(req.query.limit ?? 200);
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;

  try {
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

app.delete('/recibos/:id', verificarToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ ok: false, mensaje: 'ID inválido' });
  }

  try {
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

app.post('/tips', async (req, res) => {
  const { clienteId, fechaCita, perfil, mensaje } = req.body;

  if (!clienteId || !fechaCita || !mensaje) {
    return res.status(400).json({ error: true, mensaje: 'Faltan datos obligatorios' });
  }

  res.json({ error: false, mensaje: 'Tips enviados correctamente' });
});

app.post('/resultado', async (req, res) => {
  const { clienteId, estado, detalle, mensaje } = req.body;

  if (!clienteId || !estado || !mensaje) {
    return res.status(400).json({ error: true, mensaje: 'Faltan datos obligatorios' });
  }

  res.json({ error: false, mensaje: 'Resultado notificado correctamente' });
});

app.post('/register', async (req, res) => {
  const { nombre, email: emailAddress, concepto, monto, metodo, notas } = req.body;

  if (!nombre || !emailAddress || !concepto || !monto || !metodo) {
    return res.status(400).json({
      error: true,
      mensaje: 'Faltan datos obligatorios',
    });
  }

  try {
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

    const fechaEmision = formatDateDMY(new Date());
    const montoFmt = formatMoney(monto);

    let receiptHtml = null;
    let receiptSaved = false;
    let receiptSaveError = null;
    try {
      const template = getReceiptTemplate();

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
          fechaEmision,
          clienteEmail: emailAddress,
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
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

db.testConnection().catch(() => {});



