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
 query,
 where,
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
let currentGameState = null;

// Отримуємо roomCode та знаходимо ID документа сесії у Firestore
async function getSessionRef() {
 const urlParams = new URLSearchParams(window.location.search);
 const roomCode = (urlParams.get('room') || localStorage.getItem('currentSessionCode') || '').toUpperCase();
 if (!roomCode) return null;
 const q = query(collection(db, 'sessions'), where('code', '==', roomCode));
 const snap = await getDocs(q);
 if (!snap.empty) {
   return { docRef: snap.docs[0].ref, roomCode };
 }
 return { docRef: null, roomCode };
}

let sessionInfo = null;

// Ініціалізація та слухач стану сесії
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
 
 // Слухаємо стан саме цієї кімнати в колекції sessions
 onSnapshot(sessionInfo.docRef, async (docSnap) => {
   if (!docSnap.exists()) return;
   currentGameState = docSnap.data();
   if (isFirstRender) {
     document.getElementById('loading').style.display = 'none';
     document.getElementById('adminContent').style.display = 'block';
     await loadQuestionsSelect(currentGameState.currentRound || 1);
     isFirstRender = false;
   }
   renderAdminUI(currentGameState);
  
   // Запускаємо перевірку таймера та автоматизацію
   handleAdminTimer(currentGameState);
   checkAutomationTimeouts(currentGameState);
 });
}

// Слухаємо колекції відповідей та голосів для миттєвого оновлення
onSnapshot(collection(db, 'answers'), () => {
 if (currentGameState && sessionInfo) loadLiveStatsAndScores(currentGameState, sessionInfo.roomCode);
});
onSnapshot(collection(db, 'votes'), () => {
 if (currentGameState && sessionInfo) loadLiveStatsAndScores(currentGameState, sessionInfo.roomCode);
});

let autoShowTimeout = null;
let hasAutoSwitchedQuestion = false;
let autoShowVoteTimeout = null;
let hasAutoSwitchedVote = false;

function checkAutomationTimeouts(state) {
 if (state.phase === 'SUBMIT') {
   if (state.timerState === 'expired') {
     if (!state.showQuestion && !hasAutoSwitchedQuestion && !autoShowTimeout) {
       autoShowTimeout = setTimeout(async () => {
         hasAutoSwitchedQuestion = true;
         autoShowTimeout = null;
         if (typeof window.toggleShowQuestion === 'function') {
           await window.toggleShowQuestion(true);
         }
       }, 3000);
     }
   } else if (state.timerState === 'running') {
     hasAutoSwitchedQuestion = false;
     if (autoShowTimeout) { clearTimeout(autoShowTimeout); autoShowTimeout = null; }
   }
 } else {
   hasAutoSwitchedQuestion = false;
   if (autoShowTimeout) { clearTimeout(autoShowTimeout); autoShowTimeout = null; }
 }

 if (state.phase === 'VOTE') {
   if (state.timerState === 'expired') {
     if (!state.showVoters && !hasAutoSwitchedVote && !autoShowVoteTimeout) {
       autoShowVoteTimeout = setTimeout(async () => {
         hasAutoSwitchedVote = true;
         autoShowVoteTimeout = null;
         if (typeof window.toggleVoters === 'function') {
           await window.toggleVoters(true);
         }
       }, 3000);
     }
   } else if (state.timerState === 'running') {
     hasAutoSwitchedVote = false;
     if (autoShowVoteTimeout) { clearTimeout(autoShowVoteTimeout); autoShowVoteTimeout = null; }
   }
 } else {
   hasAutoSwitchedVote = false;
   if (autoShowVoteTimeout) { clearTimeout(autoShowVoteTimeout); autoShowVoteTimeout = null; }
 }
}

