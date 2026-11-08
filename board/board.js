import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
  getFirestore,
  doc,
  onSnapshot,
  collection,
  getDocs,
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

let timerInterval = null;
let isFirstRender = true;
let currentGameState = null;
let sessionInfo = null;

// Отримуємо roomCode напряму як ID документа в колекції sessions
async function getSessionRef() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomCode = (urlParams.get('room') || localStorage.getItem('currentSessionCode') || '').toUpperCase().trim();
  if (!roomCode) return { docRef: null, roomCode: '' };
  
  const docRef = doc(db, 'sessions', roomCode);
  return { docRef, roomCode };
}

async function initBoard() {
  sessionInfo = await getSessionRef();
  if (!sessionInfo || !sessionInfo.docRef || !sessionInfo.roomCode) {
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.innerText = 'Помилка: кімнату не знайдено!';
    return;
  }

  const roomCodeEl = document.getElementById('roomCodeDisplay');
  if (roomCodeEl) {
    roomCodeEl.innerText = `Код кімнати: ${sessionInfo.roomCode}`;
  }

  // Запускаємо слухача підключених гравців із підколекції кімнати
  subscribeToConnectedPlayers(sessionInfo.roomCode);

  // Слухаємо стан гри саме з документа сесії в sessions/{roomCode}
  onSnapshot(sessionInfo.docRef, async (docSnap) => {
    if (!docSnap.exists()) return;
    currentGameState = docSnap.data();

    if (isFirstRender) {
      isFirstRender = false;
      const loadingEl = document.getElementById('loading');
      const containerEl = document.getElementById('boardContainer');
      if (loadingEl) loadingEl.style.display = 'none';
      if (containerEl) containerEl.style.display = 'block';
    }
    renderBoard(currentGameState, sessionInfo.roomCode);
  });

  // Слухаємо зміни у підколекціях votes та answers поточної кімнати
  onSnapshot(collection(db, `sessions/${sessionInfo.roomCode}/votes`), () => {
    if (currentGameState && sessionInfo) renderBoard(currentGameState, sessionInfo.roomCode);
  });
  onSnapshot(collection(db, `sessions/${sessionInfo.roomCode}/answers`), () => {
    if (currentGameState && sessionInfo) renderBoard(currentGameState, sessionInfo.roomCode);
  });

  // Запускаємо слухача підключених гравців із підколекції кімнати
  subscribeToConnectedPlayers(sessionInfo.roomCode);
  
  subscribeToSubmittedPlayers(sessionInfo.roomCode);
  subscribeToVotedPlayers(sessionInfo.roomCode);
}

let previousGameView = 'BOARD';
let previousRoundNum = 1;

async function renderBoard(state, roomCode) {
  const gSet = state.gameSettings || {};
  const gameView = gSet.gameView || 'BOARD';
  const currentRoundNum = Number(state.currentRound) || 1;

  const viewQr = document.getElementById('viewQrMode');
  const viewBoard = document.getElementById('viewBoardMode');
  const viewLb = document.getElementById('viewLbMode');

  // 🛡️ ХОВАЄМО і ЧИСТИМО варіанти ТІЛЬКИ якщо щойно перейшли з рейтингу на дошку або змінився раунд
  if ((previousGameView === 'LEADERBOARD' && gameView === 'BOARD') || (previousRoundNum !== currentRoundNum)) {
    const answersWrapper = document.getElementById('answersWrapper');
    const answersContainer = document.getElementById('answersList');
    if (answersWrapper) answersWrapper.style.display = 'none';
    if (answersContainer) answersContainer.innerHTML = '';
  }

  // Зберігаємо поточний стан для наступної перевірки
  previousGameView = gameView;
  previousRoundNum = currentRoundNum;

  if (viewBoard) viewBoard.style.display = 'none';
  if (viewLb) viewLb.style.display = 'none';
  if (viewQr) viewQr.style.display = 'none';

  if (gameView === 'LEADERBOARD') {
    if (viewLb) viewLb.style.display = 'block';
    loadLeaderboardData(roomCode);
    return;
  } else if (gameView === 'QR') {
    if (viewQr) {
      viewQr.style.display = 'block';
      const qrImg = viewQr.querySelector('img');
      if (qrImg && !qrImg.src.includes('qr.png')) {
        const basePath = window.location.pathname.includes('/bluffing-trivia/') ? '/bluffing-trivia' : '';
        qrImg.src = basePath + '/qr.png';
      }
    }
    return;
  } else {
    if (viewBoard) viewBoard.style.display = 'block';
  }

  const roundBlock = document.getElementById('boardRound');
  if (roundBlock) {
    roundBlock.innerText = `Запитання № ${currentRoundNum}`;
  }

  await loadQuestionText(currentRoundNum, roomCode);
  handleTimer(gSet);
  loadAnswersAndVotes(state, currentRoundNum, roomCode);
  
  updateSubmittedPlayersUI(currentRoundNum);
  updateVotedPlayersUI(currentRoundNum);
}

