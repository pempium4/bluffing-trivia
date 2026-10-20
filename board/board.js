import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
  getFirestore,
  doc,
  onSnapshot,
  collection,
  getDocs,
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

// Отримуємо код кімнати з URL або з localStorage
const urlParams = new URLSearchParams(window.location.search);
const roomCode =
  urlParams.get('room') || localStorage.getItem('currentSessionCode');

if (!roomCode) {
  alert('Не вказано код кімнати!');
  window.location.href = '../index.html';
}

let sessionDocId = null;
let timerInterval = null;
let isFirstRender = true;
let currentGameState = null;

// Ініціалізація дошки та пошук сесії за кодом
async function initBoard() {
  try {
    const q = query(collection(db, 'sessions'), where('code', '==', roomCode));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      alert('Сесію з таким кодом не знайдено!');
      window.location.href = '../index.html';
      return;
    }

    querySnapshot.forEach((docSnap) => {
      sessionDocId = docSnap.id;
    });

    // Слухаємо стан гри саме з документа цієї сесії у колекції sessions
    onSnapshot(doc(db, 'sessions', sessionDocId), async (docSnap) => {
      if (!docSnap.exists()) return;
      currentGameState = docSnap.data();

      if (isFirstRender) {
        isFirstRender = false;
        const loadingEl = document.getElementById('loading');
        const containerEl = document.getElementById('boardContainer');
        if (loadingEl) loadingEl.style.display = 'none';
        if (containerEl) containerEl.style.display = 'block';
      }
      renderBoard(currentGameState);
    });

    // Слухаємо голоси та відповіді, прив'язані до цієї кімнати
    onSnapshot(collection(db, 'votes'), () => {
      if (currentGameState) renderBoard(currentGameState);
    });
    onSnapshot(collection(db, 'answers'), () => {
      if (currentGameState) renderBoard(currentGameState);
    });
  } catch (error) {
    console.error('Помилка ініціалізації дошки:', error);
  }
}

initBoard();

const boardCodeEl = document.getElementById('boardRoomCodeDisplay');
if (boardCodeEl) {
  boardCodeEl.innerText = `Код кімнати: ${roomCode}`;
}

async function renderBoard(state) {
  const viewBoard = document.getElementById('viewBoardMode');
  const viewLb = document.getElementById('viewLbMode');
  const gameView = state.gameView || 'BOARD';

  if (gameView === 'LEADERBOARD') {
    if (viewBoard) viewBoard.style.display = 'none';
    if (viewLb) viewLb.style.display = 'block';
    loadLeaderboardData();
    return;
  } else {
    if (viewLb) viewLb.style.display = 'none';
    if (viewBoard) viewBoard.style.display = 'block';
  }

  const currentRoundNum = Number(state.currentRound) || 1;
  const roundBlock = document.getElementById('boardRound');
  if (roundBlock) {
    roundBlock.innerText = `Запитання № ${currentRoundNum}`;
  }

  await loadQuestionText(currentRoundNum);
  handleTimer(state);
  loadAnswersAndVotes(state, currentRoundNum);
}

async function loadQuestionText(currentRoundNum) {
  const qQuery = query(
    collection(db, 'questions'),
    where('roomCode', '==', roomCode)
  );
  const qSnapshot = await getDocs(qQuery);
  let foundText = 'Запитання відсутнє';

  qSnapshot.forEach((docSnap) => {
    const q = docSnap.data();
    if (Number(q.roundNum) === Number(currentRoundNum)) {
      foundText = q.text || q.question || foundText;
    }
  });

  const questionBlock = document.getElementById('boardQuestion');
  if (questionBlock) {
    questionBlock.innerText = foundText;
  }
}

function handleTimer(state) {
  const timerFill = document.getElementById('timerBarFill');
  if (!timerFill) return;

  if (state.timerState === 'running' && state.timerStartTime) {
    if (timerInterval) clearInterval(timerInterval);
    const totalSecs = Number(state.timerSeconds) || 30;
    const startTime = Number(state.timerStartTime);

    timerInterval = setInterval(() => {
      const now = new Date().getTime();
      const elapsedSec = (now - startTime) / 1000;
      const left = totalSecs - elapsedSec;

      if (left <= 0) {
        timerFill.style.transform = 'scaleX(0)';
        clearInterval(timerInterval);
      } else {
        const scaleVal = Math.max(0, left / totalSecs);
        timerFill.style.transform = `scaleX(${scaleVal})`;
      }
    }, 50);
  } else if (state.timerState === 'expired') {
    if (timerInterval) clearInterval(timerInterval);
    timerFill.style.transform = 'scaleX(0)';
  } else {
    if (timerInterval) clearInterval(timerInterval);
    timerFill.style.transform = 'scaleX(1)';
  }
}

