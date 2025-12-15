const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// Serve the index.html file
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Use the port provided by the cloud host or 3000 for local development
const PORT = process.env.PORT || 3000;

// --- GLOBAL VARIABLES ---
const GRID_SIZE = 25;
const GAME_SPEED = 1000 / 10; // 10 FPS

// Room storage: { "roomID": { players: [], gameState: {}, status: 'waiting'/'countdown'/'playing' } }
let rooms = {};

// --- SOCKET.IO HANDLERS ---
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. Send the list of available rooms to the new user
    socket.emit('roomsList', getPublicRooms());

    // 2. Create a new room
    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        
        // Read settings or use defaults
        const settings = data.settings || {
            fps: 10,
            gridSize: 25,
            winScore: 20,
            penalty: 2 
        };

        rooms[roomId] = {
            id: roomId,
            players: [],
            status: 'waiting',
            timer: 5,
            config: settings, // Store room configuration
            gameState: createInitialGameState(parseInt(settings.gridSize)),
            gameInterval: null
        };

        joinPlayerToRoom(socket, roomId, data.userData, 'p1');
        
        // Update room list for everyone in the lobby
        io.emit('roomsList', getPublicRooms());
    });

    // 3. Join an existing room
    socket.on('joinRoom', (data) => {
        const room = rooms[data.roomId];
        if (room && room.status === 'waiting' && room.players.length < 2) {
            joinPlayerToRoom(socket, data.roomId, data.userData, 'p2');
            
            // If room is full (2 players), start countdown
            if (room.players.length === 2) {
                startCountdown(data.roomId);
            }
            io.emit('roomsList', getPublicRooms());
        } else {
            socket.emit('errorMsg', "ROOM_NOT_FOUND");
        }
    });

    // 4. Handle input (movement)
    socket.on('input', (data) => {
        const roomId = getRoomIdBySocket(socket.id);
        if (!roomId || !rooms[roomId]) return;
        
        const room = rooms[roomId];
        if (room.status !== 'playing') return;

        const playerRole = room.players.find(p => p.id === socket.id)?.role;
        if (!playerRole) return;

        const p = room.gameState[playerRole];

        // Prevent 180-degree turns
        if (data.xv === 1 && p.xv === -1) return;
        if (data.xv === -1 && p.xv === 1) return;
        if (data.yv === 1 && p.yv === -1) return;
        if (data.yv === -1 && p.yv === 1) return;

        p.xv = data.xv;
        p.yv = data.yv;
        
        // Update facing direction for eyes rendering
        if (data.xv !== 0 || data.yv !== 0) {
            p.facingX = data.xv;
            p.facingY = data.yv;
        }
    });

    // 5. Update snake design (color/shape)
    socket.on('updateDesign', (data) => {
        const roomId = getRoomIdBySocket(socket.id);
        if (!roomId || !rooms[roomId]) return;
        
        const room = rooms[roomId];
        const playerRole = room.players.find(p => p.id === socket.id)?.role;
        
        if (playerRole) {
            room.gameState[playerRole].design = data.design;
            // Broadcast state to update visuals for opponents
            io.to(roomId).emit('gameState', room.gameState);
        }
    });

    // 6. Handle disconnect
    socket.on('disconnect', () => {
        const roomId = getRoomIdBySocket(socket.id);
        if (roomId && rooms[roomId]) {
            // If a player leaves, close the room
            io.to(roomId).emit('playerLeft');
            closeRoom(roomId);
        }
    });
});

// --- ROOM LOGIC ---

function joinPlayerToRoom(socket, roomId, userData, role) {
    const room = rooms[roomId];
    
    // Add player to room object
    room.players.push({
        id: socket.id,
        nick: userData.nick,
        role: role
    });

    socket.join(roomId);

    // Save design and nick to game state
    room.gameState[role].design = userData.design;
    room.gameState[role].nick = userData.nick;

    // Send join confirmation
    socket.emit('roomJoined', { roomId: roomId, role: role, config: room.config });
    
    // Notify others in the room
    io.to(roomId).emit('updateLobby', { players: room.players });
}

function startCountdown(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.status = 'countdown';
    room.timer = 5;

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
        
        // 1. Update Physics
        updateRoomPhysics(room);

        // 2. Broadcast State
        io.to(roomId).emit('gameState', room.gameState);

        // 3. Check Win Condition
        checkWinCondition(room);

    }, intervalTime);
}

