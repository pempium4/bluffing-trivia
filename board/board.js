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

let timerInterval = null;
let isFirstRender = true;
let currentGameState = null;
let sessionInfo = null;

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

async function initBoard() {
  sessionInfo = await getSessionRef();
  if (!sessionInfo || !sessionInfo.docRef) {
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.innerText = 'Помилка: кімнату не знайдено!';
    return;
  }

  const roomCodeEl = document.getElementById('roomCodeDisplay');
  if (roomCodeEl) {
    roomCodeEl.innerText = `Код кімнати: ${sessionInfo.roomCode}`;
  }

  // Слухаємо стан гри саме з документа сесії в колекції sessions
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

  // Слухаємо голоси та відповіді для миттєвого оновлення дошки
  onSnapshot(collection(db, 'votes'), () => {
    if (currentGameState && sessionInfo) renderBoard(currentGameState, sessionInfo.roomCode);
  });
  onSnapshot(collection(db, 'answers'), () => {
    if (currentGameState && sessionInfo) renderBoard(currentGameState, sessionInfo.roomCode);
  });
}

async function renderBoard(state, roomCode) {
  const viewQr = document.getElementById('viewQrMode');
  const viewBoard = document.getElementById('viewBoardMode');
  const viewLb = document.getElementById('viewLbMode');
  const gameView = state.gameView || 'BOARD';

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

  const currentRoundNum = Number(state.currentRound) || 1;
  const roundBlock = document.getElementById('boardRound');
  if (roundBlock) {
    roundBlock.innerText = `Запитання № ${currentRoundNum}`;
  }

  await loadQuestionText(currentRoundNum, roomCode);
  handleTimer(state);
  loadAnswersAndVotes(state, currentRoundNum, roomCode);
}

