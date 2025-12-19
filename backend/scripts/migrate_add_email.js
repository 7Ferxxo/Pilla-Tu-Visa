const db = require('../db');

(async () => {
  const [cols] = await db.pool.query("SHOW COLUMNS FROM usuarios LIKE 'email'");
  if (!cols || cols.length === 0) {
    await db.pool.execute('ALTER TABLE usuarios ADD COLUMN email VARCHAR(120) NULL AFTER username');
    console.log('OK: columna email agregada');
  } else {
    console.log('OK: columna email ya existe');
  }

  const email = String(process.env.EMAIL_USER || '').trim();
  if (email) {
    await db.pool.execute(
      "UPDATE usuarios SET email = ? WHERE username = ? AND (email IS NULL OR email = '') LIMIT 1",
      [email, 'admin']
    );
    console.log('OK: email del admin actualizado (si estaba vacío)');
  } else {
    console.log('WARN: EMAIL_USER vacío, no se asignó email al admin');
  }

  process.exit(0);
})().catch((e) => {
  console.error('ERR:', e && e.message ? e.message : e);
  process.exit(1);
});
