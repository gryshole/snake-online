// --- AUDIO SYSTEM ---
const sounds = {
    count: new Audio('/sounds/count.mp3'),
    game: new Audio('/sounds/game.mp3')
};

// Налаштування: зациклення та гучність

sounds.game.loop = true;
sounds.game.volume = 0.3; // 30% гучності (тихіше, щоб не відволікати)

sounds.count.loop = false; // Грає один раз
sounds.count.volume = 0.8;

let currentMusic = null;

function playMusic(trackName) {
    // 1. Зупиняємо поточну музику (якщо грає інша)
    if (currentMusic && currentMusic !== sounds[trackName]) {
        currentMusic.pause();
        currentMusic.currentTime = 0; // Перемотати на початок
    }

    // 2. Якщо це та сама музика і вона вже грає — нічого не робимо
    if (currentMusic === sounds[trackName] && !currentMusic.paused) return;

    // 3. Запускаємо нову
    if (sounds[trackName]) {
        currentMusic = sounds[trackName];
        // play() повертає проміс, обробляємо помилку (якщо браузер заблокував)
        currentMusic.play().catch(e => console.log("Audio play blocked:", e));
    }
}

function stopMusic() {
    if (currentMusic) {
        currentMusic.pause();
        currentMusic.currentTime = 0;
        currentMusic = null;
    }
}

const translations = {
    en: {
        TITLE: "NEON SNAKE", BODY: "Body", EYES: "Eyes", BTN_ENTER: "ENTER", BTN_LOGIN: "LOGIN", BTN_REGISTER: "REGISTER", BTN_LOGOUT: "LOGOUT",
        LOBBY_TITLE: "Lobby", BTN_CREATE: "CREATE GAME", BTN_JOIN: "JOIN", BTN_HISTORY: "HISTORY", BTN_LEADERS: "LEADERS", BTN_BACK: "BACK", BTN_PROFILE: "PROFILE",
        LBL_SPEED: "Speed", LBL_SIZE: "Size", LBL_GOAL: "Goal", LBL_PENALTY: "Penalty", LBL_ROOMS: "AVAILABLE ROOMS:", LBL_ELO: "CURRENT RATING",
        OPT_SLOW: "Slow (7)", OPT_NORMAL: "Normal (10)", OPT_FAST: "Fast (15)", 
        OPT_SMALL: "Small (15x15)", OPT_MEDIUM: "Medium (25x25)", OPT_LARGE: "Large (40x40)",
        OPT_HALF: "Half (1/2)", OPT_THIRD: "Third (1/3)", OPT_QUARTER: "Quarter (1/4)",
        WAITING_TITLE: "WAITING", WAITING_STATUS: "Waiting for opponent...", GAMEOVER_TITLE: "GAME OVER", BTN_MENU: "MENU", 
        STATUS_WAITING: "Waiting...", STATUS_PLAY: "PLAY!", WALL_HIT: "WALL HIT", SELF_BITE: "SELF BITE", ENEMY_COLLISION: "ACCIDENT", 
        WINNER: "WINNER", DRAW: "DRAW", OPPONENT_LEFT: "Opponent left.", NO_ROOMS: "No rooms.", PH_USER: "USERNAME", PH_PASS: "PASSWORD",
        ERR_PASS_MATCH: "Mismatch", ERR_USER_EXISTS: "User exists", ERR_WRONG_PASS: "Wrong pass", ERR_USER_NOT_FOUND: "Not found",
        TBL_DATE: "DATE", TBL_PLAYERS: "MATCH", TBL_SCORE: "SCORE", TBL_WINNER: "WINNER", TBL_ELO: "ELO"
    },
    uk: {
        TITLE: "НЕОНОВА ЗМІЙКА", BODY: "Тіло", EYES: "Очі", BTN_ENTER: "УВІЙТИ", BTN_LOGIN: "ВХІД", BTN_REGISTER: "РЕЄСТРАЦІЯ", BTN_LOGOUT: "ВИЙТИ",
        LOBBY_TITLE: "Лобі", BTN_CREATE: "СТВОРИТИ ГРУ", BTN_JOIN: "ГРАТИ", BTN_HISTORY: "ІСТОРІЯ", BTN_LEADERS: "ТОП", BTN_BACK: "НАЗАД", BTN_PROFILE: "ПРОФІЛЬ",
        LBL_SPEED: "Швидкість", LBL_SIZE: "Розмір", LBL_GOAL: "Ціль", LBL_PENALTY: "Штраф", LBL_ROOMS: "ДОСТУПНІ КІМНАТИ:", LBL_ELO: "ПОТОЧНИЙ РЕЙТИНГ",
        OPT_SLOW: "Повільно (7)", OPT_NORMAL: "Нормально (10)", OPT_FAST: "Швидко (15)", 
        OPT_SMALL: "Мале (15x15)", OPT_MEDIUM: "Середнє (25x25)", OPT_LARGE: "Велике (40x40)",
        OPT_HALF: "Половина (1/2)", OPT_THIRD: "Третина (1/3)", OPT_QUARTER: "Чверть (1/4)",
        WAITING_TITLE: "ОЧІКУВАННЯ", WAITING_STATUS: "Чекаємо суперника...", GAMEOVER_TITLE: "ГРУ ЗАВЕРШЕНО", BTN_MENU: "В МЕНЮ", 
        STATUS_WAITING: "Очікування...", STATUS_PLAY: "ГРАЙТЕ!", WALL_HIT: "СТІНА", SELF_BITE: "СЕБЕ", ENEMY_COLLISION: "АВАРІЯ", 
        WINNER: "ПЕРЕМІГ", DRAW: "НІЧИЯ", OPPONENT_LEFT: "Суперник вийшов.", NO_ROOMS: "Немає кімнат.", PH_USER: "НІКНЕЙМ", PH_PASS: "ПАРОЛЬ",
        ERR_PASS_MATCH: "Різні паролі", ERR_USER_EXISTS: "Вже існує", ERR_WRONG_PASS: "Невірний пароль", ERR_USER_NOT_FOUND: "Не знайдено",
        TBL_DATE: "ДАТА", TBL_PLAYERS: "МАТЧ", TBL_SCORE: "РАХУНОК", TBL_WINNER: "ПЕРЕМОЖЕЦЬ", TBL_ELO: "РЕЙТИНГ"
    }
};

