import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
  getFirestore,
  doc,
  getDoc,
  updateDoc,
  collection,
  getDocs,
  onSnapshot,
  setDoc,
  deleteDoc,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCln7hjCL45RBjSP_XibdsZ1JdL4QE94D4',
  authDomain: 'bluf-trivia.firebaseapp.com',
  projectId: 'bluf-trivia',
  storageBucket: 'bluf-trivia.appspot.com',
  messagingSenderId: '559894766567',
  appId: '1:559894766567:web:ba15a3ee7f8c64d5f2d342',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let isFirstRender = true;
let isTimerEditing = false;
let globalQuestionsCache = [];
let draggedRow = null;

// Зберігаємо поточний стан гри глобально в адмінці
let currentGameState = null;

// Слухаємо стан налаштувань гри в реальному часі
onSnapshot(doc(db, 'settings', 'game'), async (docSnap) => {
  if (!docSnap.exists()) return;
  currentGameState = docSnap.data();

  if (isFirstRender) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('adminContent').style.display = 'block';
    await loadQuestionsSelect(currentGameState.currentRound);
    isFirstRender = false;
  }
  renderAdminUI(currentGameState);

  // --- АВТОМАТИЗАЦІЯ: Перемикання "Показати варіанти відповідей" через 3 сек після закінчення таймера ---
  if (currentGameState.phase === 'SUBMIT') {
    if (currentGameState.timerState === 'expired') {
      if (!currentGameState.showQuestion && !hasAutoSwitchedQuestion && !autoShowTimeout) {
        autoShowTimeout = setTimeout(async () => {
          hasAutoSwitchedQuestion = true;
          autoShowTimeout = null;
          
          if (typeof window.toggleShowQuestion === 'function') {
            await window.toggleShowQuestion(true);
          }
        }, 3000);
      }
    } else if (currentGameState.timerState === 'running') {
      hasAutoSwitchedQuestion = false;
      if (autoShowTimeout) {
        clearTimeout(autoShowTimeout);
        autoShowTimeout = null;
      }
    }
  } else {
    hasAutoSwitchedQuestion = false;
    if (autoShowTimeout) {
      clearTimeout(autoShowTimeout);
      autoShowTimeout = null;
    }
  }

  // --- АВТОМАТИЗАЦІЯ: Перемикання "Показати авторів та голоси" через 3 сек після закінчення таймера у фазі VOTE ---
  if (currentGameState.phase === 'VOTE') {
    if (currentGameState.timerState === 'expired') {
      if (!currentGameState.showVoters && !hasAutoSwitchedVote && !autoShowVoteTimeout) {
        autoShowVoteTimeout = setTimeout(async () => {
          hasAutoSwitchedVote = true;
          autoShowVoteTimeout = null;
          
          if (typeof window.toggleVoters === 'function') {
            await window.toggleVoters(true);
          }
        }, 3000);
      }
    } else if (currentGameState.timerState === 'running') {
      hasAutoSwitchedVote = false;
      if (autoShowVoteTimeout) {
        clearTimeout(autoShowVoteTimeout);
        autoShowVoteTimeout = null;
      }
    }
  } else {
    hasAutoSwitchedVote = false;
    if (autoShowVoteTimeout) {
      clearTimeout(autoShowVoteTimeout);
      autoShowVoteTimeout = null;
    }
  }
});

// 🟢 Також слухаємо колекції answers та votes в реальному часі, щоб дубль дошки оновлювався миттєво
onSnapshot(collection(db, 'answers'), (snapshot) => {
  if (currentGameState) {
    loadLiveStatsAndScores(currentGameState);
  }
});

onSnapshot(collection(db, 'votes'), (snapshot) => {
  if (currentGameState) {
    loadLiveStatsAndScores(currentGameState);
  }
});

let autoShowTimeout = null;
let hasAutoSwitchedQuestion = false;
let autoShowVoteTimeout = null;
let hasAutoSwitchedVote = false;

