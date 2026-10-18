// Exam results and topper analysis. Percentages are total marks obtained / total
// max marks across the subjects entered; an absent subject counts as 0.

const { db, getSettings } = require('./db');

const GRADES = [
  ['A1', 91], ['A2', 81], ['B1', 71], ['B2', 61], ['C1', 51], ['C2', 41], ['D', 33], ['E', 0],
];
const grade = pct => GRADES.find(([, min]) => pct >= min)[0];
const pctOf = (obtained, max) => (max ? Math.round((obtained / max) * 1000) / 10 : 0);
const avg = xs => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);
const passPercent = () => Number(getSettings().pass_percent) || 33;

const subjects = () => db.prepare('SELECT * FROM subjects ORDER BY sort, id').all();
const exams = () => db.prepare(`
  SELECT e.*, (SELECT COUNT(DISTINCT student_id) FROM marks m WHERE m.exam_id = e.id) students
  FROM exams e ORDER BY e.sort, e.id
`).all();

// Competition ranking (1, 1, 3) within each group; list must be sorted by pct desc.
function assignRank(list, key, groupOf = () => 0) {
  const seen = new Map();
  for (const s of list) {
    const g = groupOf(s);
    const st = seen.get(g) || { n: 0, lastPct: null, lastRank: 0 };
    st.n++;
    if (s.pct !== st.lastPct) { st.lastRank = st.n; st.lastPct = s.pct; }
    s[key] = st.lastRank;
    seen.set(g, st);
  }
  for (const s of list) s[key + 'Of'] = seen.get(groupOf(s)).n;
}

// One row per active student who has marks in the exam (or in any exam when examId is null).
function results(examId = null) {
  const rows = db.prepare(`
    SELECT m.student_id, m.subject_id, m.marks, e.max_marks,
      s.name, s.roll_no, s.batch_id, b.class, b.division
    FROM marks m JOIN exams e ON e.id = m.exam_id
    JOIN students s ON s.id = m.student_id JOIN batches b ON b.id = s.batch_id
    WHERE s.active = 1 ${examId ? 'AND m.exam_id = ?' : ''}
  `).all(...(examId ? [examId] : []));

  const pass = passPercent();
  const byStudent = new Map();
  for (const r of rows) {
    let st = byStudent.get(r.student_id);
    if (!st) {
      st = { id: r.student_id, name: r.name, roll_no: r.roll_no, batch_id: r.batch_id, class: r.class,
        division: r.division, obtained: 0, max: 0, subjects: {} };
      byStudent.set(r.student_id, st);
    }
    const sub = st.subjects[r.subject_id] || (st.subjects[r.subject_id] = { obtained: 0, max: 0, absent: 0 });
    sub.obtained += r.marks || 0;
    sub.max += r.max_marks;
    if (r.marks == null) sub.absent++;
    st.obtained += r.marks || 0;
    st.max += r.max_marks;
  }

  const list = [...byStudent.values()].map(st => {
    for (const sub of Object.values(st.subjects)) sub.pct = pctOf(sub.obtained, sub.max);
    st.pct = pctOf(st.obtained, st.max);
    st.grade = grade(st.pct);
    st.failed = Object.keys(st.subjects).filter(id => st.subjects[id].pct < pass).map(Number);
    st.passed = st.pct >= pass && st.failed.length === 0;
    return st;
  });
  list.sort((a, b) => b.pct - a.pct || b.obtained - a.obtained || a.name.localeCompare(b.name));
  assignRank(list, 'rank');
  assignRank(list, 'classRank', s => s.class);
  assignRank(list, 'divRank', s => s.batch_id);
  return list;
}

function attendancePct() {
  return new Map(db.prepare(`
    SELECT student_id, ROUND(AVG(status = 'P') * 100) pct FROM attendance GROUP BY student_id
  `).all().map(r => [r.student_id, r.pct]));
}

