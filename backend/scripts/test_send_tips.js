const db = require('../db');

(async () => {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  const [rows] = await db.pool.query(
    "SELECT id, nombre, email FROM recibos WHERE email IS NOT NULL AND email != '' ORDER BY id DESC LIMIT 1"
  );

  const client = rows && rows[0];
  if (!client) {
    console.log('No hay clientes con email en la tabla recibos.');
    process.exit(0);
  }

  const payload = {
    clienteId: String(client.id),
    fechaCita: '2025-12-20',
    perfil: 'Prueba automática (script)',
    mensaje: [
      'Preguntas sugeridas:',
      '- ¿Cuál es el propósito del viaje?',
      '- ¿Cuánto tiempo planea quedarse?',
      '',
      'Consejos rápidos:',
      '- Responde claro y directo.',
      '- Lleva documentos ordenados.',
    ].join('\n'),
  };

  console.log('Enviando tips a:', client.email, '(recibo id:', client.id + ')');

  const resp = await fetch(`${baseUrl}/tips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => ({}));
  console.log('HTTP', resp.status);
  console.log(data);
  process.exit(0);
})().catch((e) => {
  console.error('ERROR:', e && e.message ? e.message : e);
  process.exit(1);
});