let currentLang = 'en';
const socket = io();
const canvas = document.getElementById("gc");
const ctx = canvas.getContext("2d");

// Додав isAdmin в дефолтні дані
let myData = { nick: "", elo: 1000, isAdmin: false, design: { bodyColor: "#39ff14", eyeColor: "#000000" } };
let currentRoomConfig = { gridSize: 25 }; 

window.onload = async () => {
    initLanguage();
    
    // Auto Login Check
    const token = localStorage.getItem('snakeToken');
    if (token) {
        try {
            const res = await fetch('/api/verify-token', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ token: token })
            });
            const data = await res.json();
            
            if (data.success) {
                myData.nick = data.username;
                myData.design = data.design;
                myData.elo = data.elo;
                myData.isAdmin = data.isAdmin; // Отримуємо статус адміна
                enterLobby();
                return;
            }
        } catch (e) {
            console.log("Auto-login failed");
        }
    }
};

function switchAuthTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    document.getElementById('form-login').classList.add('hidden');
    document.getElementById('form-register').classList.add('hidden');
    document.getElementById('form-' + tab).classList.remove('hidden');
}

async function doRegister() {
    const user = document.getElementById('reg-user').value.trim();
    const pass = document.getElementById('reg-pass').value;
    const pass2 = document.getElementById('reg-pass2').value;
    if(pass !== pass2) { document.getElementById('reg-error').innerText = t('ERR_PASS_MATCH'); return; }
    
    const res = await fetch('/api/register', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ username: user, password: pass }) });
    const data = await res.json();
    
    if(data.success) { 
        localStorage.setItem('snakeToken', data.token);
        myData.nick = user; myData.design = data.design; myData.elo = data.elo; myData.isAdmin = data.isAdmin;
        enterLobby();
    } else { document.getElementById('reg-error').innerText = t(data.message); }
}

async function doLogin() {
    const user = document.getElementById('login-user').value.trim();
    const pass = document.getElementById('login-pass').value;
    
    const res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ username: user, password: pass }) });
    const data = await res.json();
    
    if(data.success) {
        localStorage.setItem('snakeToken', data.token);
        myData.nick = user; myData.design = data.design; myData.elo = data.elo; myData.isAdmin = data.isAdmin;
        enterLobby();
    } else { document.getElementById('login-error').innerText = t(data.message); }
}

function enterLobby() {
    document.getElementById('welcome-msg').innerText = `${t('LOBBY_TITLE')} (${myData.nick})`;
    // Якщо адмін, можна показати позначку, але для тестів це не обов'язково
    document.getElementById('my-elo-display').innerText = `ELO: ${myData.elo}`;
    document.getElementById('inp-body').value = myData.design.bodyColor;
    document.getElementById('inp-eye').value = myData.design.eyeColor;
    switchView('view-lobby');
}