async function loadQuestionText(currentRoundNum, roomCode) {
  const qSnap = await getDocs(collection(db, `sessions/${roomCode}/questions`));
  let foundText = 'Запитання відсутнє';
  let foundImage = '';

  qSnap.forEach((docSnap) => {
    const q = docSnap.data();
    if (Number(q.roundNum) === Number(currentRoundNum)) {
      foundText = q.text || q.question || foundText;
      foundImage = q.imageUrl || '';
    }
  });

  const questionCard = document.getElementById('boardQuestionCard');
  if (questionCard) {
    let questionImgEl = document.getElementById('boardQuestionImage');
    if (!questionImgEl) {
      questionImgEl = document.createElement('img');
      questionImgEl.id = 'boardQuestionImage';
      questionImgEl.style.cssText = 'display: none; width: auto; border-radius: 8px; margin-left: auto; margin-right: auto; margin-bottom: 16px; object-fit: contain; margin-left: auto; margin-right: auto;';
      questionCard.prepend(questionImgEl);
    }

    if (foundImage && foundImage.trim() !== '') {
      questionImgEl.style.display = 'inline';
      if (questionImgEl.src !== foundImage) {
        questionImgEl.src = foundImage;
        questionImgEl.classList.remove('question-animate');
        void questionImgEl.offsetWidth;
        questionImgEl.classList.add('question-animate');
      }
    } else {
      questionImgEl.style.display = 'none';
      questionImgEl.src = '';
    }
  }

  const questionTextEl = document.getElementById('boardQuestionText');
  if (questionTextEl) {
    if (questionTextEl.innerText !== foundText) {
      questionTextEl.classList.remove('question-animate');
      questionTextEl.innerText = foundText;
      void questionTextEl.offsetWidth;
      questionTextEl.classList.add('question-animate');
    }
  }
}

let globalTickCtx = null;
let continuousOscillator = null;
let continuousGainNode = null;

