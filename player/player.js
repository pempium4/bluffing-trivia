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

let playerTimerInterval = null;
let playerLastRunningStart = 0;
let playerIsExpired = false;
let isSubmittingOrVoting = false;
let unsubscribeGame = null;
let sessionInfo = null;
let lastProcessedRound = null;

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

window.onload = async function () {
  sessionInfo = await getSessionRef();
  if (!sessionInfo || !sessionInfo.docRef) {
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.innerText = 'Помилка: кімнату не знайдено!';
    return;
  }
  checkUserSession(sessionInfo.roomCode);
};

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
    subscribeToGameState(savedName, roomCode);
  } else {
    if (loginScreen) loginScreen.style.display = 'block';
    if (mainContainer) mainContainer.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

window.joinGame = function () {
  const emojiSelect = document.getElementById('userEmojiSelect');
  const emoji = emojiSelect ? emojiSelect.value : '👤';

  const input = document.getElementById('loginUsername');
  const name = input ? input.value.trim() : '';
  if (!name) {
    alert('Будь ласка, введіть свій нікнейм!');
    return;
  }

  // Об'єднуємо емодзі та нікнейм в одне ім'я (наприклад: "🦊 Мартишка")
  const fullUserName = `${emoji} ${name}`;

  // Зберігаємо у твій ключ, який використовується в проєкті
  localStorage.setItem('bluff_username', fullUserName);
  
  // Також збережемо окремо емодзі та чистий нікнейм, якщо знадобляться у майбутньому
  localStorage.setItem('bluff_user_emoji', emoji);
  localStorage.setItem('bluff_user_name_only', name);

  if (sessionInfo) {
    checkUserSession(sessionInfo.roomCode);
  }
};

window.changeNickname = function () {
  if (unsubscribeGame) unsubscribeGame();
  localStorage.removeItem('bluff_username');
  if (sessionInfo) {
    checkUserSession(sessionInfo.roomCode);
  }
};

// Підписка на стан гри з документа сесії в реальному часі
function subscribeToGameState(username, roomCode) {
  if (unsubscribeGame) unsubscribeGame();
  
  unsubscribeGame = onSnapshot(sessionInfo.docRef, async (docSnap) => {
    if (!docSnap.exists()) return;
    const state = docSnap.data();
    const currentRoundNum = Number(state.currentRound) || 1;

    // Фільтруємо відповіді за кімнатою та раундом
    const answersQuery = query(
      collection(db, 'answers'),
      where('roomCode', '==', roomCode)
    );
    const answersSnap = await getDocs(answersQuery);
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

    // Фільтруємо голоси за кімнатою та раундом
    const votesQuery = query(
      collection(db, 'votes'),
      where('roomCode', '==', roomCode)
    );
    const votesSnap = await getDocs(votesQuery);
    let hasVoted = false;
    let myVotedAnswerText = '';
    
    votesSnap.forEach((d) => {
      const v = d.data();
      if (
        Number(v.roundNum) === currentRoundNum &&
        v.userName.toLowerCase() === username.toLowerCase()
      ) {
        hasVoted = true;
        myVotedAnswerText = v.votedAnswerText || 'Обраний варіант';
      }
    });

    // Отримуємо текст запитання для поточної кімнати і раунду
    const qQuery = query(
      collection(db, 'questions'),
      where('roomCode', '==', roomCode)
    );
    const qSnapshot = await getDocs(qQuery);
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

  const timeoutStatusArea = document.getElementById('timeoutStatusArea');
  const submittedStatusArea = document.getElementById('submittedStatusArea');
  const submitFormArea = document.getElementById('submitFormArea');
  const voteTimeoutStatusArea = document.getElementById('voteTimeoutStatusArea');
  const votedStatusArea = document.getElementById('votedStatusArea');
  const voteArea = document.getElementById('voteArea');

  if (timeoutStatusArea) timeoutStatusArea.style.display = 'none';
  if (voteTimeoutStatusArea) voteTimeoutStatusArea.style.display = 'none';

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

  if (
    status.timerState === 'running' &&
    status.timerSeconds
  ) {
    if (activeContainer) activeContainer.style.display = 'block';
    
    // Використовуємо timerStartTime або унікальний ключ запуску, щоб ловити момент натискання «Старт»
    const timerSessionKey = `${status.phase}_${status.timerStartTime}`;
    
    if (playerLastRunningStart !== timerSessionKey) {
      playerLastRunningStart = timerSessionKey;
      playerIsExpired = false;
      if (playerTimerInterval) clearInterval(playerTimerInterval);
      
      // Беремо чітку кількість секунд, яку передав ведучий (наприклад, 20 або 30 с)
      const totalSec = parseInt(status.timerSeconds) || 30;
      let remainingSec = totalSec; 
 
      // Запускаємо абсолютно незалежний локальний відлік
      playerTimerInterval = setInterval(() => {
        if (playerIsExpired) return;
        
        remainingSec -= 0.1; // Зменшуємо кожні 100 мс
      
        if (activeFill) {
          if (remainingSec > 0) {
            // Чіткий розрахунок ширини від 100% до 0%
            const scaleVal = Math.max(0, Math.min(1, remainingSec / totalSec));
            activeFill.style.transform = 'scaleX(' + scaleVal + ')';
          
            if (remainingSec <= 5) {
              activeFill.style.backgroundColor = '#c62828'; // Червоний в кінці
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
  } 
  // Якщо таймер завершився або зупинений
  else if (status.timerState === 'expired' || playerIsExpired) {
    if (activeContainer) activeContainer.style.display = 'block';
    if (playerTimerInterval) {
      clearInterval(playerTimerInterval);
      playerTimerInterval = null;
    }
    if (activeFill) {
      activeFill.style.transform = 'scaleX(0)';
      activeFill.style.backgroundColor = '#c62828';
    }
  } 
  else {
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
 
    // 👇 Очищаємо текстове поле одразу при переході на новий раунд
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
    const gameDocSnap = await getDoc(sessionInfo.docRef);
    const currentRoundNum = gameDocSnap.exists()
      ? Number(gameDocSnap.data().currentRound) || 1
      : 1;

    const newAnswerRef = doc(collection(db, 'answers'));
    const answerId = newAnswerRef.id;
    await setDoc(newAnswerRef, {
      id: answerId,
      userName: username,
      answer: answer,
      roundNum: currentRoundNum,
      roomCode: sessionInfo.roomCode, // 👈 Фіксація коду кімнати
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
  if (!sessionInfo) return;
  const username = localStorage.getItem('bluff_username');
  const ansId = decodeURIComponent(encodedAnsId);
  const ansText = decodeURIComponent(encodedAnsText);
  const errDiv = document.getElementById('errorMsg');
  errDiv.style.display = 'none';

  isSubmittingOrVoting = true;
  document.getElementById('voteArea').style.display = 'none';
  document.getElementById('voteLoader').style.display = 'block';

  try {
    const gameDocSnap = await getDoc(sessionInfo.docRef);
    const currentRoundNum = gameDocSnap.exists()
      ? Number(gameDocSnap.data().currentRound) || 1
      : 1;

    const newVoteRef = doc(collection(db, 'votes'));
    await setDoc(newVoteRef, {
      userName: username,
      votedAnswerId: ansId,      // 👈 Головне для пошуку, підрахунку та співставлення
      votedAnswerText: ansText,  // 👈 Зберігаємо для відображення / історії в базі
      roundNum: currentRoundNum,
      roomCode: sessionInfo.roomCode,
      createdAt: new Date().getTime(),
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
    errDiv.innerText = "Помилка зв'язку з базою даних.";
    errDiv.style.display = 'block';
  }
};