function logout() { localStorage.removeItem('snakeToken'); location.reload(); }

async function saveDesign() {
    myData.design.bodyColor = document.getElementById('inp-body').value;
    myData.design.eyeColor = document.getElementById('inp-eye').value;
    await fetch('/api/update-design', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ username: myData.nick, design: myData.design }) });
}

async function loadProfile() {
    switchView('view-list');
    document.getElementById('profile-stats').classList.remove('hidden');
    document.getElementById('list-title').innerText = myData.nick.toUpperCase();
    
    const res = await fetch('/api/profile', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ username: myData.nick }) });
    const data = await res.json();
    
    if(data.success) {
        document.getElementById('profile-elo').innerText = data.elo;
        myData.elo = data.elo; 
        
        document.getElementById('list-head').innerHTML = `<tr><th>${t('TBL_DATE')}</th><th>${t('TBL_PLAYERS')}</th><th>${t('TBL_SCORE')}</th><th>${t('TBL_WINNER')}</th></tr>`;
        const tbody = document.getElementById('list-body'); tbody.innerHTML = "";
        
        if(data.history.length === 0) tbody.innerHTML = "<tr><td colspan='4'>No games played</td></tr>";
        
        data.history.forEach(m => {
            const date = new Date(m.date).toLocaleDateString();
            const winnerClass = m.winner === myData.nick ? 'win-text' : '';
            tbody.innerHTML += `<tr><td>${date}</td><td>${m.p1} vs ${m.p2}</td><td>${m.score1}:${m.score2}</td><td class="${winnerClass}">${m.winner}</td></tr>`;
        });
    }
}

async function loadHistory() {
    switchView('view-list');
    document.getElementById('profile-stats').classList.add('hidden');
    document.getElementById('list-title').innerText = t('BTN_HISTORY');
    document.getElementById('list-head').innerHTML = `<tr><th>${t('TBL_DATE')}</th><th>${t('TBL_PLAYERS')}</th><th>${t('TBL_SCORE')}</th><th>${t('TBL_WINNER')}</th></tr>`;
    const tbody = document.getElementById('list-body'); tbody.innerHTML = "Loading...";
    const res = await fetch('/api/history'); const matches = await res.json();
    tbody.innerHTML = "";
    matches.forEach(m => {
        const date = new Date(m.date).toLocaleDateString();
        const winnerClass = m.winner === myData.nick ? 'win-text' : '';
        tbody.innerHTML += `<tr><td>${date}</td><td>${m.p1} vs ${m.p2}</td><td>${m.score1}:${m.score2}</td><td class="${winnerClass}">${m.winner}</td></tr>`;
    });
}

async function loadLeaderboard() {
    switchView('view-list');
    document.getElementById('profile-stats').classList.add('hidden');
    document.getElementById('list-title').innerText = "LEADERS";
    document.getElementById('list-head').innerHTML = `<tr><th>#</th><th>PLAYER</th><th>${t('TBL_ELO')}</th></tr>`;
    const tbody = document.getElementById('list-body'); tbody.innerHTML = "Loading...";
    const res = await fetch('/api/leaderboard'); const users = await res.json();
    tbody.innerHTML = "";
    users.forEach((u, i) => {
        tbody.innerHTML += `<tr><td>${i+1}</td><td>${u.username}</td><td style="color:#f1c40f">${u.elo}</td></tr>`;
    });
}

function createRoom() {
    const settings = { fps: document.getElementById('set-fps').value, gridSize: document.getElementById('set-size').value, winScore: document.getElementById('set-goal').value, penalty: document.getElementById('set-penalty').value };
    // Відправляємо дані про юзера, включаючи isAdmin
    socket.emit('createRoom', { userData: myData, settings: settings });
}
function joinRoom(id) { socket.emit('joinRoom', { roomId: id, userData: myData }); }

socket.on('roomsList', (list) => {
    const container = document.getElementById('room-list'); container.innerHTML = "";
    if(list.length === 0) { container.innerHTML = `<div style='text-align:center; padding:20px; color:#555'>${t('NO_ROOMS')}</div>`; return; }
    list.forEach(r => {
        container.innerHTML += `<div class="room-item"><div><b style="color:#fff">${r.creator}</b> <span class="elo-badge">${r.creatorElo}</span></div><button class="btn-join" onclick="joinRoom('${r.id}')">${t('BTN_JOIN')}</button></div>`;
    });
});

