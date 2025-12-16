require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const ai = require('./ai');

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

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
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

  const templatePath = path.join(__dirname, 'templates', 'recibo.html');
  let template;
  try {
    template = fs.readFileSync(templatePath, 'utf8');
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
    const escapeHtml = (s) => String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    const renderTemplate = (tpl, data) =>
      tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => data[key] ?? '');

    const date = new Date();
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = String(date.getFullYear());
    const fechaEmision = `${dd}/${mm}/${yyyy}`;

    const montoNum = Number(r.monto);
    const montoFmt = Number.isFinite(montoNum) ? montoNum.toFixed(2) : escapeHtml(r.monto);

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
  const { nombre, email, concepto, monto, metodo } = req.body;

  if (!nombre || !email || !concepto || !monto || !metodo) {
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
      email,
      concepto,
      monto,
      metodo,
    ]);

    res.status(201).json({
      error: false,
      mensaje: 'Recibo guardado correctamente',
      reciboId: result.insertId,
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



