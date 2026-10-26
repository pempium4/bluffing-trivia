import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
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

// Глобальні змінні для вибору сесії з архіву
let selectedSessionCode = '';
let selectedSessionDocId = '';

// Генератор 4-значного коду англійськими літерами у верхньому регістрі
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Керування модалками
window.openCreateModal = function () {
  const modal = document.getElementById('createModal');
  const input = document.getElementById('adminPasswordInput');
  input.value = '';
  input.type = 'password';
  document.getElementById('togglePasswordBtn').innerText = '👁️';
  document.getElementById('errorMsg').style.display = 'none';
  modal.style.display = 'flex';
  input.focus();
};

window.openSessionsModal = function () {
  document.getElementById('sessionsModal').style.display = 'flex';
  loadSessionsList();
};

window.openJoinModal = function () {
  const modal = document.getElementById('joinModal');
  const input = document.getElementById('joinCodeInput');
  input.value = '';
  document.getElementById('joinErrorMsg').style.display = 'none';
  modal.style.display = 'flex';
  input.focus();
};

window.closeModal = function (modalId) {
  document.getElementById(modalId).style.display = 'none';
};

window.togglePasswordVisibility = function () {
  const input = document.getElementById('adminPasswordInput');
  const btn = document.getElementById('togglePasswordBtn');
  if (input.type === 'password') {
    input.type = 'text';
    btn.innerText = '👁️‍🗨️';
  } else {
    input.type = 'password';
    btn.innerText = '👁️';
  }
};

window.toggleSessionPasswordVisibility = function () {
  const input = document.getElementById('sessionPasswordInput');
  const btn = document.getElementById('toggleSessionPasswordBtn');
  if (input.type === 'password') {
    input.type = 'text';
    btn.innerText = '👁️‍🗨️';
  } else {
    input.type = 'password';
    btn.innerText = '👁️';
  }
};

// 1. Створення нової сесії гри з власним паролем
window.createGameSession = async function () {
  const sessionPassword = document.getElementById('adminPasswordInput').value.trim();
  const errorMsg = document.getElementById('errorMsg');

  if (!sessionPassword) {
    errorMsg.innerText = 'Введіть пароль для сесії!';
    errorMsg.style.display = 'block';
    document.getElementById('adminPasswordInput').focus();
    return;
  }

  try {
    const roomCode = generateRoomCode();

    // Створюємо документ сесії з дефолтними налаштуваннями гри всередині
    await addDoc(collection(db, 'sessions'), {
      code: roomCode,
      password: sessionPassword,
      createdAt: serverTimestamp(),
      questionsCount: 0,
      // Початкові налаштування гри для цієї сесії:
      currentRound: 1,
      gameView: 'BOARD',
      phase: 'SUBMIT',
      showBoardToPlayers: false,
      showQuestion: false,
      showVoters: false,
      timerSeconds: 20,
      timerStartTime: 0,
      timerState: 'idle',
      shuffledAnswers: []
    });

    localStorage.setItem('currentSessionCode', roomCode);
    localStorage.setItem('isAdmin', 'true');

    window.location.href = `./admin/admin.html?room=${roomCode}`;
  } catch (error) {
    console.error('Помилка створення сесії:', error);
    alert('Сталася помилка при створенні сесії.');
  }
};

// 2. Завантаження списку сесій (архів) з клікабельними рядками
async function loadSessionsList() {
  const listContainer = document.getElementById('sessionsList');
  listContainer.innerHTML = 'Завантаження...';

  try {
    const querySnapshot = await getDocs(collection(db, 'sessions'));
    listContainer.innerHTML = '';

    if (querySnapshot.empty) {
      listContainer.innerHTML = '<div style="color: #aaa; text-align: center; padding: 10px;">Архів сесій порожній</div>';
      return;
    }

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const dateStr = data.createdAt 
        ? new Date(data.createdAt.seconds * 1000).toLocaleString() 
        : 'Щойно';
      
      const row = document.createElement('div');
      row.className = 'session-row';
      row.style.cursor = 'pointer';
      row.innerHTML = `
        <span>📅 ${dateStr}</span>
        <span>❓ ${data.questionsCount || 0}</span>
        <strong style="color: #03dac6; font-size: 1.1em; letter-spacing: 1px;">${data.code}</strong>
      `;

      // При кліку відкриваємо модалку введення пароля для вибраної сесії
      row.onclick = () => {
        selectedSessionCode = data.code;
        selectedSessionDocId = docSnap.id;
        openSessionPasswordModal(data.code);
      };

      listContainer.appendChild(row);
    });
  } catch (error) {
    console.error('Помилка завантаження сесій:', error);
    listContainer.innerHTML = '<div style="color: #cf6679; text-align: center;">Не вдалося завантажити сесії</div>';
  }
}

// Відкриття модалки введення пароля для архівного рядка
function openSessionPasswordModal(code) {
  const modal = document.getElementById('sessionPasswordModal');
  const input = document.getElementById('sessionPasswordInput');
  input.value = '';
  input.type = 'password';
  document.getElementById('toggleSessionPasswordBtn').innerText = '👁️';
  document.getElementById('sessionErrorMsg').style.display = 'none';
  
  document.getElementById('targetSessionCode').innerText = `(${code})`;

  modal.style.display = 'flex';
  input.focus();
}

// Перевірка пароля сесії з архіву
window.verifySessionPassword = async function () {
  const inputPassword = document.getElementById('sessionPasswordInput').value.trim();
  const errorMsg = document.getElementById('sessionErrorMsg');

  try {
    const docRef = doc(db, 'sessions', selectedSessionDocId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const sessionData = docSnap.data();
      if (sessionData.password === inputPassword) {
        localStorage.setItem('currentSessionCode', selectedSessionCode);
        localStorage.setItem('isAdmin', 'true');
        window.location.href = `./admin/index.html?room=${selectedSessionCode}`;
        return;
      }
    }

    errorMsg.style.display = 'block';
    document.getElementById('sessionPasswordInput').focus();
  } catch (error) {
    console.error('Помилка перевірки пароля сесії:', error);
    errorMsg.style.display = 'block';
  }
};

// 3. Підключення гравця за 4-значним кодом
window.verifyAndJoinGame = async function () {
  const codeInput = document.getElementById('joinCodeInput');
  const code = codeInput.value.trim().toUpperCase();
  const errorMsg = document.getElementById('joinErrorMsg');

  if (code.length !== 4) {
    errorMsg.innerText = 'Код має містити рівно 4 символи!';
    errorMsg.style.display = 'block';
    return;
  }

  try {
    const querySnapshot = await getDocs(collection(db, 'sessions'));
    let found = false;

    querySnapshot.forEach((docSnap) => {
      if (docSnap.data().code === code) {
        found = true;
      }
    });

    if (!found) {
      errorMsg.innerText = 'Кімнату з таким кодом не знайдено!';
      errorMsg.style.display = 'block';
      codeInput.focus();
    } else {
      localStorage.setItem('currentSessionCode', code);
      window.location.href = `./player/index.html?room=${code}`;
    }
  } catch (error) {
    console.error('Помилка перевірки коду:', error);
    errorMsg.innerText = 'Помилка підключення до бази!';
    errorMsg.style.display = 'block';
  }
};

// Загальний обробник клавіші Enter
window.handleKeyPress = function (event, type) {
  if (event.key === 'Enter') {
    if (type === 'create') {
      window.createGameSession();
    } else if (type === 'join') {
      window.verifyAndJoinGame();
    } else if (type === 'sessionLogin') {
      window.verifySessionPassword();
    }
  }
};