socket.on('roomJoined', (data) => {
    currentRoomConfig = data.config;
    document.getElementById('display-room-id').innerText = data.roomId;
    switchView('view-waiting');
    if (data.role === 'p2') document.getElementById('waiting-text').innerText = t('CONNECTED');
});

socket.on('updateLobby', (data) => { if (data.players.length === 2) document.getElementById('waiting-text').innerText = "READY!"; });
socket.on('countdown', (num) => {
    document.getElementById('menu-overlay').classList.add('hidden');
    const ov = document.getElementById('countdown-overlay');
    ov.style.display = 'block';
    ov.innerText = num;
    
    // Вмикаємо звук тільки на початку відліку (коли 5)
    if (num === 5) playMusic('count');
});
socket.on('gameStart', () => {
    document.getElementById('countdown-overlay').style.display = 'none';
    document.getElementById('game-status').innerText = t('STATUS_PLAY');
    
    playMusic('game'); // <--- ДОДАНО ТУТ
});
socket.on('gameState', (state) => { drawGame(state); updateHUD(state); });
socket.on('collisionEvent', (data) => {
    const el = document.getElementById('game-status'); el.innerText = `${data.playerNick}: ${t(data.reasonCode)}!`; el.style.color = data.color;
    setTimeout(() => { el.innerText = t('STATUS_PLAY'); el.style.color = "white"; }, 1500);
});

socket.on('gameOver', (data) => {
    document.getElementById('menu-overlay').classList.remove('hidden'); switchView('view-gameover');
	stopMusic();
    const el = document.getElementById('win-msg');
    el.innerText = (data.winner === 'DRAW') ? t('DRAW') : `${t('WINNER')} ${data.winner}!`;
    el.style.color = (data.winner === 'DRAW') ? "white" : "#39ff14";
    
    if(data.eloChange && data.winner !== 'DRAW') {
        const isWin = data.winner === myData.nick;
        const sign = isWin ? '+' : '-';
        const color = isWin ? '#39ff14' : 'red';
        document.getElementById('elo-msg').innerHTML = `<span style="color:${color}">ELO ${sign}${data.eloChange}</span>`;
    } else {
        document.getElementById('elo-msg').innerText = "";
    }
});

socket.on('playerLeft', () => { alert(t('OPPONENT_LEFT')); location.reload(); });
socket.on('errorMsg', (msg) => alert(t(msg) || msg));

function drawGame(state) {
    const size = parseInt(currentRoomConfig.gridSize);
    const gs = 600 / size; // Grid Size in pixels

    // 1. Фон
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Сітка (робимо її ледь помітною)
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1;
    for(let i=0; i<size; i++) {
        ctx.beginPath(); ctx.moveTo(i*gs, 0); ctx.lineTo(i*gs, 600); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i*gs); ctx.lineTo(600, i*gs); ctx.stroke();
    }

    // 3. Яблука
    state.apples.forEach(a => drawApple(a.x, a.y, gs));

    // 4. Гравці
    drawSnake(state.p1, gs);
    drawSnake(state.p2, gs);
}

function drawSnake(p, gs) {
    // Вибір кольорів
    const bodyColor = (p.design && p.design.bodyColor) ? p.design.bodyColor : "#fff";
    const eyeColor = (p.design && p.design.eyeColor) ? p.design.eyeColor : "#000";

    // Ефект мигання при імунітеті (після удару)
    if (p.immunity > 0 && Math.floor(Date.now()/100)%2===0) {
        ctx.fillStyle = "#555"; 
        ctx.shadowBlur = 0;
    } else {
        ctx.fillStyle = bodyColor;
        ctx.shadowBlur = 15; // Неонове світіння
        ctx.shadowColor = bodyColor;
    }

    p.trail.forEach((t, i) => {
        // Малюємо заокруглений квадрат замість звичайного
        // x, y, size, radius
        const radius = gs * 0.25; // Радіус заокруглення = 25% від розміру клітинки
        drawRoundedRect(t.x * gs, t.y * gs, gs - 1, gs - 1, radius);

        // Якщо це останній елемент масиву - це ГОЛОВА, малюємо очі
        if (i === p.trail.length - 1) {
            drawEyes(t.x, t.y, gs, eyeColor, p.facingX, p.facingY);
        }
    });

    // Скидаємо ефекти тіні, щоб не впливали на інші елементи
    ctx.shadowBlur = 0;
}