async function loadQuestionText(currentRoundNum, roomCode) {
  const qQuery = query(collection(db, 'questions'), where('roomCode', '==', roomCode));
  const qSnapshot = await getDocs(qQuery);
  let foundText = 'Запитання відсутнє';
  let foundImage = '';
  
  qSnapshot.forEach((docSnap) => {
    const q = docSnap.data();
    if (Number(q.roundNum) === Number(currentRoundNum)) {
      foundText = q.text || q.question || foundText;
      foundImage = q.imageUrl || ''; 
    }
  });
 
  const questionCard = document.getElementById('boardQuestionCard');
  if (questionCard) {
    let questionImgEl = document.getElementById('boardQuestionImage');
    
    // Створюємо елемент динамічно з вирівнюванням по центру та шириною до 100%
    if (!questionImgEl) {
      questionImgEl = document.createElement('img');
      questionImgEl.id = 'boardQuestionImage';
      questionImgEl.style.cssText = 'display: none; width: 100%; border-radius: 8px; margin-bottom: 16px; object-fit: contain; margin-left: auto; margin-right: auto;';
      questionCard.prepend(questionImgEl);
    }
 
    if (foundImage && foundImage.trim() !== '') {
      questionImgEl.style.display = 'block';
      
      // Перезапускаємо анімацію ТІЛЬКИ якщо посилання на картинку змінилося
      if (questionImgEl.src !== foundImage) {
        questionImgEl.src = foundImage;
        questionImgEl.classList.remove('question-animate');
        void questionImgEl.offsetWidth; // Примусовий рефлов для перезапуску анімації
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

function handleTimer(state) {
  const timerFill = document.getElementById('timerBarFill');
  if (!timerFill) return;

  if (state.timerState === 'running' && state.timerStartTime) {
    if (timerInterval) clearInterval(timerInterval);
    const totalSecs = Number(state.timerSeconds) || 30;
    const startTime = Number(state.timerStartTime);

    // Ініціалізуємо один стабільний аудіо-потік на весь час таймера
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
          
          // Ритмічний "тік" та підвищення тону для останніх 5 секунд
          if (continuousGainNode && globalTickCtx) {
            let freq = 500;
            if (currentSecInt <= 5) {
              // Плавне або різке підвищення тону від 650 до 950 Гц залежно від наближення до 0
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
    
    if (state.timerState === 'expired') {
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
  const votesQuery = query(collection(db, 'votes'), where('roomCode', '==', roomCode));
  const answersQuery = query(collection(db, 'answers'), where('roomCode', '==', roomCode));
  const questionsQuery = query(collection(db, 'questions'), where('roomCode', '==', roomCode));
  const [votesSnap, answersSnap, qSnapshot] = await Promise.all([
    getDocs(votesQuery),
    getDocs(answersQuery),
    getDocs(questionsQuery),
  ]);

  let roundAnswers = state.shuffledAnswers || [];
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
  
  // Створюємо окремий масив для черговості модалок: 
  // звичайні варіанти (за які голосували) йдуть у своєму порядку, а пастка та правильна відповідь — завжди в кінці.
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
      // Зберігаємо правильну відповідь окремо на потім
      correctCardItem = item;
    } else if (hasVotes) {
      // Додаємо звичайний варіант або пастку ТІЛЬКИ якщо за них хтось проголосував, 
      // зберігаючи їхній природний порядок зверху вниз у списку
      activeCardItems.push(item);
    }
  });

  // Гарантовано ставимо правильну відповідь на сам кінець
  if (correctCardItem) {
    activeCardItems.push(correctCardItem);
  }

  const isNewlyShown = state.showQuestion && !lastShowQuestionState;
  lastShowQuestionState = !!state.showQuestion;

  const answersWrapper = document.getElementById('answersWrapper');
  const answersContainer = document.getElementById('answersList');
  let modalContainer = document.getElementById('modalCardContainer');
  if (!modalContainer) {
    modalContainer = document.createElement('div');
    modalContainer.id = 'modalCardContainer';
    document.body.appendChild(modalContainer);
  }

  if (!answersWrapper || !answersContainer) return;

  if (!state.showQuestion) {
    answersWrapper.style.display = 'none';
    answersContainer.innerHTML = '';
    modalContainer.innerHTML = '';
    if (revealTimeout) { clearTimeout(revealTimeout); revealTimeout = null; }
    lastShowQuestionState = false;
    lastShowVotersState = false;
    return;
  }

  answersWrapper.style.display = 'block';

  // Логіка запуску ланцюжка модалок при увімкненні світчера "Показати авторів та голоси"
  const justTurnedOnVoters = state.showVoters && !lastShowVotersState;
  
  if (justTurnedOnVoters) {
    revealStepIndex = 0;
    if (revealTimeout) clearTimeout(revealTimeout);
    startRevealSequence();
  } else if (!state.showVoters) {
    revealStepIndex = activeCardItems.length;
    if (revealTimeout) { clearTimeout(revealTimeout); revealTimeout = null; }
    modalContainer.innerHTML = '';
  }
  lastShowVotersState = !!state.showVoters;

  function startRevealSequence() {
    if (!state.showVoters || revealStepIndex >= activeCardItems.length) {
      if (modalContainer) modalContainer.innerHTML = '';
      renderListOnly();
      return;
    }

    // Рендеримо картку та оновлюємо список
    renderBoardContent(true);

    // Модалка тримається 5 секунд
    revealTimeout = setTimeout(() => {
      if (!state.showVoters) return;

      const modalInner = modalContainer.querySelector('.question-animate');
      const modalBackdrop = modalContainer.querySelector('div');

      if (modalInner) modalInner.classList.add('question-animate-out');
      if (modalBackdrop) modalBackdrop.classList.add('question-animate-out');

      // Збільшуємо індекс і оновлюємо список одразу на початку плавного зникання модалки
      revealStepIndex++;
      renderListOnly();

      // Через 0.5с (коли анімація завершиться) повністю очищаємо модалку та показуємо мітку в списку
      setTimeout(() => {
        if (!state.showVoters) return;

        if (modalContainer) modalContainer.innerHTML = '';

        // Пауза 4 секунди перед наступною модалкою
        revealTimeout = setTimeout(() => {
          if (!state.showVoters) return;
          startRevealSequence();
        }, 3500);
      }, 500);

    }, 4500); // 4.5с + 0.5с анімації = 5 секунд показу модалки
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
            voters.push(v.userName);
          }
        });

        // Перевіряємо, чи цей елемент уже брав участь у модалках і чи дійшла до нього черга
        const cardIndex = activeCardItems.findIndex(ci => ci.id === item.id);
        const showThisLabel = state.showVoters && cardIndex !== -1 && cardIndex < revealStepIndex;

        const animClass = isNewlyShown ? 'answer-item-animate' : '';
        const delay = index * 0.15;
        const styleAttr = isNewlyShown
          ? `display: flex; justify-content: space-between; align-items: flex-end; animation-delay: ${delay}s;`
          : `display: flex; justify-content: space-between; align-items: flex-end;`;

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
            
            // Визначаємо емодзі та чисте ім'я автора
            let authorIcon = '😎';
            let cleanAuthorName = item.userName;
            
            const match = item.userName.match(/^([\p{Extended_Pictographic}\u{1F300}-\u{1F9FF}])\s*(.*)$/u);
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
          // Для голосів у списку та модалці:
          voters.forEach((v) => {
            let pointsText = '';
            if (isCorrect) {
              pointsText = ' <b style="color: #2e7d32;">+2</b>';
            } else if (isWrong) {
              pointsText = ' <b style="color: #ff5252;">-1</b>';
            }

            // Перевіряємо, чи є емодзі на початку рядка (простий і надійний спосіб)
            // Якщо гравець не обрав емодзі, додаємо дефолтне 👤
            const hasEmoji = /^\p{Extended_Pictographic}/u.test(v) || /^[\u{1F300}-\u{1F9FF}]/u.test(v);
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

    if (showModal && state.showVoters && revealStepIndex < activeCardItems.length) {
      const currentCardItem = activeCardItems[revealStepIndex];
      let cardVoters = [];
      const isCorrect = currentCardItem.id === 'correct' + currentRoundNum || (currentCardItem.id && currentCardItem.id.startsWith('correct'));
      const isWrong = currentCardItem.id === 'wrong' + currentRoundNum || (currentCardItem.id && currentCardItem.id.startsWith('wrong'));

      votesSnap.forEach((vDoc) => {
        const v = vDoc.data();
        if (Number(v.roundNum) === Number(currentRoundNum) && v.votedAnswerId === currentCardItem.id) {
          cardVoters.push(v.userName);
        }
      });

      let badgeHtml = '';
      if (isCorrect) {
        badgeHtml = `<span class="correct-tag" style="font-size: 18px; padding: 8px 16px;">✅ Правильна відповідь</span>`;
      } else if (isWrong) {
        badgeHtml = `<span style="background: #c62828; color: #fff; padding: 8px 16px; border-radius: 8px; font-size: 18px; font-weight: 500;">😡 Відповідь-пастка</span>`;
      } else {
        badgeHtml = `<span class="author-tag" style="font-size: 18px; padding: 8px 16px;">😎 Автор: ${currentCardItem.userName}</span>`;
      }

      let votersHtml = '';
      if (cardVoters.length > 0) {
        votersHtml = `<div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: 20px;">`;
        cardVoters.forEach((v) => {
          let pts = isCorrect ? ' (+2)' : (isWrong ? ' (-1)' : '');
          votersHtml += `<span style="background: #ffffff; color: #3700b3; padding: 10px 18px; border-radius: 8px; font-size: 20px; font-weight: bold;">👤 ${v}${pts}</span>`;
        });
        votersHtml += `</div>`;
      }

      let authorPoints = cardVoters.length;
      let leftBadgeHtml = '';
      if (isCorrect) {
        leftBadgeHtml = `<span class="correct-tag" style="font-size: 16px; padding: 6px 14px; margin: 0;">✅ Правильна відповідь</span>`;
      } else if (isWrong) {
        leftBadgeHtml = `<span style="display: inline-block; background: #c62828; color: #fff; padding: 6px 14px; border-radius: 6px; font-size: 16px; font-weight: 500; margin: 0;">😡 Відповідь-пастка</span>`;
      } else {
        const authorPoints = cardVoters.length;
        
        let authorIcon = '😎';
        let cleanAuthorName = currentCardItem.userName;

        const match = currentCardItem.userName.match(/^([\p{Extended_Pictographic}\u{1F300}-\u{1F9FF}])\s*(.*)$/u);
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
          
          // Перевіряємо наявність емодзі у гравця
          const hasEmoji = /^\p{Extended_Pictographic}/u.test(v) || /^[\u{1F300}-\u{1F9FF}]/u.test(v);
          const displayName = hasEmoji ? v : `👤 ${v}`;
      
          rightVotersHtml += `<span style="background: #ffffff; color: #3700b3; padding: 8px 14px; border-radius: 8px; font-size: 16px; font-weight: bold; white-space: nowrap; margin: 0;">${displayName}${pts}</span>`;
        });
        rightVotersHtml += `</div>`;
      } else {
        rightVotersHtml = `<span style="color: #888; font-size: 15px;">Ніхто не обрав</span>`;
      }

      modalContainer.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.75); display: flex; align-items: center; justify-content: center; z-index: 9999;">
          <div class="question-animate" style="background: #1e1e1e; border: 3px solid #03dac6; padding: 40px; border-radius: 16px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.8); max-width: 800px; width: 90%;">
            <div style="font-size: 32px; font-weight: bold; margin-bottom: 25px; color: #fff;">«${currentCardItem.answer}»</div>
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

async function loadLeaderboardData(roomCode) {
  const votesQuery = query(collection(db, 'votes'), where('roomCode', '==', roomCode));
  const answersQuery = query(collection(db, 'answers'), where('roomCode', '==', roomCode));
  const questionsQuery = query(collection(db, 'questions'), where('roomCode', '==', roomCode));

  const [answersSnap, votesSnap, questionsSnap] = await Promise.all([
    getDocs(answersQuery),
    getDocs(votesQuery),
    getDocs(questionsQuery),
  ]);

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
    answerAuthorMap[ansId] = a.userName; // Зберігаємо зв'язок ID -> Автор відповіді
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
    const votedId = vote.votedAnswerId; // 👈 Використовуємо виключно ID голосу
    const rNum = Number(vote.roundNum);
    if (!voter || !votedId) return;
    if (scores[voter] === undefined) scores[voter] = 0;
    const details = roundDetails[rNum] || {};
    
    if (votedId === details.correctId) {
      scores[voter] += 2;
    } else if (votedId === details.wrongId) {
      scores[voter] -= 1;
    } else {
      const author = answerAuthorMap[votedId]; // Шукаємо автора за унікальним ID варіанта
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

// Запуск ініціалізації дошки
window.onload = function () {
  initBoard();
};