const PDFDocument = require('pdfkit');
const { db, getSettings } = require('./db');
const { moneyPlain, dateLabel } = require('./util');

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
  'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n) {
  return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
}

// Indian numbering: crore, lakh, thousand, hundred.
function inWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const units = [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand'], [100, 'Hundred']];
  for (const [size, name] of units) {
    if (n >= size) {
      parts.push(`${inWords(Math.floor(n / size))} ${name}`);
      n %= size;
    }
  }
  if (n) parts.push(twoDigits(n));
  return parts.join(' ');
}

function paymentDetails(paymentId) {
  return db.prepare(`
    SELECT p.*, s.name, s.roll_no, s.parent_name, s.phone, b.class, b.division
    FROM payments p JOIN students s ON s.id = p.student_id JOIN batches b ON b.id = p.batch_id
    WHERE p.id = ?
  `).get(paymentId);
}

// Balance right after this payment: dues up to the payment month minus payments up to this one.
function balanceAfter(p) {
  const r = db.prepare(`
    SELECT
      (SELECT COALESCE(SUM(amount), 0) FROM dues WHERE student_id = ? AND waived = 0 AND month <= ?) AS due,
      (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE student_id = ? AND voided = 0 AND id <= ?) AS paid
  `).get(p.student_id, p.paid_on.slice(0, 7), p.student_id, p.id);
  return r.due - r.paid;
}

function streamReceipt(p, res) {
  const s = getSettings();
  const doc = new PDFDocument({ size: 'A5', margin: 36, info: { Title: `Receipt ${p.receipt_no}` } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Receipt-${p.receipt_no}.pdf"`);
  doc.pipe(res);

  const W = doc.page.width - 72;
  const L = 36;
  const ink = '#1f2937', muted = '#6b7280', accent = '#2563eb';

  doc.rect(0, 0, doc.page.width, 6).fill(accent);
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(16).text(s.center_name || 'Tuition Center', L, 30, { width: W, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor(muted);
  const contact = [s.center_address, s.center_phone && `Ph: ${s.center_phone}`].filter(Boolean).join('  |  ');
  if (contact) doc.text(contact, { width: W, align: 'center' });

  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(accent).text('FEE RECEIPT', { width: W, align: 'center', characterSpacing: 2 });
  doc.moveDown(0.6);

  const y0 = doc.y;
  doc.font('Helvetica').fontSize(9).fillColor(muted).text('Receipt No.', L, y0);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(ink).text(p.receipt_no, L, y0 + 12);
  doc.font('Helvetica').fontSize(9).fillColor(muted).text('Date', L, y0, { width: W, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(ink).text(dateLabel(p.paid_on), L, y0 + 12, { width: W, align: 'right' });

  doc.moveTo(L, y0 + 32).lineTo(L + W, y0 + 32).strokeColor('#e5e7eb').stroke();

  let y = y0 + 44;
  const row = (label, value) => {
    doc.font('Helvetica').fontSize(9).fillColor(muted).text(label, L, y, { width: 110 });
    doc.font('Helvetica').fontSize(10).fillColor(ink).text(value || '-', L + 110, y, { width: W - 110 });
    y = doc.y + 6;
  };
  row('Student', p.name);
  row('Class', `${p.class}-${p.division}` +(p.roll_no ? `   (Roll No. ${p.roll_no})` : ''));
  if (p.parent_name) row('Parent / Guardian', p.parent_name);
  row('Payment method', p.method);
  if (p.note) row('Note', p.note);

  // Line item table
  y += 6;
  doc.rect(L, y, W, 22).fill('#f3f4f6');
  doc.fillColor(muted).font('Helvetica-Bold').fontSize(9)
    .text('DESCRIPTION', L + 10, y + 7).text('AMOUNT', L, y + 7, { width: W - 10, align: 'right' });
  y += 30;
  doc.fillColor(ink).font('Helvetica').fontSize(10)
    .text(`Tuition fee - ${p.covers || ''}`, L + 10, y, { width: W - 120 })
    .text(moneyPlain(p.amount), L, y, { width: W - 10, align: 'right' });
  y = Math.max(doc.y, y + 14) + 10;
  doc.moveTo(L, y).lineTo(L + W, y).strokeColor('#e5e7eb').stroke();
  y += 10;
  doc.font('Helvetica-Bold').fontSize(12)
    .text('Total Paid', L + 10, y).text(moneyPlain(p.amount), L, y, { width: W - 10, align: 'right' });
  y += 20;
  doc.font('Helvetica-Oblique').fontSize(9).fillColor(muted)
    .text(`Rupees ${inWords(p.amount)} Only`, L + 10, y, { width: W - 20 });
  y = doc.y + 10;

  const bal = balanceAfter(p);
  doc.font('Helvetica').fontSize(9).fillColor(muted)
    .text(bal > 0 ? `Balance pending after this payment: ${moneyPlain(bal)}`
      : bal < 0 ? `Advance paid: ${moneyPlain(-bal)}` : 'No balance pending.', L + 10, y);

  if (p.voided) {
    doc.save().rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] })
      .font('Helvetica-Bold').fontSize(72).fillColor('#dc2626').opacity(0.25)
      .text('VOID', 0, doc.page.height / 2 - 40, { width: doc.page.width, align: 'center' }).restore();
  }

  doc.opacity(1).font('Helvetica').fontSize(8).fillColor(muted)
    .text('This is a computer generated receipt.', L, doc.page.height - 60, { width: W, align: 'center' });
  doc.end();
}

module.exports = { paymentDetails, streamReceipt, inWords };
