// Date helpers work in the server's local time zone (set TZ, default Asia/Kolkata).

const pad = n => String(n).padStart(2, '0');

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function currentMonth() {
  return today().slice(0, 7);
}

function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// Inclusive list of YYYY-MM from `from` to `to`.
function monthRange(from, to) {
  const out = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function dateLabel(date) {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function lastDayOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${pad(new Date(y, m, 0).getDate())}`;
}

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const money = n => '₹' + inr.format(n || 0);
const moneyPlain = n => 'Rs. ' + inr.format(n || 0); // PDF core fonts have no ₹ glyph

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const isMonth = s => /^\d{4}-\d{2}$/.test(s || '');

// Digits only, with India country code for wa.me links.
function waPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  return digits;
}

function batchName(b) {
  return b ? `Class ${b.class}-${b.division}` : '';
}

module.exports = {
  today, currentMonth, addMonths, monthRange, monthLabel, dateLabel, lastDayOfMonth,
  money, moneyPlain, isDate, isMonth, waPhone, batchName, MONTHS,
};