async function loadAnswersAndVotes(state, currentRoundNum) {
  const votesQuery = query(
    collection(db, 'votes'),
    where('roomCode', '==', roomCode)
  );
  const answersQuery = query(
    collection(db, 'answers'),
    where('roomCode', '==', roomCode)
  );
  const questionsQuery = query(
    collection(db, 'questions'),
    where('roomCode', '==', roomCode)
  );

  const votesSnap = await getDocs(votesQuery);
  let roundAnswers = state.shuffledAnswers || [];

  if (roundAnswers.length === 0) {
    const answersSnap = await getDocs(answersQuery);
    const questionsSnap = await getDocs(questionsQuery);
    let currentQ = { correctAnswer: '', wrongAnswer: '' };

    questionsSnap.forEach((docSnap) => {
      const q = docSnap.data();
      if (Number(q.roundNum) === Number(currentRoundNum)) currentQ = q;
    });

    answersSnap.forEach((docSnap) => {
      const ans = docSnap.data();
      if (Number(ans.roundNum) === Number(currentRoundNum)) {
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
  }

  let listHtml = '';
  if (roundAnswers.length === 0) {
    listHtml = `<div class="answer-item" style="border-left-color: #ffb74d; color: #aaa;">Очікуємо на варіанти від гравців...</div>`;
  } else {
    roundAnswers.forEach((item, index) => {
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

      listHtml += `
        <div class="answer-item" style="display: flex; justify-content: space-between; align-items: flex-end;">
          <div style="display: flex; flex-direction: column; flex-grow: 1; margin-right: 15px;">
            <div style="font-size: 20px; font-weight: bold; margin-bottom: 8px;"><b>${
              index + 1
            }.</b> ${item.answer}</div>
      `;
      if (state.showVoters) {
        if (item.id && item.id.startsWith('correct')) {
          listHtml += `<div><span class="correct-tag" style="margin: 0;">✅ Правильна відповідь</span></div>`;
        } else if (item.id && item.id.startsWith('wrong')) {
          listHtml += `<div><span style="display: inline-block; background: #c62828; color: #fff; padding: 3px 10px; border-radius: 6px; font-size: 13px; font-weight: 500; margin: 0;">😡 Відповідь-пастка</span></div>`;
        } else {
          const authorPoints = voters.length;
          listHtml += `
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span class="author-tag" style="margin: 0;">😎 Автор: ${
                item.userName
              }</span>
              ${
                authorPoints > 0
                  ? `<b style="color: #03dac6; font-size: 14px;">+${authorPoints}${
                      authorPoints === 1
                        ? 'бал'
                        : authorPoints < 5
                        ? 'бали'
                        : 'балів'
                    }</b>`
                  : ''
              }
            </div>
          `;
        }
      }
      listHtml += `</div>`;

      if (state.showVoters && voters.length > 0) {
        listHtml += `<div style="display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; align-items: flex-end;">`;
        voters.forEach((v) => {
          let pointsText = '';
          if (item.id && item.id.startsWith('correct')) {
            pointsText = ' <b style="color: #2e7d32;">+2</b>';
          } else if (item.id && item.id.startsWith('wrong')) {
            pointsText = ' <b style="color: #ff5252;">-1</b>';
          }
          listHtml += `<span style="background: #ffffff; color: #3700b3; padding: 5px 12px; border-radius: 6px; font-size: 15px; white-space: nowrap; margin: 0; font-weight: 500;">👤 ${v}${pointsText}</span>`;
        });
        listHtml += `</div>`;
      }
      listHtml += `</div>`;
    });
  }

  const answersWrapper = document.getElementById('answersWrapper');
  const answersContainer = document.getElementById('answersList');
  if (answersWrapper && answersContainer) {
    if (state.showQuestion) {
      answersWrapper.style.display = 'block';
      answersContainer.innerHTML = listHtml;
    } else {
      answersWrapper.style.display = 'none';
      answersContainer.innerHTML = '';
    }
  }
}

async function loadLeaderboardData() {
  const answersQuery = query(
    collection(db, 'answers'),
    where('roomCode', '==', roomCode)
  );
  const votesQuery = query(
    collection(db, 'votes'),
    where('roomCode', '==', roomCode)
  );
  const questionsQuery = query(
    collection(db, 'questions'),
    where('roomCode', '==', roomCode)
  );

  const answersSnap = await getDocs(answersQuery);
  const votesSnap = await getDocs(votesQuery);
  const questionsSnap = await getDocs(questionsQuery);

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

  let lbHtml =
    '<tr><th>Гравець</th><th style="text-align: right;">Бали</th></tr>';
  if (scoreList.length > 0) {
    scoreList.forEach((item, index) => {
      const medal =
        index === 0 ? '🥇 ' : index === 1 ? '🥈 ' : index === 2 ? '🥉 ' : '';
      lbHtml += `<tr><td style="padding: 8px;">${medal}${item.name}</td><td style="padding: 8px; text-align: right; font-weight: bold; color: #bb86fc;">${item.score}</td></tr>`;
    });
  } else {
    lbHtml += `<tr><td colspan="2" style="color: #888; text-align: center;">Ще немає нарахованих балів...</td></tr>`;
  }

  const lbTable = document.getElementById('leaderboardTable');
  if (lbTable) {
    lbTable.innerHTML = lbHtml;
  }
}
