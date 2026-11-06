import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  serverTimestamp,
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

let selectedSessionCode = '';

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

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

// Створення сесії без жодного дублювання в корені — все, що стосується гри, суворо всередині gameSettings
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
    const sessionRef = doc(db, 'sessions', roomCode);
    
    const existing = await getDoc(sessionRef);
    if (existing.exists()) {
      window.createGameSession();
      return;
    }

    await setDoc(sessionRef, {
      password: sessionPassword,
      createdAt: serverTimestamp(),
      questionsCount: 0,
      currentRound: 1,
      gameSettings: {
        gameView: 'BOARD',
        phase: 'SUBMIT',
        showBoardToPlayers: false,
        showQuestion: false,
        showVoters: false,
        timerSeconds: 20,
        timerStartTime: 0,
        timerState: 'idle',
        autoBoardUpdate: false,
        finishOnLastPlayer: false,
        halfVoteTime: false
      }
    });

    localStorage.setItem('currentSessionCode', roomCode);
    localStorage.setItem('isAdmin', 'true');
    window.location.href = `./admin/index.html?room=${roomCode}`;
  } catch (error) {
    console.error('Помилка створення сесії:', error);
    alert('Сталася помилка при створенні сесії.');
  }
};

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
      const roomCode = docSnap.id;
      const dateStr = data.createdAt
        ? new Date(data.createdAt.seconds * 1000).toLocaleString()
        : 'Щойно';
     
      const row = document.createElement('div');
      row.className = 'session-row';
      row.style.cursor = 'pointer';
      row.innerHTML = `
        <span>📅 ${dateStr}</span>
        <span>❓ ${data.questionsCount || 0}</span>
        <strong style="color: #03dac6; font-size: 1.1em; letter-spacing: 1px;">${roomCode}</strong>
      `;
      
      row.onclick = () => {
        selectedSessionCode = roomCode;
        openSessionPasswordModal(roomCode);
      };
      listContainer.appendChild(row);
    });
  } catch (error) {
    console.error('Помилка завантаження сесій:', error);
    listContainer.innerHTML = '<div style="color: #cf6679; text-align: center;">Не вдалося завантажити сесії</div>';
  }
}

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

window.verifySessionPassword = async function () {
  const inputPassword = document.getElementById('sessionPasswordInput').value.trim();
  const errorMsg = document.getElementById('sessionErrorMsg');
  
  try {
    const docRef = doc(db, 'sessions', selectedSessionCode);
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
    const docRef = doc(db, 'sessions', code);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
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