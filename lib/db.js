const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// DB_PATH points at the database file; its folder also holds backups and the session key.
const DB_PATH = process.env.DB_PATH
  || path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'tuition.db');
const DATA_DIR = path.dirname(DB_PATH);
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- One batch per class + division, e.g. 8-A. Fee is per batch per month.
CREATE TABLE IF NOT EXISTS batches (
  id          INTEGER PRIMARY KEY,
  class       INTEGER NOT NULL,
  division    TEXT NOT NULL,
  monthly_fee INTEGER NOT NULL,
  UNIQUE (class, division)
);

CREATE TABLE IF NOT EXISTS students (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  roll_no         TEXT,
  batch_id        INTEGER NOT NULL REFERENCES batches(id),
  parent_name     TEXT,
  phone           TEXT,
  joined_on       TEXT NOT NULL,          -- YYYY-MM-DD
  fee_start_month TEXT NOT NULL,          -- YYYY-MM, first month fees are charged
  active          INTEGER NOT NULL DEFAULT 1,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per student per month charged. Amount is frozen at the batch fee
-- when the month is generated, so later fee changes don't rewrite history.
CREATE TABLE IF NOT EXISTS dues (
  id         INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,               -- YYYY-MM
  amount     INTEGER NOT NULL,
  waived     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (student_id, month)
);

CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  batch_id   INTEGER NOT NULL REFERENCES batches(id),
  amount     INTEGER NOT NULL,
  paid_on    TEXT NOT NULL,               -- YYYY-MM-DD
  method     TEXT NOT NULL,
  covers     TEXT,                        -- human readable months covered
  note       TEXT,
  voided     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  batch_id   INTEGER NOT NULL REFERENCES batches(id),
  date       TEXT NOT NULL,               -- YYYY-MM-DD
  status     TEXT NOT NULL CHECK (status IN ('P','A')),
  PRIMARY KEY (student_id, date)
);

CREATE TABLE IF NOT EXISTS subjects (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS exams (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  max_marks INTEGER NOT NULL,             -- per subject
  sort      INTEGER NOT NULL DEFAULT 0    -- exam order, used for "most improved"
);

-- A row with marks NULL means absent; no row means not entered yet.
CREATE TABLE IF NOT EXISTS marks (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  exam_id    INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  marks      REAL,
  PRIMARY KEY (student_id, exam_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_students_batch ON students(batch_id);
CREATE INDEX IF NOT EXISTS idx_marks_exam ON marks(exam_id);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(paid_on);
CREATE INDEX IF NOT EXISTS idx_attendance_batch_date ON attendance(batch_id, date);
`);

// Seed classes 8-10, divisions A-D on first run.
if (db.prepare('SELECT COUNT(*) n FROM batches').get().n === 0) {
  const insert = db.prepare('INSERT INTO batches (class, division, monthly_fee) VALUES (?, ?, ?)');
  db.transaction(() => {
    for (const cls of [8, 9, 10]) for (const div of ['A', 'B', 'C', 'D']) insert.run(cls, div, 2500);
  })();
}

if (db.prepare('SELECT COUNT(*) n FROM subjects').get().n === 0) {
  const insert = db.prepare('INSERT INTO subjects (name, sort) VALUES (?, ?)');
  ['English', 'Second Language', 'Maths', 'Science', 'Social Science'].forEach((s, i) => insert.run(s, i));
}

if (db.prepare('SELECT COUNT(*) n FROM exams').get().n === 0) {
  const insert = db.prepare('INSERT INTO exams (name, max_marks, sort) VALUES (?, ?, ?)');
  [['Unit Test 1', 50], ['Mid Term', 100], ['Unit Test 2', 50], ['Final Exam', 100]].forEach(([n, m], i) => insert.run(n, m, i));
}

const defaults = {
  pass_percent: '33',
  center_name: 'My Tuition Center',
  center_address: '',
  center_phone: '',
  receipt_prefix: 'R',
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaults)) insertSetting.run(k, v);

function getSettings() {
  return Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]));
}

module.exports = { db, getSettings, DATA_DIR };
