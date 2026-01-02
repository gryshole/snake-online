const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "super_secret_snake_key_123";
const MONGO_URI = process.env.MONGO_URL; 

if (!MONGO_URI) {
    console.error("ERROR: MONGO_URL is not set!");
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('✅ Connected to MongoDB Atlas'))
        .catch(err => console.error('❌ MongoDB Connection Error:', err));
}

// --- SCHEMAS ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    elo: { type: Number, default: 1000 },
    isAdmin: { type: Boolean, default: false }, // НОВЕ ПОЛЕ: Адмін
    design: {
        bodyColor: { type: String, default: "#39ff14" },
        eyeColor: { type: String, default: "#000000" }
    }
});

const matchSchema = new mongoose.Schema({
    date: { type: Date, default: Date.now },
    p1: String,
    p2: String,
    score1: Number,
    score2: Number,
    winner: String,
    eloChange: Number,
    mode: String 
});

const User = mongoose.model('User', userSchema);
const Match = mongoose.model('Match', matchSchema);

function calculateEloChange(ratingA, ratingB, actualScoreA, k = 32) {
    const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
    return Math.round(k * (actualScoreA - expectedA));
}

// --- ROUTES ---

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const existingUser = await User.findOne({ username: username });
        if (existingUser) return res.json({ success: false, message: "USER_EXISTS" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({ username, password: hashedPassword, elo: 1000, isAdmin: false });
        await newUser.save();

        const token = jwt.sign({ id: newUser._id, username: newUser.username }, JWT_SECRET, { expiresIn: '5d' });

        // Повертаємо isAdmin
        res.json({ success: true, token, username: newUser.username, design: newUser.design, elo: newUser.elo, isAdmin: newUser.isAdmin });
    } catch (error) {
        res.json({ success: false, message: "SERVER_ERROR" });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username: username });
        if (!user) return res.json({ success: false, message: "USER_NOT_FOUND" });

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.json({ success: false, message: "WRONG_PASSWORD" });

        const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '5d' });

        // Повертаємо isAdmin
        res.json({ success: true, token, design: user.design, elo: user.elo, isAdmin: user.isAdmin });
    } catch (error) {
        res.json({ success: false, message: "SERVER_ERROR" });
    }
});

app.post('/api/verify-token', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.json({ success: false });

        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.id);
        if (!user) return res.json({ success: false });

        // Повертаємо isAdmin
        res.json({ 
            success: true, 
            username: user.username, 
            design: user.design, 
            elo: user.elo,
            isAdmin: user.isAdmin 
        });
    } catch (error) {
        res.json({ success: false });
    }
});

app.post('/api/profile', async (req, res) => {
    try {
        const { username } = req.body;
        const user = await User.findOne({ username: username });
        if (!user) return res.json({ success: false });

        const matches = await Match.find({
            $or: [{ p1: username }, { p2: username }]
        }).sort({ date: -1 }).limit(50);

        res.json({ success: true, elo: user.elo, design: user.design, history: matches });
    } catch (error) {
        res.json({ success: false });
    }
});

app.post('/api/update-design', async (req, res) => {
    try {
        const { username, design } = req.body;
        await User.updateOne({ username: username }, { design: design });
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false });
    }
});

app.get('/api/history', async (req, res) => {
    try {
        const matches = await Match.find().sort({ date: -1 }).limit(20);
        res.json(matches);
    } catch (error) {
        res.json([]);
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const leaders = await User.find({}, 'username elo').sort({ elo: -1 }).limit(10);
        res.json(leaders);
    } catch (error) {
        res.json([]);
    }
});

