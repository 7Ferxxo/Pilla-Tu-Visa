const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const EMAIL_USER = String(process.env.EMAIL_USER || '').trim();
const EMAIL_PASS = String(process.env.EMAIL_PASS || '').replace(/\s+/g, '');

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
  receiptHtml,
  baseUrl,
}) {
  const transporter = buildTransporter();

  const subject = `Recibo de pago #${reciboId} | Pilla Tu Visa`;

  let embeddedReceipt = '';
  try {
    if (receiptHtml && String(receiptHtml).trim()) {
      const cssPath = path.join(__dirname, 'templates', 'recibo.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      const extractBodyInner = (docHtml) => {
        const m = String(docHtml).match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        return m ? m[1] : String(docHtml);
      };

      const absolutizeLogo = (htmlFragment) => {
        if (!baseUrl) return htmlFragment;
        return String(htmlFragment)
          .replace(/src=\"\/(imagenes\/[^\"]+)\"/g, `src=\"${escapeHtml(baseUrl)}/$1\"`)
          .replace(/src=\'\/(imagenes\/[^\']+)\'/g, `src=\'${escapeHtml(baseUrl)}/$1\'`);
      };

      const bodyInner = extractBodyInner(receiptHtml);
      embeddedReceipt = `
        <div style="margin-top:20px;">
          <h3 style="margin:0 0 10px; color:#111827;">Vista previa del recibo</h3>
          <div style="border:1px solid #e5e7eb; border-radius:14px; overflow:hidden;">
            <style>${css}</style>
            ${absolutizeLogo(bodyInner)}
          </div>
          <p style="margin:12px 0 0; color:#6b7280; font-size:12px;">Si no puedes ver la vista previa, usa el botón “Ver recibo”.</p>
        </div>
      `;
    }
  } catch (e) {
    embeddedReceipt = '';
  }

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

      ${embeddedReceipt}

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

  const attachments = [];
  if (receiptHtml && String(receiptHtml).trim()) {
    attachments.push({
      filename: `recibo-${reciboId}.html`,
      content: String(receiptHtml),
      contentType: 'text/html; charset=utf-8',
    });
  }

  return transporter.sendMail({
    from: EMAIL_USER,
    to,
    subject,
    text,
    html,
    attachments,
  });
}

async function sendTestEmail({
  to,
  baseUrl,
} = {}) {
  const transporter = buildTransporter();
  const target = String(to || EMAIL_USER || '').trim();
  if (!target) {
    const err = new Error('Falta destinatario (to)');
    err.code = 'NO_TO';
    throw err;
  }

  const now = new Date();
  const subject = `Prueba de correo | Pilla Tu Visa | ${now.toISOString()}`;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif; background:#f3f4f6; padding:24px;">
      <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:14px; padding:22px;">
        <h2 style="margin:0 0 10px; color:#111827;">Correo de prueba</h2>
        <div style="height:4px; background:#dc2626; border-radius:999px; margin:10px 0 16px;"></div>
        <p style="margin:0 0 8px; color:#111827;">Si estás leyendo esto, el envío de correos funciona correctamente.</p>
        <p style="margin:0; color:#6b7280; font-size:12px;">Base URL: ${escapeHtml(baseUrl || '')}</p>
      </div>
    </div>
  `;

  const text = `Correo de prueba\nFecha: ${now.toISOString()}\nBase URL: ${baseUrl || ''}`;

  return transporter.sendMail({
    from: EMAIL_USER,
    to: target,
    subject,
    text,
    html,
  });
}

module.exports = {
  hasEmailConfig,
  sendReceiptEmail,
  sendTestEmail,
};