// Допоміжна функція для малювання заокругленого квадрата
function drawRoundedRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
}

function drawEyes(x, y, gs, color, fx, fy) {
    ctx.fillStyle = color;
    ctx.shadowBlur = 0; // Очі не світяться, щоб були чіткими

    const eyeSize = gs / 5; // Розмір ока
    const offset = gs / 3.5; // Відступ від центру
    
    // Координати лівого верхнього кута клітинки в пікселях
    const px = x * gs;
    const py = y * gs;
    
    let ex1, ey1, ex2, ey2; // Координати двох очей

    // Логіка розміщення очей залежно від напрямку погляду (fx, fy)
    if (fx === 1) { // Дивиться ВПРАВО
        ex1 = px + gs - offset; ey1 = py + offset; 
        ex2 = px + gs - offset; ey2 = py + gs - offset;
    } 
    else if (fx === -1) { // Дивиться ВЛІВО
        ex1 = px + offset; ey1 = py + offset; 
        ex2 = px + offset; ey2 = py + gs - offset;
    } 
    else if (fy === -1) { // Дивиться ВГОРУ
        ex1 = px + offset; ey1 = py + offset;
        ex2 = px + gs - offset; ey2 = py + offset;
    } 
    else { // Дивиться ВНИЗ (або стоїть)
        ex1 = px + offset; ey1 = py + gs - offset;
        ex2 = px + gs - offset; ey2 = py + gs - offset;
    }

    ctx.beginPath(); ctx.arc(ex1, ey1, eyeSize, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(ex2, ey2, eyeSize, 0, Math.PI*2); ctx.fill();
}

function drawApple(x, y, gs) {
    const cx = x * gs + gs/2; // Центр по X
    const cy = y * gs + gs/2; // Центр по Y
    const r = gs/2 - 2;       // Радіус

    // 1. Тіло яблука (Червоне)
    ctx.fillStyle = "#ff0033"; 
    ctx.shadowColor = "#ff0033"; 
    ctx.shadowBlur = 15;
    
    ctx.beginPath(); 
    ctx.arc(cx, cy, r, 0, Math.PI*2); 
    ctx.fill(); 
    
    // 2. Хвостик (Зелений)
    ctx.shadowBlur = 0; // Хвостик без світіння
    ctx.fillStyle = "#2ecc71"; 
    // Малюємо прямокутник зверху по центру
    ctx.fillRect(cx - 2, cy - r - 2, 4, 6);
}

function updateHUD(state) {
    document.getElementById('p1-name').innerText = state.p1.nick;
    document.getElementById('s1').innerText = state.p1.score;
    if(state.p1.design) document.getElementById('s1').style.color = state.p1.design.bodyColor;

    document.getElementById('p2-name').innerText = state.p2.nick;
    document.getElementById('s2').innerText = state.p2.score;
    if(state.p2.design) document.getElementById('s2').style.color = state.p2.design.bodyColor;
}

function initLanguage() {
    const savedLang = localStorage.getItem('snakeLang');
    if (savedLang) currentLang = savedLang;
    else { const browserLang = navigator.language; if (browserLang.startsWith('uk')) currentLang = 'uk'; }
    updateTexts();
}
function toggleLanguage() { currentLang = (currentLang === 'en') ? 'uk' : 'en'; localStorage.setItem('snakeLang', currentLang); updateTexts(); }
function updateTexts() {
    document.getElementById('lang-switch').innerText = (currentLang === 'en') ? "🇬🇧 EN" : "🇺🇦 UK";
    document.querySelectorAll('[data-key]').forEach(el => { const key = el.getAttribute('data-key'); if (translations[currentLang][key]) el.innerText = translations[currentLang][key]; });
    document.querySelectorAll('[data-ph]').forEach(el => { const key = el.getAttribute('data-ph'); if (translations[currentLang][key]) el.placeholder = translations[currentLang][key]; });
}
function t(key) { return translations[currentLang][key] || key; }
function switchView(id) {
    document.querySelectorAll('.active').forEach(el => { if(el.id.startsWith('view-')) el.classList.remove('active'); el.classList.add('hidden'); });
    document.getElementById(id).classList.remove('hidden'); document.getElementById(id).classList.add('active');
}
document.addEventListener("keydown", (evt) => {
    let xv=0, yv=0;
    switch(evt.keyCode) { case 37: xv=-1; break; case 38: yv=-1; break; case 39: xv=1; break; case 40: yv=1; break; }
    if(xv||yv) socket.emit('input', {xv, yv});
});