// --- GAME SOCKETS ---
let rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    socket.emit('roomsList', getPublicRooms());

    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        const settings = data.settings || { fps: 10, gridSize: 25, winScore: 20, penalty: 2 };

        rooms[roomId] = {
            id: roomId,
            players: [],
            status: 'waiting',
            timer: 5,
            config: settings,
            mode: 'pvp', 
            gameState: createInitialGameState(parseInt(settings.gridSize)),
            gameInterval: null
        };

        joinPlayerToRoom(socket, roomId, data.userData, 'p1');
        
        // --- ADMIN CHECK ---
        // Якщо адмін, запускаємо гру одразу (без другого гравця)
        if (data.userData.isAdmin) {
            console.log(`Admin ${data.userData.nick} started game alone in room ${roomId}`);
            startCountdown(roomId);
            // Не оновлюємо список кімнат, бо вона зразу стане 'playing'
        } else {
            io.emit('roomsList', getPublicRooms());
        }
    });

    socket.on('joinRoom', (data) => {
        const room = rooms[data.roomId];
        if (room && room.status === 'waiting' && room.players.length < 2) {
            joinPlayerToRoom(socket, data.roomId, data.userData, 'p2');
            if (room.players.length === 2) startCountdown(data.roomId);
            io.emit('roomsList', getPublicRooms());
        } else {
            socket.emit('errorMsg', "ROOM_NOT_FOUND");
        }
    });

    socket.on('input', (data) => {
        const roomId = getRoomIdBySocket(socket.id);
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        if (room.status !== 'playing') return;

        const playerRole = room.players.find(p => p.id === socket.id)?.role;
        if (!playerRole) return;
        const p = room.gameState[playerRole];

        if (data.xv === 1 && p.xv === -1) return;
        if (data.xv === -1 && p.xv === 1) return;
        if (data.yv === 1 && p.yv === -1) return;
        if (data.yv === -1 && p.yv === 1) return;

        p.xv = data.xv;
        p.yv = data.yv;
        if (data.xv !== 0 || data.yv !== 0) {
            p.facingX = data.xv;
            p.facingY = data.yv;
        }
    });

    socket.on('updateDesign', (data) => {
        const roomId = getRoomIdBySocket(socket.id);
        if (roomId && rooms[roomId]) {
            const playerRole = rooms[roomId].players.find(p => p.id === socket.id)?.role;
            if (playerRole) {
                rooms[roomId].gameState[playerRole].design = data.design;
                io.to(roomId).emit('gameState', rooms[roomId].gameState);
            }
        }
    });

    socket.on('disconnect', () => {
        const roomId = getRoomIdBySocket(socket.id);
        if (roomId && rooms[roomId]) {
            io.to(roomId).emit('playerLeft');
            closeRoom(roomId);
        }
    });
});

function joinPlayerToRoom(socket, roomId, userData, role) {
    const room = rooms[roomId];
    room.players.push({ 
        id: socket.id, 
        nick: userData.nick, 
        role: role,
        elo: userData.elo || 1000 
    });
    socket.join(roomId);
    
    room.gameState[role].design = userData.design;
    room.gameState[role].nick = userData.nick;

    socket.emit('roomJoined', { roomId: roomId, role: role, config: room.config });
    io.to(roomId).emit('updateLobby', { players: room.players });
}

function startCountdown(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    room.status = 'countdown';
    room.timer = 5;
    room.mode = 'pvp'; 

    let countdownInterval = setInterval(() => {
        if (!rooms[roomId]) { clearInterval(countdownInterval); return; }
        io.to(roomId).emit('countdown', room.timer);
        room.timer--;
        if (room.timer < 0) {
            clearInterval(countdownInterval);
            startGameLoop(roomId);
        }
    }, 1000);
}

function startGameLoop(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    room.status = 'playing';
    io.to(roomId).emit('gameStart');

    const fps = parseInt(room.config.fps);
    const intervalTime = 1000 / fps;

    room.gameInterval = setInterval(() => {
        if (!rooms[roomId]) { clearInterval(room.gameInterval); return; }
        updateRoomPhysics(room);
        io.to(roomId).emit('gameState', room.gameState);
        checkWinCondition(room);
    }, intervalTime);
}

function updateRoomPhysics(room) {
    const state = room.gameState;
    const size = parseInt(room.config.gridSize);
    const penalty = parseInt(room.config.penalty);

    ['p1', 'p2'].forEach(key => {
        const p = state[key];
        if (p.trail.length === 0 && p.tail > 0) {
            for(let i=0; i<p.tail; i++) p.trail.push({x: p.x - (p.facingX * i), y: p.y - (p.facingY * i)});
        }
    });

    [state.p1, state.p2].forEach(p => {
        if (p.xv === 0 && p.yv === 0) return;
        if (p.immunity > 0) p.immunity--;

        p.x += p.xv;
        p.y += p.yv;

        let collisionHappened = false;
        let collisionReason = "";

        if (p.x < 0) { p.x = size - 1; collisionHappened = true; collisionReason = "WALL_HIT"; }
        if (p.x >= size) { p.x = 0; collisionHappened = true; collisionReason = "WALL_HIT"; }
        if (p.y < 0) { p.y = size - 1; collisionHappened = true; collisionReason = "WALL_HIT"; }
        if (p.y >= size) { p.y = 0; collisionHappened = true; collisionReason = "WALL_HIT"; }

        if (!collisionHappened && p.immunity === 0) {
            if (checkTrailCollision(p.x, p.y, p.trail)) {
                collisionHappened = true; collisionReason = "SELF_BITE";
            }
            const enemy = (p === state.p1) ? state.p2 : state.p1;
            if (checkTrailCollision(p.x, p.y, enemy.trail)) {
                collisionHappened = true; collisionReason = "ENEMY_COLLISION";
            }
        }

        if (collisionHappened && p.immunity === 0) {
            applyPenalty(p, penalty);
            io.to(room.id).emit('collisionEvent', { playerNick: p.nick, reasonCode: collisionReason, color: p.design.bodyColor });
        }

        p.trail.push({x: p.x, y: p.y});
        while (p.trail.length > p.tail) p.trail.shift();

        state.apples.forEach(apple => {
            if (p.x === apple.x && p.y === apple.y) {
                p.tail++;
                p.score++;
                let valid = false;
                while(!valid) {
                    apple.x = Math.floor(Math.random() * size);
                    apple.y = Math.floor(Math.random() * size);
                    valid = true; 
                }
            }
        });
    });
}

