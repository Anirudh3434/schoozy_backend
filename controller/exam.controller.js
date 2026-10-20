import db from '../db/db.js';
import { bufferUpload } from '../utils/awsS3.js';

// ---------------------------------------------------------------------------
// Identity resolution.
// Production uses cookie sessions (withCredentials). For local testing we
// accept explicit params too. Priority:
//   1. body/query: email + exam_id (exam_code)
//   2. body/query: user_id (+ optional exam_id)
//   3. cookie: exam_session = base64url(JSON { user_id, exam_code })
// ---------------------------------------------------------------------------
function getSessionPayload(req) {
  try {
    const raw = req.cookies?.exam_session;
    if (!raw) return null;
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function resolveAssignment(req) {
  const src = { ...(req.query || {}), ...(req.body || {}) };
  let { email, exam_id, exam_code, user_id } = src;
  const code = exam_code || exam_id;

  if (!email && !user_id) {
    const sess = getSessionPayload(req);
    if (sess) {
      email = sess.email;
      user_id = sess.user_id;
    }
  }
  if (!code) {
    const sess = getSessionPayload(req);
    if (sess?.exam_code) return resolveByCode(sess, sess.exam_code);
  }
  if (!code) return { error: 'exam_id is required (query/body/cookie)' };

  if (email) {
    const r = await db.query(
      `SELECT a.*, s.user_id, s.full_name, s.email, e.exam_code, e.title, e.duration_minutes
       FROM exam_assignments a
       JOIN students s ON s.id = a.student_id
       JOIN exams e ON e.id = a.exam_id
       WHERE LOWER(TRIM(s.email)) = LOWER(TRIM($1)) AND UPPER(TRIM(e.exam_code)) = UPPER(TRIM($2))`,
      [email, code],
    );
    if (!r.rows.length) return { error: 'Invalid email / exam_id combination' };
    return { assignment: r.rows[0] };
  }

  if (user_id) return resolveByCode({ user_id }, code);
  return { error: 'email or user_id is required' };
}

async function resolveByCode(sess, code) {
  const r = await db.query(
    `SELECT a.*, s.user_id, s.full_name, s.email, e.exam_code, e.title, e.duration_minutes
     FROM exam_assignments a
     JOIN students s ON s.id = a.student_id
     JOIN exams e ON e.id = a.exam_id
     WHERE TRIM(s.user_id) = TRIM($1) AND UPPER(TRIM(e.exam_code)) = UPPER(TRIM($2))`,
    [sess.user_id, code],
  );
  if (!r.rows.length) return { error: 'Invalid user_id / exam_id combination' };
  return { assignment: r.rows[0] };
}

// ---------------------------------------------------------------------------
// Deterministic per-student option shuffling (anti-sharing).
// Same (assignment, question) always yields the same order, so grading can
// recompute the shuffle without storing per-student state.
// ---------------------------------------------------------------------------
function shuffleIndices(n, seed) {
  const order = Array.from({ length: n }, (_, i) => i);
  let s = seed >>> 0;
  const rand = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

const LETTERS = ['A', 'B', 'C', 'D'];

// Returns { options: [{text, media}], correctLetter } for the shuffled layout.
function shuffledLayout(qRow, assignmentId) {
  const texts = [qRow.option_a_text, qRow.option_b_text, qRow.option_c_text, qRow.option_d_text];
  const media = [qRow.option_a_media, qRow.option_b_media, qRow.option_c_media, qRow.option_d_media];
  const order = shuffleIndices(4, assignmentId * 7919 + qRow.id * 131);
  const options = order.map((origIdx) => ({ text: texts[origIdx], media: media[origIdx] }));
  const correctOrigIdx = LETTERS.indexOf((qRow.correct_option || 'A').toUpperCase());
  const correctLetter = LETTERS[order.indexOf(correctOrigIdx)];
  return { options, correctLetter };
}

function setSessionCookie(res, { user_id, email, exam_code }) {
  const val = Buffer.from(JSON.stringify({ user_id, email, exam_code })).toString('base64url');
  res.cookie('exam_session', val, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 3 * 60 * 60 * 1000,
  });
}

// POST /exam/verify-id  { email, exam_id }
export const verifyId = async (req, res) => {
  try {
    let { email, exam_id } = req.body || {};
    email = typeof email === 'string' ? email.trim() : email;
    exam_id = typeof exam_id === 'string' ? exam_id.trim() : exam_id;
    if (!email || !exam_id) {
      return res.status(400).json({ message: 'email and exam_id are required' });
    }
    req.body.email = email;
    req.body.exam_id = exam_id;
    const { assignment, error } = await resolveAssignment(req);
    if (error) return res.status(401).json({ message: error });

    if (assignment.status === 'Suspended') {
      return res.status(200).json({ message: 'Exam is already Suspended' });
    }
    if (assignment.status === 'Completed') {
      return res.status(200).json({ message: 'Exam is already Completed' });
    }

    setSessionCookie(res, {
      user_id: assignment.user_id,
      email: assignment.email,
      exam_code: assignment.exam_code,
    });

    return res.status(200).json({
      success: true,
      message: 'Verification successful',
      student: { full_name: assignment.full_name, email: assignment.email, user_id: assignment.user_id },
      exam: [{ exam_code: assignment.exam_code, title: assignment.title, exam_status: assignment.status, end_time: assignment.end_time }],
    });
  } catch (err) {
    console.error('❌ verifyId error:', err);
    return res.status(500).json({ message: 'Verification failed' });
  }
};

// GET /exam/verify-check  (landing page: ?exam_id=&email= or cookie)
export const verifyCheckGet = async (req, res) => {
  try {
    const { assignment, error } = await resolveAssignment(req);
    if (error) {
      // Landing page with no session yet: report not-verified without 500
      return res.status(200).json({ success: false, message: error });
    }
    return res.status(200).json({
      success: true,
      user: [{ full_name: assignment.full_name, email: assignment.email }],
      exam: [{ exam_code: assignment.exam_code, exam_status: assignment.status, end_time: assignment.end_time }],
    });
  } catch (err) {
    console.error('❌ verifyCheckGet error:', err);
    return res.status(500).json({ success: false, message: 'Verify check failed' });
  }
};

// POST /exam/verify-check  (instructions page: {} + cookie)
export const verifyCheckPost = async (req, res) => {
  try {
    const { assignment, error } = await resolveAssignment(req);
    if (error) return res.status(401).json({ message: error });
    return res.status(200).json({
      success: true,
      user: [{ full_name: assignment.full_name, email: assignment.email }],
      exam: [{ exam_code: assignment.exam_code, exam_status: assignment.status, end_time: assignment.end_time }],
    });
  } catch (err) {
    console.error('❌ verifyCheckPost error:', err);
    return res.status(500).json({ message: 'Verify check failed' });
  }
};

// GET /exam/get-question?question_number=N
export const getQuestion = async (req, res) => {
  try {
    const { assignment, error } = await resolveAssignment(req);
    if (error) return res.status(401).json({ success: false, message: error });
    if (assignment.status !== 'Active') {
      return res.status(403).json({ success: false, message: `Exam is ${assignment.status}` });
    }

    const qn = parseInt(req.query.question_number, 10);
    if (!qn || qn < 1) {
      return res.status(400).json({ success: false, message: 'valid question_number is required' });
    }

    const total = await db.query('SELECT COUNT(*)::int AS c FROM questions WHERE exam_id = $1', [assignment.exam_id]);
    const q = await db.query(
      `SELECT id, question_text, question_media,
              option_a_text, option_a_media, option_b_text, option_b_media,
              option_c_text, option_c_media, option_d_text, option_d_media,
              correct_option, marks, class, subject
       FROM questions WHERE exam_id = $1 AND question_number = $2`,
      [assignment.exam_id, qn],
    );
    if (!q.rows.length) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }
    // Shuffle options per student; NEVER send the answer key to the client.
    const row = q.rows[0];
    const { options } = shuffledLayout(row, assignment.id);
    return res.json({
      success: true,
      question: {
        question_id: row.id,
        question_text: row.question_text,
        question_media: row.question_media,
        option_a_text: options[0].text,
        option_a_media: options[0].media,
        option_b_text: options[1].text,
        option_b_media: options[1].media,
        option_c_text: options[2].text,
        option_c_media: options[2].media,
        option_d_text: options[3].text,
        option_d_media: options[3].media,
        marks: row.marks,
        class: row.class,
        subject: row.subject,
      },
      total_questions: total.rows[0].c,
    });
  } catch (err) {
    console.error('❌ getQuestion error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch question' });
  }
};

// POST /exam/submit-answer  { question_number, question_id, answer, time_taken }
export const submitAnswer = async (req, res) => {
  try {
    const { assignment, error } = await resolveAssignment(req);
    if (error) return res.status(401).json({ success: false, message: error });
    if (assignment.status !== 'Active') {
      return res.status(403).json({ success: false, message: `Exam is ${assignment.status}` });
    }

    const { question_number, question_id, answer = '', time_taken = '0' } = req.body || {};
    if (!question_number || !question_id) {
      return res.status(400).json({ success: false, message: 'question_number and question_id are required' });
    }

    // Server-side exam-window enforcement (60s grace for in-flight saves).
    if (assignment.end_time && Date.now() > new Date(assignment.end_time).getTime() + 60_000) {
      return res.status(403).json({ success: false, message: 'Exam time window has ended' });
    }

    const q = await db.query(
      `SELECT id, option_a_text, option_b_text, option_c_text, option_d_text, correct_option, marks
       FROM questions WHERE id = $1 AND exam_id = $2`,
      [question_id, assignment.exam_id],
    );
    if (!q.rows.length) {
      return res.status(404).json({ success: false, message: 'Question not found for this exam' });
    }

    // Grade against the same deterministic shuffle this student saw.
    const { correctLetter } = shuffledLayout(q.rows[0], assignment.id);
    const norm = String(answer).trim().toUpperCase();
    const isCorrect = norm && norm === correctLetter ? 1 : 0;
    // Marking scheme: +marks correct, -1 wrong, 0 unanswered
    const marksAwarded = !norm ? 0 : isCorrect ? q.rows[0].marks : -1;

    await db.query(
      `INSERT INTO exam_answers (assignment_id, question_number, question_id, selected_option, is_correct, marks_awarded, time_taken, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (assignment_id, question_number)
       DO UPDATE SET question_id = EXCLUDED.question_id, selected_option = EXCLUDED.selected_option,
                     is_correct = EXCLUDED.is_correct, marks_awarded = EXCLUDED.marks_awarded,
                     time_taken = EXCLUDED.time_taken, updated_at = NOW()`,
      [assignment.id, question_number, question_id, norm, isCorrect, marksAwarded, String(time_taken)],
    );

    return res.json({ success: true, message: 'Response saved', is_correct: isCorrect, marks_awarded: marksAwarded });
  } catch (err) {
    console.error('❌ submitAnswer error:', err);
    return res.status(500).json({ success: false, message: 'Failed to save response' });
  }
};

// GET /exam/submit-answer-info
export const submitAnswerInfo = async (req, res) => {
  try {
    const { assignment, error } = await resolveAssignment(req);
    if (error) return res.status(401).json({ success: false, message: error });

    const r = await db.query(
      `SELECT question_number, question_id, selected_option, is_correct, marks_awarded, time_taken
       FROM exam_answers WHERE assignment_id = $1 ORDER BY question_number`,
      [assignment.id],
    );
    return res.json({
      success: true,
      total_attempted: r.rows.length,
      question_attempted: r.rows.map((a) => a.question_number),
      answers: r.rows,
    });
  } catch (err) {
    console.error('❌ submitAnswerInfo error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve answers' });
  }
};

// POST /exam/log-violation  { violation_type, timestamp, severity, description, snapshot? (dataURL jpeg) }
export const logViolation = async (req, res) => {
  try {
    const { assignment, error } = await resolveAssignment(req);
    if (error) return res.status(401).json({ success: false, message: error });
    const { violation_type, timestamp, severity, description, snapshot } = req.body || {};
    if (!violation_type) return res.status(400).json({ success: false, message: 'violation_type is required' });

    // Optional webcam snapshot -> S3. Never fail the violation log on upload errors.
    let snapshotUrl = null;
    if (typeof snapshot === 'string' && snapshot.startsWith('data:image/')) {
      try {
        const base64 = snapshot.split(',')[1] || '';
        if (base64.length > 0 && base64.length < 700_000) {
          const buf = Buffer.from(base64, 'base64');
          snapshotUrl = await bufferUpload(buf, `violation-${assignment.id}-${Date.now()}.jpg`, 'image/jpeg');
        }
      } catch (uploadErr) {
        console.warn('⚠️ violation snapshot upload failed (continuing):', uploadErr.message);
      }
    }

    await db.query(
      'INSERT INTO exam_violations (assignment_id, violation_type, timestamp_ms, severity, description, snapshot_url) VALUES ($1, $2, $3, $4, $5, $6)',
      [assignment.id, violation_type, timestamp || Date.now(), severity || null, description || null, snapshotUrl],
    );
    return res.json({ success: true, message: 'Violation logged' });
  } catch (err) {
    console.error('❌ logViolation error:', err);
    return res.status(500).json({ success: false, message: 'Failed to log violation' });
  }
};

// POST /exam/heartbeat  { email, exam_id } -> presence ping + clock sync
export const heartbeat = async (req, res) => {
  try {
    const { assignment, error } = await resolveAssignment(req);
    if (error) return res.status(401).json({ success: false, message: error });
    await db.query('UPDATE exam_assignments SET updated_at = NOW() WHERE id = $1', [assignment.id]);
    return res.json({
      success: true,
      server_time: new Date().toISOString(),
      exam_status: assignment.status,
      end_time: assignment.end_time,
    });
  } catch (err) {
    console.error('❌ heartbeat error:', err);
    return res.status(500).json({ success: false, message: 'Heartbeat failed' });
  }
};

// GET /exam/proctor/overview -> all assignments with attempt/violation/score rollups
export const proctorOverview = async (_req, res) => {
  try {
    const r = await db.query(
      `SELECT a.id AS assignment_id, s.full_name, s.email, s.user_id,
              e.exam_code, e.title, a.status, a.start_time, a.end_time, a.updated_at,
              COALESCE(ans.attempted, 0)::int AS attempted,
              COALESCE(ans.score, 0)::float AS score,
              COALESCE(v.violations, 0)::int AS violations
       FROM exam_assignments a
       JOIN students s ON s.id = a.student_id
       JOIN exams e ON e.id = a.exam_id
       LEFT JOIN (SELECT assignment_id, COUNT(*) AS attempted, SUM(marks_awarded) AS score
                  FROM exam_answers WHERE selected_option <> '' GROUP BY assignment_id) ans ON ans.assignment_id = a.id
       LEFT JOIN (SELECT assignment_id, COUNT(*) AS violations
                  FROM exam_violations GROUP BY assignment_id) v ON v.assignment_id = a.id
       ORDER BY a.updated_at DESC`,
    );
    return res.json({ success: true, assignments: r.rows });
  } catch (err) {
    console.error('❌ proctorOverview error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load overview' });
  }
};

// GET /exam/proctor/detail?assignment_id= -> answers + violations + latest analysis
export const proctorDetail = async (req, res) => {
  try {
    const assignmentId = parseInt(req.query.assignment_id, 10);
    if (!assignmentId) return res.status(400).json({ success: false, message: 'assignment_id is required' });
    const head = await db.query(
      `SELECT a.id AS assignment_id, s.full_name, s.email, s.user_id,
              e.exam_code, e.title, a.status, a.start_time, a.end_time
       FROM exam_assignments a
       JOIN students s ON s.id = a.student_id
       JOIN exams e ON e.id = a.exam_id
       WHERE a.id = $1`,
      [assignmentId],
    );
    if (!head.rows.length) return res.status(404).json({ success: false, message: 'Assignment not found' });
    const answers = await db.query(
      `SELECT an.question_number, an.question_id, q.question_text, an.selected_option,
              an.is_correct, an.marks_awarded, an.time_taken, an.updated_at
       FROM exam_answers an JOIN questions q ON q.id = an.question_id
       WHERE an.assignment_id = $1 ORDER BY an.question_number`,
      [assignmentId],
    );
    const violations = await db.query(
      `SELECT violation_type, timestamp_ms, severity, description, snapshot_url, created_at
       FROM exam_violations WHERE assignment_id = $1 ORDER BY id`,
      [assignmentId],
    );
    const analysis = await db.query(
      'SELECT json_response, created_at FROM exam_analysis WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
      [head.rows[0].user_id],
    );
    return res.json({
      success: true,
      assignment: head.rows[0],
      answers: answers.rows,
      violations: violations.rows,
      analysis: analysis.rows[0] || null,
    });
  } catch (err) {
    console.error('❌ proctorDetail error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load detail' });
  }
};

// POST /exam/suspend-exam
export const suspendExam = async (req, res) => {
  try {
    const { assignment, error } = await resolveAssignment(req);
    if (error) return res.status(401).json({ success: false, message: error });
    await db.query(`UPDATE exam_assignments SET status = 'Suspended', updated_at = NOW() WHERE id = $1`, [assignment.id]);
    return res.json({ success: true, message: 'Exam suspended' });
  } catch (err) {
    console.error('❌ suspendExam error:', err);
    return res.status(500).json({ success: false, message: 'Failed to suspend exam' });
  }
};

// POST /exam/complete-exam  (+ builds analysis row for the report page)
export const completeExam = async (req, res) => {
  try {
    const { assignment, error } = await resolveAssignment(req);
    if (error) return res.status(401).json({ success: false, message: error });

    await db.query(`UPDATE exam_assignments SET status = 'Completed', updated_at = NOW() WHERE id = $1`, [assignment.id]);

    const totalQ = await db.query('SELECT COUNT(*)::int AS c, COALESCE(SUM(marks),0)::int AS max FROM questions WHERE exam_id = $1', [assignment.exam_id]);
    const agg = await db.query(
      `SELECT COUNT(*)::int AS attempted, COALESCE(SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END),0)::int AS correct,
              COALESCE(SUM(marks_awarded),0)::float AS score
       FROM exam_answers WHERE assignment_id = $1 AND selected_option <> ''`,
      [assignment.id],
    );
    const detail = await db.query(
      `SELECT an.question_number, an.question_id, q.question_text, an.selected_option, q.correct_option,
              an.is_correct, an.marks_awarded, an.time_taken
       FROM exam_answers an JOIN questions q ON q.id = an.question_id
       WHERE an.assignment_id = $1 ORDER BY an.question_number`,
      [assignment.id],
    );

    const viol = await db.query(
      `SELECT violation_type, COUNT(*)::int AS count
       FROM exam_violations WHERE assignment_id = $1 GROUP BY violation_type`,
      [assignment.id],
    );
    const violRows = await db.query(
      `SELECT violation_type, timestamp_ms, severity, description, snapshot_url, created_at
       FROM exam_violations WHERE assignment_id = $1 ORDER BY id`,
      [assignment.id],
    );

    const summary = {
      student: { full_name: assignment.full_name, email: assignment.email, user_id: assignment.user_id },
      exam: { exam_code: assignment.exam_code, title: assignment.title },
      total_questions: totalQ.rows[0].c,
      max_marks: totalQ.rows[0].max,
      attempted: agg.rows[0].attempted,
      correct: agg.rows[0].correct,
      wrong: agg.rows[0].attempted - agg.rows[0].correct,
      score: agg.rows[0].score,
      questions: detail.rows,
      tracking_summary: {
        total_violations: violRows.rows.length,
        by_type: Object.fromEntries(viol.rows.map((v) => [v.violation_type, v.count])),
      },
      violations: violRows.rows,
    };

    await db.query(
      `INSERT INTO exam_analysis (user_id, exam_code, json_response) VALUES ($1, $2, $3)`,
      [assignment.user_id, assignment.exam_code, JSON.stringify(summary)],
    );

    return res.json({ success: true, message: 'Exam submitted successfully', summary });
  } catch (err) {
    console.error('❌ completeExam error:', err);
    return res.status(500).json({ success: false, message: 'Failed to submit exam' });
  }
};

// GET /exam/analysis-report?user_id=
export const analysisReport = async (req, res) => {
  try {
    const { user_id, exam_id, exam_code } = { ...req.query, ...req.body };
    if (!user_id) return res.status(400).json({ message: 'user_id is required' });
    const code = exam_code || exam_id;
    const r = code
      ? await db.query('SELECT json_response FROM exam_analysis WHERE user_id = $1 AND exam_code = $2 ORDER BY id DESC', [user_id, code])
      : await db.query('SELECT json_response FROM exam_analysis WHERE user_id = $1 ORDER BY id DESC', [user_id]);
    return res.json({ analysis: r.rows });
  } catch (err) {
    console.error('❌ analysisReport error:', err);
    return res.status(500).json({ message: 'Failed to fetch analysis report' });
  }
};
