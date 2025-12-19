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

const nl2br = (text) => escapeHtml(text).replace(/\n/g, '<br>');

const sanitizeAiWording = (raw) => {
  const text = String(raw ?? '');
  if (!text) return '';

  return text
    .replace(/\b(preguntas?)\s+clave\s+generad[ao]s?\s+por\s+la\s+ia\b/gi, '$1 clave')
    .replace(/\b(preguntas?)\s+generad[ao]s?\s+por\s+la\s+ia\b/gi, '$1')
    .replace(/\b(preguntas?)\s+generad[ao]s?\s+por\s+ia\b/gi, '$1')
    .replace(/\bgenerad[ao]s?\s+por\s+la\s+ia\b/gi, '')
    .replace(/\bgenerad[ao]s?\s+por\s+ia\b/gi, '')
    .replace(/\bpor\s+la\s+ia\b/gi, '')
    .replace(/\bpor\s+ia\b/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const renderNumberedListHtml = (raw) => {
  const cleaned = sanitizeAiWording(raw);
  const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  const nonItems = [];

  for (const line of lines) {
    const m = line.match(/^\d+\s*[\.|\)|\-]\s*(.+)$/);
    if (m) items.push(m[1].trim());
    else nonItems.push(line);
  }

  if (items.length >= 2 && nonItems.length === 0) {
    const lis = items
      .map((t) => `<li style="margin:0 0 10px;">${escapeHtml(t)}</li>`)
      .join('');
    return `<ol style="margin:0; padding-left:18px; color:#111827; line-height:1.6;">${lis}</ol>`;
  }

  return `<div style="color:#111827; line-height:1.6;">${nl2br(cleaned)}</div>`;
};

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

async function sendRecoveryEmail({ to, username, resetUrl, expiresAt }) {
  const transporter = buildTransporter();
  const friendlyName = username || 'usuario';
  const subject = 'Recupera tu acceso | Pilla Tu Visa';
  const expiryText = expiresAt
    ? new Intl.DateTimeFormat('es-PA', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(expiresAt)
    : 'próximos 60 minutos';

  const safeResetUrl = escapeHtml(resetUrl || '');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif; background:#f3f4f6; padding:24px;">
      <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:14px; padding:24px;">
        <h2 style="margin:0 0 8px; color:#111827;">Recupera tu contraseña</h2>
        <p style="margin:0 0 12px; color:#374151;">Hola ${escapeHtml(friendlyName)}, recibimos una solicitud para restablecer tu contraseña del panel de Pilla Tu Visa.</p>
        <p style="margin:0 0 18px; color:#374151;">Haz clic en el botón para definir una nueva contraseña. El enlace vence el <strong>${escapeHtml(expiryText)}</strong>.</p>
        <p style="margin:0 0 20px;"><a href="${safeResetUrl}" style="display:inline-block; background:#111827; color:#ffffff; text-decoration:none; padding:12px 18px; border-radius:12px; font-weight:700;">Crear nueva contraseña</a></p>
        <p style="margin:0 0 16px; color:#6b7280; font-size:14px;">Si tú no solicitaste el cambio, ignora este correo y tu contraseña seguirá igual.</p>
        <div style="padding:12px 16px; border-radius:12px; background:#f9fafb; color:#4b5563; font-size:13px;">
          <strong>¿Problemas con el botón?</strong>
          <p style="margin:6px 0 0; word-break:break-all;"><a href="${safeResetUrl}" style="color:#111827;">${safeResetUrl}</a></p>
        </div>
      </div>
    </div>
  `;

  const text = [
    'Recupera tu contraseña',
    `Usuario: ${friendlyName}`,
    `Enlace: ${resetUrl}`,
    `Vence: ${expiryText}`,
    'Si no solicitaste el cambio, ignora este mensaje.',
  ].join('\n');

  return transporter.sendMail({
    from: EMAIL_USER,
    to,
    subject,
    text,
    html,
  });
}

async function sendTipsEmail({
  to,
  clienteNombre,
  fechaCita,
  perfil,
  mensaje,
  baseUrl,
}) {
  const transporter = buildTransporter();
  const subject = 'Tips de entrevista | Pilla Tu Visa';

  const safeBaseUrl = String(baseUrl || '').trim();
  const logoRemoteUrl = safeBaseUrl ? `${safeBaseUrl.replace(/\/$/, '')}/imagenes/logo.png` : '';
  const logoPath = path.join(__dirname, 'public', 'Imagenes', 'logo.png');
  const hasLogoFile = (() => {
    try {
      return fs.existsSync(logoPath);
    } catch {
      return false;
    }
  })();
  const logoImgHtml = hasLogoFile
    ? '<img src="cid:ptv-logo" alt="Pilla Tu Visa" style="width:44px; height:44px; object-fit:contain; border-radius:12px;" />'
    : (logoRemoteUrl
      ? `<img src="${escapeHtml(logoRemoteUrl)}" alt="Pilla Tu Visa" style="width:44px; height:44px; object-fit:contain; border-radius:12px;" />`
      : '');
  const bodyHtml = renderNumberedListHtml(String(mensaje || ''));

  const introParts = [];
  if (clienteNombre) introParts.push(`Hola ${escapeHtml(clienteNombre)},`);
  if (fechaCita) introParts.push(`tu cita consular está programada para el día <strong>${escapeHtml(fechaCita)}</strong>.`);
  if (!introParts.length) introParts.push('Hola,');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif; background:#f3f4f6; padding:24px;">
      <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:16px; padding:22px;">
        <div style="display:flex; align-items:center; gap:12px;">
          ${logoImgHtml}
          <div>
            <h2 style="margin:0; color:#111827; font-size:22px;">Preparación para tu entrevista</h2>
            <p style="margin:4px 0 0; color:#6b7280; font-size:13px;">Pilla Tu Visa</p>
          </div>
        </div>

        <div style="height:4px; background:#dc2626; border-radius:999px; margin:14px 0 16px;"></div>

        <p style="margin:0 0 12px; color:#111827;">${introParts.join(' ')}</p>
        <p style="margin:0 0 14px; color:#374151;">Te compartimos una lista de preguntas y puntos clave para que practiques con tiempo y llegues con seguridad.</p>

        <table style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden; margin:0 0 14px;">
          <tr>
            <td style="padding:10px 12px; border-bottom:1px solid #e5e7eb; color:#6b7280; font-weight:700; width:160px;">Fecha de cita</td>
            <td style="padding:10px 12px; border-bottom:1px solid #e5e7eb;">${escapeHtml(fechaCita || '')}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px; color:#6b7280; font-weight:700;">Perfil</td>
            <td style="padding:10px 12px;">${escapeHtml(perfil || '')}</td>
          </tr>
        </table>

        <div style="border:1px solid #e5e7eb; border-radius:12px; padding:14px; background:#fafafa;">
          <div style="font-weight:800; color:#111827; margin:0 0 10px;">Preguntas clave para practicar</div>
          ${bodyHtml}
        </div>

        <p style="margin:16px 0 0; color:#6b7280; font-size:12px;">Recuerda mantener la calma, la honestidad y la seguridad en ti mismo.</p>
        <p style="margin:6px 0 0; color:#6b7280; font-size:12px;">Pilla Tu Visa System</p>
      </div>
    </div>
  `;

  const text = [
    'Tips para tu entrevista',
    `Fecha de cita: ${fechaCita || ''}`,
    `Perfil: ${perfil || ''}`,
    '',
    sanitizeAiWording(String(mensaje || '')),
  ].join('\n');

  return transporter.sendMail({
    from: EMAIL_USER,
    to,
    subject,
    text,
    html,
    attachments: hasLogoFile
      ? [
          {
            filename: 'logo.png',
            path: logoPath,
            cid: 'ptv-logo',
          },
        ]
      : [],
  });
}

async function sendResultadoEmail({
  to,
  clienteNombre,
  estado,
  detalle,
  mensaje,
}) {
  const transporter = buildTransporter();
  const subject = 'Resultado de tu visa | Pilla Tu Visa';
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif; background:#f3f4f6; padding:24px;">
      <div style="max-width:720px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:14px; padding:22px;">
        <h2 style="margin:0 0 10px; color:#111827;">Resultado de tu visa</h2>
        <div style="height:4px; background:#dc2626; border-radius:999px; margin:10px 0 16px;"></div>

        <p style="margin:0 0 12px; color:#111827;">Hola ${escapeHtml(clienteNombre || '')},</p>

        <table style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden; margin:0 0 14px;">
          <tr>
            <td style="padding:10px 12px; border-bottom:1px solid #e5e7eb; color:#6b7280; font-weight:700; width:160px;">Estado</td>
            <td style="padding:10px 12px; border-bottom:1px solid #e5e7eb; font-weight:800;">${escapeHtml(estado || '')}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px; color:#6b7280; font-weight:700;">Detalle</td>
            <td style="padding:10px 12px;">${escapeHtml(detalle || '')}</td>
          </tr>
        </table>

        <div style="border:1px solid #e5e7eb; border-radius:12px; padding:14px 14px; background:#fafafa; color:#111827; line-height:1.6;">
          ${nl2br(String(mensaje || ''))}
        </div>

        <p style="margin:16px 0 0; color:#6b7280; font-size:12px;">Pilla Tu Visa System</p>
      </div>
    </div>
  `;

  const text = [
    'Resultado de tu visa',
    `Estado: ${estado || ''}`,
    `Detalle: ${detalle || ''}`,
    '',
    String(mensaje || ''),
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
  sendTestEmail,
  sendRecoveryEmail,
  sendTipsEmail,
  sendResultadoEmail,
};