function updateRoomPhysics(room) {
    const state = room.gameState;
    const size = parseInt(room.config.gridSize);
    const penalty = parseInt(room.config.penalty);

    // Initialize trail on first movement if empty
    ['p1', 'p2'].forEach(key => {
        const p = state[key];
        if (p.trail.length === 0 && p.tail > 0) {
            for(let i=0; i<p.tail; i++) p.trail.push({x: p.x - (p.facingX * i), y: p.y - (p.facingY * i)});
        }
    });

    [state.p1, state.p2].forEach(p => {
        if (p.xv === 0 && p.yv === 0) return; // Player is idle

        if (p.immunity > 0) p.immunity--;

        p.x += p.xv;
        p.y += p.yv;

        let collisionHappened = false;
        let collisionReason = ""; // Reason code for client translation

        // 1. WALLS (Teleport + Hit)
        if (p.x < 0) { p.x = size - 1; collisionHappened = true; collisionReason = "WALL_HIT"; }
        if (p.x >= size) { p.x = 0; collisionHappened = true; collisionReason = "WALL_HIT"; }
        if (p.y < 0) { p.y = size - 1; collisionHappened = true; collisionReason = "WALL_HIT"; }
        if (p.y >= size) { p.y = 0; collisionHappened = true; collisionReason = "WALL_HIT"; }

        // 2. TRAILS (Self & Enemy)
        if (!collisionHappened && p.immunity === 0) {
            // Self collision
            if (checkTrailCollision(p.x, p.y, p.trail)) {
                collisionHappened = true; collisionReason = "SELF_BITE";
            }
            // Enemy collision
            const enemy = (p === state.p1) ? state.p2 : state.p1;
            if (checkTrailCollision(p.x, p.y, enemy.trail)) {
                collisionHappened = true; collisionReason = "ENEMY_COLLISION";
            }
        }

        // Handle Collision
        if (collisionHappened && p.immunity === 0) {
            applyPenalty(p, penalty);
            io.to(room.id).emit('collisionEvent', { 
                playerNick: p.nick, // Send Nickname
                reasonCode: collisionReason, // Send Code instead of text
                color: p.design.bodyColor 
            });
        }

        // Update trail
        p.trail.push({x: p.x, y: p.y});
        while (p.trail.length > p.tail) p.trail.shift();

        // Apples
        state.apples.forEach(apple => {
            if (p.x === apple.x && p.y === apple.y) {
                p.tail++;
                p.score++;
                // Respawn apple
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
    
    p.immunity = 15; // Frames of immunity
}

function checkWinCondition(room) {
    const goal = parseInt(room.config.winScore);
    const p1 = room.gameState.p1;
    const p2 = room.gameState.p2;

    if (p1.score >= goal && p2.score >= goal) finishGame(room, "DRAW");
    else if (p1.score >= goal) finishGame(room, p1.nick);
    else if (p2.score >= goal) finishGame(room, p2.nick);
}

function finishGame(room, winnerName) {
    clearInterval(room.gameInterval);
    room.status = 'finished';
    io.to(room.id).emit('gameOver', { winner: winnerName });
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
            list.push({
                id: id,
                creator: rooms[id].players[0].nick,
                config: rooms[id].config
            });
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

    // Generate trails so heads face each other
    // P1 faces Right
    let trail1 = [];
    for(let i = 2; i >= 0; i--) trail1.push({ x: startX1 - i, y: midY });

    // P2 faces Left
    let trail2 = [];
    for(let i = 2; i >= 0; i--) trail2.push({ x: startX2 + i, y: midY });

    return {
        p1: { 
            x: startX1, y: midY, xv: 0, yv: 0, 
            facingX: 1, facingY: 0, 
            trail: trail1, tail: 3, score: 0, immunity: 0, nick: "", design: {} 
        },
        p2: { 
            x: startX2, y: midY, xv: 0, yv: 0, 
            facingX: -1, facingY: 0, 
            trail: trail2, tail: 3, score: 0, immunity: 0, nick: "", design: {} 
        },
        apples: [{x: midY, y: midY - 2}, {x: midY, y: midY + 2}]
    };
}

server.listen(PORT, () => {
  console.log(`SERVER RUNNING ON PORT ${PORT}`);
});