function checkTrailCollision(x, y, trail) {
    for (let t of trail) {
        if (x === t.x && y === t.y) return true;
    }
    return false;
}

function applyPenalty(p, divisor) {
    p.tail = Math.floor(p.tail / divisor);
    if (p.tail < 1) p.tail = 1;
    p.score = Math.floor(p.score / divisor);
    while (p.trail.length > p.tail) p.trail.shift();
    p.immunity = 15;
}

function checkWinCondition(room) {
    const goal = parseInt(room.config.winScore);
    const p1 = room.gameState.p1;
    const p2 = room.gameState.p2;
    if (p1.score >= goal && p2.score >= goal) finishGame(room, "DRAW");
    else if (p1.score >= goal) finishGame(room, p1.nick);
    else if (p2.score >= goal) finishGame(room, p2.nick);
}

async function finishGame(room, winnerName) {
    clearInterval(room.gameInterval);
    room.status = 'finished';

    let eloChange = 0;
    
    // БЕЗПЕЧНА ПЕРЕВІРКА: Чи є обидва гравці (для ELO)
    // Якщо грав адмін сам, то гравців < 2, і ми не рахуємо ELO
    if (winnerName !== "DRAW" && room.players.length === 2) {
        const player1Data = room.players.find(p => p.role === 'p1');
        const player2Data = room.players.find(p => p.role === 'p2');

        if (player1Data && player2Data) {
            const isP1Winner = winnerName === player1Data.nick;
            const actualScoreP1 = isP1Winner ? 1 : 0;
            
            eloChange = calculateEloChange(player1Data.elo, player2Data.elo, actualScoreP1);

            try {
                await User.updateOne({ username: player1Data.nick }, { $inc: { elo: eloChange } });
                await User.updateOne({ username: player2Data.nick }, { $inc: { elo: -eloChange } });
            } catch (e) {
                console.error("ELO Update Error", e);
            }
        }
    }

    io.to(room.id).emit('gameOver', { winner: winnerName, eloChange: Math.abs(eloChange) });

    // Зберігаємо матч. Якщо P2 немає, пишемо "Bot/Empty"
    const p2Nick = room.players.length > 1 ? room.players.find(p => p.role === 'p2').nick : "Training Dummy";
    
    const match = new Match({
        p1: room.players.length > 0 ? room.players[0].nick : "Unknown",
        p2: p2Nick,
        score1: room.gameState.p1.score,
        score2: room.gameState.p2.score,
        winner: winnerName,
        eloChange: Math.abs(eloChange),
        mode: room.mode
    });

    match.save().then(() => console.log('Match saved'));
}

function closeRoom(roomId) {
    const room = rooms[roomId];
    if (room && room.gameInterval) clearInterval(room.gameInterval);
    io.to(roomId).emit('playerLeft');
    delete rooms[roomId];
    io.emit('roomsList', getPublicRooms());
}

function getPublicRooms() {
    let list = [];
    for (let id in rooms) {
        if (rooms[id].status === 'waiting' && rooms[id].players.length === 1) {
            const creator = rooms[id].players[0];
            list.push({ id: id, creator: creator.nick, creatorElo: creator.elo, config: rooms[id].config });
        }
    }
    return list;
}

function getRoomIdBySocket(socketId) {
    for (let id in rooms) {
        if (rooms[id].players.find(p => p.id === socketId)) return id;
    }
    return null;
}

function createInitialGameState(gridSize) {
    const midY = Math.floor(gridSize / 2);
    const startX1 = Math.floor(gridSize * 0.2);
    const startX2 = Math.floor(gridSize * 0.8);
    let trail1 = []; for(let i = 2; i >= 0; i--) trail1.push({ x: startX1 - i, y: midY });
    let trail2 = []; for(let i = 2; i >= 0; i--) trail2.push({ x: startX2 + i, y: midY });

    return {
        p1: { x: startX1, y: midY, xv: 0, yv: 0, facingX: 1, facingY: 0, trail: trail1, tail: 3, score: 0, immunity: 0, nick: "", design: {} },
        p2: { x: startX2, y: midY, xv: 0, yv: 0, facingX: -1, facingY: 0, trail: trail2, tail: 3, score: 0, immunity: 0, nick: "", design: {} },
        apples: [{x: midY, y: midY - 2}, {x: midY, y: midY + 2}]
    };
}

server.listen(PORT, () => {
  console.log(`SERVER RUNNING ON PORT ${PORT}`);
});