function handleTimer(gSet) {
  const timerFill = document.getElementById('timerBarFill');
  if (!timerFill) return;
  
  if (gSet.timerState === 'running' && gSet.timerStartTime) {
    if (timerInterval) clearInterval(timerInterval);
    const totalSecs = Number(gSet.timerSeconds) || 30;
    const startTime = Number(gSet.timerStartTime);
    try {
      if (!globalTickCtx || globalTickCtx.state === 'closed') {
        globalTickCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (globalTickCtx.state === 'suspended') {
        globalTickCtx.resume();
      }
      if (continuousOscillator) {
        try { continuousOscillator.stop(); } catch(e){}
      }
      continuousOscillator = globalTickCtx.createOscillator();
      continuousGainNode = globalTickCtx.createGain();
      continuousOscillator.type = 'sine';
      continuousOscillator.frequency.setValueAtTime(500, globalTickCtx.currentTime);
      continuousGainNode.gain.setValueAtTime(0.001, globalTickCtx.currentTime);
      continuousOscillator.connect(continuousGainNode);
      continuousGainNode.connect(globalTickCtx.destination);
      continuousOscillator.start();
    } catch (e) {
      console.log('Помилка ініціалізації аудіо:', e);
    }
    let lastPlayedSecond = -1;
    timerInterval = setInterval(() => {
      const now = new Date().getTime();
      const elapsedSec = (now - startTime) / 1000;
      const left = totalSecs - elapsedSec;
      if (left <= 0) {
        timerFill.style.transform = 'scaleX(0)';
        timerFill.style.backgroundColor = '#c62828';
        clearInterval(timerInterval);
        stopContinuousSound();
      } else {
        const scaleVal = Math.max(0, left / totalSecs);
        timerFill.style.transform = `scaleX(${scaleVal})`;
        const currentSecInt = Math.floor(left);
        if (currentSecInt !== lastPlayedSecond) {
          lastPlayedSecond = currentSecInt;
          if (continuousGainNode && globalTickCtx) {
            let freq = 500;
            if (currentSecInt <= 5) {
              freq = 650 + (5 - currentSecInt) * 60;
            }
            continuousOscillator.frequency.setValueAtTime(freq, globalTickCtx.currentTime);
            continuousGainNode.gain.setValueAtTime(0.12, globalTickCtx.currentTime);
            continuousGainNode.gain.exponentialRampToValueAtTime(0.001, globalTickCtx.currentTime + 0.08);
          }
        }
        if (left <= 5) {
          timerFill.style.backgroundColor = '#c62828';
        } else {
          timerFill.style.backgroundColor = '';
        }
      }
    }, 50);
  } else {
    if (timerInterval) clearInterval(timerInterval);
    stopContinuousSound();
    if (gSet.timerState === 'expired') {
      timerFill.style.transform = 'scaleX(0)';
      timerFill.style.backgroundColor = '#c62828';
    } else {
      timerFill.style.transform = 'scaleX(1)';
      timerFill.style.backgroundColor = '';
    }
  }
}

function stopContinuousSound() {
  if (continuousOscillator) {
    try {
      continuousOscillator.stop();
      continuousOscillator.disconnect();
    } catch (e) {}
    continuousOscillator = null;
  }
}

let revealStepIndex = 0;
let revealTimeout = null;
let lastShowQuestionState = false;
let lastShowVotersState = false;

async function loadAnswersAndVotes(state, currentRoundNum, roomCode) {
  const gSet = state.gameSettings || {};
  const [votesSnap, answersSnap, qSnapshot, playersSnap] = await Promise.all([
    getDocs(collection(db, `sessions/${roomCode}/votes`)),
    getDocs(collection(db, `sessions/${roomCode}/answers`)),
    getDocs(collection(db, `sessions/${roomCode}/questions`)),
    getDocs(collection(db, `sessions/${roomCode}/players`))
  ]);

  const playersMap = {};
  playersSnap.forEach((docSnap) => {
    const p = docSnap.data();
    playersMap[docSnap.id] = p.userName || '👤 Гравець';
  });

  let currentQDoc = null;
  qSnapshot.forEach((docSnap) => {
    const q = docSnap.data();
    if (Number(q.roundNum) === Number(currentRoundNum)) {
      currentQDoc = q;
    }
  });

  let roundAnswers = (currentQDoc && currentQDoc.shuffledAnswers) ? currentQDoc.shuffledAnswers : [];
  if (roundAnswers.length === 0) {
    let currentQ = { correctAnswer: '', wrongAnswer: '' };
    qSnapshot.forEach((docSnap) => {
      const q = docSnap.data();
      if (Number(q.roundNum) === Number(currentRoundNum)) currentQ = q;
    });
    answersSnap.forEach((docSnap) => {
      const ans = docSnap.data();
      if (Number(ans.roundNum) === Number(currentRoundNum)) {
        roundAnswers.push({
          id: docSnap.id,
          answer: ans.answer,
          userId: ans.userId,
          userName: playersMap[ans.userId] || '👤 Гравець',
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

  let activeCardItems = [];
  let correctCardItem = null;
  roundAnswers.forEach((item) => {
    let hasVotes = false;
    votesSnap.forEach((vDoc) => {
      const v = vDoc.data();
      if (Number(v.roundNum) === Number(currentRoundNum) && v.votedAnswerId === item.id) {
        hasVotes = true;
      }
    });
    const isCorrect = item.id && item.id.startsWith('correct');
    if (isCorrect) {
      correctCardItem = item;
    } else if (hasVotes) {
      activeCardItems.push(item);
    }
  });
  if (correctCardItem) {
    activeCardItems.push(correctCardItem);
  }

  const isNewlyShown = gSet.showQuestion && !lastShowQuestionState;
  lastShowQuestionState = !!gSet.showQuestion;
  const answersWrapper = document.getElementById('answersWrapper');
  const answersContainer = document.getElementById('answersList');
  let modalContainer = document.getElementById('modalCardContainer');
  if (!modalContainer) {
    modalContainer = document.createElement('div');
    modalContainer.id = 'modalCardContainer';
    document.body.appendChild(modalContainer);
  }
  if (!answersWrapper || !answersContainer) return;

  // Перевіряємо параметри із gSet
  if (!gSet.showQuestion) {
    answersWrapper.style.display = 'none';
    answersContainer.innerHTML = '';
    modalContainer.innerHTML = '';
    if (revealTimeout) { clearTimeout(revealTimeout); revealTimeout = null; }
    lastShowQuestionState = false;
    lastShowVotersState = false;
    return;
  }
  answersWrapper.style.display = 'block';

  const isVotePhase = gSet.phase === 'VOTE';
  const shouldShowModal = gSet.showVoters && isVotePhase;
  const justTurnedOnVoters = shouldShowModal && !lastShowVotersState;

  if (justTurnedOnVoters) {
    revealStepIndex = 0;
    if (revealTimeout) clearTimeout(revealTimeout);
    startRevealSequence();
  } else if (!shouldShowModal) {
    revealStepIndex = activeCardItems.length;
    if (revealTimeout) { clearTimeout(revealTimeout); revealTimeout = null; }
    modalContainer.innerHTML = '';
  }
  lastShowVotersState = shouldShowModal;

  function startRevealSequence() {
    if (!gSet.showVoters || revealStepIndex >= activeCardItems.length) {
      if (modalContainer) modalContainer.innerHTML = '';
      renderListOnly();
      return;
    }
    renderBoardContent(true);
    revealTimeout = setTimeout(() => {
      if (!gSet.showVoters) return;
      const modalInner = modalContainer.querySelector('.question-animate');
      const modalBackdrop = modalContainer.querySelector('div');
      if (modalInner) modalInner.classList.add('question-animate-out');
      if (modalBackdrop) modalBackdrop.classList.add('question-animate-out');
      revealStepIndex++;
      renderListOnly();
      setTimeout(() => {
        if (!gSet.showVoters) return;
        if (modalContainer) modalContainer.innerHTML = '';
        revealTimeout = setTimeout(() => {
          if (!gSet.showVoters) return;
          startRevealSequence();
        }, 3500);
      }, 500);
    }, 4500);
  }

  function renderListOnly() {
    let listHtml = '';
    if (roundAnswers.length === 0) {
      listHtml = `<div class="answer-item" style="border-left-color: #ffb74d; color: #aaa;">Очікуємо на варіанти від гравців...</div>`;
    } else {
      roundAnswers.forEach((item, index) => {
        let voters = [];
        const isCorrect = item.id === 'correct' + currentRoundNum || (item.id && item.id.startsWith('correct'));
        const isWrong = item.id === 'wrong' + currentRoundNum || (item.id && item.id.startsWith('wrong'));
        votesSnap.forEach((vDoc) => {
          const v = vDoc.data();
          if (Number(v.roundNum) === Number(currentRoundNum) && v.votedAnswerId === item.id) {
            voters.push(playersMap[v.userId] || '👤 Гравець');
          }
        });
        const cardIndex = activeCardItems.findIndex(ci => ci.id === item.id);
        const showThisLabel = gSet.showVoters && cardIndex !== -1 && cardIndex < revealStepIndex;
        const animClass = isNewlyShown ? 'answer-item-animate' : '';
        const delay = index * 0.15;
        const styleAttr = isNewlyShown
          ? `display: flex; justify-content: space-between; align-items: flex-end; animation-delay: ${delay}s;`
          : `display: flex; justify-content: space-between; align-items: flex-end;`;
        
        const itemAuthorName = item.userName || playersMap[item.userId] || '👤 Гравець';

        listHtml += `
          <div class="answer-item ${animClass}" style="${styleAttr}">
            <div style="display: flex; flex-direction: column; flex-grow: 1; margin-right: 15px;">
              <div style="font-size: 20px; font-weight: bold; margin-bottom: 8px;"><b>${index + 1}.</b> ${item.answer}</div>
        `;
        if (showThisLabel) {
          if (isCorrect) {
            listHtml += `<div><span class="correct-tag" style="margin: 0;">✅ Правильна відповідь</span></div>`;
          } else if (isWrong) {
            listHtml += `<div><span style="display: inline-block; background: #c62828; color: #fff; padding: 3px 10px; border-radius: 6px; font-size: 13px; font-weight: 500; margin: 0;">😡 Відповідь-пастка</span></div>`;
          } else {
            const authorPoints = voters.length;
            let authorIcon = '😎';
            let cleanAuthorName = itemAuthorName;
            const match = itemAuthorName.match(/^([\p{Extended_Pictographic}\u1F300-\u1F9FF])\s*(.*)$/u);
            if (match && match[1] !== '👤') {
              authorIcon = match[1];
              cleanAuthorName = match[2];
            }
            listHtml += `
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span class="author-tag" style="margin: 0;">${authorIcon} Автор: ${cleanAuthorName}</span>
                ${authorPoints > 0 ? `<b style="color: #03dac6; font-size: 14px;">+${authorPoints} ${authorPoints === 1 ? 'бал' : authorPoints < 5 ? 'бали' : 'балів'}</b>` : ''}
              </div>
            `;
          }
        }
        listHtml += `</div>`;
        if (showThisLabel && voters.length > 0) {
          listHtml += `<div style="display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; align-items: flex-end;">`;
          voters.forEach((v) => {
            let pointsText = '';
            if (isCorrect) {
              pointsText = ' <b style="color: #2e7d32;">+2</b>';
            } else if (isWrong) {
              pointsText = ' <b style="color: #ff5252;">-1</b>';
            }
            const hasEmoji = /^[\p{Extended_Pictographic}\u1F300-\u1F9FF]/u.test(v);
            const displayName = hasEmoji ? v : `👤 ${v}`;
            listHtml += `<span style="background: #ffffff; color: #3700b3; padding: 5px 12px; border-radius: 6px; font-size: 15px; white-space: nowrap; margin: 0; font-weight: 500;">${displayName}${pointsText}</span>`;
          });
          listHtml += `</div>`;
        }
        listHtml += `</div>`;
      });
    }
    answersContainer.innerHTML = listHtml;
  }

  function renderBoardContent(showModal = false) {
    renderListOnly();
    const isVotePhase = gSet.phase === 'VOTE';
    if (showModal && gSet.showVoters && isVotePhase && revealStepIndex < activeCardItems.length) {
      const currentCardItem = activeCardItems[revealStepIndex];
      let cardVoters = [];
      const isCorrect = currentCardItem.id === 'correct' + currentRoundNum || (currentCardItem.id && currentCardItem.id.startsWith('correct'));
      const isWrong = currentCardItem.id === 'wrong' + currentRoundNum || (currentCardItem.id && currentCardItem.id.startsWith('wrong'));
      
      votesSnap.forEach((vDoc) => {
        const v = vDoc.data();
        if (Number(v.roundNum) === Number(currentRoundNum) && v.votedAnswerId === currentCardItem.id) {
          cardVoters.push(playersMap[v.userId] || '👤 Гравець');
        }
      });

      const currentAuthorName = currentCardItem.userName || playersMap[currentCardItem.userId] || '👤 Гравець';

      let leftBadgeHtml = '';
      if (isCorrect) {
        leftBadgeHtml = `<span class="correct-tag" style="font-size: 16px; padding: 6px 14px; margin: 0;">✅ Правильна відповідь</span>`;
      } else if (isWrong) {
        leftBadgeHtml = `<span style="display: inline-block; background: #c62828; color: #fff; padding: 6px 14px; border-radius: 6px; font-size: 16px; font-weight: 500; margin: 0;">😡 Відповідь-пастка</span>`;
      } else {
        const authorPoints = cardVoters.length;
        let authorIcon = '😎';
        let cleanAuthorName = currentAuthorName;
        const match = currentAuthorName.match(/^([\p{Extended_Pictographic}\u1F300-\u1F9FF])\s*(.*)$/u);
        if (match && match[1] !== '👤') {
          authorIcon = match[1];
          cleanAuthorName = match[2];
        }
        leftBadgeHtml = `
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="author-tag" style="font-size: 16px; padding: 6px 14px; margin: 0;">${authorIcon} Автор: ${cleanAuthorName}</span>
            ${authorPoints > 0 ? `<b style="color: #03dac6; font-size: 16px;">+${authorPoints} ${authorPoints === 1 ? 'бал' : authorPoints < 5 ? 'бали' : 'балів'}</b>` : ''}
          </div>
        `;
      }

      let rightVotersHtml = '';
      if (cardVoters.length > 0) {
        rightVotersHtml = `<div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end;">`;
        cardVoters.forEach((v) => {
          let pts = isCorrect ? ' <b style="color: #2e7d32;">+2</b>' : (isWrong ? ' <b style="color: #ff5252;">-1</b>' : '');
          const hasEmoji = /^[\p{Extended_Pictographic}\u1F300-\u1F9FF]/u.test(v);
          const displayName = hasEmoji ? v : `👤 ${v}`;
          rightVotersHtml += `<span style="background: #ffffff; color: #3700b3; padding: 8px 14px; border-radius: 8px; font-size: 16px; font-weight: bold; white-space: nowrap; margin: 0;">${displayName}${pts}</span>`;
        });
        rightVotersHtml += `</div>`;
      }

      modalContainer.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.75); display: flex; align-items: center; justify-content: center; z-index: 9999;">
          <div class="question-animate" style="background: #1e1e1e; border: 3px solid #03dac6; padding: 40px; border-radius: 16px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.8); max-width: 800px; width: 90%;">
            <div style="font-size: 32px; font-weight: bold; margin-bottom: 25px; color: #fff;">"${currentCardItem.answer}"</div>
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 20px; text-align: left;">
              <div style="flex: 1;">${leftBadgeHtml}</div>
              <div style="flex: 1; display: flex; justify-content: flex-end;">${rightVotersHtml}</div>
            </div>
          </div>
        </div>
      `;
    }
  }

  if (!justTurnedOnVoters) {
    renderListOnly();
  }
}

// Завантаження таблиці лідерів СУВОРО з полів score у колекції players
async function loadLeaderboardData(roomCode) {
  const playersSnap = await getDocs(collection(db, `sessions/${roomCode}/players`));
  
  let scoreList = [];
  playersSnap.forEach((docSnap) => {
    const p = docSnap.data();
    scoreList.push({
      name: p.userName || '👤 Гравець',
      score: p.score || 0,
    });
  });

  scoreList.sort((a, b) => b.score - a.score);

  let lbHtml = '<tr><th>Гравець</th><th style="text-align: right;">Бали</th></tr>';
  if (scoreList.length > 0) {
    scoreList.forEach((item, index) => {
      const medal = index === 0 ? '🥇 ' : index === 1 ? '🥈 ' : index === 2 ? '🥉 ' : '';
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

let lastPlayersSnapshot = null;
let lastRenderedSignature = '';

function subscribeToConnectedPlayers(roomCode) {
  const q = collection(db, `sessions/${roomCode}/players`);
  onSnapshot(q, (snapshot) => {
    lastPlayersSnapshot = snapshot;
    renderConnectedPlayers();
  });

  setInterval(() => {
    if (lastPlayersSnapshot) {
      renderConnectedPlayers();
    }
  }, 2000);
}

function renderConnectedPlayers() {
  const container = document.getElementById('connectedPlayersContainer');
  if (!container || !lastPlayersSnapshot) return;

  const now = Date.now();
  const activePlayers = [];
  lastPlayersSnapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const lastSeen = data.lastSeen || 0;
    if ((now - lastSeen) < 5000) {
      activePlayers.push({
        id: docSnap.id,
        userName: data.userName
      });
    }
  });

  activePlayers.sort((a, b) => a.id.localeCompare(b.id));
  const currentSignature = activePlayers.map(p => p.id).join(',');
  if (currentSignature === lastRenderedSignature) {
    return;
  }
  lastRenderedSignature = currentSignature;
  container.innerHTML = '';

  if (activePlayers.length === 0) {
    container.innerHTML = '<span style="color: #888; font-size: 14px;">Очікуємо підключення гравців...</span>';
    return;
  }

  activePlayers.forEach((player) => {
    const chip = document.createElement('div');
    chip.className = 'player-chip';
    chip.innerText = player.userName;
    container.appendChild(chip);
  });
}

let lastAnswersSnapshot = null;

function subscribeToSubmittedPlayers(roomCode) {
  const q = collection(db, `sessions/${roomCode}/answers`);
  onSnapshot(q, (snapshot) => {
    lastAnswersSnapshot = snapshot;
    // Беремо актуальний номер раунду з поточного стану гри або за замовчуванням 1
    const currentRoundNum = Number(currentGameState?.currentRound) || 1;
    updateSubmittedPlayersUI(currentRoundNum);
  });
}

async function updateSubmittedPlayersUI(currentRoundNum) {
  const container = document.getElementById('submittedPlayersContainer');
  if (!container || !lastAnswersSnapshot) return;

  const gSet = currentGameState?.gameSettings || {};
  
  // 🛡️ Якщо глобальний світчер міток вимкнено або активний показ питань — ховаємо мітки миттєво
  if (gSet.showPlayerChips === false || gSet.showQuestion || gSet.gameView === 'LEADERBOARD') {
    container.style.opacity = '1';
    container.innerHTML = '';
    return;
  }

  // Отримуємо список гравців
  const playersSnap = await getDocs(collection(db, `sessions/${sessionInfo.roomCode}/players`));
  const playersMap = {};
  playersSnap.forEach(docSnap => {
    const p = docSnap.data();
    playersMap[docSnap.id] = p.userName || '👤 Гравець';
  });

  const submittedNames = [];
  lastAnswersSnapshot.forEach(docSnap => {
    const ans = docSnap.data();
    if (Number(ans.roundNum) === Number(currentRoundNum)) {
      const name = playersMap[ans.userId] || '👤 Гравець';
      submittedNames.push(name);
    }
  });

  container.style.opacity = '1';
  container.innerHTML = '';

  if (submittedNames.length === 0) return;

  submittedNames.forEach(name => {
    const chip = document.createElement('div');
    chip.className = 'player-submitted-chip';
    const hasEmoji = /^[\p{Extended_Pictographic}\u1F300-\u1F9FF]/u.test(name);
    chip.innerHTML = hasEmoji ? `<span>${name}</span>` : `<span>👤 ${name}</span>`;
    container.appendChild(chip);
  });
}

let lastVotesSnapshot = null;

function subscribeToVotedPlayers(roomCode) {
  const q = collection(db, `sessions/${roomCode}/votes`);
  onSnapshot(q, (snapshot) => {
    lastVotesSnapshot = snapshot;
    const currentRoundNum = Number(currentGameState?.currentRound) || 1;
    updateVotedPlayersUI(currentRoundNum);
  });
}

async function updateVotedPlayersUI(currentRoundNum) {
  const container = document.getElementById('votedPlayersContainer');
  if (!container || !lastVotesSnapshot) return;

  const gSet = currentGameState?.gameSettings || {};
  
  const showOptionsActive = gSet.showQuestion === true;
  const showVotersActive = gSet.showVoters === true;

  // 🛡️ Якщо глобальний світчер міток вимкнено, варіанти не показані або вже увімкнено авторів — ховаємо
  if (gSet.showPlayerChips === false || !showOptionsActive || showVotersActive || gSet.gameView === 'LEADERBOARD') {
    container.style.opacity = '1';
    container.innerHTML = '';
    return;
  }

  // Отримуємо список гравців
  const playersSnap = await getDocs(collection(db, `sessions/${sessionInfo.roomCode}/players`));
  const playersMap = {};
  playersSnap.forEach(docSnap => {
    const p = docSnap.data();
    playersMap[docSnap.id] = p.userName || '👤 Гравець';
  });

  const votedNames = [];
  lastVotesSnapshot.forEach(docSnap => {
    const vote = docSnap.data();
    if (Number(vote.roundNum) === Number(currentRoundNum)) {
      const name = playersMap[vote.userId] || '👤 Гравець';
      votedNames.push(name);
    }
  });

  container.style.opacity = '1';
  container.innerHTML = '';

  if (votedNames.length === 0) return;

  votedNames.forEach(name => {
    const chip = document.createElement('div');
    chip.className = 'player-voted-chip';
    const hasEmoji = /^[\p{Extended_Pictographic}\u1F300-\u1F9FF]/u.test(name);
    chip.innerHTML = hasEmoji ? `<span>${name}</span>` : `<span>👤 ${name}</span>`;
    container.appendChild(chip);
  });
}

window.onload = function () {
  initBoard();
};