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
  deleteDoc,
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

let playerTimerInterval = null;
let playerLastRunningStart = 0;
let playerIsExpired = false;
let isSubmittingOrVoting = false;
let unsubscribeGame = null;
let sessionInfo = null;
let lastProcessedRound = null;
let heartbeatInterval = null;
let myPlayerId = null;

async function getSessionRef() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomCode = (urlParams.get('room') || localStorage.getItem('currentSessionCode') || '').toUpperCase().trim();
  if (!roomCode) return { docRef: null, roomCode: '' };
  
  const docRef = doc(db, 'sessions', roomCode);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { docRef, roomCode };
  }
  return { docRef: null, roomCode };
}

window.onload = async function () {
  sessionInfo = await getSessionRef();
  if (!sessionInfo || !sessionInfo.docRef || !sessionInfo.roomCode) {
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.innerText = 'Помилка: кімнату не знайдено!';
    return;
  }
  checkUserSession(sessionInfo.roomCode);
};

function getOrCreateUserId(roomCode) {
  const storageKey = `bluff_user_id_${roomCode}`;
  let userId = localStorage.getItem(storageKey);
  if (!userId) {
    userId = doc(collection(db, `sessions/${roomCode}/players`)).id;
    localStorage.setItem(storageKey, userId);
  }
  return userId;
}

async function startPlayerHeartbeat(roomCode, userName) {
  if (!db) return;
  myPlayerId = getOrCreateUserId(roomCode);

  try {
    const playerRef = doc(db, `sessions/${roomCode}/players`, myPlayerId);
    
    await setDoc(playerRef, {
      userName: userName,
      lastSeen: Date.now(),
      score: 0
    }, { merge: true });

    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(async () => {
      try {
        await updateDoc(doc(db, `sessions/${roomCode}/players`, myPlayerId), {
          lastSeen: Date.now()
        });
      } catch (e) {
        console.error('Помилка оновлення статусу активності:', e);
      }
    }, 3000);
  } catch (err) {
    console.error('Помилка запуску heartbeat гравця:', err);
  }
}

window.addEventListener('beforeunload', async () => {
  if (myPlayerId && sessionInfo && sessionInfo.roomCode && db) {
    try {
      await deleteDoc(doc(db, `sessions/${sessionInfo.roomCode}/players`, myPlayerId));
    } catch (e) {
      console.error('Помилка видалення гравця при виході:', e);
    }
  }
});