async function loadQuestionsSelect(currentRound) {
 if (!sessionInfo) return;
 const qQuery = query(collection(db, 'questions'), where('roomCode', '==', sessionInfo.roomCode));
 const qSnapshot = await getDocs(qQuery);
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
   <td><input type="text" class="q-image" placeholder="URL картинки..." value="${imageVal.replace(/"/g, '&quot;')}"></td>
   <td style="text-align: center;">
     <button class="delete-row-btn" onclick="deleteQuestionRow(this)" title="Видалити раунд">🗑️</button>
   </td>
 `;
 tbody.appendChild(tr);
 if (typeof initDragAndDrop === 'function') initDragAndDrop();
 if (typeof reindexRounds === 'function') reindexRounds();
};

document.getElementById('saveQuestionsBtn').onclick = async () => {
 if (!sessionInfo) return;
 showLoader('Збереження запитань...');
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
   const questionData = { roomCode: sessionInfo.roomCode, roundNum, text, correctAnswer, wrongAnswer, imageUrl };
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
 await updateDoc(sessionInfo.docRef, { questionsCount: rows.length });
 await loadQuestionsSelect(1);
 modal.style.display = 'none';
 hideLoader();
};

function renderAdminUI(state) {
 const btnSubmit = document.getElementById('btnSubmitPhase');
 const btnVote = document.getElementById('btnVotePhase');
 if (btnSubmit) btnSubmit.className = state.phase === 'SUBMIT' ? 'active' : '';
 if (btnVote) btnVote.className = state.phase === 'VOTE' ? 'active' : '';
 
 const btnQr = document.getElementById('btnViewQr');
 const btnBoard = document.getElementById('btnViewBoard');
 const btnLb = document.getElementById('btnViewLb');
 if (btnQr) btnQr.className = state.gameView === 'QR' ? 'active' : '';
 if (btnBoard) btnBoard.className = state.gameView === 'BOARD' ? 'active' : '';
 if (btnLb) btnLb.className = state.gameView === 'LEADERBOARD' ? 'active' : '';
 
 const showQToggle = document.getElementById('showQuestionToggle');
 if (showQToggle) showQToggle.checked = state.showQuestion || false;
 
 const votersToggle = document.getElementById('votersToggle');
 if (votersToggle) votersToggle.checked = state.showVoters || false;
 
 const select = document.getElementById('questionSelect');
 if (select && Number(select.value) !== Number(state.currentRound)) {
   select.value = state.currentRound;
 }
 
 const timerInput = document.getElementById('timerInput');
 if (timerInput && document.activeElement !== timerInput) {
   if (state.timerSeconds) {
     timerInput.value = state.timerSeconds;
   }
 }
 
 const btnStartTimer = document.getElementById('btnStartTimer');
 if (btnStartTimer) {
   if (state.timerState === 'running') {
     btnStartTimer.innerText = 'Стоп';
     btnStartTimer.style.background = '#c62828';
   } else {
     btnStartTimer.innerText = 'Старт';
     btnStartTimer.style.background = '#2e7d32';
   }
 }
 
 if (sessionInfo) loadLiveStatsAndScores(state, sessionInfo.roomCode);
}

async function loadLiveStatsAndScores(state, roomCode) {
 const votesQuery = query(collection(db, 'votes'), where('roomCode', '==', roomCode));
 const answersQuery = query(collection(db, 'answers'), where('roomCode', '==', roomCode));
 const questionsQuery = query(collection(db, 'questions'), where('roomCode', '==', roomCode));
 const [votesSnap, answersSnap, questionsSnap] = await Promise.all([
   getDocs(votesQuery),
   getDocs(answersQuery),
   getDocs(questionsQuery),
 ]);
 const statsContainer = document.getElementById('liveStatsContainer');
 if (!statsContainer) return;
 let statsHtml = '';
 const currentRoundNum = Number(state.currentRound) || 1;
 let roundAnswers = [];
 if (state.shuffledAnswers && state.shuffledAnswers.length > 0) {
   roundAnswers = state.shuffledAnswers;
 } else {
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
       if (Number(v.roundNum) === Number(currentRoundNum)) {
         if (v.votedAnswerId && v.votedAnswerId === item.id) {
           voters.push(v.userName);
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
               let authorIcon = '😎';
               let cleanAuthorName = item.userName;
               const match = item.userName.match(/^([\p{Extended_Pictographic}\u{1F300}-\u{1F9FF}])\s*(.*)$/u);
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
                     const hasEmoji = /^\p{Extended_Pictographic}/u.test(v) || /^[\u{1F300}-\u{1F9FF}]/u.test(v);
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

 // Підрахунок балів для Таблиці лідерів
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
 await updateDoc(sessionInfo.docRef, {
   currentRound: Number(roundNum),
   phase: 'idle',
   gameView: 'BOARD',
   showQuestion: false,
   showVoters: false,
   showBoardToPlayers: false,
   timerState: 'idle',
   timerStartTime: 0,
   timerSeconds: defaultSecs,
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
  const updateData = { phase };
 if (phase === 'SUBMIT') {
   updateData.showBoardToPlayers = true;
   updateData.showQuestion = false;
   updateData.showVoters = false;
   updateData.timerState = 'running';
   updateData.timerStartTime = new Date().getTime();
   updateData.timerSeconds = baseSecs;
 }
 else if (phase === 'VOTE') {
   updateData.showBoardToPlayers = true;
   updateData.timerState = 'running';
   updateData.timerStartTime = new Date().getTime();
   updateData.timerSeconds = baseSecs;
 }
 await updateDoc(sessionInfo.docRef, updateData);
 hideLoader();
};

window.setView = async function (mode) {
 if (!sessionInfo) return;
 showLoader('Зміна режиму...');
 await updateDoc(sessionInfo.docRef, { gameView: mode });
 hideLoader();
};

window.toggleShowQuestion = async function (isChecked) {
 if (!sessionInfo) return;
 if (isChecked) {
   const currentRoundNum = Number(currentGameState.currentRound) || 1;
   const answersQuery = query(collection(db, 'answers'), where('roomCode', '==', sessionInfo.roomCode));
   const questionsQuery = query(collection(db, 'questions'), where('roomCode', '==', sessionInfo.roomCode));
   const [answersSnap, qSnapshot] = await Promise.all([
     getDocs(answersQuery),
     getDocs(questionsQuery),
   ]);
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
   for (let i = roundAnswers.length - 1; i > 0; i--) {
     const j = Math.floor(Math.random() * (i + 1));
     [roundAnswers[i], roundAnswers[j]] = [roundAnswers[j], roundAnswers[i]];
   }
   await updateDoc(sessionInfo.docRef, {
     showQuestion: true,
     shuffledAnswers: roundAnswers,
   });
 } else {
   await updateDoc(sessionInfo.docRef, {
     showQuestion: false,
   });
 }
};

window.toggleVoters = async function (isChecked) {
 if (!sessionInfo) return;
 await updateDoc(sessionInfo.docRef, { showVoters: isChecked });
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
   timerSeconds: secs,
   timerState: timerState,
   timerStartTime: timerStartTime,
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
document.getElementById('confirmClearBtn').onclick = async () => {
 clearModal.style.display = 'none';
 if (!sessionInfo) return;
 showLoader('Очищення дошки...');
 try {
   const answersQuery = query(collection(db, 'answers'), where('roomCode', '==', sessionInfo.roomCode));
   const votesQuery = query(collection(db, 'votes'), where('roomCode', '==', sessionInfo.roomCode));
   const [answersSnap, votesSnap] = await Promise.all([
     getDocs(answersQuery),
     getDocs(votesQuery),
   ]);
   for (const d of answersSnap.docs) {
     await deleteDoc(doc(db, 'answers', d.id));
   }
   for (const d of votesSnap.docs) {
     await deleteDoc(doc(db, 'votes', d.id));
   }
   await updateDoc(sessionInfo.docRef, {
     shuffledAnswers: [],
     showQuestion: false,
   });
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
 await updateDoc(sessionInfo.docRef, { timerSeconds: secs });
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
     let row = line;
     let matches = row.match(/(".*?"|[^",;\t]+)(?=\s*[,;\t]|\s*$)/g);
    
     if (!matches || matches.length < 2) {
       const separator = line.includes(';') ? ';' : (line.includes('\t') ? '\t' : ',');
       parts = line.split(separator).map(p => p.trim().replace(/^['"]|['"]$/g, ''));
     } else {
       parts = matches.map(p => p.trim().replace(/^['"](.+?)['"]$/, '$1').replace(/""/g, '"'));
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

// Функція таймера з підтримкою оновлення статусу expired у базі в момент завершення часу
function handleAdminTimer(state) {
 if (adminTimerInterval) {
   clearInterval(adminTimerInterval);
   adminTimerInterval = null;
 }
 if (state.timerState === 'running' && state.timerStartTime && state.timerSeconds) {
   const totalMs = Number(state.timerSeconds) * 1000;
   const startTime = Number(state.timerStartTime);
   adminTimerInterval = setInterval(async () => {
     const now = new Date().getTime();
     const elapsed = now - startTime;
     if (elapsed >= totalMs) {
       clearInterval(adminTimerInterval);
       adminTimerInterval = null;
       // Оновлюємо статус на expired, щоб кнопка та дошка оновилися
       if (sessionInfo && sessionInfo.docRef && state.timerState === 'running') {
         try {
           await updateDoc(sessionInfo.docRef, { timerState: 'expired' });
         } catch (err) {
           console.error('Помилка оновлення таймера:', err);
         }
       }
     }
   }, 200);
 }
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
     const qQuery = query(collection(db, 'questions'), where('roomCode', '==', roomCode));
     const qSnap = await getDocs(qQuery);
     for (const d of qSnap.docs) {
       await deleteDoc(doc(db, 'questions', d.id));
     }
     const aQuery = query(collection(db, 'answers'), where('roomCode', '==', roomCode));
     const aSnap = await getDocs(aQuery);
     for (const d of aSnap.docs) {
       await deleteDoc(doc(db, 'answers', d.id));
     }
     const vQuery = query(collection(db, 'votes'), where('roomCode', '==', roomCode));
     const vSnap = await getDocs(vQuery);
     for (const d of vSnap.docs) {
       await deleteDoc(doc(db, 'votes', d.id));
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