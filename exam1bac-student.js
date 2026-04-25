const socket = io();

const screens = {
  join: document.getElementById('screen-join'),
  waiting: document.getElementById('screen-waiting'),
  question: document.getElementById('screen-question'),
  result: document.getElementById('screen-result'),
  leaderboard: document.getElementById('screen-leaderboard'),
  finished: document.getElementById('screen-finished')
};

let currentQuestion = null;
let currentTimeLimit = 40;
let hasAnswered = false;
let studentName = '';
let playerId = '';
let playerToken = '';
let myScore = 0;
let protectionArmed = false;
let violationSent = false;
let removed = false;

function showScreen(name) {
  Object.values(screens).forEach((screen) => screen.classList.remove('active'));
  const target = screens[name] || screens.join;
  target.classList.add('active');
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function updateScore(score) {
  myScore = Number(score) || 0;
  setText('score-value', myScore);
  setText('result-score', myScore);
  setText('final-score', myScore);
  setText('removed-score', myScore);
}

function renderQuestion(question) {
  currentQuestion = question;
  currentTimeLimit = question.timeLimit;
  hasAnswered = false;

  setText('question-number', `Question ${question.number} of ${question.total}`);
  setText('question-section', question.section);
  setText('question-points', `${question.points} points`);
  setText('question-prompt', question.prompt);
  document.getElementById('answer-status').classList.add('hidden');

  const passage = document.getElementById('question-passage');
  if (question.passage) {
    passage.textContent = question.passage;
    passage.classList.remove('hidden');
  } else {
    passage.textContent = '';
    passage.classList.add('hidden');
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
    const button = document.createElement('button');
    button.className = 'option';
    button.type = 'button';

    const letter = document.createElement('span');
    letter.className = 'option-letter';
    letter.textContent = String.fromCharCode(65 + index);

    const label = document.createElement('span');
    label.textContent = option;

    button.append(letter, label);
    button.addEventListener('click', () => submitAnswer(index, button));
    options.appendChild(button);
  });

  updateTimer(question.timeLimit);
  showScreen('question');
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

function submitAnswer(choiceIndex, button) {
  if (hasAnswered || !currentQuestion || removed) return;
  hasAnswered = true;

  document.querySelectorAll('#question-options .option').forEach((option) => {
    option.disabled = true;
    option.classList.remove('selected');
  });
  button.classList.add('selected');
  document.getElementById('answer-status').classList.remove('hidden');

  socket.emit('student:answer', {
    questionId: currentQuestion.id,
    choiceIndex
  });
}

function makeEmpty(text) {
  const node = document.createElement('p');
  node.className = 'muted';
  node.textContent = text;
  return node;
}

function renderLeaderboard(containerId, leaderboard) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  if (!leaderboard.length) {
    container.appendChild(makeEmpty('No scores yet.'));
    return;
  }

  leaderboard.forEach((player, index) => {
    if (player.id === playerId) updateScore(player.score);

    const row = document.createElement('div');
    row.className = `leaderboard-row ${player.status === 'active' ? '' : 'removed'}`;

    const rank = document.createElement('div');
    rank.className = 'avatar';
    rank.textContent = String(index + 1);

    const nameWrap = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'leader-name';
    name.textContent = player.id === playerId ? `${player.name} (you)` : player.name;
    const detail = document.createElement('span');
    detail.className = 'small-text';
    detail.textContent = player.status === 'active' ? 'Active' : 'Removed';
    nameWrap.append(name, detail);

    const score = document.createElement('span');
    score.className = player.status === 'active' ? 'score-pill' : 'status-pill removed';
    score.textContent = `${player.score} pts`;

    row.append(rank, nameWrap, score);
    container.appendChild(row);
  });
}

function showRemoved(reason, score) {
  removed = true;
  protectionArmed = false;
  document.body.classList.remove('protected');
  setText('removed-reason', reason || 'You left the quiz.');
  updateScore(score ?? myScore);
  document.getElementById('removed-overlay').classList.add('active');
}

function sendViolation(reason, type) {
  if (!protectionArmed || removed || violationSent) return;
  violationSent = true;

  const payload = {
    playerId,
    token: playerToken,
    reason,
    type
  };

  try {
    socket.emit('student:violation', payload);
  } catch (error) {
    // The beacon below is the fallback for closing or crashing tabs.
  }

  try {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/exam1bac/violation', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/exam1bac/violation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).catch(() => {});
    }
  } catch (error) {
    // Nothing else to do if the page is already going away.
  }

  showRemoved(reason, myScore);
  setTimeout(() => socket.disconnect(), 250);
}