function checkUserSession(roomCode) {
  const savedName = localStorage.getItem('bluff_username') || '';
  const loginScreen = document.getElementById('loginScreen');
  const mainContainer = document.getElementById('mainContainer');
  const loadingEl = document.getElementById('loading');
  const roomCodeEl = document.getElementById('playerRoomCodeDisplay');
  
  if (roomCodeEl) {
    roomCodeEl.innerText = `Код кімнати: ${roomCode}`;
  }

  if (savedName) {
    if (loginScreen) loginScreen.style.display = 'none';
    if (mainContainer) mainContainer.style.display = 'block';
    
    const usernameInput = document.getElementById('username');
    if (usernameInput) {
      usernameInput.value = savedName;
      usernameInput.readOnly = true;
    }
    
    startPlayerHeartbeat(roomCode, savedName);
    subscribeToGameState(savedName, roomCode);
  } else {
    if (loginScreen) loginScreen.style.display = 'block';
    if (mainContainer) mainContainer.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

window.joinGame = async function () {
  const emojiSelect = document.getElementById('userEmojiSelect');
  const emoji = emojiSelect ? emojiSelect.value : '👤';
  const input = document.getElementById('loginUsername');
  const name = input ? input.value.trim() : '';
  
  if (!name) {
    alert('Будь ласка, введіть свій нікнейм!');
    return;
  }

  const fullUserName = `${emoji} ${name}`;
  localStorage.setItem('bluff_username', fullUserName);
  localStorage.setItem('bluff_user_emoji', emoji);
  localStorage.setItem('bluff_user_name_only', name);

  if (sessionInfo && sessionInfo.docRef) {
    checkUserSession(sessionInfo.roomCode);
  }
};

window.changeNickname = function () {
  localStorage.removeItem('bluff_username');
  if (unsubscribeGame) unsubscribeGame();
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  
  if (myPlayerId && sessionInfo && sessionInfo.roomCode) {
    deleteDoc(doc(db, `sessions/${sessionInfo.roomCode}/players`, myPlayerId)).catch(() => {});
  }

  location.reload();
};

function subscribeToGameState(username, roomCode) {
  if (unsubscribeGame) unsubscribeGame();

  unsubscribeGame = onSnapshot(sessionInfo.docRef, async (docSnap) => {
    if (!docSnap.exists()) return;
    const sessionData = docSnap.data();
    const gSet = sessionData.gameSettings || {};
    const currentRoundNum = Number(sessionData.currentRound) || 1;

    // 👇 ДОДАЙ ЦЕЙ ЛОГ ДЛЯ ПЕРЕВІРКИ
    console.log("📥 Оновлення стану від сесії:", {
      phase: gSet.phase,
      timerState: gSet.timerState,
      timerSeconds: gSet.timerSeconds,
      showBoardToPlayers: gSet.showBoardToPlayers
    });

    myPlayerId = getOrCreateUserId(roomCode);
    // ... решта коду

    // У функції subscribeToGameState перевіряємо наявність відповіді/голосу саме для поточного раунду (currentRoundNum)
    const answersSnap = await getDocs(collection(db, `sessions/${roomCode}/answers`));
    let hasSubmitted = false;
    let myAnswerText = '';

    answersSnap.forEach((d) => {
      const a = d.data();
      if (
        Number(a.roundNum) === currentRoundNum &&
        (d.id === `${myPlayerId}_r${currentRoundNum}` || (a.userId === myPlayerId && Number(a.roundNum) === currentRoundNum))
      ) {
        hasSubmitted = true;
        myAnswerText = a.answer;
      }
    });

    // Фільтруємо голоси за підколекцією кімнати та раундом
    const votesSnap = await getDocs(collection(db, `sessions/${roomCode}/votes`));
    let hasVoted = false;
    let myVotedAnswerId = '';

    votesSnap.forEach((d) => {
      const v = d.data();
      if (
        Number(v.roundNum) === currentRoundNum &&
        (d.id === `${myPlayerId}_r${currentRoundNum}` || (v.userId === myPlayerId && Number(v.roundNum) === currentRoundNum))
      ) {
        hasVoted = true;
        myVotedAnswerId = v.votedAnswerId || '';
      }
    });

    // Отримуємо текст запитання та варіанти для поточної кімнати і раунду
    const qSnapshot = await getDocs(collection(db, `sessions/${roomCode}/questions`));
    let questionText = 'Запитання відсутнє';
    let shuffledAnswers = [];
    let currentQ = { correctAnswer: '', wrongAnswer: '' };

    qSnapshot.forEach((d) => {
      const q = d.data();
      if (Number(q.roundNum) === currentRoundNum) {
        questionText = q.text || q.question || questionText;
        shuffledAnswers = q.shuffledAnswers || [];
        currentQ = q;
      }
    });

    // Знаходимо реальний текст обраного варіанта за його ID
    let myVotedAnswerText = 'Обраний варіант';
    if (hasVoted && myVotedAnswerId) {
      if (myVotedAnswerId === 'correct' + currentRoundNum) {
        myVotedAnswerText = currentQ.correctAnswer || 'Правильна відповідь';
      } else if (myVotedAnswerId === 'wrong' + currentRoundNum) {
        myVotedAnswerText = currentQ.wrongAnswer || 'Відповідь-пастка';
      } else {
        const foundAns = shuffledAnswers.find(ans => (ans.id || ans.answer) === myVotedAnswerId);
        if (foundAns) {
          myVotedAnswerText = foundAns.answer;
        }
      }
    }

    const fullStatus = {
      ...gSet,
      currentRoundNum,
      questionText,
      shuffledAnswers,
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
  const timeoutStatusArea = document.getElementById('timeoutStatusArea');
  const submittedStatusArea = document.getElementById('submittedStatusArea');
  const submitFormArea = document.getElementById('submitFormArea');
  const voteTimeoutStatusArea = document.getElementById('voteTimeoutStatusArea');
  const votedStatusArea = document.getElementById('votedStatusArea');
  const voteArea = document.getElementById('voteArea');

  if (timeoutStatusArea) timeoutStatusArea.style.display = 'none';
  if (voteTimeoutStatusArea) voteTimeoutStatusArea.style.display = 'none';

  // Читаємо showBoardToPlayers із gameSettings
  if (status.showBoardToPlayers !== true) {
    waitingContainer.style.display = 'block';
    submitCont.style.display = 'none';
    voteCont.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'none';
    return;
  } else {
    waitingContainer.style.display = 'none';
  }

  if (loadingEl) loadingEl.style.display = 'none';

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

  const isDone = (status.phase === 'SUBMIT' && status.hasSubmitted) || (status.phase === 'VOTE' && status.hasVoted);
  if (isDone) {
    if (activeContainer) activeContainer.style.display = 'none';
    if (playerTimerInterval) {
      clearInterval(playerTimerInterval);
      playerTimerInterval = null;
    }
  } else if (
    status.timerState === 'running' &&
    status.timerSeconds
  ) {
    if (activeContainer) activeContainer.style.display = 'block';
    const timerSessionKey = `${status.phase}_${status.timerStartTime}`;

    if (playerLastRunningStart !== timerSessionKey) {
      playerLastRunningStart = timerSessionKey;
      playerIsExpired = false;
      if (playerTimerInterval) clearInterval(playerTimerInterval);

      const totalSec = parseInt(status.timerSeconds) || 30;
      let remainingSec = totalSec;

      playerTimerInterval = setInterval(() => {
        if (playerIsExpired) return;
        remainingSec -= 0.1;

        if (activeFill) {
          if (remainingSec > 0) {
            const scaleVal = Math.max(0, Math.min(1, remainingSec / totalSec));
            activeFill.style.transform = 'scaleX(' + scaleVal + ')';

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
          }
        }
      }, 100);
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
    playerLastRunningStart = null;
    if (activeFill) {
      activeFill.style.transform = 'scaleX(1)';
      activeFill.style.backgroundColor = '';
    }
  }

  if (status.phase === 'SUBMIT') {
    document.getElementById('submitLoader').style.display = 'none';
    document.getElementById('voteLoader').style.display = 'none';
    submitCont.style.display = 'block';
    voteCont.style.display = 'none';
    document.getElementById('roundBadgeSubmit').innerText =
      'Запитання № ' + status.currentRoundNum;
    document.getElementById('questionTextSubmit').innerText =
      status.questionText;

    if (lastProcessedRound !== status.currentRoundNum) {
      lastProcessedRound = status.currentRoundNum;
      const answerInput = document.getElementById('answer');
      if (answerInput) {
        answerInput.value = '';
      }
    }

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
  } else if (status.phase === 'VOTE') {
    document.getElementById('submitLoader').style.display = 'none';
    document.getElementById('voteLoader').style.display = 'none';
    submitCont.style.display = 'none';
    voteCont.style.display = 'block';
    document.getElementById('questionTextVote').innerText = status.questionText;

    if (status.hasVoted) {
      voteArea.style.display = 'none';
      votedStatusArea.style.display = 'block';
      if (voteTimeoutStatusArea) voteTimeoutStatusArea.style.display = 'none';
      document.getElementById('dispMyVote').innerText = status.votedAnswer;
    } else if (status.timerState === 'expired') {
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
                <b>${idx + 1}.</b> ${ansObj.answer} <span style="float: right; font-size: 13px; font-style: italic;">(Ваш варіант)</span>
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
  if (!sessionInfo) return;
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
  const timerContSubmit = document.getElementById('playerTimerContainerSubmit');
  if (timerContSubmit) timerContSubmit.style.display = 'none';
  document.getElementById('submitLoader').style.display = 'block';

  try {
    const gameDocSnap = await getDoc(sessionInfo.docRef);
    const currentRoundNum = gameDocSnap.exists()
      ? Number(gameDocSnap.data().currentRound) || 1
      : 1;
    
    // Формуємо унікальний ID документа для конкретного гравця і конкретного раунду
    const docId = `${myPlayerId}_r${currentRoundNum}`;
    const answerRef = doc(db, `sessions/${sessionInfo.roomCode}/answers`, docId);
    
    await setDoc(answerRef, {
      userId: myPlayerId,
      answer: answer,
      roundNum: currentRoundNum,
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
    if (timerContSubmit) timerContSubmit.style.display = 'block';
    errDiv.innerText = "Помилка зв'язку з базою даних.";
    errDiv.style.display = 'block';
  }
};

window.sendVote = async function (encodedAnsId, encodedAnsText) {
  if (!sessionInfo) return;
  const ansId = decodeURIComponent(encodedAnsId);
  const ansText = decodeURIComponent(encodedAnsText);
  const errDiv = document.getElementById('errorMsg');
  errDiv.style.display = 'none';
  isSubmittingOrVoting = true;
  document.getElementById('voteArea').style.display = 'none';
  const timerContVote = document.getElementById('playerTimerContainerVote');
  if (timerContVote) timerContVote.style.display = 'none';
  document.getElementById('voteLoader').style.display = 'block';

  try {
    const gameDocSnap = await getDoc(sessionInfo.docRef);
    const currentRoundNum = gameDocSnap.exists()
      ? Number(gameDocSnap.data().currentRound) || 1
      : 1;
    
    // Формуємо унікальний ID голосу для конкретного гравця і конкретного раунду
    const docId = `${myPlayerId}_r${currentRoundNum}`;
    const voteRef = doc(db, `sessions/${sessionInfo.roomCode}/votes`, docId);
    
    await setDoc(voteRef, {
      userId: myPlayerId,
      votedAnswerId: ansId,
      roundNum: currentRoundNum,
    });

    document.getElementById('voteLoader').style.display = 'none';
    document.getElementById('votedStatusArea').style.display = 'block';
    document.getElementById('dispMyVote').innerText = ansText;
    setTimeout(function () {
      isSubmittingOrVoting = false;
    }, 3000);
  } catch (err) {
    console.error('Помилка надсилання голосу:', err);
    isSubmittingOrVoting = false;
    document.getElementById('voteLoader').style.display = 'none';
    document.getElementById('voteArea').style.display = 'block';
    if (timerContVote) timerContVote.style.display = 'block';
    errDiv.innerText = "Помилка зв'язку з базою даних.";
    errDiv.style.display = 'block';
  }
};