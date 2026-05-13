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
const DISCONNECT_GRACE_MS = 30000;

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

  const questionCount = questions.length;

  // Header row
  const header = ['Name', 'Number', 'Class'];
  for (let i = 0; i < questionCount; i++) {
    header.push(`Q${i + 1}`);
  }
  header.push(`Score (/${TOTAL_SCORE})`, `Correct (/${questionCount})`, 'Status');

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
    for (let i = 0; i < questionCount; i++) {
      const qNum = i + 1;
      const ans = player.answers.find(a => a.questionNumber === qNum);
      if (!ans || ans.choiceIndex === null) {
        row.push('— No answer');
      } else {
        const prefix = ans.correct ? '✓' : '✗';
        row.push(`${prefix} ${ans.prompt || ans.questionId}: ${ans.choiceText || ''}`);
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
    ...Array.from({ length: questionCount }, () => ({ wch: 42 })),
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
    prompt: 'This person delivers letters. He is a:',
    image: '/exam1bac-assets/common-core/job-postman.png',
    imageAlt: 'A postman carrying letters',
    options: ['postman', 'pilot', 'dentist'],
    correctIndex: 0, timeLimit: IMAGE_TIME
  },
  {
    id: 'A2', section: 'Jobs and Occupations',
    prompt: 'This person flies planes. He is a:',
    image: '/exam1bac-assets/common-core/job-pilot.png',
    imageAlt: 'A pilot',
    options: ['pilot', 'mechanic', 'carpenter'],
    correctIndex: 0, timeLimit: IMAGE_TIME
  },
  {
    id: 'A3', section: 'Jobs and Occupations',
    prompt: 'This person works with wood. He is a:',
    image: '/exam1bac-assets/common-core/job-carpenter.png',
    imageAlt: 'A carpenter carrying wood',
    options: ['carpenter', 'dentist', 'author'],
    correctIndex: 0, timeLimit: IMAGE_TIME
  },
  {
    id: 'A4', section: 'Jobs and Occupations',
    prompt: 'This person looks after people\'s teeth. She is a:',
    image: '/exam1bac-assets/common-core/job-dentist.png',
    imageAlt: 'A dentist looking after teeth',
    options: ['dentist', 'doctor', 'painter'],
    correctIndex: 0, timeLimit: IMAGE_TIME
  },
  {
    id: 'A5', section: 'Jobs and Occupations',
    prompt: 'This person repairs cars. He is a:',
    image: '/exam1bac-assets/common-core/job-mechanic.png',
    imageAlt: 'A mechanic with tools',
    options: ['mechanic', 'postman', 'gardener'],
    correctIndex: 0, timeLimit: IMAGE_TIME
  },
  {
    id: 'A6', section: 'Jobs and Occupations',
    prompt: 'This person paints walls. He is a:',
    image: '/exam1bac-assets/common-core/job-painter.png',
    imageAlt: 'A painter holding a brush',
    options: ['painter', 'bus driver', 'postman'],
    correctIndex: 0, timeLimit: IMAGE_TIME
  },
  {
    id: 'A7', section: 'Jobs and Occupations',
    prompt: 'A gardener __________ plants.',
    options: ['grows', 'drives', 'arrests'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'A8', section: 'Jobs and Occupations',
    prompt: 'A bus driver __________ a bus.',
    options: ['drives', 'writes', 'looks after'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'A9', section: 'Jobs and Occupations',
    prompt: 'A police officer __________ criminals.',
    options: ['arrests', 'grows', 'drives'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'A10', section: 'Jobs and Occupations',
    prompt: 'An author __________ books.',
    options: ['writes', 'arrests', 'drives'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'A11', section: 'Jobs and Occupations',
    prompt: 'A doctor __________ sick people.',
    options: ['helps', 'writes', 'grows'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'A12', section: 'Jobs and Occupations',
    prompt: 'A dentist looks after:',
    options: ['people\'s teeth', 'a bus', 'plants'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },

  // Section B - Time prepositions
  {
    id: 'B1', section: 'Time Prepositions',
    prompt: 'I get up early __________ the morning.',
    options: ['in', 'on', 'at'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'B2', section: 'Time Prepositions',
    prompt: 'We have English __________ Monday.',
    options: ['on', 'in', 'at'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'B3', section: 'Time Prepositions',
    prompt: 'The shop opens __________ noon.',
    options: ['at', 'in', 'on'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'B4', section: 'Time Prepositions',
    prompt: 'My birthday is __________ April.',
    options: ['in', 'on', 'at'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'B5', section: 'Time Prepositions',
    prompt: 'The test is __________ Friday.',
    options: ['on', 'in', 'at'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'B6', section: 'Time Prepositions',
    prompt: 'The movie starts __________ 9:30.',
    options: ['at', 'on', 'in'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'B7', section: 'Time Prepositions',
    prompt: 'We go to the beach __________ summer.',
    options: ['in', 'on', 'at'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'B8', section: 'Time Prepositions',
    prompt: 'I visit my grandparents __________ the weekend.',
    options: ['at', 'in', 'on'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },

  // Section C - Adverbs of frequency
  {
    id: 'C1', section: 'Adverbs of Frequency',
    prompt: 'Put "always" in the right place.',
    options: [
      'She is always happy.',
      'She always is happy.',
      'Always she is happy.'
    ],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'C2', section: 'Adverbs of Frequency',
    prompt: 'Put "never" in the right place.',
    options: [
      'He never drinks coffee.',
      'He drinks never coffee.',
      'Never he drinks coffee.'
    ],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'C3', section: 'Adverbs of Frequency',
    prompt: 'Put "often" in the right place.',
    options: [
      'Do you often play football?',
      'Do often you play football?',
      'Often do you play football?'
    ],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'C4', section: 'Adverbs of Frequency',
    prompt: 'Put "ever" in the right place.',
    options: [
      'Are they ever late?',
      'Are ever they late?',
      'Ever are they late?'
    ],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'C5', section: 'Adverbs of Frequency',
    prompt: 'Put "always" in the right place.',
    options: [
      'We always do our homework.',
      'We do always our homework.',
      'Always we do our homework.'
    ],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'C6', section: 'Adverbs of Frequency',
    prompt: 'Put "never" in the right place.',
    options: [
      'I am never late.',
      'I never am late.',
      'Never I am late.'
    ],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'C7', section: 'Adverbs of Frequency',
    prompt: 'Put "often" in the right place.',
    options: [
      'They often watch TV.',
      'They watch often TV.',
      'Often they watch TV.'
    ],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'C8', section: 'Adverbs of Frequency',
    prompt: 'Put "ever" in the right place.',
    options: [
      'Does she ever cook dinner?',
      'Does ever she cook dinner?',
      'Ever does she cook dinner?'
    ],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'C9', section: 'Adverbs of Frequency',
    prompt: 'Put "sometimes" in the right place.',
    options: [
      'He sometimes plays basketball.',
      'He plays sometimes basketball.',
      'Sometimes he plays basketball.'
    ],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'C10', section: 'Adverbs of Frequency',
    prompt: 'Put "usually" in the right place.',
    options: [
      'My sister usually walks to school.',
      'My sister walks usually to school.',
      'Usually my sister walks to school.'
    ],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },

  // Section D - Some and any
  {
    id: 'D1', section: 'Some / Any',
    prompt: 'There are __________ apples in the kitchen.',
    options: ['some', 'any'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'D2', section: 'Some / Any',
    prompt: 'There aren\'t __________ onions in the fridge.',
    options: ['any', 'some'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'D3', section: 'Some / Any',
    prompt: 'Can we buy __________ mayonnaise, please?',
    options: ['some', 'any'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'D4', section: 'Some / Any',
    prompt: 'I don\'t want __________ celery in my salad.',
    options: ['any', 'some'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'D5', section: 'Some / Any',
    prompt: 'Do we have __________ bananas?',
    options: ['any', 'some'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'D6', section: 'Some / Any',
    prompt: 'Let\'s put __________ apples in the salad.',
    options: ['some', 'any'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'D7', section: 'Some / Any',
    prompt: 'There isn\'t __________ fish in the store.',
    options: ['any', 'some'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'D8', section: 'Some / Any',
    prompt: 'We need __________ milk for breakfast.',
    options: ['some', 'any'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'D9', section: 'Some / Any',
    prompt: 'Are there __________ eggs in the bowl?',
    options: ['any', 'some'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'D10', section: 'Some / Any',
    prompt: 'I have __________ potatoes at home.',
    options: ['some', 'any'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },

  // Section E - Shopping, colors, materials and items
  {
    id: 'E1', section: 'Shopping Categories',
    prompt: 'These items belong to the:',
    image: '/exam1bac-assets/common-core/shop-jewelry.png',
    imageAlt: 'Watches, earrings, a necklace and a ring',
    options: ['jewelry store', 'food store', 'furniture store'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'E2', section: 'Shopping Categories',
    prompt: 'Bananas, chicken, milk and beef belong to the:',
    options: ['food store', 'clothing store', 'utensils store'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'E3', section: 'Colors, Materials and Items',
    prompt: 'Blue, yellow and red are:',
    options: ['colors', 'materials', 'items'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'E4', section: 'Shopping Categories',
    prompt: 'A bowl, a spoon, a fork and a knife belong to the:',
    options: ['utensils store', 'jewelry store', 'clothing store'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'E5', section: 'Shopping Categories',
    prompt: 'A bed, a chair and a pillow belong to the:',
    options: ['furniture store', 'food store', 'jewelry store'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'E6', section: 'Shopping Categories',
    prompt: 'Shoes, a shirt and a tie belong to the:',
    options: ['clothing store', 'utensils store', 'food store'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'E7', section: 'Shopping Categories',
    prompt: 'A ring, a necklace and earrings belong to the:',
    options: ['jewelry store', 'furniture store', 'food store'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'E8', section: 'Colors, Materials and Items',
    prompt: 'Cotton, wool and silk are:',
    options: ['materials', 'colors', 'shops'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'E9', section: 'Colors, Materials and Items',
    prompt: 'Dress, skirt and sweater are:',
    options: ['items', 'colors', 'materials'],
    correctIndex: 0, timeLimit: STANDARD_TIME
  },
  {
    id: 'E10', section: 'Colors, Materials and Items',
    prompt: 'Black, white and green are:',
    options: ['colors', 'materials', 'stores'],
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

/** Fisher-Yates shuffle, returns a new array */
function shuffleArray(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Shuffle a question's options, returns new question object */
function shuffleQuestionOptions(question) {
  const indices = question.options.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const shuffledOptions = indices.map(i => question.options[i]);
  const newCorrectIndex = indices.indexOf(question.correctIndex);
  return { ...question, options: shuffledOptions, correctIndex: newCorrectIndex };
}

function buildStudentQuestionSet() {
  return shuffleArray(questions).map(q => shuffleQuestionOptions(q));
}

function questionForSlot(question, slotIndex) {
  return {
    ...question,
    number: slotIndex + 1,
    total: questions.length,
    timeLimit: STANDARD_TIME
  };
}

function ensureStudentQuestionSet(player) {
  if (!player.questionSet || player.questionSet.length !== questions.length) {
    player.questionSet = buildStudentQuestionSet();
  }
  return player.questionSet;
}

function getPlayerQuestion(player, slotIndex = gameState.currentQuestionIndex) {
  if (!player || slotIndex < 0 || slotIndex >= questions.length) return null;
  const questionSet = ensureStudentQuestionSet(player);
  return questionForSlot(questionSet[slotIndex], slotIndex);
}

function publicQuestion(question) {
  return {
    id: question.id,
    number: question.number,
    total: question.total || questions.length,
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

function teacherSlotQuestion(slotIndex = gameState.currentQuestionIndex) {
  const slotNumber = Math.max(0, slotIndex) + 1;
  return {
    id: `slot-${slotNumber}`,
    number: slotNumber,
    total: questions.length,
    section: 'Randomized Quiz',
    prompt: `Question ${slotNumber} of ${questions.length}: each student is seeing a different randomized question.`,
    passage: null,
    image: null,
    imageAlt: '',
    options: ['Students have individual questions and shuffled choices.'],
    points: POINTS_PER_QUESTION,
    timeLimit: STANDARD_TIME
  };
}

function getActivePlayers() {
  return Object.values(gameState.players).filter(p => p.status === 'active');
}

function findPlayerEntryByToken(token) {
  if (!token) return null;
  return Object.entries(gameState.players).find(([, player]) => player.token === token) || null;
}

function clearPendingDisconnect(token) {
  const timer = token ? gameState.pendingDisconnects[token] : null;
  if (timer) {
    clearTimeout(timer);
    delete gameState.pendingDisconnects[token];
  }
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
    connectionStatus: player.connectionStatus || 'online',
    removalReason: player.removalReason || '',
    removalType: player.removalType || ''
  };
}

function getTeacherState() {
  const qi = gameState.currentQuestionIndex;
  const currentQuestion = qi >= 0 && qi < questions.length ? teacherSlotQuestion(qi) : null;
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

function emitStudentCurrentState(socket, player) {
  if (!player || player.status !== 'active') return;

  socket.emit('student:score', {
    score: Math.round(player.score * 100) / 100
  });

  if (gameState.phase === 'question') {
    const question = getPlayerQuestion(player);
    if (!question) return;

    socket.emit('game:question', publicQuestion(question));
    socket.emit('game:timer', { timeRemaining: gameState.timeRemaining });

    const answer = gameState.currentAnswers[player.id];
    if (answer) {
      socket.emit('student:answerReceived', { choiceIndex: answer.choiceIndex });
    }
    return;
  }

  if (gameState.phase === 'results' && gameState.lastResultsPayload) {
    socket.emit('game:results', gameState.lastResultsPayload);
    return;
  }

  if (gameState.phase === 'leaderboard') {
    socket.emit('game:leaderboard', { leaderboard: getLeaderboard() });
    return;
  }

  if (gameState.phase === 'finished') {
    socket.emit('game:finished', { leaderboard: getLeaderboard() });
  }
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
  lastResultsPayload: null,
  pendingDisconnects: {}
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
  gameState.lastResultsPayload = null;

  if (gameState.currentQuestionIndex >= questions.length) {
    finishQuiz();
    return;
  }

  gameState.phase = 'question';
  gameState.currentAnswers = {};
  gameState.questionStartedAt = Date.now();
  gameState.timeRemaining = STANDARD_TIME;

  for (const player of getActivePlayers()) {
    const studentQuestion = getPlayerQuestion(player);
    if (studentQuestion) {
      io.to(player.id).emit('game:question', publicQuestion(studentQuestion));
    }
  }
  io.to('teachers').emit('game:question', teacherSlotQuestion());
  io.emit('game:answerCount', { count: 0, total: getActivePlayers().length });
  emitTeacherState();
  startTimer({ timeLimit: STANDARD_TIME });
}

function finishCurrentQuestion(showResults) {
  if (gameState.phase !== 'question') return null;

  clearTimer();
  const slotIndex = gameState.currentQuestionIndex;
  const slotKey = `slot-${slotIndex + 1}`;
  const results = {};
  let correctCount = 0;
  let totalAnswered = 0;

  if (!gameState.scoredQuestionIds.has(slotKey)) {
    // Score players who answered
    for (const [playerId, answer] of Object.entries(gameState.currentAnswers)) {
      const player = gameState.players[playerId];
      if (!player) continue;
      const question = getPlayerQuestion(player, slotIndex);
      if (!question) continue;
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
        prompt: question.prompt,
        choiceIndex: answer.choiceIndex,
        choiceText: question.options[answer.choiceIndex] || '',
        correctAnswer: question.options[question.correctIndex],
        correct: isCorrect,
        points
      });
      results[playerId] = {
        correct: isCorrect,
        points,
        score: Math.round(player.score * 100) / 100,
        choiceIndex: answer.choiceIndex,
        correctAnswer: question.options[question.correctIndex]
      };
    }

    // Record no-answer for active players who didn't answer
    for (const player of getActivePlayers()) {
      if (!results[player.id]) {
        const question = getPlayerQuestion(player, slotIndex);
        if (!question) continue;
        player.answers.push({
          questionId: question.id,
          questionNumber: question.number,
          prompt: question.prompt,
          choiceIndex: null,
          choiceText: null,
          correctAnswer: question.options[question.correctIndex],
          correct: false,
          points: 0
        });
        results[player.id] = {
          correct: false,
          points: 0,
          score: Math.round(player.score * 100) / 100,
          noAnswer: true,
          correctAnswer: question.options[question.correctIndex]
        };
      }
    }

    gameState.scoredQuestionIds.add(slotKey);
  }

  // Push updated scores to each student
  for (const player of Object.values(gameState.players)) {
    io.to(player.id).emit('student:score', {
      score: Math.round(player.score * 100) / 100
    });
  }

  gameState.phase = showResults ? 'results' : 'closed';

  const payload = {
    questionId: slotKey,
    questionNumber: slotIndex + 1,
    correctAnswer: 'Each student had a different question.',
    correctIndex: null,
    results,
    stats: {
      totalAnswered,
      correctCount,
      totalActive: getActivePlayers().length,
      noAnswerCount: Math.max(getActivePlayers().length - totalAnswered, 0)
    },
    leaderboard: getLeaderboard()
  };
  gameState.lastResultsPayload = payload;

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
  clearPendingDisconnect(player.token);

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
  Object.values(gameState.pendingDisconnects).forEach(clearTimeout);
  gameState.players = {};

  gameState.bannedNames.clear();
  gameState.phase = 'lobby';
  gameState.currentQuestionIndex = -1;
  gameState.currentAnswers = {};
  gameState.questionStartedAt = null;
  gameState.timeRemaining = 0;
  gameState.scoredQuestionIds.clear();
  gameState.lastResultsPayload = null;
  gameState.pendingDisconnects = {};

  io.emit('game:reset', { clearStudents: true });
  emitTeacherState();
}

function resumePlayer(socket, token) {
  const entry = findPlayerEntryByToken(String(token || ''));
  if (!entry) return null;

  const [oldSocketId, player] = entry;
  if (player.status !== 'active') return null;

  clearPendingDisconnect(player.token);

  if (oldSocketId !== socket.id) {
    delete gameState.players[oldSocketId];
    player.id = socket.id;
    gameState.players[socket.id] = player;

    if (gameState.currentAnswers[oldSocketId]) {
      gameState.currentAnswers[socket.id] = gameState.currentAnswers[oldSocketId];
      delete gameState.currentAnswers[oldSocketId];
    }

    if (gameState.lastResultsPayload?.results?.[oldSocketId]) {
      gameState.lastResultsPayload.results[socket.id] = gameState.lastResultsPayload.results[oldSocketId];
      delete gameState.lastResultsPayload.results[oldSocketId];
    }
  }

  player.connectionStatus = 'online';
  player.disconnectedAt = null;
  socket.data.playerToken = player.token;

  socket.emit('student:resumed', {
    id: socket.id,
    token: player.token,
    name: player.name,
    number: player.number,
    studentClass: player.studentClass,
    score: Math.round(player.score * 100) / 100,
    totalQuestions: questions.length
  });

  emitStudentCurrentState(socket, player);
  io.to('teachers').emit('game:answerCount', {
    count: Object.keys(gameState.currentAnswers).length,
    total: getActivePlayers().length
  });
  emitTeacherState();
  return player;
}

function scheduleDisconnectRemoval(playerId) {
  const player = gameState.players[playerId];
  if (!player || player.status !== 'active') return;

  player.connectionStatus = 'reconnecting';
  player.disconnectedAt = Date.now();
  clearPendingDisconnect(player.token);

  gameState.pendingDisconnects[player.token] = setTimeout(() => {
    markPlayerRemoved(player.id, 'Left the quiz or lost connection', 'disconnect', null, false);
  }, DISCONNECT_GRACE_MS);

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

  socket.on('student:resume', safe(({ token }) => {
    resumePlayer(socket, token);
  }));

  socket.on('student:sync', safe(({ token }) => {
    const player = resumePlayer(socket, token);
    if (player) return;

    const currentPlayer = gameState.players[socket.id];
    if (currentPlayer && currentPlayer.status === 'active') {
      emitStudentCurrentState(socket, currentPlayer);
    }
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
    socket.data.playerToken = token;
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
      questionSet: buildStudentQuestionSet(),
      status: 'active',
      connectionStatus: 'online',
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

  socket.on('student:answer', safe(({ questionId, choiceIndex, token }) => {
    let player = gameState.players[socket.id];
    if (!player && token) {
      player = resumePlayer(socket, token);
    }
    const question = getPlayerQuestion(player);
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
        scheduleDisconnectRemoval(socket.id);
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