function analysis({ examId = null, classNo = null } = {}) {
  const all = results(examId);
  const scope = classNo ? all.filter(s => s.class === classNo) : all;
  const subs = subjects();
  const pass = passPercent();
  const batches = db.prepare('SELECT * FROM batches ORDER BY class, division').all();

  const kpis = {
    assessed: scope.length,
    average: avg(scope.map(s => s.pct)),
    passRate: scope.length ? Math.round((scope.filter(s => s.passed).length / scope.length) * 100) : 0,
    distinctions: scope.filter(s => s.pct >= 75).length,
    highest: scope[0] ? scope[0].pct : 0,
  };

  const classes = classNo ? [classNo] : [8, 9, 10];
  const classToppers = classes.map(c => {
    const list = all.filter(s => s.class === c);
    return { class: c, count: list.length, average: avg(list.map(s => s.pct)), top: list.slice(0, 3) };
  });

  const divisions = batches.filter(b => !classNo || b.class === classNo).map(b => {
    const list = scope.filter(s => s.batch_id === b.id);
    const best = list[0] ? list[0].pct : null;
    return { ...b, count: list.length, average: avg(list.map(s => s.pct)), toppers: list.filter(s => s.pct === best) };
  });

  const subjectStats = subs.map(sub => {
    const entries = scope.filter(s => s.subjects[sub.id]).map(s => ({ student: s, pct: s.subjects[sub.id].pct }));
    const best = entries.length ? Math.max(...entries.map(e => e.pct)) : null;
    return {
      ...sub,
      count: entries.length,
      average: avg(entries.map(e => e.pct)),
      passRate: entries.length ? Math.round((entries.filter(e => e.pct >= pass).length / entries.length) * 100) : 0,
      best,
      toppers: entries.filter(e => e.pct === best).map(e => e.student),
    };
  });

  const gradeDist = GRADES.map(([g, min]) => ({ grade: g, min, count: scope.filter(s => s.grade === g).length }));

  // Most improved: compare with the previous exam that has marks.
  let improved = [], prevExam = null;
  if (examId) {
    const list = exams();
    const idx = list.findIndex(e => e.id === examId);
    prevExam = list.slice(0, Math.max(idx, 0)).reverse().find(e => e.students > 0) || null;
    if (prevExam) {
      const prev = new Map(results(prevExam.id).map(s => [s.id, s.pct]));
      improved = scope.filter(s => prev.has(s.id))
        .map(s => ({ ...s, before: prev.get(s.id), change: Math.round((s.pct - prev.get(s.id)) * 10) / 10 }))
        .filter(s => s.change > 0)
        .sort((a, b) => b.change - a.change)
        .slice(0, 5);
    }
  }

  const subjectName = Object.fromEntries(subs.map(s => [s.id, s.name]));
  const attention = scope.filter(s => !s.passed).slice().reverse().slice(0, 10)
    .map(s => ({ ...s, failedNames: s.failed.map(id => subjectName[id]) }));

  const att = attendancePct();
  const buckets = [
    { label: '90% and above', test: p => p >= 90 },
    { label: '75% to 89%', test: p => p >= 75 && p < 90 },
    { label: 'Below 75%', test: p => p < 75 },
  ].map(b => {
    const list = scope.filter(s => att.has(s.id) && b.test(att.get(s.id)));
    return { label: b.label, count: list.length, average: avg(list.map(s => s.pct)) };
  });

  return {
    kpis, toppers: scope.slice(0, 10), classToppers, divisions, subjectStats, gradeDist,
    improved, prevExam, attention, attendance: buckets, all: scope, subjects: subs, pass,
  };
}

// Exam-by-exam history for one student.
function studentHistory(studentId) {
  return exams().filter(e => e.students > 0).map(e => {
    const s = results(e.id).find(r => r.id === Number(studentId));
    return s ? { exam: e, ...s } : null;
  }).filter(Boolean);
}

module.exports = { GRADES, grade, results, analysis, studentHistory, subjects, exams, passPercent };