function armProtection() {
  protectionArmed = true;
  document.body.classList.add('protected');
}

document.getElementById('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = document.getElementById('student-name').value.trim();
  if (name.length < 2) {
    setText('join-error', 'Please enter your full name.');
    return;
  }
  setText('join-error', '');
  socket.emit('student:join', { name });
});

socket.on('student:joinRejected', ({ message }) => {
  setText('join-error', message || 'Could not join the quiz.');
});

socket.on('student:joined', ({ id, token, name }) => {
  playerId = id;
  playerToken = token;
  studentName = name;
  updateScore(0);
  setText('student-subtitle', name);
  setText('waiting-name', `${name}, wait for the teacher to start.`);
  setText('score-name', name);
  setText('result-name', name);
  showScreen('waiting');
  armProtection();
});

socket.on('game:question', (question) => {
  if (removed) return;
  renderQuestion(question);
});

socket.on('game:timer', ({ timeRemaining }) => {
  if (!removed) updateTimer(timeRemaining);
});

socket.on('student:answerReceived', () => {
  document.getElementById('answer-status').classList.remove('hidden');
});

socket.on('student:score', ({ score }) => {
  updateScore(score);
});

socket.on('game:results', (data) => {
  if (removed) return;
  const result = data.results[playerId];
  const strip = document.getElementById('result-strip');

  if (result) updateScore(result.score);
  if (result?.correct) {
    strip.className = 'result-strip correct';
    strip.textContent = `Correct. +${result.points} points`;
  } else if (result?.noAnswer) {
    strip.className = 'result-strip wrong';
    strip.textContent = 'No answer submitted.';
  } else {
    strip.className = 'result-strip wrong';
    strip.textContent = 'Incorrect.';
  }

  setText('correct-answer', data.correctAnswer);
  showScreen('result');
});

socket.on('game:leaderboard', ({ leaderboard }) => {
  if (removed) return;
  renderLeaderboard('leaderboard-list', leaderboard || []);
  showScreen('leaderboard');
});

socket.on('game:finished', ({ leaderboard }) => {
  if (removed) return;
  renderLeaderboard('final-leaderboard', leaderboard || []);
  setText('final-score', myScore);
  showScreen('finished');
});

socket.on('game:reset', () => {
  if (removed) return;
  updateScore(0);
  showScreen(studentName ? 'waiting' : 'join');
});

socket.on('student:removed', ({ reason, score }) => {
  showRemoved(reason, score);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) sendViolation('You left the quiz page.', 'visibility');
});

window.addEventListener('blur', () => {
  sendViolation('You opened another app or window during the quiz.', 'blur');
});

window.addEventListener('pagehide', () => {
  sendViolation('You left the quiz page.', 'pagehide');
});

window.addEventListener('beforeunload', () => {
  sendViolation('You left the quiz page.', 'beforeunload');
});

document.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  const screenshotShortcut = event.key === 'PrintScreen'
    || (event.metaKey && event.shiftKey && ['3', '4', '5'].includes(event.key))
    || (event.ctrlKey && event.shiftKey && ['s', 'p'].includes(key));

  const blockedShortcut = screenshotShortcut
    || event.key === 'F12'
    || (event.ctrlKey && event.shiftKey && ['i', 'j', 'c'].includes(key))
    || (event.metaKey && event.altKey && ['i', 'j', 'c'].includes(key))
    || ((event.ctrlKey || event.metaKey) && ['u', 's', 'p', 'a', 'c'].includes(key));

  if (blockedShortcut) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (screenshotShortcut) {
    sendViolation('Screenshot attempt detected.', 'screenshot');
  }
});

document.addEventListener('keyup', (event) => {
  if (event.key === 'PrintScreen') {
    sendViolation('Screenshot attempt detected.', 'screenshot');
  }
});

document.addEventListener('contextmenu', (event) => {
  if (protectionArmed) event.preventDefault();
});

document.addEventListener('copy', (event) => {
  if (protectionArmed) event.preventDefault();
});

if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
  const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getDisplayMedia = (...args) => {
    sendViolation('Screen recording attempt detected.', 'screen-capture');
    return originalGetDisplayMedia(...args);
  };
}
