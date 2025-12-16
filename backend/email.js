const nodemailer = require('nodemailer');

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

const hasEmailConfig = () => Boolean(EMAIL_USER && EMAIL_USER.trim() && EMAIL_PASS && EMAIL_PASS.trim());

const buildTransporter = () => {
  if (!hasEmailConfig()) {
    const err = new Error('Falta EMAIL_USER o EMAIL_PASS');
    err.code = 'NO_EMAIL_CONFIG';
    throw err;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS,
    },
  });
};

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

async function sendReceiptEmail({
  to,
  clienteNombre,
  reciboId,
  monto,
  concepto,
  metodo,
  reciboUrl,
}) {
  const transporter = buildTransporter();

  const subject = `Recibo de pago #${reciboId} | Pilla Tu Visa`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif; background:#f3f4f6; padding:24px;">
    <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:14px; padding:22px;">
      <h2 style="margin:0 0 10px; color:#111827;">Recibo de pago</h2>
      <div style="height:4px; background:#dc2626; border-radius:999px; margin:10px 0 16px;"></div>

      <p style="margin:0 0 10px; color:#111827;">Hola ${escapeHtml(clienteNombre || '')},</p>
      <p style="margin:0 0 16px; color:#111827;">Aquí tienes tu comprobante de pago. Puedes abrirlo desde el siguiente enlace:</p>

      <p style="margin:0 0 18px;"><a href="${escapeHtml(reciboUrl)}" style="display:inline-block; background:#111827; color:#ffffff; text-decoration:none; padding:10px 14px; border-radius:10px; font-weight:700;">Ver recibo #${escapeHtml(reciboId)}</a></p>

      <table style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
        <tr><td style="padding:10px 12px; border-bottom:1px solid #e5e7eb; color:#6b7280; font-weight:700;">Concepto</td><td style="padding:10px 12px; border-bottom:1px solid #e5e7eb;">${escapeHtml(concepto)}</td></tr>
        <tr><td style="padding:10px 12px; border-bottom:1px solid #e5e7eb; color:#6b7280; font-weight:700;">Método</td><td style="padding:10px 12px; border-bottom:1px solid #e5e7eb;">${escapeHtml(metodo)}</td></tr>
        <tr><td style="padding:10px 12px; color:#6b7280; font-weight:700;">Monto</td><td style="padding:10px 12px; font-weight:800;">$${escapeHtml(monto)}</td></tr>
      </table>

      <p style="margin:16px 0 0; color:#6b7280; font-size:12px;">Pilla Tu Visa System</p>
    </div>
  </div>`;

  const text = [
    'Recibo de pago',
    `Recibo #${reciboId}`,
    `Concepto: ${concepto}`,
    `Método: ${metodo}`,
    `Monto: $${monto}`,
    `Link: ${reciboUrl}`,
  ].join('\n');

  return transporter.sendMail({
    from: EMAIL_USER,
    to,
    subject,
    text,
    html,
  });
}

module.exports = {
  hasEmailConfig,
  sendReceiptEmail,
};
