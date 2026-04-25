const socket = io();

const screens = {
  lobby: document.getElementById('screen-lobby'),
  question: document.getElementById('screen-question'),
  results: document.getElementById('screen-results'),
  leaderboard: document.getElementById('screen-leaderboard'),
  finished: document.getElementById('screen-finished')
};

let currentQuestion = null;
let currentTimeLimit = 40;
let latestState = null;

function showScreen(name) {
  Object.values(screens).forEach((screen) => screen.classList.remove('active'));
  const target = screens[name] || screens.lobby;
  target.classList.add('active');
}

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function makeEmpty(text) {
  const node = document.createElement('p');
  node.className = 'muted';
  node.textContent = text;
  return node;
}

function initials(name) {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

function renderPlayerList(containerId, players, mode = 'active') {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  const rows = Object.values(players)
    .filter((player) => mode === 'active' ? player.status === 'active' : player.status !== 'active')
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!rows.length) {
    container.appendChild(makeEmpty(mode === 'active' ? 'No students yet.' : 'No removals yet.'));
    return;
  }

  rows.forEach((player) => {
    const row = document.createElement('div');
    row.className = `student-row ${player.status === 'active' ? '' : 'removed'}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = initials(player.name);

    const nameWrap = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'student-name';
    name.textContent = player.name;
    nameWrap.appendChild(name);

    const detail = document.createElement('span');
    detail.className = 'small-text';
    detail.textContent = player.status === 'active'
      ? `${player.score} points`
      : `${player.score} points - ${player.removalReason || 'removed'}`;
    nameWrap.appendChild(detail);

    const action = document.createElement('button');
    action.className = player.status === 'active' ? 'btn danger' : 'status-pill removed';
    action.textContent = player.status === 'active' ? 'Remove' : 'Removed';
    if (player.status === 'active') {
      action.addEventListener('click', () => {
        if (window.confirm(`Remove ${player.name} from the quiz?`)) {
          socket.emit('teacher:kickPlayer', { playerId: player.id });
        }
      });
    }

    row.append(avatar, nameWrap, action);
    container.appendChild(row);
  });
}

function renderLeaderboard(containerId, leaderboard) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  if (!leaderboard.length) {
    container.appendChild(makeEmpty('No scores yet.'));
    return;
  }

  leaderboard.forEach((player, index) => {
    const row = document.createElement('div');
    row.className = `leaderboard-row ${player.status === 'active' ? '' : 'removed'}`;

    const rank = document.createElement('div');
    rank.className = 'avatar';
    rank.textContent = String(index + 1);

    const nameWrap = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'leader-name';
    name.textContent = player.name;
    const detail = document.createElement('span');
    detail.className = 'small-text';
    detail.textContent = player.status === 'active' ? 'Active' : (player.removalReason || 'Removed');
    nameWrap.append(name, detail);

    const score = document.createElement('span');
    score.className = player.status === 'active' ? 'score-pill' : 'status-pill removed';
    score.textContent = `${player.score} pts`;

    row.append(rank, nameWrap, score);
    container.appendChild(row);
  });
}

function renderQuestion(question) {
  if (!question) return;
  currentQuestion = question;
  currentTimeLimit = question.timeLimit;

  setText('question-number', `Question ${question.number} of ${question.total}`);
  setText('question-section', question.section);
  setText('question-points', `${question.points} points`);
  setText('question-prompt', question.prompt);
  setText('question-time-kind', question.timeLimit === 300 ? '5m' : '40s');

  const passage = document.getElementById('question-passage');
  if (question.passage) {
    passage.textContent = question.passage;
    passage.classList.remove('hidden');
  } else {
    passage.classList.add('hidden');
    passage.textContent = '';
  }

  const imageFrame = document.getElementById('question-image-frame');
  const image = document.getElementById('question-image');
  if (question.image) {
    image.src = question.image;
    image.alt = question.imageAlt || 'Question image';
    imageFrame.classList.remove('hidden');
  } else {
    image.removeAttribute('src');
    image.alt = '';
    imageFrame.classList.add('hidden');
  }

  const options = document.getElementById('question-options');
  options.innerHTML = '';
  question.options.forEach((option, index) => {
    const row = document.createElement('div');
    row.className = 'option';

    const letter = document.createElement('span');
    letter.className = 'option-letter';
    letter.textContent = String.fromCharCode(65 + index);

    const label = document.createElement('span');
    label.textContent = option;

    row.append(letter, label);
    options.appendChild(row);
  });

  updateTimer(question.timeLimit);
}

function updateTimer(seconds) {
  const timerNumber = document.getElementById('timer-number');
  const timerFill = document.getElementById('timer-fill');
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const percent = currentTimeLimit ? (safeSeconds / currentTimeLimit) * 100 : 0;

  timerNumber.textContent = formatTime(safeSeconds);
  timerFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;

  timerNumber.className = 'timer-number';
  timerFill.className = 'timer-fill';
  if (safeSeconds <= 5) {
    timerNumber.classList.add('danger');
    timerFill.classList.add('danger');
  } else if (safeSeconds <= 10) {
    timerNumber.classList.add('warning');
    timerFill.classList.add('warning');
  }
}

function applyTeacherState(state) {
  latestState = state;
  const players = state.players || {};
  const playerValues = Object.values(players);
  const activeCount = playerValues.filter((player) => player.status === 'active').length;
  const removedCount = playerValues.filter((player) => player.status !== 'active').length;

  setText('active-count', activeCount);
  setText('removed-count', removedCount);
  setText('total-count', state.totalQuestions || 24);
  setText('answer-total', activeCount);
  setText('answer-count', state.answerCount || 0);
  document.getElementById('start-btn').disabled = activeCount < 1 || state.phase !== 'lobby';

  renderPlayerList('student-list', players, 'active');
  renderPlayerList('question-student-list', players, 'active');
  renderPlayerList('removed-list', players, 'removed');
  renderLeaderboard('leaderboard-list', state.leaderboard || []);
  renderLeaderboard('final-leaderboard', state.leaderboard || []);

  if (state.currentQuestion) {
    renderQuestion(state.currentQuestion);
    updateTimer(state.timeRemaining);
  }

  if (state.phase === 'lobby') showScreen('lobby');
  if (state.phase === 'question') showScreen('question');
  if (state.phase === 'results') showScreen('results');
  if (state.phase === 'leaderboard') showScreen('leaderboard');
  if (state.phase === 'finished') showScreen('finished');
}

socket.emit('teacher:join');

socket.on('teacher:state', applyTeacherState);

socket.on('game:question', (question) => {
  renderQuestion(question);
  setText('answer-count', 0);
  showScreen('question');
});

socket.on('game:timer', ({ timeRemaining }) => {
  updateTimer(timeRemaining);
});

socket.on('game:answerCount', ({ count, total }) => {
  setText('answer-count', count);
  setText('answer-total', total);
});

socket.on('game:results', (data) => {
  const wrongCount = Math.max(data.stats.totalAnswered - data.stats.correctCount, 0);
  setText('correct-count', data.stats.correctCount);
  setText('wrong-count', wrongCount);
  setText('no-answer-count', data.stats.noAnswerCount);

  const correct = document.getElementById('correct-answer');
  correct.className = 'result-strip correct';
  correct.textContent = `Correct answer: ${data.correctAnswer}`;
  renderLeaderboard('results-leaderboard', data.leaderboard || []);
  showScreen('results');
});

socket.on('game:leaderboard', ({ leaderboard }) => {
  renderLeaderboard('leaderboard-list', leaderboard || []);
  showScreen('leaderboard');
});

socket.on('game:finished', ({ leaderboard }) => {
  renderLeaderboard('final-leaderboard', leaderboard || []);
  showScreen('finished');
});

document.getElementById('start-btn').addEventListener('click', () => {
  socket.emit('teacher:start');
});

document.getElementById('restart-btn').addEventListener('click', () => {
  if (window.confirm('Reset the lobby and scores?')) socket.emit('teacher:restart');
});

document.getElementById('final-restart-btn').addEventListener('click', () => {
  socket.emit('teacher:restart');
});

document.getElementById('move-next-btn').addEventListener('click', () => {
  socket.emit('teacher:moveNext');
});

document.getElementById('show-results-btn').addEventListener('click', () => {
  socket.emit('teacher:showResults');
});

document.getElementById('results-next-btn').addEventListener('click', () => {
  socket.emit('teacher:moveNext');
});

document.getElementById('leaderboard-next-btn').addEventListener('click', () => {
  socket.emit('teacher:moveNext');
});

document.getElementById('leaderboard-btn').addEventListener('click', () => {
  socket.emit('teacher:showLeaderboard');
});

document.getElementById('end-quiz-btn').addEventListener('click', () => {
  if (latestState?.phase === 'finished') return;
  if (window.confirm('End the quiz now and show final scores?')) {
    socket.emit('teacher:endQuiz');
  }
});
