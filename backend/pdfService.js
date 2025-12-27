const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function generateReceiptPdf({ reciboId, fechaEmision, nombre, email, metodo, concepto, monto }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // --- Header ---
      const logoPath = path.join(__dirname, 'public', 'Imagenes', 'logo.png');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 50, 20, { width: 100 });
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(20)
        .text('Comprobante Oficial de Pago', 160, 65, { align: 'right' })
        .moveDown();

      // Divider
      doc
        .strokeColor('#dc2626') // Red color from CSS
        .lineWidth(3)
        .moveTo(50, 110)
        .lineTo(550, 110)
        .stroke();

      // --- Meta Info ---
      const startY = 140;
      const labelX = 50;
      const valueX = 200;
      const lineHeight = 20;

      doc.font('Helvetica-Bold').fontSize(10).fillColor('#6b7280'); // Gray
      doc.text('Fecha de Emisión:', labelX, startY);
      doc.text('Cliente:', labelX, startY + lineHeight);
      doc.text('Email:', labelX, startY + lineHeight * 2);
      doc.text('Método de Pago:', labelX, startY + lineHeight * 3);

      doc.font('Helvetica').fillColor('#111827'); // Dark
      doc.text(fechaEmision, valueX, startY);
      doc.text(nombre, valueX, startY + lineHeight);
      doc.text(email, valueX, startY + lineHeight * 2);
      doc.text(metodo, valueX, startY + lineHeight * 3);

      doc.moveDown(4);

      // --- Table ---
      const tableTop = 250;
      const col1X = 50;
      const col2X = 400;

      // Table Header
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#6b7280')
        .text('CONCEPTO DEL SERVICIO', col1X, tableTop)
        .text('MONTO PAGADO', col2X, tableTop, { align: 'right', width: 150 });

      // Line
      doc
        .strokeColor('#e5e7eb')
        .lineWidth(1)
        .moveTo(50, tableTop + 15)
        .lineTo(550, tableTop + 15)
        .stroke();

      // Table Row
      const rowTop = tableTop + 30;
      doc
        .font('Helvetica')
        .fontSize(12)
        .fillColor('#111827')
        .text(concepto, col1X, rowTop)
        .text(`$${monto}`, col2X, rowTop, { align: 'right', width: 150 });

      // Line
      doc
        .strokeColor('#e5e7eb')
        .lineWidth(1)
        .moveTo(50, rowTop + 20)
        .lineTo(550, rowTop + 20)
        .stroke();

      // Total
      const totalTop = rowTop + 40;
      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor('#6b7280')
        .text('TOTAL', col1X, totalTop)
        .fillColor('#111827')
        .text(`$${monto}`, col2X, totalTop, { align: 'right', width: 150 });

      // --- Footer ---
      doc
        .fontSize(10)
        .fillColor('#6b7280')
        .text(
          'Este comprobante es generado automáticamente por el sistema Pilla Tu Visa.',
          50,
          700,
          { align: 'center', width: 500 }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateReceiptPdf };
