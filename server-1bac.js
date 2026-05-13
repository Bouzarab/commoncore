const crypto = require('crypto');
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const XLSX = require('xlsx');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const TOTAL_SCORE = 20;
const STANDARD_TIME = 40;
const IMAGE_TIME = 35;

const VALID_CLASSES = ['TCSF3', 'TCSF4', 'TCSF5'];

app.use(express.static(__dirname));

app.get('/', (req, res) => res.redirect('/exam1bac-teacher.html'));
app.get('/teacher', (req, res) => res.redirect('/exam1bac-teacher.html'));
app.get('/student', (req, res) => res.redirect('/exam1bac-student.html'));

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    exam: 'common-core',
    phase: gameState.phase,
    activePlayers: getActivePlayers().length,
    totalPlayers: Object.keys(gameState.players).length
  });
});

// ─── Excel Export ────────────────────────────────────────────────────────────
app.get('/exam1bac/export-results', (req, res) => {
  const players = Object.values(gameState.players);
  if (!players.length) {
    return res.status(404).json({ error: 'No student data available.' });
  }

  const qs = gameState.shuffledQuestions || questions;

  // Header row
  const header = ['Name', 'Number', 'Class'];
  qs.forEach((q, i) => {
    const label = q.prompt.length > 55 ? q.prompt.slice(0, 52) + '...' : q.prompt;
    header.push(`Q${i + 1}: ${label}`);
  });
  header.push(`Score (/${TOTAL_SCORE})`, `Correct (/${qs.length})`, 'Status');

  const rows = [header];

  // Sort: active first, then by score desc
  const sorted = [...players].sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    return b.score - a.score || a.name.localeCompare(b.name);
  });

  for (const player of sorted) {
    const row = [
      player.name,
      player.number || '',
      player.studentClass || ''
    ];

    let correctCount = 0;
    for (let i = 0; i < qs.length; i++) {
      const qNum = i + 1;
      const ans = player.answers.find(a => a.questionNumber === qNum);
      if (!ans || ans.choiceIndex === null) {
        row.push('— No answer');
      } else {
        const prefix = ans.correct ? '✓' : '✗';
        row.push(`${prefix} ${ans.choiceText || ''}`);
        if (ans.correct) correctCount++;
      }
    }

    const score = Math.round(player.score * 100) / 100;
    row.push(score, correctCount, player.status === 'active' ? 'Active' : 'Removed');
    rows.push(row);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths
  ws['!cols'] = [
    { wch: 28 },
    { wch: 10 },
    { wch: 12 },
    ...qs.map(() => ({ wch: 32 })),
    { wch: 12 },
    { wch: 12 },
    { wch: 10 }
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Quiz Results');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="quiz-results.xlsx"');
  res.send(buf);
});

// ─── Violation beacon ────────────────────────────────────────────────────────
app.post('/exam1bac/violation', express.text({ type: '*/*' }), (req, res) => {
  try {
    const payload = JSON.parse(req.body || '{}');
    const { playerId, token, reason, type } = payload;
    if (playerId && token) {
      markPlayerRemoved(playerId, reason || 'Left the quiz', type || 'leave', token, false);
    }
  } catch (err) {
    console.warn('Violation beacon parse error:', err.message);
  }
  res.status(204).end();
});

// ─── Questions ───────────────────────────────────────────────────────────────
const questionsRaw = [
  // Section A - Jobs and occupations
  {
    id: 'A1', section: 'Jobs and Occupations',
    prompt: 'What is this job?',
    image: '/exam1bac-assets/common-core/job-pilot.png',
    imageAlt: 'A pilot',
    options: ['pilot', 'postman', 'mechanic'],
    correctIndex: 0, timeLimit: IMAGE_TIME
  },
  {
    id: 'A2', section: 'Jobs and Occupations',
    prompt: 'What is this job?',
    image: '/exam1bac-assets/common-core/job-dentist.png',
    imageAlt: 'A dentist looking after teeth',
    options: ['dentist', 'doctor', 'teacher'],
    correctIndex: 0, timeLimit: IMAGE_TIME
  },
  {
    id: 'A3', section: 'Jobs and Occupations',
    prompt: 'What is this job?',
    image: '/exam1bac-assets/common-core/job-carpenter.png',
    imageAlt: 'A carpenter carrying wood',
    options: ['carpenter', 'butcher', 'bus driver'],
    correctIndex: 0, timeLimit: IMAGE_TIME
  },
  {
    id: 'A4', section: 'Jobs and Occupations',
    prompt: 'What is this job?',
    image: '/exam1bac-assets/common-core/job-mechanic.png',
    imageAlt: 'A mechanic with tools',
    options: ['mechanic', 'painter', 'pilot'],
    correctIndex: 0, timeLimit: IMAGE_TIME
  },
  {
    id: 'A5', section: 'Jobs and Occupations',
    prompt: 'What is this job?',
    image: '/exam1bac-assets/common-core/job-painter.png',
    imageAlt: 'A painter holding a brush',
    options: ['painter', 'carpenter', 'dentist'],
    correctIndex: 0, timeLimit: IMAGE_TIME
  },
  {
    id: 'A6', section: 'Jobs and Occupations',
    prompt: 'A dentist __________ people\'s teeth.',
    options: ['looks after', 'drives', 'writes'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'A7', section: 'Jobs and Occupations',
    prompt: 'A bus driver __________ a bus.',
    options: ['drives', 'grows', 'arrests'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'A8', section: 'Jobs and Occupations',
    prompt: 'A police officer __________ criminals.',
    options: ['arrests', 'writes', 'grows'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },

  // Section B - Time prepositions
  {
    id: 'B1', section: 'Time Prepositions',
    prompt: 'My birthday is __________ July.',
    options: ['in', 'on', 'at'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'B2', section: 'Time Prepositions',
    prompt: 'The English class starts __________ 8 o\'clock.',
    options: ['at', 'in', 'on'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'B3', section: 'Time Prepositions',
    prompt: 'We do not study __________ Sundays.',
    options: ['on', 'in', 'at'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },

  // Section C - Adverbs of frequency
  {
    id: 'C1', section: 'Adverbs of Frequency',
    prompt: 'Put "always" in the right place.',
    options: [
      'Do you always exercise on Saturdays?',
      'Do always you exercise on Saturdays?',
      'Always do you exercise on Saturdays?'
    ],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'C2', section: 'Adverbs of Frequency',
    prompt: 'Put "often" in the right place.',
    options: [
      'He often listens to the radio.',
      'He listens often to the radio.',
      'Often he listens to the radio.'
    ],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'C3', section: 'Adverbs of Frequency',
    prompt: 'Put "ever" in the right place.',
    options: [
      'Do they ever read books?',
      'Ever do they read books?',
      'Do ever they read books?'
    ],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'C4', section: 'Adverbs of Frequency',
    prompt: 'Put "never" in the right place.',
    options: [
      'They never read books.',
      'They read never books.',
      'Never they read books.'
    ],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },

  // Section D - Some and any
  {
    id: 'D1', section: 'Some / Any',
    prompt: 'We have lots of potatoes. Let\'s make __________ potato salad!',
    options: ['some', 'any'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'D2', section: 'Some / Any',
    prompt: 'Do we have __________ mayonnaise?',
    options: ['any', 'some'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'D3', section: 'Some / Any',
    prompt: 'I do not want __________ onions.',
    options: ['any', 'some'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },

  // Section E - Shopping, colors, materials and items
  {
    id: 'E1', section: 'Shopping Categories',
    prompt: 'Which shop category do these items belong to?',
    image: '/exam1bac-assets/common-core/shop-jewelry.png',
    imageAlt: 'Watches, earrings, a necklace and a ring',
    options: ['jewelry store', 'food store', 'furniture store'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'E2', section: 'Colors, Materials and Items',
    prompt: 'The word "cotton" is a:',
    options: ['material', 'color', 'shop'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  }
];

const POINTS_PER_QUESTION = TOTAL_SCORE / questionsRaw.length;

const questions = questionsRaw.map((q, i) => ({
  ...q,
  number: i + 1,
  points: POINTS_PER_QUESTION
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normalize for duplicate detection (order-sensitive) */
function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Normalize for ban detection (order-independent: "Dan Injel" = "Injel Dan") */
function normalizeNameForBan(name) {
  return name.trim().toLowerCase().split(/\s+/).sort().join(' ');
}

/** Only allow Latin letters, spaces, hyphens, apostrophes, dots */
function isEnglishOnly(name) {
  return /^[a-zA-Z\s\-'\.]+$/.test(name);
}

/** Fisher-Yates shuffle of a question's options, returns new question object */
function shuffleQuestion(question) {
  const indices = question.options.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const shuffledOptions = indices.map(i => question.options[i]);
  const newCorrectIndex = indices.indexOf(question.correctIndex);
  return { ...question, options: shuffledOptions, correctIndex: newCorrectIndex };
}

function publicQuestion(question) {
  return {
    id: question.id,
    number: question.number,
    total: questions.length,
    section: question.section,
    prompt: question.prompt,
    passage: question.passage || null,
    image: question.image || null,
    imageAlt: question.imageAlt || '',
    options: question.options,
    points: question.points,
    timeLimit: question.timeLimit
  };
}

function teacherQuestion(question) {
  return { ...publicQuestion(question), correctIndex: question.correctIndex };
}

function getActivePlayers() {
  return Object.values(gameState.players).filter(p => p.status === 'active');
}

function getLeaderboard() {
  return Object.values(gameState.players)
    .map(p => ({
      id: p.id,
      name: p.name,
      number: p.number || '',
      studentClass: p.studentClass || '',
      score: Math.round(p.score * 100) / 100,
      status: p.status,
      removalReason: p.removalReason || ''
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    number: player.number || '',
    studentClass: player.studentClass || '',
    score: Math.round(player.score * 100) / 100,
    status: player.status,
    removalReason: player.removalReason || '',
    removalType: player.removalType || ''
  };
}

function getTeacherState() {
  const qi = gameState.currentQuestionIndex;
  const qs = gameState.shuffledQuestions;
  const currentQuestion = qi >= 0 && qs && qi < qs.length ? teacherQuestion(qs[qi]) : null;
  const players = Object.fromEntries(
    Object.entries(gameState.players).map(([id, p]) => [id, publicPlayer(p)])
  );
  return {
    phase: gameState.phase,
    players,
    leaderboard: getLeaderboard(),
    currentQuestion,
    currentQuestionIndex: qi,
    totalQuestions: questions.length,
    activeCount: getActivePlayers().length,
    answerCount: Object.keys(gameState.currentAnswers).length,
    timeRemaining: gameState.timeRemaining
  };
}

function emitTeacherState() {
  io.to('teachers').emit('teacher:state', getTeacherState());
}

// ─── Game state ───────────────────────────────────────────────────────────────
const gameState = {
  phase: 'lobby',
  players: {},
  bannedNames: new Set(),    // stores banKey (order-independent)
  currentQuestionIndex: -1,
  currentAnswers: {},
  questionStartedAt: null,
  timeRemaining: 0,
  timer: null,
  scoredQuestionIds: new Set(),
  shuffledQuestions: null    // populated when quiz starts
};

// ─── Timer ────────────────────────────────────────────────────────────────────
function clearTimer() {
  if (gameState.timer) {
    clearInterval(gameState.timer);
    gameState.timer = null;
  }
}

function startTimer(question) {
  clearTimer();
  gameState.timeRemaining = question.timeLimit;
  io.emit('game:timer', { timeRemaining: gameState.timeRemaining });

  gameState.timer = setInterval(() => {
    gameState.timeRemaining -= 1;
    io.emit('game:timer', { timeRemaining: gameState.timeRemaining });
    if (gameState.timeRemaining <= 0) {
      finishCurrentQuestion(true);
    }
  }, 1000);
}

// ─── Quiz flow ────────────────────────────────────────────────────────────────
function startNextQuestion() {
  clearTimer();
  gameState.currentQuestionIndex += 1;

  // Shuffle all questions once when quiz starts
  if (gameState.currentQuestionIndex === 0 && !gameState.shuffledQuestions) {
    gameState.shuffledQuestions = questions.map(q => shuffleQuestion(q));
  }

  if (gameState.currentQuestionIndex >= questions.length) {
    finishQuiz();
    return;
  }

  const question = gameState.shuffledQuestions[gameState.currentQuestionIndex];
  gameState.phase = 'question';
  gameState.currentAnswers = {};
  gameState.questionStartedAt = Date.now();
  gameState.timeRemaining = question.timeLimit;

  io.emit('game:question', publicQuestion(question));
  io.emit('game:answerCount', { count: 0, total: getActivePlayers().length });
  emitTeacherState();
  startTimer(question);
}

function finishCurrentQuestion(showResults) {
  if (gameState.phase !== 'question') return null;

  clearTimer();
  const question = gameState.shuffledQuestions[gameState.currentQuestionIndex];
  const results = {};
  let correctCount = 0;
  let totalAnswered = 0;

  if (!gameState.scoredQuestionIds.has(question.id)) {
    // Score players who answered
    for (const [playerId, answer] of Object.entries(gameState.currentAnswers)) {
      const player = gameState.players[playerId];
      if (!player) continue;
      totalAnswered += 1;
      const isCorrect = Number(answer.choiceIndex) === question.correctIndex;
      const points = isCorrect ? question.points : 0;
      if (isCorrect) {
        correctCount += 1;
        player.score += points;
      }
      player.answers.push({
        questionId: question.id,
        questionNumber: question.number,
        choiceIndex: answer.choiceIndex,
        choiceText: question.options[answer.choiceIndex] || '',
        correct: isCorrect,
        points
      });
      results[playerId] = {
        correct: isCorrect,
        points,
        score: Math.round(player.score * 100) / 100,
        choiceIndex: answer.choiceIndex
      };
    }

    // Record no-answer for active players who didn't answer
    for (const player of getActivePlayers()) {
      if (!results[player.id]) {
        player.answers.push({
          questionId: question.id,
          questionNumber: question.number,
          choiceIndex: null,
          choiceText: null,
          correct: false,
          points: 0
        });
        results[player.id] = {
          correct: false,
          points: 0,
          score: Math.round(player.score * 100) / 100,
          noAnswer: true
        };
      }
    }

    gameState.scoredQuestionIds.add(question.id);
  }

  // Push updated scores to each student
  for (const player of Object.values(gameState.players)) {
    io.to(player.id).emit('student:score', {
      score: Math.round(player.score * 100) / 100
    });
  }

  gameState.phase = showResults ? 'results' : 'closed';

  const payload = {
    questionId: question.id,
    questionNumber: question.number,
    correctAnswer: question.options[question.correctIndex],
    correctIndex: question.correctIndex,
    results,
    stats: {
      totalAnswered,
      correctCount,
      totalActive: getActivePlayers().length,
      noAnswerCount: Math.max(getActivePlayers().length - totalAnswered, 0)
    },
    leaderboard: getLeaderboard()
  };

  if (showResults) {
    io.emit('game:results', payload);
  }
  emitTeacherState();
  return payload;
}

function finishQuiz() {
  clearTimer();
  if (gameState.phase === 'question') {
    finishCurrentQuestion(false);
  }
  gameState.phase = 'finished';
  io.emit('game:finished', { leaderboard: getLeaderboard() });
  emitTeacherState();
}

function markPlayerRemoved(playerId, reason, type, token, shouldDisconnect = true) {
  const player = gameState.players[playerId];
  if (!player || player.status !== 'active') return false;
  if (token && player.token !== token) return false;

  player.status = 'removed';
  player.removalReason = reason || 'Removed from the quiz';
  player.removalType = type || 'rule';
  player.removedAt = Date.now();

  // Ban by order-independent name key
  gameState.bannedNames.add(player.banKey);

  if (gameState.currentAnswers[playerId]) {
    delete gameState.currentAnswers[playerId];
  }

  io.to('teachers').emit('game:playerRemoved', {
    id: playerId,
    name: player.name,
    score: Math.round(player.score * 100) / 100,
    reason: player.removalReason,
    type: player.removalType,
    activeCount: getActivePlayers().length
  });
  io.emit('game:playerCount', { count: getActivePlayers().length });
  io.to('teachers').emit('game:answerCount', {
    count: Object.keys(gameState.currentAnswers).length,
    total: getActivePlayers().length
  });
  emitTeacherState();

  const targetSocket = io.sockets.sockets.get(playerId);
  if (targetSocket) {
    targetSocket.emit('student:removed', {
      reason: player.removalReason,
      score: Math.round(player.score * 100) / 100
    });
    if (shouldDisconnect) {
      setTimeout(() => targetSocket.disconnect(true), 120);
    }
  }

  return true;
}

function resetQuiz() {
  clearTimer();
  for (const player of Object.values(gameState.players)) {
    if (player.status === 'active') {
      player.score = 0;
      player.answers = [];
    }
  }
  for (const [id, player] of Object.entries(gameState.players)) {
    if (player.status !== 'active') delete gameState.players[id];
  }

  gameState.bannedNames.clear();
  gameState.phase = 'lobby';
  gameState.currentQuestionIndex = -1;
  gameState.currentAnswers = {};
  gameState.questionStartedAt = null;
  gameState.timeRemaining = 0;
  gameState.scoredQuestionIds.clear();
  gameState.shuffledQuestions = null;

  io.emit('game:reset');
  emitTeacherState();
}

// ─── Socket.IO events ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  function safe(fn) {
    return (...args) => {
      try { fn(...args); } catch (err) { console.error(`Socket error [${socket.id}]:`, err); }
    };
  }

  // ── Teacher events ──
  socket.on('teacher:join', safe(() => {
    socket.join('teachers');
    socket.emit('teacher:state', getTeacherState());
  }));

  socket.on('teacher:start', safe(() => {
    if (gameState.phase !== 'lobby') return;
    if (getActivePlayers().length < 1) return;
    startNextQuestion();
  }));

  // "Show Results Now" = end the quiz immediately and show all final results
  socket.on('teacher:showResults', safe(() => {
    finishQuiz();
  }));

  socket.on('teacher:moveNext', safe(() => {
    if (gameState.phase === 'question') {
      finishCurrentQuestion(false);
    }
    startNextQuestion();
  }));

  socket.on('teacher:showLeaderboard', safe(() => {
    gameState.phase = 'leaderboard';
    io.emit('game:leaderboard', { leaderboard: getLeaderboard() });
    emitTeacherState();
  }));

  socket.on('teacher:endQuiz', safe(() => {
    finishQuiz();
  }));

  socket.on('teacher:restart', safe(() => {
    resetQuiz();
  }));

  socket.on('teacher:kickPlayer', safe(({ playerId }) => {
    markPlayerRemoved(playerId, 'Removed by teacher', 'teacher', null, true);
  }));

  // ── Student events ──
  socket.on('student:join', safe(({ name, number, studentClass }) => {
    const cleanName = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const cleanNumber = String(number || '').trim().slice(0, 20);
    const cleanClass = String(studentClass || '').trim();

    if (cleanName.length < 2) {
      socket.emit('student:joinRejected', { message: 'Please enter your full name.' });
      return;
    }
    if (!isEnglishOnly(cleanName)) {
      socket.emit('student:joinRejected', {
        message: 'Please write your name in English letters only (no Arabic or other scripts).'
      });
      return;
    }
    if (cleanName.split(/\s+/).length < 2) {
      socket.emit('student:joinRejected', { message: 'Please enter both your first and last name.' });
      return;
    }
    if (!cleanNumber) {
      socket.emit('student:joinRejected', { message: 'Please enter your student number.' });
      return;
    }
    if (!VALID_CLASSES.includes(cleanClass)) {
      socket.emit('student:joinRejected', { message: 'Please select a valid class.' });
      return;
    }
    if (gameState.phase !== 'lobby') {
      socket.emit('student:joinRejected', { message: 'The quiz has already started. Please wait for the next session.' });
      return;
    }

    const normalizedName = normalizeName(cleanName);
    const banKey = normalizeNameForBan(cleanName);

    if (gameState.bannedNames.has(banKey)) {
      socket.emit('student:joinRejected', {
        message: 'You have been removed from this quiz session and cannot rejoin.'
      });
      return;
    }

    const duplicate = Object.values(gameState.players).some(
      p => p.status === 'active' && p.normalizedName === normalizedName
    );
    if (duplicate) {
      socket.emit('student:joinRejected', { message: 'This name is already in the quiz.' });
      return;
    }

    const token = crypto.randomBytes(18).toString('hex');
    gameState.players[socket.id] = {
      id: socket.id,
      token,
      name: cleanName,
      number: cleanNumber,
      studentClass: cleanClass,
      normalizedName,
      banKey,
      score: 0,
      answers: [],
      status: 'active',
      joinedAt: Date.now()
    };

    socket.emit('student:joined', {
      id: socket.id,
      token,
      name: cleanName,
      number: cleanNumber,
      studentClass: cleanClass,
      totalQuestions: questions.length
    });
    io.emit('game:playerCount', { count: getActivePlayers().length });
    emitTeacherState();
  }));

  socket.on('student:answer', safe(({ questionId, choiceIndex }) => {
    const player = gameState.players[socket.id];
    const qs = gameState.shuffledQuestions;
    const question = qs ? qs[gameState.currentQuestionIndex] : null;
    if (!player || player.status !== 'active') return;
    if (gameState.phase !== 'question' || !question || question.id !== questionId) return;
    if (gameState.currentAnswers[socket.id]) return;

    const numericChoice = Number(choiceIndex);
    if (!Number.isInteger(numericChoice) || numericChoice < 0 || numericChoice >= question.options.length) return;

    gameState.currentAnswers[socket.id] = { choiceIndex: numericChoice, timestamp: Date.now() };

    socket.emit('student:answerReceived', { choiceIndex: numericChoice });
    io.to('teachers').emit('game:answerCount', {
      count: Object.keys(gameState.currentAnswers).length,
      total: getActivePlayers().length
    });
    emitTeacherState();
  }));

  socket.on('student:violation', safe(({ playerId, token, reason, type }) => {
    if (playerId && playerId !== socket.id) return;
    markPlayerRemoved(socket.id, reason || 'Left the quiz', type || 'rule', token, true);
  }));

  socket.on('disconnect', () => {
    try {
      const player = gameState.players[socket.id];
      if (player && player.status === 'active' && gameState.phase !== 'finished') {
        markPlayerRemoved(socket.id, 'Left the quiz or lost connection', 'disconnect', null, false);
      }
    } catch (err) {
      console.error('disconnect error:', err);
    }
    console.log(`Disconnected: ${socket.id}`);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log(`Common Core Quiz Live -> ${HOST}:${PORT}`);
  console.log('  Teacher: /teacher');
  console.log('  Student: /student');
});
