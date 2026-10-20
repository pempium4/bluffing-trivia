import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
  getFirestore,
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  collection,
  getDocs,
  setDoc,
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

let playerTimerInterval = null;
let playerLastRunningStart = 0;
let playerIsExpired = false;
let isSubmittingOrVoting = false;
let unsubscribeGame = null;

window.onload = function () {
  checkUserSession();
};

function checkUserSession() {
  const savedName = localStorage.getItem('bluff_username') || '';
  const loginScreen = document.getElementById('loginScreen');
  const mainContainer = document.getElementById('mainContainer');
  const loadingEl = document.getElementById('loading');

  if (savedName) {
    if (loginScreen) loginScreen.style.display = 'none';
    if (mainContainer) mainContainer.style.display = 'block';

    const usernameInput = document.getElementById('username');
    if (usernameInput) {
      usernameInput.value = savedName;
      usernameInput.readOnly = true;
    }

    // Запускаємо підписку на стан гри у реальному часі через Firestore
    subscribeToGameState(savedName);
  } else {
    if (loginScreen) loginScreen.style.display = 'block';
    if (mainContainer) mainContainer.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

window.joinGame = function () {
  const input = document.getElementById('loginUsername');
  const name = input ? input.value.trim() : '';
  if (!name) {
    alert('Будь ласка, введіть свій нікнейм!');
    return;
  }
  localStorage.setItem('bluff_username', name);
  checkUserSession();
};

window.changeNickname = function () {
  if (unsubscribeGame) unsubscribeGame();
  localStorage.removeItem('bluff_username');
  checkUserSession();
};

// Підписка на зміни гри в реальному часі
function subscribeToGameState(username) {
  if (unsubscribeGame) unsubscribeGame();

  unsubscribeGame = onSnapshot(doc(db, 'settings', 'game'), async (docSnap) => {
    if (!docSnap.exists()) return;
    const state = docSnap.data();

    // Перевіряємо, чи гравець вже надсилав відповідь або голос для поточного раунду
    const currentRoundNum = Number(state.currentRound) || 1;

    const answersSnap = await getDocs(collection(db, 'answers'));
    let hasSubmitted = false;
    let myAnswerText = '';
    answersSnap.forEach((d) => {
      const a = d.data();
      if (
        Number(a.roundNum) === currentRoundNum &&
        a.userName.toLowerCase() === username.toLowerCase()
      ) {
        hasSubmitted = true;
        myAnswerText = a.answer;
      }
    });

    const votesSnap = await getDocs(collection(db, 'votes'));
    let hasVoted = false;
    let myVotedAnswerText = '';
    votesSnap.forEach((d) => {
      const v = d.data();
      // Перевіряємо за поточним раундом та ім'ям гравця
      if (
        Number(v.roundNum) === currentRoundNum &&
        v.userName.toLowerCase() === username.toLowerCase()
      ) {
        hasVoted = true;
        // Забираємо текст, який зберігся у votedAnswerText, або резервний варіант
        myVotedAnswerText =
          v.votedAnswerText || v.votedAnswer || 'Обраний варіант';
      }
    });

    // Отримуємо текст поточного запитання
    const qSnapshot = await getDocs(collection(db, 'questions'));
    let questionText = 'Запитання відсутнє';
    qSnapshot.forEach((d) => {
      const q = d.data();
      if (Number(q.roundNum) === currentRoundNum) {
        questionText = q.text || q.question || questionText;
      }
    });

    const fullStatus = {
      ...state,
      currentRoundNum,
      questionText,
      hasSubmitted,
      answer: myAnswerText,
      hasVoted,
      votedAnswer: myVotedAnswerText,
    };

    renderPhases(fullStatus, username);
  });
}

function renderPhases(status, username) {
  if (isSubmittingOrVoting) return;
  const waitingContainer = document.getElementById('waitingContainer');
  const submitCont = document.getElementById('phaseSubmitContainer');
  const voteCont = document.getElementById('phaseVoteContainer');
  const loadingEl = document.getElementById('loading');

  // 🛡️ ПРИМУСОВО ховаємо всі статусні блоки при будь-якій зміні стану/раунду
  const timeoutStatusArea = document.getElementById('timeoutStatusArea');
  const submittedStatusArea = document.getElementById('submittedStatusArea');
  const submitFormArea = document.getElementById('submitFormArea');

  const voteTimeoutStatusArea = document.getElementById(
    'voteTimeoutStatusArea'
  );
  const votedStatusArea = document.getElementById('votedStatusArea');
  const voteArea = document.getElementById('voteArea');

  if (timeoutStatusArea) timeoutStatusArea.style.display = 'none';
  if (voteTimeoutStatusArea) voteTimeoutStatusArea.style.display = 'none';

  if (status.showBoardToPlayers === false) {
    waitingContainer.style.display = 'block';
    submitCont.style.display = 'none';
    voteCont.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'none';
    return;
  } else {
    waitingContainer.style.display = 'none';
  }
  if (loadingEl) loadingEl.style.display = 'none';

  // --- КЕРУВАННЯ ТАЙМЕРОМ ТА СМУЖКОЮ У ГРАВЦЯ ---
  const isVotePhase = status.phase === 'VOTE';
  const activeContainer = document.getElementById(
    isVotePhase ? 'playerTimerContainerVote' : 'playerTimerContainerSubmit'
  );
  const activeFill = document.getElementById(
    isVotePhase ? 'playerTimerFillVote' : 'playerTimerFillSubmit'
  );
  const inactiveContainer = document.getElementById(
    isVotePhase ? 'playerTimerContainerSubmit' : 'playerTimerContainerVote'
  );
  if (inactiveContainer) inactiveContainer.style.display = 'none';

  if (
    status.timerState === 'running' &&
    status.timerStartTime &&
    status.timerSeconds
  ) {
    if (activeContainer) activeContainer.style.display = 'block';
    if (playerLastRunningStart !== status.timerStartTime) {
      playerLastRunningStart = status.timerStartTime;
      playerIsExpired = false;
      if (playerTimerInterval) clearInterval(playerTimerInterval);
      const totalSec = parseInt(status.timerSeconds) || 30;
      const startTime = parseInt(status.timerStartTime) || new Date().getTime();

      playerTimerInterval = setInterval(() => {
        if (playerIsExpired) return;
        const now = new Date().getTime();
        const elapsedSec = (now - startTime) / 1000;
        const remainingSec = totalSec - elapsedSec;
        
        if (activeFill) {
          if (remainingSec > 0) {
            const scaleVal = Math.max(0, remainingSec / totalSec);
            activeFill.style.transform = 'scaleX(' + scaleVal + ')';
            
            // Зміна кольору на червоний на останніх 5 секундах
            if (remainingSec <= 5) {
              activeFill.style.backgroundColor = '#c62828';
            } else {
              activeFill.style.backgroundColor = ''; 
            }
          } else {
            playerIsExpired = true;
            activeFill.style.transform = 'scaleX(0)';
            activeFill.style.backgroundColor = '#c62828';
            clearInterval(playerTimerInterval);
            playerTimerInterval = null;
            updateDoc(doc(db, 'settings', 'game'), { timerState: 'expired' });
          }
        }
      }, 50);
    }
  } else if (status.timerState === 'expired' || playerIsExpired) {
    if (activeContainer) activeContainer.style.display = 'block';
    if (playerTimerInterval) {
      clearInterval(playerTimerInterval);
      playerTimerInterval = null;
    }
    if (activeFill) {
      activeFill.style.transform = 'scaleX(0)';
      activeFill.style.backgroundColor = '#c62828';
    }
  } else {
    if (activeContainer) activeContainer.style.display = 'block';
    if (playerTimerInterval) {
      clearInterval(playerTimerInterval);
      playerTimerInterval = null;
    }
    playerLastRunningStart = status.timerStartTime || 0;
    if (playerIsExpired) {
      if (activeFill) {
        activeFill.style.transform = 'scaleX(0)';
        activeFill.style.backgroundColor = '#c62828';
      }
    } else {
      if (activeFill) {
        activeFill.style.transform = 'scaleX(1)';
        activeFill.style.backgroundColor = '';
      }
    }
  }

  // --- Рендер фази ЗБОРУ (SUBMIT) ---
  if (status.phase === 'SUBMIT') {
    document.getElementById('submitLoader').style.display = 'none';
    document.getElementById('voteLoader').style.display = 'none';
    submitCont.style.display = 'block';
    voteCont.style.display = 'none';
    document.getElementById('roundBadgeSubmit').innerText =
      'Запитання № ' + status.currentRoundNum;
    document.getElementById('questionTextSubmit').innerText =
      status.questionText;

    const submitFormArea = document.getElementById('submitFormArea');
    const submittedStatusArea = document.getElementById('submittedStatusArea');
    const timeoutStatusArea = document.getElementById('timeoutStatusArea');

    if (status.hasSubmitted) {
      submitFormArea.style.display = 'none';
      submittedStatusArea.style.display = 'block';
      if (timeoutStatusArea) timeoutStatusArea.style.display = 'none';
      document.getElementById('dispMyAnswer').innerText = status.answer;
    } else if (status.timerState === 'expired') {
      submitFormArea.style.display = 'none';
      submittedStatusArea.style.display = 'none';
      if (timeoutStatusArea) timeoutStatusArea.style.display = 'block';
    } else {
      submitFormArea.style.display = 'block';
      submittedStatusArea.style.display = 'none';
      if (timeoutStatusArea) timeoutStatusArea.style.display = 'none';
    }
  }
  // --- Рендер фази ГОЛОСУВАННЯ (VOTE) ---
  else if (status.phase === 'VOTE') {
    document.getElementById('submitLoader').style.display = 'none';
    document.getElementById('voteLoader').style.display = 'none';
    submitCont.style.display = 'none';
    voteCont.style.display = 'block';
    document.getElementById('questionTextVote').innerText = status.questionText;

    const voteArea = document.getElementById('voteArea');
    const votedStatusArea = document.getElementById('votedStatusArea');
    const voteTimeoutStatusArea = document.getElementById(
      'voteTimeoutStatusArea'
    );

    if (status.hasVoted) {
      voteArea.style.display = 'none';
      votedStatusArea.style.display = 'block';
      if (voteTimeoutStatusArea) voteTimeoutStatusArea.style.display = 'none';
      document.getElementById('dispMyVote').innerText = status.votedAnswer;
    } else if (status.timerState === 'expired') {
      // ⏳ Час на голосування вичерпано, а голос не відправлено
      voteArea.style.display = 'none';
      votedStatusArea.style.display = 'none';
      if (voteTimeoutStatusArea) voteTimeoutStatusArea.style.display = 'block';
    } else {
      voteArea.style.display = 'block';
      votedStatusArea.style.display = 'none';
      if (voteTimeoutStatusArea) voteTimeoutStatusArea.style.display = 'none';

      let listHtml = '';
      const shuffled = status.shuffledAnswers || [];
      if (shuffled.length > 0) {
        const myUsername = username.trim().toLowerCase();
        shuffled.forEach((ansObj, idx) => {
          const authorClean = (ansObj.userName || '').trim().toLowerCase();
          const isMyOwnAnswer = authorClean === myUsername && myUsername !== '';
          const ansId = ansObj.id || ansObj.answer;
          if (isMyOwnAnswer) {
            listHtml += `
              <button class="vote-btn" style="background: #444; color: #888; cursor: not-allowed; opacity: 0.6;" disabled>
                <b>${idx + 1}.</b> ${
              ansObj.answer
            } <span style="float: right; font-size: 13px; font-style: italic;">(Ваш варіант)</span>
              </button>
            `;
          } else {
            const encodedId = encodeURIComponent(ansId);
            const encodedText = encodeURIComponent(ansObj.answer);
            listHtml += `
              <button class="vote-btn" onclick="sendVote('${encodedId}', '${encodedText}')">
                <b>${idx + 1}.</b> ${ansObj.answer}
              </button>
            `;
          }
        });
      } else {
        listHtml = '<p style="color: #666;">Немає доступних варіантів...</p>';
      }
      document.getElementById('votingButtonsList').innerHTML = listHtml;
    }
  }
}

window.submitAnswer = async function () {
  const username = localStorage.getItem('bluff_username');
  const answerInput = document.getElementById('answer');
  const answer = answerInput ? answerInput.value.trim() : '';
  const errDiv = document.getElementById('errorMsg');

  if (!answer) {
    errDiv.innerText = 'Заповніть текст відповіді!';
    errDiv.style.display = 'block';
    return;
  }
  errDiv.style.display = 'none';
  isSubmittingOrVoting = true;

  document.getElementById('submitFormArea').style.display = 'none';
  document.getElementById('submitLoader').style.display = 'block';

  try {
    const gameDocSnap = await getDoc(doc(db, 'settings', 'game'));
    const currentRoundNum = gameDocSnap.exists()
      ? Number(gameDocSnap.data().currentRound) || 1
      : 1;

    // Створюємо посилання на новий документ, щоб отримати його унікальний id
    const newAnswerRef = doc(collection(db, 'answers'));
    const answerId = newAnswerRef.id;

    await setDoc(newAnswerRef, {
      id: answerId, // Зберігаємо унікальний id всередині документа
      userName: username,
      answer: answer,
      roundNum: currentRoundNum,
      createdAt: new Date().getTime(),
    });

    document.getElementById('submitLoader').style.display = 'none';
    document.getElementById('submittedStatusArea').style.display = 'block';
    document.getElementById('dispMyAnswer').innerText = answer;

    setTimeout(function () {
      isSubmittingOrVoting = false;
    }, 3000);
  } catch (err) {
    console.error('Помилка надсилання відповіді:', err);
    isSubmittingOrVoting = false;
    document.getElementById('submitLoader').style.display = 'none';
    document.getElementById('submitFormArea').style.display = 'block';
    errDiv.innerText = "Помилка зв'язку з базою даних.";
    errDiv.style.display = 'block';
  }
};

window.sendVote = async function (encodedAnsId, encodedAnsText) {
  const username = localStorage.getItem('bluff_username');
  const ansId = decodeURIComponent(encodedAnsId);
  const ansText = decodeURIComponent(encodedAnsText);
  const errDiv = document.getElementById('errorMsg');

  errDiv.style.display = 'none';
  isSubmittingOrVoting = true;

  document.getElementById('voteArea').style.display = 'none';
  document.getElementById('voteLoader').style.display = 'block';

  try {
    const gameDocSnap = await getDoc(doc(db, 'settings', 'game'));
    const currentRoundNum = gameDocSnap.exists()
      ? Number(gameDocSnap.data().currentRound) || 1
      : 1;

    // Зберігаємо у votes унікальний id обраного варіанта та його текст
    const newVoteRef = doc(collection(db, 'votes'));
    await setDoc(newVoteRef, {
      userName: username,
      votedAnswerId: ansId, // 👈 Чистий унікальний ID для синхронізації
      votedAnswerText: ansText, // 👈 Текст для зручності
      roundNum: currentRoundNum,
      createdAt: new Date().getTime(),
    });

    document.getElementById('voteLoader').style.display = 'none';
    document.getElementById('votedStatusArea').style.display = 'block';
    document.getElementById('dispMyVote').innerText = ansText; // Показуємо текст обраного варіанта

    setTimeout(function () {
      isSubmittingOrVoting = false;
    }, 3000);
  } catch (err) {
    console.error('Помилка надсилання голосу:', err);
    isSubmittingOrVoting = false;
    document.getElementById('voteLoader').style.display = 'none';
    document.getElementById('voteArea').style.display = 'block';
    errDiv.innerText = "Помилка зв'язку з базою даних.";
    errDiv.style.display = 'block';
  }
};