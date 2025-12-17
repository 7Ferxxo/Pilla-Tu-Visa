require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });

const emailService = require('./email');

async function main() {
  const to = process.argv[2];

  if (!emailService.hasEmailConfig()) {
    console.error('Falta EMAIL_USER o EMAIL_PASS en backend/.env');
    process.exitCode = 2;
    return;
  }

  try {
    const info = await emailService.sendTestEmail({
      to,
      baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    });
    console.log('OK: correo enviado');
    if (info && info.messageId) console.log('messageId:', info.messageId);
  } catch (err) {
    console.error('ERROR: no se pudo enviar el correo');
    console.error('code:', err && err.code ? err.code : '');
    console.error('message:', err && err.message ? err.message : String(err));
    process.exitCode = 1;
  }
}

main();