async function loadQuestionsSelect(currentRound) {
  const qSnapshot = await getDocs(collection(db, 'questions'));
  const select = document.getElementById('questionSelect');
  let html = '';

  const questions = [];
  qSnapshot.forEach((docSnap) => {
    questions.push({ id: docSnap.id, ...docSnap.data() });
  });

  questions.sort((a, b) => Number(a.roundNum) - Number(b.roundNum));
  globalQuestionsCache = questions;

  if (questions.length === 0) {
    html = `<option value="1">Немає запитань (Налаштування ⚙️)</option>`;
  } else {
    questions.forEach((q) => {
      html += `<option value="${q.roundNum}">Раунд ${q.roundNum}: ${
        q.text || q.question || ''
      }</option>`;
    });
  }

  select.innerHTML = html;
  select.value = currentRound;
}

const modal = document.getElementById('settingsModal');
document.getElementById('openSettingsBtn').onclick = (e) => {
  e.preventDefault();
  openSettingsModal();
};
document.getElementById('closeModalBtn').onclick = () =>
  (modal.style.display = 'none');
document.getElementById('cancelModalBtn').onclick = () =>
  (modal.style.display = 'none');

function openSettingsModal() {
  const tbody = document.getElementById('questionsTableBody');
  let html = '';

  globalQuestionsCache.forEach((q, idx) => {
    const qText = q.text || q.question || '';
    html += `
      <tr draggable="true" data-doc-id="${q.id}">
        <td class="drag-handle" title="Перетягніть, щоб змінити порядок">☰</td>
        <td><input type="number" class="q-round" value="${
          idx + 1
        }" readonly style="text-align: center; background: #222; color: #888;"></td>
        <td><input type="text" class="q-text" value="${qText}"></td>
        <td><input type="text" class="q-correct" value="${
          q.correctAnswer || ''
        }"></td>
        <td><input type="text" class="q-wrong" value="${
          q.wrongAnswer || ''
        }"></td>
        <td style="text-align: center;">
          <button class="delete-row-btn" onclick="deleteQuestionRow(this)" title="Видалити раунд">🗑️</button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  initDragAndDrop();
  reindexRounds();
  modal.style.display = 'flex';
}

// Налаштування логіки Drag & Drop для рядків таблиці
// Налаштування логіки Drag & Drop для рядків таблиці
function initDragAndDrop() {
  const tbody = document.getElementById('questionsTableBody');
  const rows = tbody.querySelectorAll('tr');

  rows.forEach((row) => {
    // Дозволяємо розпочинати drag лише при затисканні ручки ☰
    const handle = row.querySelector('.drag-handle');
    if (handle) {
      handle.addEventListener('mousedown', () => {
        row.setAttribute('draggable', 'true');
      });
      handle.addEventListener('mouseup', () => {
        row.removeAttribute('draggable');
      });
    }

    row.addEventListener('dragstart', function (e) {
      draggedRow = this;
      this.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', function () {
      this.classList.remove('dragging');
      this.removeAttribute('draggable');
      draggedRow = null;
      reindexRounds();
    });

    row.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      if (!draggedRow || draggedRow === this) return;

      const rect = this.getBoundingClientRect();
      const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;

      if (next) {
        tbody.insertBefore(draggedRow, this.nextSibling);
      } else {
        tbody.insertBefore(draggedRow, this);
      }
    });
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [
    ...container.querySelectorAll('tr:not(.dragging)'),
  ];

  return draggableElements.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return { offset: negativeInfinityOrLowest(), element: closest.element };
      }
    },
    { offset: Number.NEGATIVE_INFINITY }
  ).element;
}

function negativeInfinityOrLowest() {
  return Number.NEGATIVE_INFINITY;
}

function reindexRounds() {
  const rows = document.querySelectorAll('#questionsTableBody tr');
  rows.forEach((row, index) => {
    const roundInput = row.querySelector('.q-round');
    if (roundInput) {
      roundInput.value = index + 1;
    }
  });
}

window.deleteQuestionRow = function (btn) {
  const row = btn.closest('tr');
  if (row) {
    row.remove();
    reindexRounds();
  }
};

window.addQuestionRow = function (questionVal = '', correctVal = '', wrongVal = '') {
  const tbody = document.getElementById('questionsTableBody');
  const tr = document.createElement('tr');
  tr.setAttribute('draggable', 'true');
  tr.innerHTML = `
    <td class="drag-handle" title="Перетягніть, щоб змінити порядок">☰</td>
    <td><input type="number" class="q-round" value="${
      tbody.children.length + 1
    }" readonly style="text-align: center; background: #222; color: #888;"></td>
    <td><input type="text" class="q-text" placeholder="Текст запитання..." value="${questionVal.replace(/"/g, '&quot;')}"></td>
    <td><input type="text" class="q-correct" placeholder="Правильна..." value="${correctVal.replace(/"/g, '&quot;')}"></td>
    <td><input type="text" class="q-wrong" placeholder="Пастка..." value="${wrongVal.replace(/"/g, '&quot;')}"></td>
    <td style="text-align: center;">
      <button class="delete-row-btn" onclick="deleteQuestionRow(this)" title="Видалити раунд">🗑️</button>
    </td>
  `;
  tbody.appendChild(tr);
  if (typeof initDragAndDrop === 'function') initDragAndDrop();
  if (typeof reindexRounds === 'function') reindexRounds();
};

document.getElementById('saveQuestionsBtn').onclick = async () => {
  showLoader('Збереження запитань...');
  const rows = document.querySelectorAll('#questionsTableBody tr');

  const existingDocs = [...globalQuestionsCache];
  const processedDocIds = new Set();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const roundNum = i + 1; // Автоматичний порядок за позицією у списку
    const text = row.querySelector('.q-text').value.trim();
    const correctAnswer = row.querySelector('.q-correct').value.trim();
    const wrongAnswer = row.querySelector('.q-wrong').value.trim();

    const docId = row.getAttribute('data-doc-id');
    const questionData = { roundNum, text, correctAnswer, wrongAnswer };

    if (docId) {
      await setDoc(doc(db, 'questions', docId), questionData);
      processedDocIds.add(docId);
    } else {
      const newRef = doc(collection(db, 'questions'));
      await setDoc(newRef, questionData);
    }
  }

  for (const oldDoc of existingDocs) {
    if (!processedDocIds.has(oldDoc.id)) {
      await deleteDoc(doc(db, 'questions', oldDoc.id));
    }
  }

  await loadQuestionsSelect(1);
  modal.style.display = 'none';
  hideLoader();
};

// --- Решта логіки адмінки ---
function renderAdminUI(state) {
  const btnSubmit = document.getElementById('btnSubmitPhase');
  const btnVote = document.getElementById('btnVotePhase');
  btnSubmit.className = state.phase === 'SUBMIT' ? 'active' : '';
  btnVote.className = state.phase === 'VOTE' ? 'active' : '';

  const btnBoard = document.getElementById('btnViewBoard');
  const btnLb = document.getElementById('btnViewLb');
  btnBoard.className = state.gameView === 'BOARD' ? 'active' : '';
  btnLb.className = state.gameView === 'LEADERBOARD' ? 'active' : '';

  document.getElementById('showQuestionToggle').checked =
    state.showQuestion || false;
  document.getElementById('votersToggle').checked = state.showVoters || false;
  document.getElementById('boardToggle').checked =
    state.showBoardToPlayers !== false;

  const select = document.getElementById('questionSelect');
  if (select && Number(select.value) !== Number(state.currentRound)) {
    select.value = state.currentRound;
  }

  const timerInput = document.getElementById('timerInput');
  // Оновлюємо значення інпута з бази, тільки якщо користувач зараз в ньому нічого не друкує
  if (timerInput && document.activeElement !== timerInput) {
    timerInput.value = state.timerSeconds || 30;
  }

  const btnStartTimer = document.getElementById('btnStartTimer');
  if (state.timerState === 'running') {
    btnStartTimer.innerText = 'Стоп';
    btnStartTimer.style.background = '#c62828';
  } else {
    btnStartTimer.innerText = 'Старт';
    btnStartTimer.style.background = '#2e7d32';
  }

  loadLiveStatsAndScores(state);
}

async function loadLiveStatsAndScores(state) {
  const votesSnap = await getDocs(collection(db, 'votes'));
  const answersSnap = await getDocs(collection(db, 'answers')); // 👈 Додано правильне оголошення answersSnap
  const questionsSnap = await getDocs(collection(db, 'questions'));
  const statsContainer = document.getElementById('liveStatsContainer');
  let statsHtml = '';

  const currentRoundNum = Number(state.currentRound) || 1;
  let roundAnswers = [];

  // 1. Спочатку пробуємо взяти вже закешований і перемішаний масив із налаштувань гри
  if (state.shuffledAnswers && state.shuffledAnswers.length > 0) {
    roundAnswers = state.shuffledAnswers;
  } else {
    // 2. Якщо кешу ще немає, збираємо звичайним способом
    answersSnap.forEach((docSnap) => {
      const ans = docSnap.data();
      if (Number(ans.roundNum) === currentRoundNum) {
        roundAnswers.push({
          id: ans.id || docSnap.id,
          answer: ans.answer,
          userName: ans.userName,
        });
      }
    });

    let currentQ = { correctAnswer: '', wrongAnswer: '' };
    questionsSnap.forEach((docSnap) => {
      const q = docSnap.data();
      if (Number(q.roundNum) === currentRoundNum) {
        currentQ = q;
      }
    });

    if (currentQ.correctAnswer) {
      roundAnswers.push({
        id: 'correct' + currentRoundNum,
        answer: currentQ.correctAnswer,
        userName: '✅ Правильна відповідь',
        isSpecial: true,
      });
    }
    if (currentQ.wrongAnswer) {
      roundAnswers.push({
        id: 'wrong' + currentRoundNum,
        answer: currentQ.wrongAnswer,
        userName: '😡 Відповідь-пастка',
        isSpecial: true,
      });
    }
  }

  if (roundAnswers.length === 0) {
    statsHtml = `<p style="color: #888;">Немає варіантів для цього раунду...</p>`;
  } else {
    roundAnswers.forEach((item, idx) => {
      let voters = [];
      votesSnap.forEach((vDoc) => {
        const v = vDoc.data();
        if (
          Number(v.roundNum) === Number(currentRoundNum) &&
          v.votedAnswerId === item.id
        ) {
          voters.push(v.userName);
        }
      });

      // Рахуємо бали для автора цього варіанта (якщо це звичайна відповідь)
      const authorPoints = voters.length;

      statsHtml += `
        <div class="answer-stat-box" style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 12px; background: #252525; padding: 12px; border-radius: 8px;">
          <div style="display: flex; flex-direction: column; flex-grow: 1; margin-right: 15px;">
            <div class="ans-text" style="font-size: 18px; font-weight: bold; margin-bottom: 6px; color: #fff;"><b>${
              idx + 1
            }.</b> ${item.answer}</div>
            ${
              item.isSpecial
                ? `<div><span style="display: inline-block; background: ${
                    item.userName.includes('Правильна') ? '#2e7d32' : '#c62828'
                  }; color: #fff; padding: 3px 10px; border-radius: 6px; font-size: 13px; font-weight: 500; margin: 0;">${
                    item.userName
                  }</span></div>`
                : `<div><span class="author-badge" style="margin: 0;">😎 Автор: ${item.userName}</span></div>`
            }
          </div>
          <div>
            ${
              voters.length > 0
                ? voters
                    .map(
                      (v) =>
                        `<span class="voters-tag" style="background: #ffffff; color: #3700b3; padding: 5px 12px; border-radius: 6px; font-size: 15px; white-space: nowrap; margin: 2px; display: inline-block; font-weight: 500;">👤 ${v}</span>`
                    )
                    .join('')
                : '<div class="no-votes" style="color: #888; white-space: nowrap;">Ніхто поки не обрав</div>'
            }
          </div>
        </div>
      `;
    });
  }
  statsContainer.innerHTML = statsHtml;

  // --- ПОВНИЙ ПІДРАХУНОК БАЛІВ ДЛЯ ТАБЛИЦІ ЛІДЕРІВ В АДМІНЦІ ---
  const roundDetails = {};
  questionsSnap.forEach((docSnap) => {
    const q = docSnap.data();
    const rNum = Number(q.roundNum);
    roundDetails[rNum] = {
      correctId: 'correct' + rNum,
      wrongId: 'wrong' + rNum,
    };
  });

  const answerAuthorMap = {};
  answersSnap.forEach((docSnap) => {
    const a = docSnap.data();
    const ansId = a.id || docSnap.id;
    answerAuthorMap[ansId] = a.userName;
  });

  const scores = {};
  answersSnap.forEach((d) => {
    const a = d.data();
    if (a.userName) scores[a.userName] = 0;
  });
  votesSnap.forEach((d) => {
    const v = d.data();
    if (v.userName && scores[v.userName] === undefined) scores[v.userName] = 0;
  });

  votesSnap.forEach((d) => {
    const vote = d.data();
    const voter = vote.userName;
    const votedId = vote.votedAnswerId;
    const rNum = Number(vote.roundNum);

    if (!voter || !votedId) return;
    if (scores[voter] === undefined) scores[voter] = 0;

    const details = roundDetails[rNum] || {};

    if (votedId === details.correctId) {
      scores[voter] += 2;
    } else if (votedId === details.wrongId) {
      scores[voter] -= 1;
    } else {
      const author = answerAuthorMap[votedId];
      if (author) {
        if (scores[author] === undefined) scores[author] = 0;
        scores[author] += 1;
      }
    }
  });

  let scoreList = Object.keys(scores).map((name) => ({
    name,
    score: scores[name],
  }));
  scoreList.sort((a, b) => b.score - a.score);

  let lbHtml = '';
  if (scoreList.length > 0) {
    lbHtml += `<table style="width: 100%; border-collapse: collapse;">
                <tr style="border-bottom: 1px solid #444; color: #03dac6; text-align: left;"><th style="padding: 8px;">Гравець</th><th style="padding: 8px; text-align: right;">Бали</th></tr>`;
    scoreList.forEach((item, index) => {
      const medal =
        index === 0 ? '🥇 ' : index === 1 ? '🥈 ' : index === 2 ? '🥉 ' : '';
      lbHtml += `<tr style="border-bottom: 1px solid #222;"><td style="padding: 8px;">${medal}${item.name}</td><td style="padding: 8px; text-align: right; font-weight: bold; color: #bb86fc;">${item.score}</td></tr>`;
    });
    lbHtml += `</table>`;
  } else {
    lbHtml = `<p style="color: #888;">Ще немає нарахованих балів...</p>`;
  }

  const lbContainer = document.getElementById('leaderboardContainer');
  if (lbContainer) {
    lbContainer.innerHTML = lbHtml;
  }
}

window.changeQuestion = async function (roundNum) {
  showLoader('Зміна раунду...');
  await updateDoc(doc(db, 'settings', 'game'), {
    currentRound: Number(roundNum),
    phase: 'SUBMIT',
    gameView: 'BOARD',
    showQuestion: false,
    showVoters: false,
    showBoardToPlayers: false,
    timerState: 'idle',
    timerStartTime: 0,
    shuffledAnswers: [],
  });
  hideLoader();
};

window.nextRoundBtn = async function () {
  const select = document.getElementById('questionSelect');
  if (select.selectedIndex < select.options.length - 1) {
    select.selectedIndex++;
    await window.changeQuestion(select.value);
  }
  hasAutoSwitchedQuestion = false;
  if (autoShowTimeout) {
    clearTimeout(autoShowTimeout);
    autoShowTimeout = null;
  }
  hasAutoSwitchedVote = false;
  if (autoShowVoteTimeout) {
    clearTimeout(autoShowVoteTimeout);
    autoShowVoteTimeout = null;
  }
};

window.prevRoundBtn = async function () {
  const select = document.getElementById('questionSelect');
  if (select.selectedIndex > 0) {
    select.selectedIndex--;
    await window.changeQuestion(select.value);
  }
  hasAutoSwitchedQuestion = false;
  if (autoShowTimeout) {
    clearTimeout(autoShowTimeout);
    autoShowTimeout = null;
  }
  hasAutoSwitchedVote = false;
  if (autoShowVoteTimeout) {
    clearTimeout(autoShowVoteTimeout);
    autoShowVoteTimeout = null;
  }
};

window.setPhase = async function (phase) {
  showLoader('Зміна фази...');
  const timerInput = document.getElementById('timerInput');
  const secs = timerInput ? parseInt(timerInput.value) || 30 : 30;

  const updateData = { phase };
  if (phase === 'VOTE') {
    updateData.showBoardToPlayers = true;
    // 👈 Автоматично запускаємо таймер при переході на фазу Голосування
    updateData.timerState = 'running';
    updateData.timerStartTime = new Date().getTime();
    updateData.timerSeconds = secs;
  }
  await updateDoc(doc(db, 'settings', 'game'), updateData);
  hideLoader();
};

window.setView = async function (mode) {
  showLoader('Зміна режиму...');
  await updateDoc(doc(db, 'settings', 'game'), { gameView: mode });
  hideLoader();
};

window.toggleShowQuestion = async function (isChecked) {
  const gameDocRef = doc(db, 'settings', 'game');
  if (isChecked) {
    const gameSnap = await getDoc(gameDocRef);
    const state = gameSnap.data();
    const currentRoundNum = Number(state.currentRound) || 1;
    const answersSnap = await getDocs(collection(db, 'answers'));
    const qSnapshot = await getDocs(collection(db, 'questions'));
    let currentQ = { correctAnswer: '', wrongAnswer: '' };
    qSnapshot.forEach((docSnap) => {
      const q = docSnap.data();
      if (Number(q.roundNum) === currentRoundNum) {
        currentQ = q;
      }
    });
    let roundAnswers = [];
    answersSnap.forEach((docSnap) => {
      const ans = docSnap.data();
      if (Number(ans.roundNum) === currentRoundNum) {
        roundAnswers.push({
          id: ans.id || docSnap.id,
          answer: ans.answer,
          userName: ans.userName,
        });
      }
    });
    if (currentQ.correctAnswer) {
      roundAnswers.push({
        id: 'correct' + currentRoundNum,
        answer: currentQ.correctAnswer,
        userName: '✅ Правильна відповідь',
        isSpecial: true,
      });
    }
    if (currentQ.wrongAnswer) {
      roundAnswers.push({
        id: 'wrong' + currentRoundNum,
        answer: currentQ.wrongAnswer,
        userName: '😡 Відповідь-пастка',
        isSpecial: true,
      });
    }
    // Перемішуємо тільки при увімкненні
    for (let i = roundAnswers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roundAnswers[i], roundAnswers[j]] = [roundAnswers[j], roundAnswers[i]];
    }
    
    // 👇 ЗАМІНА: Прибираємо скидання таймера в 'idle', щоб не відкривати поля заново
    await updateDoc(gameDocRef, {
      showQuestion: true,
      shuffledAnswers: roundAnswers,
    });
  } else {
    await updateDoc(gameDocRef, {
      showQuestion: false,
    });
  }
};

window.toggleBoardToPlayers = async function (isChecked) {
  const updateData = { showBoardToPlayers: isChecked };

  if (isChecked) {
    const timerInput = document.getElementById('timerInput');
    const secs = timerInput ? parseInt(timerInput.value) || 30 : 30;

    // 👈 Автоматично запускаємо таймер при увімкненні показу запитання учасникам
    updateData.timerState = 'running';
    updateData.timerStartTime = new Date().getTime();
    updateData.timerSeconds = secs;
  }

  await updateDoc(doc(db, 'settings', 'game'), updateData);
};

window.toggleVoters = async function (isChecked) {
  await updateDoc(doc(db, 'settings', 'game'), {
    showVoters: isChecked,
  });
};

window.saveOrEditTimer = async function () {
  const input = document.getElementById('timerInput');
  const btnSave = document.getElementById('btnSaveTimer');
  const secs = parseInt(input.value) || 30;

  if (!isTimerEditing) {
    // Натиснули "Зберегти" -> блокуємо поле, робимо кнопку сірим текстом "Змінити"
    input.disabled = true;
    input.style.background = '#222';
    btnSave.innerText = 'Змінити';
    btnSave.classList.add('change-link-btn');
    isTimerEditing = true;
    await updateDoc(doc(db, 'settings', 'game'), { timerSeconds: secs });
  } else {
    // Натиснули "Змінити" -> розблоковуємо поле, повертаємо фіолетову кнопку "Зберегти"
    input.disabled = false;
    input.style.background = '#2d2d2d';
    btnSave.innerText = 'Зберегти';
    btnSave.classList.remove('change-link-btn');
    isTimerEditing = false;
  }
};

window.toggleTimer = async function () {
  const input = document.getElementById('timerInput');
  const btnStart = document.getElementById('btnStartTimer');
  const secs = parseInt(input.value) || 30;
  const isRunning = btnStart.innerText === 'Стоп';

  const timerState = isRunning ? 'idle' : 'running';
  const timerStartTime = isRunning ? 0 : new Date().getTime();

  await updateDoc(doc(db, 'settings', 'game'), {
    timerSeconds: secs,
    timerState: timerState,
    timerStartTime: timerStartTime,
  });
};

// Логіка модального вікна очищення дошки
const clearModal = document.getElementById('clearBoardModal');
document.getElementById('openClearBoardModal').onclick = (e) => {
  e.preventDefault();
  clearModal.style.display = 'flex';
};

document.getElementById('cancelClearBtn').onclick = () => {
  clearModal.style.display = 'none';
};

document.getElementById('confirmClearBtn').onclick = async () => {
  clearModal.style.display = 'none';
  showLoader('Очищення дошки...');

  try {
    const answersSnap = await getDocs(collection(db, 'answers'));
    for (const d of answersSnap.docs) {
      await deleteDoc(doc(db, 'answers', d.id));
    }

    const votesSnap = await getDocs(collection(db, 'votes'));
    for (const d of votesSnap.docs) {
      await deleteDoc(doc(db, 'votes', d.id));
    }

    await updateDoc(doc(db, 'settings', 'game'), {
      shuffledAnswers: [],
      showQuestion: false,
    });

    hideLoader();
    // Прибрали alert, тепер очищення відбуватиметься без зайвого попапу!
  } catch (err) {
    console.error('Помилка очищення:', err);
    hideLoader();
    alert('Сталася помилка при очищенні дошки.');
  }
};

window.updateTimerSeconds = async function (val) {
  const secs = parseInt(val) || 30;
  await updateDoc(doc(db, 'settings', 'game'), { timerSeconds: secs });
};

window.handleCsvImport = function (event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    const text = e.target.result;
    const lines = text.split(/\r\n|\n/);
    
    // Шукаємо контейнер усіма можливими способами
    let container = document.getElementById('questionsTableBody');
    if (!container) {
      container = document.querySelector('tbody');
    }
    
    if (!container) {
      alert('Помилка: таблиця для запитань не знайдена на сторінці!');
      return;
    }

    let importedCount = 0;

    lines.forEach((line, index) => {
      if (!line.trim()) return;
      
      const separator = line.includes(';') ? ';' : ',';
      const parts = line.split(separator).map(p => p.trim().replace(/^["']|["']$/g, ''));

      // Пропускаємо шапку
      if (parts.length >= 2 && index === 0 && (parts[0].toLowerCase().includes('запит') || parts[0].toLowerCase().includes('question'))) {
        return;
      }

      if (parts.length >= 2) {
        const questionText = parts[0] || '';
        const correctAns = parts[1] || '';
        const wrongAns = parts[2] || '';

        if (typeof window.addQuestionRow === 'function') {
          window.addQuestionRow(questionText, correctAns, wrongAns);
          importedCount++;
        }
      }
    });

    event.target.value = '';
  };

  reader.readAsText(file, 'UTF-8');
};

function showLoader(text) {
  const loader = document.getElementById('adminLoader');
  loader.querySelector('span').innerText = text || 'Збереження...';
  loader.style.display = 'flex';
}

function hideLoader() {
  document.getElementById('adminLoader').style.display = 'none';
}