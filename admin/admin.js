import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
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
  query,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyCYp0Rtyu20272JG6pF6EB92cTGL13jpNc",
  authDomain: "bluffing-trivia.firebaseapp.com",
  projectId: "bluffing-trivia",
  storageBucket: "bluffing-trivia.firebasestorage.app",
  messagingSenderId: "642089303002",
  appId: "1:642089303002:web:457b53be09f2437527dee3"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let isFirstRender = true;
let globalQuestionsCache = [];
let draggedRow = null;
let currentGameState = null;
let sessionInfo = null;

async function getSessionRef() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomCode = (urlParams.get('room') || localStorage.getItem('currentSessionCode') || '').toUpperCase();
  if (!roomCode) return { docRef: null, roomCode: '' };
  
  const docRef = doc(db, 'sessions', roomCode);
  const docSnap = await getDoc(docRef);
  
  if (docSnap.exists()) {
    return { docRef, roomCode };
  }
  return { docRef: null, roomCode };
}

async function initAdmin() {
  sessionInfo = await getSessionRef();
  if (!sessionInfo || !sessionInfo.docRef) {
    document.getElementById('loading').innerText = 'Помилка: кімнату не знайдено!';
    return;
  }
  
  const roomCodeEl = document.getElementById('roomCodeDisplay');
  if (roomCodeEl) {
    roomCodeEl.innerText = `Код кімнати: ${sessionInfo.roomCode}`;
  }

  onSnapshot(sessionInfo.docRef, async (docSnap) => {
    if (!docSnap.exists()) return;
    currentGameState = docSnap.data();
    if (!currentGameState) return;
    
    if (isFirstRender) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('adminContent').style.display = 'block';
     
      const savedRound = currentGameState.currentRound || 1;
      await updateDoc(sessionInfo.docRef, {
        "gameSettings.phase": 'idle',
        "gameSettings.gameView": 'BOARD',
        "gameSettings.showQuestion": false,
        "gameSettings.showVoters": false,
        "gameSettings.showBoardToPlayers": false,
        "gameSettings.timerState": 'idle',
        "gameSettings.timerStartTime": 0
      });
 
      await loadQuestionsSelect(savedRound);
      isFirstRender = false;
    }
    
    renderAdminUI(currentGameState);

    if (currentGameState.gameSettings) {
      const gSet = currentGameState.gameSettings;
      if (document.getElementById('half-vote-time')) document.getElementById('half-vote-time').checked = !!gSet.halfVoteTime;
      if (document.getElementById('auto-board-update')) document.getElementById('auto-board-update').checked = !!gSet.autoBoardUpdate;
      if (document.getElementById('finish-on-last-player')) document.getElementById('finish-on-last-player').checked = !!gSet.finishOnLastPlayer;
    }
   
    handleAdminTimer(currentGameState);
    checkAutomationTimeouts(currentGameState);
  });
}

let unsubAnswers = null;
let unsubVotes = null;

function setupSubcollectionListeners(roomCode) {
  if (unsubAnswers) unsubAnswers();
  if (unsubVotes) unsubVotes();

  unsubAnswers = onSnapshot(collection(db, `sessions/${roomCode}/answers`), () => {
    if (currentGameState && sessionInfo) loadLiveStatsAndScores(currentGameState, sessionInfo.roomCode);
  });

  unsubVotes = onSnapshot(collection(db, `sessions/${roomCode}/votes`), () => {
    if (currentGameState && sessionInfo) loadLiveStatsAndScores(currentGameState, sessionInfo.roomCode);
  });
}

let autoShowTimeout = null;
let hasAutoSwitchedQuestion = false;
let autoShowVoteTimeout = null;
let hasAutoSwitchedVote = false;
let isRevealingAnswers = false;

function checkAutomationTimeouts(state) {
  const gSet = state.gameSettings || {};
  const isAutoEnabled = gSet.autoBoardUpdate === true;
  
  if (gSet.phase === 'SUBMIT') {
    if (gSet.timerState === 'expired' && isAutoEnabled) {
      if (!gSet.showQuestion && !hasAutoSwitchedQuestion && !autoShowTimeout && !isRevealingAnswers) {
        autoShowTimeout = setTimeout(async () => {
          hasAutoSwitchedQuestion = true;
          if (typeof window.toggleShowQuestion === 'function') {
            await window.toggleShowQuestion(true);
          }
          autoShowTimeout = null;
        }, 4500);
      }
    } else if (gSet.timerState === 'running' || !isAutoEnabled) {
      hasAutoSwitchedQuestion = false;
      if (autoShowTimeout) { clearTimeout(autoShowTimeout); autoShowTimeout = null; }
    }
  } else {
    hasAutoSwitchedQuestion = false;
    if (autoShowTimeout) { clearTimeout(autoShowTimeout); autoShowTimeout = null; }
  }

  if (gSet.phase === 'VOTE') {
    if (gSet.timerState === 'expired' && isAutoEnabled) {
      if (!gSet.showVoters && !hasAutoSwitchedVote && !autoShowVoteTimeout) {
        autoShowVoteTimeout = setTimeout(async () => {
          hasAutoSwitchedVote = true;
          if (typeof window.toggleVoters === 'function') {
            await window.toggleVoters(true);
          }
          autoShowVoteTimeout = null;
        }, 6000);
      }
    } else if (gSet.timerState === 'running' || !isAutoEnabled) {
      hasAutoSwitchedVote = false;
      if (autoShowVoteTimeout) { clearTimeout(autoShowVoteTimeout); autoShowVoteTimeout = null; }
    }
  } else {
    hasAutoSwitchedVote = false;
    if (autoShowVoteTimeout) { clearTimeout(autoShowVoteTimeout); autoShowVoteTimeout = null; }
  }
}

// Завантаження запитань із підколекції sessions/{roomCode}/questions
async function loadQuestionsSelect(currentRound) {
  if (!sessionInfo) return;
  setupSubcollectionListeners(sessionInfo.roomCode);

  const qSnapshot = await getDocs(collection(db, `sessions/${sessionInfo.roomCode}/questions`));
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
      html += `<option value="${q.roundNum}">Раунд ${q.roundNum}: ${q.text || q.question || ''}</option>`;
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
document.getElementById('closeModalBtn').onclick = () => (modal.style.display = 'none');
document.getElementById('cancelModalBtn').onclick = () => (modal.style.display = 'none');

function openSettingsModal() {
  const tbody = document.getElementById('questionsTableBody');
  let html = '';
  globalQuestionsCache.forEach((q, idx) => {
    const qText = q.text || q.question || '';
    html += `
      <tr draggable="true" data-doc-id="${q.id}">
        <td class="drag-handle" title="Перетягніть, щоб змінити порядок">☰</td>
        <td><input type="number" class="q-round" value="${idx + 1}" readonly style="text-align: center; background: #222; color: #888;"></td>
        <td><input type="text" class="q-text" value="${qText.replace(/"/g, '&quot;')}"></td>
        <td><input type="text" class="q-correct" value="${(q.correctAnswer || '').replace(/"/g, '&quot;')}"></td>
        <td><input type="text" class="q-wrong" value="${(q.wrongAnswer || '').replace(/"/g, '&quot;')}"></td>
        <td><input type="text" class="q-image" placeholder="URL картинки..." value="${(q.imageUrl || '').replace(/"/g, '&quot;')}"></td>
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

const gameSettingsModal = document.getElementById('gameSettingsModal');
const openGameSettingsBtn = document.getElementById('openGameSettingsBtn');

function syncGameSettingsUI() {
  if (currentGameState && currentGameState.gameSettings) {
    const gSet = currentGameState.gameSettings;
    const halfVote = document.getElementById('half-vote-time');
    const autoBoard = document.getElementById('auto-board-update');
    const finishLast = document.getElementById('finish-on-last-player');
   
    if (halfVote) halfVote.checked = !!gSet.halfVoteTime;
    if (autoBoard) autoBoard.checked = !!gSet.autoBoardUpdate;
    if (finishLast) finishLast.checked = !!gSet.finishOnLastPlayer;
  }
}

if (openGameSettingsBtn) {
  openGameSettingsBtn.onclick = (e) => {
    e.preventDefault();
    syncGameSettingsUI();
    if (gameSettingsModal) gameSettingsModal.style.display = 'flex';
  };
}

const closeGSBtn = document.getElementById('closeGameSettingsBtn');
const cancelGSBtn = document.getElementById('cancelGameSettingsBtn');
const saveGSBtn = document.getElementById('saveGameSettingsBtn');

const rollbackAndClose = () => {
  syncGameSettingsUI();
  gameSettingsModal.style.display = 'none';
};
if (closeGSBtn) closeGSBtn.onclick = rollbackAndClose;
if (cancelGSBtn) cancelGSBtn.onclick = rollbackAndClose;

if (saveGSBtn) {
  saveGSBtn.onclick = async () => {
    if (!sessionInfo || !sessionInfo.docRef) return;
   
    showLoader('Збереження...');
    try {
      await updateDoc(sessionInfo.docRef, {
        "gameSettings.halfVoteTime": document.getElementById('half-vote-time').checked,
        "gameSettings.autoBoardUpdate": document.getElementById('auto-board-update').checked,
        "gameSettings.finishOnLastPlayer": document.getElementById('finish-on-last-player').checked
      });
      gameSettingsModal.style.display = 'none';
      hideLoader();
    } catch (err) {
      console.error('Помилка збереження налаштувань:', err);
      hideLoader();
      alert('Помилка збереження');
    }
  };
}

function initDragAndDrop() {
  const tbody = document.getElementById('questionsTableBody');
  const rows = tbody.querySelectorAll('tr');
  rows.forEach((row) => {
    const handle = row.querySelector('.drag-handle');
    if (handle) {
      handle.addEventListener('mousedown', () => row.setAttribute('draggable', 'true'));
      handle.addEventListener('mouseup', () => row.removeAttribute('draggable'));
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

function reindexRounds() {
  const rows = document.querySelectorAll('#questionsTableBody tr');
  rows.forEach((row, index) => {
    const roundInput = row.querySelector('.q-round');
    if (roundInput) roundInput.value = index + 1;
  });
}

window.deleteQuestionRow = function (btn) {
  const row = btn.closest('tr');
  if (row) {
    row.remove();
    reindexRounds();
  }
};

window.addQuestionRow = function (questionVal = '', correctVal = '', wrongVal = '', imageVal = '') {
  const tbody = document.getElementById('questionsTableBody');
  const tr = document.createElement('tr');
  tr.setAttribute('draggable', 'true');
  tr.innerHTML = `
    <td class="drag-handle" title="Перетягніть, щоб змінити порядок">☰</td>
    <td><input type="number" class="q-round" value="${tbody.children.length + 1}" readonly style="text-align: center; background: #222; color: #888;"></td>
    <td><input type="text" class="q-text" placeholder="Текст запитання..." value="${questionVal.replace(/"/g, '&quot;')}"></td>
    <td><input type="text" class="q-correct" placeholder="Правильна..." value="${correctVal.replace(/"/g, '&quot;')}"></td>
    <td><input type="text" class="q-wrong" placeholder="Пастка..." value="${wrongVal.replace(/"/g, '&quot;')}"></td>
    <td><input type="text" class="q-image" placeholder="URL картинки..." value="${(imageVal || '').replace(/"/g, '&quot;')}"></td>
    <td style="text-align: center;">
      <button class="delete-row-btn" onclick="deleteQuestionRow(this)" title="Видалити раунд">🗑️</button>
    </td>
  `;
  tbody.appendChild(tr);
  initDragAndDrop();
  reindexRounds();
};

// Збереження запитань у підколекцію sessions/{roomCode}/questions
document.getElementById('saveQuestionsBtn').onclick = async () => {
  if (!sessionInfo) return;
  showLoader('Збереження запитань...');
  const roomCode = sessionInfo.roomCode;
  const rows = document.querySelectorAll('#questionsTableBody tr');
  const existingDocs = [...globalQuestionsCache];
  const processedDocIds = new Set();
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const roundNum = i + 1;
    const text = row.querySelector('.q-text').value.trim();
    const correctAnswer = row.querySelector('.q-correct').value.trim();
    const wrongAnswer = row.querySelector('.q-wrong').value.trim();
    const imageUrl = row.querySelector('.q-image').value.trim();
    const docId = row.getAttribute('data-doc-id');
    
    const questionData = { roundNum, text, correctAnswer, wrongAnswer, imageUrl, shuffledAnswers: [] };
    
    if (docId) {
      await setDoc(doc(db, `sessions/${roomCode}/questions`, docId), questionData, { merge: true });
      processedDocIds.add(docId);
    } else {
      const newRef = doc(collection(db, `sessions/${roomCode}/questions`));
      await setDoc(newRef, questionData);
    }
  }
  
  for (const oldDoc of existingDocs) {
    if (!processedDocIds.has(oldDoc.id)) {
      await deleteDoc(doc(db, `sessions/${roomCode}/questions`, oldDoc.id));
    }
  }
  
  await updateDoc(sessionInfo.docRef, { questionsCount: rows.length });
  await loadQuestionsSelect(1);
  modal.style.display = 'none';
  hideLoader();
};

function renderAdminUI(state) {
  const gSet = state.gameSettings || {};
  const btnSubmit = document.getElementById('btnSubmitPhase');
  const btnVote = document.getElementById('btnVotePhase');
  if (btnSubmit) btnSubmit.className = gSet.phase === 'SUBMIT' ? 'active' : '';
  if (btnVote) btnVote.className = gSet.phase === 'VOTE' ? 'active' : '';
  
  const btnQr = document.getElementById('btnViewQr');
  const btnBoard = document.getElementById('btnViewBoard');
  const btnLb = document.getElementById('btnViewLb');
  if (btnQr) btnQr.className = gSet.gameView === 'QR' ? 'active' : '';
  if (btnBoard) btnBoard.className = gSet.gameView === 'BOARD' ? 'active' : '';
  if (btnLb) btnLb.className = gSet.gameView === 'LEADERBOARD' ? 'active' : '';
  
  const mobileSelect = document.getElementById('mobileTabloSelect');
  if (mobileSelect && gSet.gameView) {
    mobileSelect.value = gSet.gameView;
  }
  
  const showQToggle = document.getElementById('showQuestionToggle');
  if (showQToggle) showQToggle.checked = gSet.showQuestion || false;
 
  const votersToggle = document.getElementById('votersToggle');
  if (votersToggle) votersToggle.checked = gSet.showVoters || false;
  
  const select = document.getElementById('questionSelect');
  if (select && Number(select.value) !== Number(state.currentRound)) {
    select.value = state.currentRound;
  }
  
  const timerInput = document.getElementById('timerInput');
  if (timerInput && document.activeElement !== timerInput) {
    if (gSet.timerSeconds && gSet.phase !== 'VOTE') {
      timerInput.value = gSet.timerSeconds;
    }
  }
  
  const btnStartTimer = document.getElementById('btnStartTimer');
  if (btnStartTimer) {
    if (gSet.timerState === 'running') {
      btnStartTimer.innerText = 'Стоп';
      btnStartTimer.style.background = '#c62828';
    } else {
      btnStartTimer.innerText = 'Старт';
      btnStartTimer.style.background = '#2e7d32';
    }
  }
  
  if (sessionInfo) loadLiveStatsAndScores(state, sessionInfo.roomCode);
}

// Завантаження статистики та підрахунок балів з підколекції запитань кімнати
async function loadLiveStatsAndScores(state, roomCode) {
  const [votesSnap, answersSnap, questionsSnap, playersSnap] = await Promise.all([
    getDocs(collection(db, `sessions/${roomCode}/votes`)),
    getDocs(collection(db, `sessions/${roomCode}/answers`)),
    getDocs(collection(db, `sessions/${roomCode}/questions`)),
    getDocs(collection(db, `sessions/${roomCode}/players`))
  ]);

  // Збираємо мапу гравців, де ключ — це ID документа (userId)
  const playersMap = {};
  playersSnap.forEach((docSnap) => {
    const p = docSnap.data();
    playersMap[docSnap.id] = p.userName || '👤 Гравець';
  });

  const statsContainer = document.getElementById('liveStatsContainer');
  if (!statsContainer) return;
  let statsHtml = '';
  const currentRoundNum = Number(state.currentRound) || 1;
  
  let currentQDoc = null;
  questionsSnap.forEach((docSnap) => {
    const q = docSnap.data();
    if (Number(q.roundNum) === Number(currentRoundNum)) {
      currentQDoc = q;
    }
  });

  let roundAnswers = (currentQDoc && currentQDoc.shuffledAnswers) ? currentQDoc.shuffledAnswers : [];
  
  if (roundAnswers.length === 0) {
    answersSnap.forEach((docSnap) => {
      const ans = docSnap.data();
      if (Number(ans.roundNum) === Number(currentRoundNum)) {
        const authorName = playersMap[ans.userId] || '👤 Гравець';
        roundAnswers.push({
          id: docSnap.id, // ID документа відповіді замість дублюючого поля
          answer: ans.answer,
          userId: ans.userId,
          userName: authorName
        });
      }
    });

    roundAnswers.sort((a, b) => a.id.localeCompare(b.id));

    if (currentQDoc && currentQDoc.correctAnswer) {
      roundAnswers.push({
        id: 'correct' + currentRoundNum,
        answer: currentQDoc.correctAnswer,
        userName: '✅ Правильна відповідь',
        isSpecial: true,
      });
    }
    if (currentQDoc && currentQDoc.wrongAnswer) {
      roundAnswers.push({
        id: 'wrong' + currentRoundNum,
        answer: currentQDoc.wrongAnswer,
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
        if (Number(v.roundNum) === Number(currentRoundNum)) {
          if (v.votedAnswerId && v.votedAnswerId === item.id) {
            const voterName = playersMap[v.userId] || '👤 Гравець';
            voters.push(voterName);
          }
        }
      });

      statsHtml += `
        <div class="answer-stat-box" style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 12px; background: #252525; padding: 12px; border-radius: 8px;">
          <div style="display: flex; flex-direction: column; flex-grow: 1; margin-right: 15px;">
            <div class="ans-text" style="font-size: 18px; font-weight: bold; margin-bottom: 6px; color: #fff;"><b>${idx + 1}.</b> ${item.answer}</div>
            ${(() => {
              if (item.isSpecial) {
                return `<div><span style="display: inline-block; background: ${ item.userName.includes('Правильна') ? '#2e7d32' : '#c62828' }; color: #fff; padding: 3px 10px; border-radius: 6px; font-size: 13px; font-weight: 500; margin: 0;">${item.userName}</span></div>`;
              } else {
                const authorName = item.userName || playersMap[item.userId] || '👤 Гравець';
                let authorIcon = '😎';
                let cleanAuthorName = authorName;
                const match = authorName.match(/^([\p{Extended_Pictographic}\u1F300-\u1F9FF])\s*(.*)$/u);
                if (match && match[1] !== '👤') {
                  authorIcon = match[1];
                  cleanAuthorName = match[2];
                }
                return `<div><span class="author-badge" style="margin: 0;">${authorIcon} Автор: ${cleanAuthorName}</span></div>`;
              }
            })()}
          </div>
          <div>
            ${
              voters.length > 0
                ? voters
                    .map((v) => {
                      const hasEmoji = /^[\p{Extended_Pictographic}\u1F300-\u1F9FF]/u.test(v);
                      const displayName = hasEmoji ? v : `👤 ${v}`;
                      return `<span class="voters-tag" style="background: #ffffff; color: #3700b3; padding: 5px 12px; border-radius: 6px; font-size: 15px; white-space: nowrap; margin: 2px; display: inline-block; font-weight: 500;">${displayName}</span>`;
                    })
                    .join('')
                : '<div class="no-votes" style="color: #888; white-space: nowrap;">Ніхто поки не обрав</div>'
            }
          </div>
        </div>
      `;
    });
  }
  statsContainer.innerHTML = statsHtml;

  // 1. Повний розрахунок балів на основі історії голосів та відповідей
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
    const ansId = docSnap.id; // ID документа відповіді
    answerAuthorMap[ansId] = a.userId; // зв'язок з автором через поле userId всередині
  });

  const scores = {};
  playersSnap.forEach((docSnap) => {
    const p = docSnap.data();
    scores[docSnap.id] = 0; // ключ гравця — це назва документа (userId)
  });

  votesSnap.forEach((d) => {
    const vote = d.data();
    const voterId = vote.userId;
    const votedId = vote.votedAnswerId;
    const rNum = Number(vote.roundNum);
    
    if (!voterId || !votedId) return;
    if (scores[voterId] === undefined) scores[voterId] = 0;
    
    const details = roundDetails[rNum] || {};
    if (votedId === details.correctId) {
      scores[voterId] += 2;
    } else if (votedId === details.wrongId) {
      scores[voterId] -= 1;
    } else {
      const authorId = answerAuthorMap[votedId];
      if (authorId && scores[authorId] !== undefined) {
        scores[authorId] += 1;
      }
    }
  });

  // 2. Зберігаємо фінальний актуальний score прямо в базу даних для кожного гравця
  for (const [uId, calculatedScore] of Object.entries(scores)) {
    try {
      const playerRef = doc(db, `sessions/${roomCode}/players`, uId);
      await updateDoc(playerRef, { score: calculatedScore });
    } catch (e) {
      console.error(`Помилка оновлення балів для гравця ${uId}:`, e);
    }
  }

  // 3. Формуємо Таблицю лідерів СУВОРО з параметрів score, збережених у базі даних (playersSnap)
  let scoreList = [];
  playersSnap.forEach((docSnap) => {
    const p = docSnap.data();
    const uId = docSnap.id;
    scoreList.push({
      name: p.userName || '👤 Гравець',
      score: scores[uId] !== undefined ? scores[uId] : (p.score || 0),
    });
  });
  
  scoreList.sort((a, b) => b.score - a.score);

  let lbHtml = '';
  if (scoreList.length > 0) {
    lbHtml += `<table style="width: 100%; border-collapse: collapse;">
                <tr style="border-bottom: 1px solid #444; color: #03dac6; text-align: left;"><th style="padding: 8px;">Гравець</th><th style="padding: 8px; text-align: right;">Бали</th></tr>`;
    scoreList.forEach((item, index) => {
      const medal = index === 0 ? '🥇 ' : index === 1 ? '🥈 ' : index === 2 ? '🥉 ' : '';
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
  if (!sessionInfo) return;
  showLoader('Зміна раунду...');
  const timerInput = document.getElementById('timerInput');
  const defaultSecs = timerInput ? parseInt(timerInput.value) || 30 : 30;

  const qSnap = await getDocs(collection(db, `sessions/${sessionInfo.roomCode}/questions`));
  for (const docSnap of qSnap.docs) {
    await updateDoc(docSnap.ref, { shuffledAnswers: [] });
  }

  await updateDoc(sessionInfo.docRef, {
    currentRound: Number(roundNum),
    "gameSettings.phase": 'idle',
    "gameSettings.gameView": 'BOARD',
    "gameSettings.showQuestion": false,
    "gameSettings.showVoters": false,
    "gameSettings.showBoardToPlayers": false,
    "gameSettings.timerState": 'idle',
    "gameSettings.timerStartTime": 0,
    "gameSettings.timerSeconds": defaultSecs
  });
  hideLoader();
};

window.nextRoundBtn = async function () {
  const select = document.getElementById('questionSelect');
  if (select.selectedIndex < select.options.length - 1) {
    select.selectedIndex++;
    await window.changeQuestion(select.value);
  }
};

window.prevRoundBtn = async function () {
  const select = document.getElementById('questionSelect');
  if (select.selectedIndex > 0) {
    select.selectedIndex--;
    await window.changeQuestion(select.value);
  }
};

window.setPhase = async function (phase) {
  if (!sessionInfo) return;
  showLoader('Зміна фази...');
  const timerInput = document.getElementById('timerInput');
  const baseSecs = timerInput ? parseInt(timerInput.value) || 30 : 30;
 
  const updateData = {};
  updateData["gameSettings.phase"] = phase;
  
  if (phase === 'SUBMIT') {
    updateData["gameSettings.showBoardToPlayers"] = true;
    updateData["gameSettings.showQuestion"] = false;
    updateData["gameSettings.showVoters"] = false;
    updateData["gameSettings.timerState"] = 'running';
    updateData["gameSettings.timerStartTime"] = new Date().getTime();
    updateData["gameSettings.timerSeconds"] = baseSecs;
  } else if (phase === 'VOTE') {
    const shouldHalve = currentGameState?.gameSettings?.halfVoteTime === true;
    const halfSecs = shouldHalve ? Math.max(1, Math.floor(baseSecs / 2)) : baseSecs;
    updateData["gameSettings.showBoardToPlayers"] = true;
    updateData["gameSettings.timerState"] = 'running';
    updateData["gameSettings.timerStartTime"] = new Date().getTime();
    updateData["gameSettings.timerSeconds"] = halfSecs;
  }
  await updateDoc(sessionInfo.docRef, updateData);
  hideLoader();
};

window.setView = async function (mode) {
  if (!sessionInfo) return;
  showLoader('Зміна режиму...');
  await updateDoc(sessionInfo.docRef, { "gameSettings.gameView": mode });
  hideLoader();
};

window.toggleShowQuestion = async function (isChecked) {
  if (!sessionInfo || isRevealingAnswers) return;
  const currentRoundNum = Number(currentGameState.currentRound) || 1;
  
  const qSnapshot = await getDocs(collection(db, `sessions/${sessionInfo.roomCode}/questions`));
  let targetDocRef = null;
  let currentQ = { correctAnswer: '', wrongAnswer: '' };
  
  qSnapshot.forEach((docSnap) => {
    const q = docSnap.data();
    if (Number(q.roundNum) === currentRoundNum) {
      currentQ = q;
      targetDocRef = docSnap.ref;
    }
  });

  if (!isChecked) {
    await updateDoc(sessionInfo.docRef, { "gameSettings.showQuestion": false });
    if (targetDocRef) await updateDoc(targetDocRef, { shuffledAnswers: [] });
    return;
  }

  isRevealingAnswers = true;
  try {
    const [answersSnap, playersSnap] = await Promise.all([
      getDocs(collection(db, `sessions/${sessionInfo.roomCode}/answers`)),
      getDocs(collection(db, `sessions/${sessionInfo.roomCode}/players`))
    ]);

    const playersMap = {};
    playersSnap.forEach((docSnap) => {
      const p = docSnap.data();
      playersMap[p.userId || docSnap.id] = p.userName || '👤 Гравець';
    });

    let roundAnswers = [];
    answersSnap.forEach((docSnap) => {
      const ans = docSnap.data();
      if (Number(ans.roundNum) === currentRoundNum) {
        const authorName = playersMap[ans.userId] || '👤 Гравець';
        roundAnswers.push({
          id: ans.answerId || ans.id || docSnap.id,
          answer: ans.answer,
          userId: ans.userId,
          userName: authorName
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

    for (let i = roundAnswers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roundAnswers[i], roundAnswers[j]] = [roundAnswers[j], roundAnswers[i]];
    }

    if (targetDocRef) {
      await updateDoc(targetDocRef, { shuffledAnswers: roundAnswers });
    }
    await updateDoc(sessionInfo.docRef, { "gameSettings.showQuestion": true });
  } catch (err) {
    console.error("Помилка при перемішуванні:", err);
  } finally {
    isRevealingAnswers = false;
  }
};

window.toggleVoters = async function (isChecked) {
  if (!sessionInfo) return;
  await updateDoc(sessionInfo.docRef, { "gameSettings.showVoters": isChecked });
};

window.toggleTimer = async function () {
  if (!sessionInfo) return;
  const input = document.getElementById('timerInput');
  const btnStart = document.getElementById('btnStartTimer');
  const secs = parseInt(input.value) || 30;
  const isRunning = btnStart.innerText === 'Стоп';
  const timerState = isRunning ? 'idle' : 'running';
  const timerStartTime = isRunning ? 0 : new Date().getTime();
  await updateDoc(sessionInfo.docRef, {
    "gameSettings.timerSeconds": secs,
    "gameSettings.timerState": timerState,
    "gameSettings.timerStartTime": timerStartTime,
  });
};

const clearModal = document.getElementById('clearBoardModal');
document.getElementById('openClearBoardModal').onclick = (e) => {
  e.preventDefault();
  clearModal.style.display = 'flex';
};
document.getElementById('cancelClearBtn').onclick = () => {
  clearModal.style.display = 'none';
};

window.confirmClearBtn = async function () {
  clearModal.style.display = 'none';
  if (!sessionInfo) return;
  showLoader('Очищення дошки...');
  try {
    const roomCode = sessionInfo.roomCode;
    const answersSnap = await getDocs(collection(db, `sessions/${roomCode}/answers`));
    const votesSnap = await getDocs(collection(db, `sessions/${roomCode}/votes`));
    
    for (const d of answersSnap.docs) {
      await deleteDoc(doc(db, `sessions/${roomCode}/answers`, d.id));
    }
    for (const d of votesSnap.docs) {
      await deleteDoc(doc(db, `sessions/${roomCode}/votes`, d.id));
    }

    const qSnap = await getDocs(collection(db, `sessions/${roomCode}/questions`));
    for (const qDoc of qSnap.docs) {
      await updateDoc(qDoc.ref, { shuffledAnswers: [] });
    }

    await updateDoc(sessionInfo.docRef, { "gameSettings.showQuestion": false });
    hideLoader();
  } catch (err) {
    console.error('Помилка очищення:', err);
    hideLoader();
    alert('Сталася помилка при очищенні дошки.');
  }
};

window.updateTimerSeconds = async function (val) {
  if (!sessionInfo) return;
  const secs = parseInt(val) || 30;
  await updateDoc(sessionInfo.docRef, { "gameSettings.timerSeconds": secs });
};

window.handleCsvImport = function (event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    const text = e.target.result;
    const lines = text.split(/\r\n|\n/);
    let container = document.getElementById('questionsTableBody') || document.querySelector('tbody');
   
    if (!container) {
      alert('Помилка: таблиця для запитань не знайдена на сторінці!');
      return;
    }
 
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      let parts = [];
      let matches = line.match(/(".*?"|[^",;\t]+)(?=\s*[,;\t]|\s*$)/g);
     
      if (!matches || matches.length < 2) {
        const separator = line.includes(';') ? ';' : (line.includes('\t') ? '\t' : ',');
        parts = line.split(separator).map(p => p.trim().replace(/^['"]|['"]$/g, ''));
      } else {
        parts = matches.map(p => p.trim().replace(/^["'](.+?)["']$/, '$1').replace(/""/g, '"'));
      }
 
      if (parts.length >= 2 && index === 0 && (parts[0].toLowerCase().includes('запит') || parts[0].toLowerCase().includes('question'))) {
        return;
      }
 
      if (parts.length >= 2) {
        const questionText = parts[0] ? parts[0].replace(/^"+|"+$/g, '"') : '';
        const correctAns = parts[1] ? parts[1].replace(/^"+|"+$/g, '"') : '';
        const wrongAns = parts[2] ? parts[2].replace(/^"+|"+$/g, '"') : '';
        const imageUrl = parts[3] ? parts[3].replace(/^"+|"+$/g, '"') : '';
       
        if (typeof window.addQuestionRow === 'function') {
          window.addQuestionRow(questionText, correctAns, wrongAns, imageUrl);
        }
      }
    });
    event.target.value = '';
  };
  reader.readAsText(file, 'UTF-8');
};

let adminTimerInterval = null;
let activeTimerStartTime = null;

function handleAdminTimer(state) {
  const gSet = state.gameSettings || {};
  if (gSet.timerState !== 'running' || !gSet.timerSeconds) {
    if (adminTimerInterval) {
      clearInterval(adminTimerInterval);
      adminTimerInterval = null;
    }
    activeTimerStartTime = null;
    return;
  }

  if (adminTimerInterval && activeTimerStartTime === gSet.timerStartTime) {
    return;
  }

  if (adminTimerInterval) {
    clearInterval(adminTimerInterval);
    adminTimerInterval = null;
  }

  activeTimerStartTime = gSet.timerStartTime;
  let remainingSecs = Number(gSet.timerSeconds);

  adminTimerInterval = setInterval(async () => {
    remainingSecs--;

    const finishOnLastPlayer = gSet.finishOnLastPlayer === true;
    if (finishOnLastPlayer && sessionInfo && sessionInfo.roomCode) {
      try {
        const roomCode = sessionInfo.roomCode;
        const currentRound = Number(state.currentRound) || 1;
        const phase = gSet.phase;
        const now = Date.now();

        const playersSnap = await getDocs(collection(db, `sessions/${roomCode}/players`));
        const activePlayersIds = new Set();

        playersSnap.forEach(docSnap => {
          const pData = docSnap.data();
          if ((now - (pData.lastSeen || 0)) < 7000) {
            activePlayersIds.add(docSnap.id); // Використовуємо ID документа гравця
          }
        });

        const activeCount = activePlayersIds.size;
        if (activeCount > 0) {
          let allCompleted = false;

          if (phase === 'SUBMIT') {
            const answersSnap = await getDocs(collection(db, `sessions/${roomCode}/answers`));
            const submittedIds = new Set();
            answersSnap.forEach(docSnap => {
              const aData = docSnap.data();
              if (Number(aData.roundNum) === currentRound && aData.userId) submittedIds.add(aData.userId);
            });
            let answeredCount = 0;
            activePlayersIds.forEach(id => { if (submittedIds.has(id)) answeredCount++; });
            if (answeredCount >= activeCount) allCompleted = true;
          } else if (phase === 'VOTE') {
            const votesSnap = await getDocs(collection(db, `sessions/${roomCode}/votes`));
            const votedIds = new Set();
            votesSnap.forEach(docSnap => {
              const vData = docSnap.data();
              if (Number(vData.roundNum) === currentRound && vData.userId) votedIds.add(vData.userId);
            });
            let votedCount = 0;
            activePlayersIds.forEach(id => { if (votedIds.has(id)) votedCount++; });
            if (votedCount >= activeCount) allCompleted = true;
          }

          if (allCompleted) {
            clearInterval(adminTimerInterval);
            adminTimerInterval = null;
            activeTimerStartTime = null;
            await updateDoc(sessionInfo.docRef, { "gameSettings.timerState": 'expired' });
            return;
          }
        }
      } catch (err) {
        console.error('Помилка дострокового завершення:', err);
      }
    }

    if (remainingSecs <= 0) {
      clearInterval(adminTimerInterval);
      adminTimerInterval = null;
      activeTimerStartTime = null;
      if (sessionInfo && sessionInfo.docRef) {
        await updateDoc(sessionInfo.docRef, { "gameSettings.timerState": 'expired' });
      }
    }
  }, 1000);
}

const deleteSessionModal = document.getElementById('deleteSessionModal');
const openDeleteBtn = document.getElementById('openDeleteSessionModalBtn');
const cancelDeleteBtn = document.getElementById('cancelDeleteSessionBtn');
const confirmDeleteBtn = document.getElementById('confirmDeleteSessionBtn');

if (openDeleteBtn) {
  openDeleteBtn.onclick = (e) => {
    e.preventDefault();
    if (modal) modal.style.display = 'none';
    if (deleteSessionModal) deleteSessionModal.style.display = 'flex';
  };
}

if (cancelDeleteBtn) {
  cancelDeleteBtn.onclick = () => {
    if (deleteSessionModal) deleteSessionModal.style.display = 'none';
  };
}

if (confirmDeleteBtn) {
  confirmDeleteBtn.onclick = async () => {
    if (deleteSessionModal) deleteSessionModal.style.display = 'none';
    if (!sessionInfo || !sessionInfo.docRef) return;
    showLoader('Видалення сесії та даних...');
    try {
      const roomCode = sessionInfo.roomCode;
      
      const qSnap = await getDocs(collection(db, `sessions/${roomCode}/questions`));
      for (const d of qSnap.docs) {
        await deleteDoc(doc(db, `sessions/${roomCode}/questions`, d.id));
      }
      
      const answersSnap = await getDocs(collection(db, `sessions/${roomCode}/answers`));
      for (const d of answersSnap.docs) {
        await deleteDoc(doc(db, `sessions/${roomCode}/answers`, d.id));
      }
      
      const votesSnap = await getDocs(collection(db, `sessions/${roomCode}/votes`));
      for (const d of votesSnap.docs) {
        await deleteDoc(doc(db, `sessions/${roomCode}/votes`, d.id));
      }

      const playersSnap = await getDocs(collection(db, `sessions/${roomCode}/players`));
      for (const d of playersSnap.docs) {
        await deleteDoc(doc(db, `sessions/${roomCode}/players`, d.id));
      }

      await deleteDoc(sessionInfo.docRef);
      localStorage.removeItem('currentSessionCode');
      hideLoader();
      window.location.href = '../index.html';
    } catch (err) {
      console.error('Помилка при видаленні сесії:', err);
      hideLoader();
      alert('Сталася помилка при видаленні сесії.');
    }
  };
}

function showLoader(text) {
  const loader = document.getElementById('adminLoader');
  if (loader) {
    loader.querySelector('span').innerText = text || 'Збереження...';
    loader.style.display = 'flex';
  }
}

function hideLoader() {
  const loader = document.getElementById('adminLoader');
  if (loader) loader.style.display = 'none';
}

window.onload = function () {
  initAdmin();
};