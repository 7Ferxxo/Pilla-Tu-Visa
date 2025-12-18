const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

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
  fechaEmision,
  clienteEmail,
}) {
  const transporter = buildTransporter();

  const logoPath = path.join(__dirname, 'public', 'Imagenes', 'logo.png');
  const logoExists = fs.existsSync(logoPath);

  const subject = `Recibo de pago #${reciboId} | Pilla Tu Visa`;

  const embeddedReceipt = buildEmailPreview({
    clienteNombre,
    clienteEmail: clienteEmail || to,
    reciboId,
    monto,
    concepto,
    metodo,
    fechaEmision,
    logoCid: logoExists ? 'logo-inline' : null,
  });

  const pdfBuffer = await buildReceiptPdf({
    clienteNombre,
    clienteEmail: clienteEmail || to,
    reciboId,
    monto,
    concepto,
    metodo,
    fechaEmision,
    logoPath: logoExists ? logoPath : null,
  });

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif; background:#f3f4f6; padding:24px;">
    <div style="max-width:680px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:16px; padding:24px;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div style="display:flex; align-items:center; gap:10px;">
          ${logoExists ? '<img src="cid:logo-inline" alt="Pilla Tu Visa" style="height:42px; width:auto;" />' : ''}
          <h2 style="margin:0; color:#0f172a; font-size:22px;">Recibo de pago</h2>
        </div>
        <a href="${escapeHtml(reciboUrl)}" style="display:inline-block; background:#111827; color:#ffffff; text-decoration:none; padding:10px 14px; border-radius:10px; font-weight:700;">Ver recibo #${escapeHtml(reciboId)}</a>
      </div>

      <div style="height:4px; background:#dc2626; border-radius:999px; margin:16px 0 18px;"></div>

      <p style="margin:0 0 8px; color:#0f172a;">Hola ${escapeHtml(clienteNombre || '')},</p>
      <p style="margin:0 0 18px; color:#0f172a;">Aquí tienes tu comprobante de pago. También adjuntamos el PDF.</p>

      ${embeddedReceipt}

      <p style="margin:16px 0 0; color:#6b7280; font-size:12px;">Si no ves bien el recibo, usa el botón “Ver recibo” o abre el PDF adjunto.</p>
    </div>
  </div>`;

  const text = [
    'Recibo de pago',
    `Recibo #${reciboId}`,
    `Fecha: ${fechaEmision || ''}`,
    `Cliente: ${clienteNombre || ''}`,
    `Email: ${clienteEmail || to || ''}`,
    `Concepto: ${concepto}`,
    `Método: ${metodo}`,
    `Monto: ${formatCurrency(monto)}`,
    `Link: ${reciboUrl}`,
  ].join('\n');

  const attachments = [];
  if (logoExists) {
    attachments.push({
      filename: 'logo.png',
      path: logoPath,
      cid: 'logo-inline',
    });
  }

  if (pdfBuffer) {
    attachments.push({
      filename: `recibo-${reciboId}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
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

module.exports = {
  hasEmailConfig,
  sendReceiptEmail,
  buildReceiptPdf,
  buildEmailPreview,
  sendLeadNotification,
};

async function sendLeadNotification({ nombre, email, telefono, mensaje }) {
  const transporter = buildTransporter();

  const subject = 'Nuevo cliente potencial - Pilla Tu Visa';

  const safeNombre = escapeHtml(nombre || '');
  const safeEmail = escapeHtml(email || '');
  const safeTelefono = escapeHtml(telefono || '');
  const safeMensaje = escapeHtml(mensaje || '');

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif; background:#0f172a; padding:24px; color:#e5e7eb;">
    <div style="max-width:640px; margin:0 auto; background:#020617; border-radius:14px; padding:20px 22px; border:1px solid #1f2937;">
      <h2 style="margin:0 0 12px; color:#f9fafb;">Nuevo cliente potencial</h2>
      <p style="margin:0 0 8px;">Se registró un posible cliente interesado en asesoría de visa:</p>
      <ul style="margin:0 0 14px 18px; padding:0;">
        <li><strong>Nombre:</strong> ${safeNombre}</li>
        <li><strong>Email:</strong> ${safeEmail}</li>
        <li><strong>Teléfono:</strong> ${safeTelefono || 'No indicado'}</li>
      </ul>
      <p style="margin:0 0 6px;"><strong>Mensaje:</strong></p>
      <p style="margin:0; white-space:pre-line;">${safeMensaje || 'Sin mensaje adicional.'}</p>
    </div>
  </div>`;

  const text = [
    'Nuevo cliente potencial',
    `Nombre: ${nombre || ''}`,
    `Email: ${email || ''}`,
    `Teléfono: ${telefono || ''}`,
    `Mensaje: ${mensaje || ''}`,
  ].join('\n');

  return transporter.sendMail({
    from: EMAIL_USER,
    to: EMAIL_USER,
    subject,
    text,
    html,
  });
}

function buildReceiptPdf({
  clienteNombre,
  clienteEmail,
  reciboId,
  monto,
  concepto,
  metodo,
  fechaEmision,
  logoPath,
}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      // fondo suave
      doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f3f4f6');
      doc.fillColor('#000000');

      // tarjeta principal
      const cardX = 30;
      const cardY = 40;
      const cardW = doc.page.width - cardX * 2;
      const cardH = doc.page.height - cardY * 2;
      const innerPadding = 24;
      const contentWidth = cardW - innerPadding * 2;

      doc.roundedRect(cardX, cardY, cardW, cardH, 18).fill('#ffffff');

      doc.translate(cardX + innerPadding, cardY + innerPadding);

      // header con logo y título
      const headerYStart = doc.y;
      if (logoPath && fs.existsSync(logoPath)) {
        try {
          doc.image(logoPath, doc.x, doc.y, { fit: [120, 60] });
        } catch {}
      }
      doc.font('Helvetica-Bold').fontSize(22).text('Comprobante Oficial de Pago', 0, headerYStart, {
        align: 'center',
        width: contentWidth,
      });

      doc.moveDown(1.2);
      doc.save();
      doc.rect(0, doc.y, contentWidth, 3).fill('#dc2626');
      doc.restore();
      doc.moveDown(1.5);

      // Datos principales (dos columnas en tarjeta interna)
      const info = [
        ['Recibo #', `#${reciboId}`],
        ['Fecha de Emisión', fechaEmision || ''],
        ['Cliente', clienteNombre || ''],
        ['Email', clienteEmail || ''],
        ['Método de Pago', metodo || ''],
      ];

      doc.fontSize(11);

      // tarjeta interna de datos del cliente
      const clientBoxY = doc.y + 4;
      const clientBoxH = info.length * 18 + 18;
      doc.save();
      doc.roundedRect(0, clientBoxY, contentWidth, clientBoxH, 12).fill('#f9fafb');
      doc.restore();

      doc.y = clientBoxY + 10;
      const labelWidth = 130;
      info.forEach(([label, value]) => {
        const rowY = doc.y;
        doc.font('Helvetica-Bold').fillColor('#6b7280')
          .text(label, 14, rowY, { width: labelWidth });
        doc.font('Helvetica').fillColor('#111827')
          .text(value, 14 + labelWidth + 16, rowY, { width: contentWidth - labelWidth - 30 });
        doc.y = rowY + 18;
      });

      doc.y = clientBoxY + clientBoxH + 18;
      doc.font('Helvetica-Bold').fillColor('#6b7280').text('CONCEPTO DEL SERVICIO', 4, doc.y, {
        characterSpacing: 0.5,
      });

      const conceptBoxY = doc.y + 10;
      const conceptBoxH = 26;
      doc.save();
      doc.roundedRect(0, conceptBoxY, contentWidth, conceptBoxH, 10).fill('#f9fafb');
      doc.restore();
      doc.font('Helvetica').fillColor('#111827').text(concepto || '', 14, conceptBoxY + 8, {
        width: contentWidth - 28,
      });

      const totalTitleY = conceptBoxY + conceptBoxH + 18;
      doc.font('Helvetica-Bold').fillColor('#6b7280').text('TOTAL', 4, totalTitleY, {
        characterSpacing: 0.5,
      });

      const totalBoxY = totalTitleY + 10;
      const totalBoxH = 30;
      doc.save();
      doc.roundedRect(0, totalBoxY, contentWidth, totalBoxH, 10).fill('#fef2f2');
      doc.restore();
      doc.font('Helvetica-Bold').fillColor('#b91c1c').fontSize(14)
        .text(formatCurrency(monto), 14, totalBoxY + 8, { width: contentWidth - 28 });

      const footerY = totalBoxY + totalBoxH + 24;
      doc.font('Helvetica-Oblique').fontSize(9).fillColor('#4b5563')
        .text('Este comprobante es generado automáticamente por el sistema Pilla Tu Visa.', {
          align: 'center',
          width: contentWidth,
          lineGap: 2,
          baseline: 'middle',
        });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function buildEmailPreview({
  clienteNombre,
  clienteEmail,
  reciboId,
  monto,
  concepto,
  metodo,
  fechaEmision,
  logoCid,
}) {
  const money = formatCurrency(monto);

  return `
    <div style="background:#f3f4f6; padding:10px;">
      <div style="background:#ffffff; border:1px solid #e5e7eb; border-radius:14px; padding:18px 18px 10px;">
        <div style="display:flex; align-items:center; justify-content:center; gap:14px; margin-bottom:14px;">
          ${logoCid ? `<img src="cid:${logoCid}" alt="Pilla Tu Visa" style="height:40px; width:auto;" />` : ''}
          <div style="font-size:20px; font-weight:700; color:#0f172a;">Comprobante Oficial de Pago</div>
        </div>
        <div style="height:3px; background:#dc2626; border-radius:999px; margin:0 0 16px;"></div>

        <table style="width:100%; border-collapse:collapse; font-size:13px; color:#0f172a;">
          <tr>
            <td style="padding:6px 0; font-weight:700; color:#4b5563;">Recibo</td>
            <td style="padding:6px 0;">#${escapeHtml(reciboId)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0; font-weight:700; color:#4b5563;">Fecha de Emisión</td>
            <td style="padding:6px 0;">${escapeHtml(fechaEmision || '')}</td>
          </tr>
          <tr>
            <td style="padding:6px 0; font-weight:700; color:#4b5563;">Cliente</td>
            <td style="padding:6px 0;">${escapeHtml(clienteNombre || '')}</td>
          </tr>
          <tr>
            <td style="padding:6px 0; font-weight:700; color:#4b5563;">Email</td>
            <td style="padding:6px 0;">${escapeHtml(clienteEmail || '')}</td>
          </tr>
          <tr>
            <td style="padding:6px 0; font-weight:700; color:#4b5563;">Método de Pago</td>
            <td style="padding:6px 0;">${escapeHtml(metodo || '')}</td>
          </tr>
        </table>

        <div style="margin:16px 0 10px; font-weight:700; color:#4b5563; text-transform:uppercase; font-size:12px;">Concepto del servicio</div>
        <div style="padding:10px 12px; border:1px solid #e5e7eb; border-radius:10px; background:#f9fafb; color:#111827;">${escapeHtml(concepto || '')}</div>

        <div style="margin:14px 0 8px; font-weight:700; color:#4b5563; text-transform:uppercase; font-size:12px;">Total</div>
        <div style="padding:12px 14px; border:1px solid #e5e7eb; border-radius:12px; background:#fef2f2; color:#b91c1c; font-weight:800; font-size:15px;">${escapeHtml(money)}</div>

      </div>
    </div>
  `;
}

function formatCurrency(monto) {
  const num = Number(monto);
  if (Number.isFinite(num)) {
    return `$${num.toFixed(2)}`;
  }
  const str = String(monto || '').trim();
  return str.startsWith('$') ? str : `$${str}`;
}
