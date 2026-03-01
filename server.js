const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Game state management
const activeLobbies = new Map();
const MAX_GROUPS_PER_LOBBY = 20;
const LOBBY_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

// Wheel configuration storage
const WHEELS_CONFIG_FILE = path.join(__dirname, 'data', 'wheels-config.json');
let wheelConfigs = loadWheelConfigs();

// Load wheel configurations from file
function loadWheelConfigs() {
  try {
    if (fs.existsSync(WHEELS_CONFIG_FILE)) {
      const data = fs.readFileSync(WHEELS_CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    logger.error('Error loading wheel configs', { error: error.message });
  }
  return { presets: [], custom: [] };
}

// Save wheel configurations to file
function saveWheelConfigs() {
  try {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(WHEELS_CONFIG_FILE, JSON.stringify(wheelConfigs, null, 2));
  } catch (error) {
    logger.error('Error saving wheel configs', { error: error.message });
  }
}

// Generate unique room code
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (activeLobbies.has(code));
  return code;
}

// Get local IP address for hotspot
function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({ address: iface.address, name });
      }
    }
  }

  const priority192 = addresses.find(a => a.address.startsWith('192.168.'));
  if (priority192) return priority192.address;

  const priority10 = addresses.find(a => a.address.startsWith('10.'));
  if (priority10) return priority10.address;

  if (addresses.length > 0) {
    return addresses[0].address;
  }

  return 'localhost';
}

// Cleanup inactive lobbies periodically
setInterval(() => {
  const now = Date.now();
  for (const [code, lobby] of activeLobbies.entries()) {
    if (now - lobby.lastActivity > LOBBY_TIMEOUT_MS) {
      logger.warn('Lobby timed out, closing', { roomCode: code });
      io.to(code).emit('lobby-closed', { reason: 'timeout' });
      activeLobbies.delete(code);
    }
  }
}, 60000);

// REST API endpoints

// Get wheel configurations
app.get('/api/wheels', (req, res) => {
  res.json(wheelConfigs);
});

// Save wheel configuration
app.post('/api/wheels', (req, res) => {
  try {
    const { name, wheels } = req.body;
    const config = {
      id: uuidv4(),
      name,
      wheels,
      createdAt: new Date().toISOString()
    };
    wheelConfigs.custom.push(config);
    saveWheelConfigs();
    res.json({ success: true, config });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update wheel configuration
app.put('/api/wheels/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, wheels } = req.body;
    const index = wheelConfigs.custom.findIndex(c => c.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'Config not found' });
    }
    wheelConfigs.custom[index] = {
      ...wheelConfigs.custom[index],
      name,
      wheels,
      updatedAt: new Date().toISOString()
    };
    saveWheelConfigs();
    res.json({ success: true, config: wheelConfigs.custom[index] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete wheel configuration
app.delete('/api/wheels/:id', (req, res) => {
  try {
    const { id } = req.params;
    wheelConfigs.custom = wheelConfigs.custom.filter(c => c.id !== id);
    saveWheelConfigs();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Content API endpoints

// Get all available content files
app.get('/api/content', (req, res) => {
  try {
    const contentDir = path.join(__dirname, 'data', 'blank-reviewers');
    
    if (!fs.existsSync(contentDir)) {
      return res.json({ files: [] });
    }

    const files = fs.readdirSync(contentDir)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const filePath = path.join(contentDir, file);
        const stats = fs.statSync(filePath);
        return {
          filename: file,
          filepath: filePath,
          name: file.replace(/\.json$/, '').replace(/-/g, ' '),
          size: stats.size,
          modifiedAt: stats.mtime
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ files });
  } catch (error) {
    logger.error('Error loading content files', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get specific content file
app.get('/api/content/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const contentPath = path.join(__dirname, 'data', 'blank-reviewers', filename);

    // Security: prevent directory traversal
    if (filename.includes('..') || !filename.endsWith('.json')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    if (!fs.existsSync(contentPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
    res.json(content);
  } catch (error) {
    logger.error('Error reading content file', { error: error.message, filename: req.params.filename });
    res.status(500).json({ error: error.message || 'Failed to read file' });
  }
});

// Save new content file
app.post('/api/content', (req, res) => {
  try {
    const { filename, content } = req.body;

    if (!filename || !content) {
      return res.status(400).json({ error: 'Filename and content are required' });
    }

    // Sanitize filename
    const safeFilename = filename.replace(/[^a-z0-9-]/gi, '_');
    const fullFilename = safeFilename.endsWith('.json') ? safeFilename : `${safeFilename}.json`;
    
    const contentDir = path.join(__dirname, 'data', 'blank-reviewers');
    const filePath = path.join(contentDir, fullFilename);

    // Ensure directory exists
    if (!fs.existsSync(contentDir)) {
      fs.mkdirSync(contentDir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(content, null, 2));

    res.json({ 
      success: true, 
      filename: fullFilename,
      name: fullFilename.replace('.json', '')
    });
  } catch (error) {
    logger.error('Error saving content file', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Delete content file
app.delete('/api/content/:filename', (req, res) => {
  try {
    const filename = req.params.filename;

    // Security: prevent directory traversal
    if (filename.includes('..')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const contentPath = path.join(__dirname, 'data', 'blank-reviewers', filename);

    if (!fs.existsSync(contentPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    fs.unlinkSync(contentPath);

    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting content file', { error: error.message, filename: req.params.filename });
    res.status(500).json({ error: error.message });
  }
});

// Generate QR code for room
app.get('/api/qr/:roomCode', async (req, res) => {
  try {
    const ip = getLocalIPAddress();
    const url = `http://${ip}:${PORT}/player.html?room=${req.params.roomCode}`;
    const qrCode = await QRCode.toDataURL(url);
    res.json({ qrCode, url });
  }   catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Logs API endpoints

// Get logs
app.get('/api/logs', (req, res) => {
  try {
    const { page, pageSize, level } = req.query;
    const p = parseInt(page) || 0;
    const ps = parseInt(pageSize) || 50;

    let logsData;
    if (level) {
      logsData = {
        logs: logger.getLogsByLevel(level, ps),
        total: logger.getLogsByLevel(level).length
      };
    } else {
      logsData = logger.getLogs(p, ps);
    }

    res.json(logsData);
  } catch (error) {
    logger.error('Error fetching logs', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get recent logs from memory
app.get('/api/logs/recent', (req, res) => {
  try {
    const { limit } = req.query;
    const logs = logger.getRecentLogs(parseInt(limit) || 100);
    res.json({ logs });
  } catch (error) {
    logger.error('Error fetching recent logs', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get logs by level
app.get('/api/logs/level/:level', (req, res) => {
  try {
    const { limit } = req.query;
    const { level } = req.params;
    const validLevels = ['debug', 'info', 'warn', 'error'];
    
    if (!validLevels.includes(level)) {
      return res.status(400).json({ error: 'Invalid level' });
    }

    const logs = logger.getLogsByLevel(level, parseInt(limit) || 100);
    res.json({ logs, count: logs.length });
  } catch (error) {
    logger.error('Error fetching logs by level', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Clear logs from memory
app.delete('/api/logs', (req, res) => {
  try {
    logger.clearMemory();
    res.json({ success: true });
  } catch (error) {
    logger.error('Error clearing logs', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
      logger.info('Client connected', { socketId: socket.id });

  // Host creates a lobby
  socket.on('create-lobby', (data, callback) => {
    try {
      const roomCode = generateRoomCode();
      const hostToken = uuidv4();
      
      const lobby = {
        code: roomCode,
        hostSocketId: socket.id,
        hostToken,
        groups: new Map(),
        content: null,
        wheelResults: [],
        status: 'waiting',
        createdAt: Date.now(),
        lastActivity: Date.now()
      };

      activeLobbies.set(roomCode, lobby);
      socket.join(roomCode);
      socket.join(`host-${roomCode}`);

      const ip = getLocalIPAddress();
      const joinUrl = `http://${ip}:${PORT}/player.html?room=${roomCode}`;

      callback({
        success: true,
        roomCode,
        hostToken,
        joinUrl
      });

      logger.info('Lobby created', { roomCode, socketId: socket.id });
    } catch (error) {
      logger.error('Error creating lobby', { error: error.message, socketId: socket.id });
      callback({ error: error.message });
    }
  });

  // Group joins a lobby
  socket.on('join-lobby', (data, callback) => {
    try {
      const { roomCode, groupName } = data;
      const lobby = activeLobbies.get(roomCode);

      if (!lobby) {
        return callback({ error: 'Lobby not found' });
      }

      if (lobby.groups.size >= MAX_GROUPS_PER_LOBBY) {
        return callback({ error: 'Lobby is full' });
      }

      if (lobby.groups.has(groupName)) {
        return callback({ error: 'Group name already taken' });
      }

      // Add group to lobby
      const group = {
        id: uuidv4(),
        name: groupName,
        socketId: socket.id,
        answers: new Map(),
        score: 0,
        joinedAt: Date.now()
      };

      lobby.groups.set(groupName, group);
      lobby.lastActivity = Date.now();
      socket.join(roomCode);
      socket.groupName = groupName;
      socket.roomCode = roomCode;

      // Notify host
      io.to(`host-${roomCode}`).emit('group-joined', {
        groupName,
        groupCount: lobby.groups.size,
        groups: Array.from(lobby.groups.values()).map(g => ({
          name: g.name,
          score: g.score,
          joinedAt: g.joinedAt
        }))
      });

      callback({
        success: true,
        groupName,
        lobbyStatus: lobby.status,
        content: lobby.status === 'active' ? lobby.content : null
      });

      logger.info('Group joined lobby', { groupName, roomCode });
    } catch (error) {
      callback({ error: error.message });
    }
  });

  // Host loads content
  socket.on('load-content', (data, callback) => {
    try {
      const { roomCode, hostToken, content } = data;
      const lobby = activeLobbies.get(roomCode);

      if (!lobby) {
        return callback({ error: 'Lobby not found' });
      }

      if (lobby.hostToken !== hostToken) {
        return callback({ error: 'Unauthorized' });
      }

      lobby.content = content;
      lobby.status = 'active';
      lobby.lastActivity = Date.now();

      // Broadcast to all groups
      io.to(roomCode).emit('content-loaded', {
        content,
        loadedBy: 'host'
      });

      // Reset all group answers
      lobby.groups.forEach(group => {
        group.answers.clear();
      });

      callback({ success: true });
      logger.info('Content loaded', { roomCode, contentTitle: content?.title });
    } catch (error) {
      logger.error('Error loading content', { error: error.message, roomCode });
      callback({ error: error.message });
    }
  });

  // Group submits an answer
  socket.on('submit-answer', (data, callback) => {
    try {
      const { roomCode, groupName, blankId, answer } = data;
      const lobby = activeLobbies.get(roomCode);

      if (!lobby) {
        return callback({ error: 'Lobby not found' });
      }

      const group = lobby.groups.get(groupName);
      if (!group) {
        return callback({ error: 'Group not found' });
      }

      // Store answer
      group.answers.set(blankId, {
        answer,
        submittedAt: Date.now()
      });

      lobby.lastActivity = Date.now();

      // Notify host
      io.to(`host-${roomCode}`).emit('answer-submitted', {
        groupName,
        blankId,
        answer,
        totalAnswers: group.answers.size
      });

      callback({ success: true });
    } catch (error) {
      callback({ error: error.message });
    }
  });

  // Host reveals all answers
  socket.on('reveal-answers', (data) => {
    try {
      const { roomCode, hostToken, answers } = data;
      const lobby = activeLobbies.get(roomCode);

      if (!lobby || lobby.hostToken !== hostToken) return;

      lobby.lastActivity = Date.now();

      // Broadcast correct answers to all groups
      io.to(roomCode).emit('answers-revealed', { answers });
    } catch (error) {
      logger.error('Error revealing answers', { error: error.message, roomCode });
    }
  });

  // Host spins wheel
  socket.on('spin-wheel', (data) => {
    try {
      const { roomCode, hostToken, wheelId, result } = data;
      const lobby = activeLobbies.get(roomCode);

      if (!lobby || lobby.hostToken !== hostToken) return;

      lobby.lastActivity = Date.now();
      lobby.wheelResults.push({
        wheelId,
        result,
        timestamp: Date.now()
      });

      // Broadcast wheel result to all groups
      io.to(roomCode).emit('wheel-spun', {
        wheelId,
        result
      });
    } catch (error) {
      logger.error('Error spinning wheel', { error: error.message, roomCode, wheelId: data.wheelId });
    }
  });

  // Host updates wheels (live editing)
  socket.on('update-wheels', (data) => {
    try {
      const { roomCode, hostToken, wheels } = data;
      const lobby = activeLobbies.get(roomCode);

      if (!lobby || lobby.hostToken !== hostToken) return;

      lobby.lastActivity = Date.now();

      // Broadcast wheel update to all groups
      io.to(roomCode).emit('wheels-updated', { wheels });
    } catch (error) {
      logger.error('Error updating wheels', { error: error.message, roomCode });
    }
  });

  // Get lobby state (for reconnecting)
  socket.on('get-lobby-state', (data, callback) => {
    try {
      const { roomCode } = data;
      const lobby = activeLobbies.get(roomCode);

      if (!lobby) {
        return callback({ error: 'Lobby not found' });
      }

      callback({
        success: true,
        status: lobby.status,
        content: lobby.content,
        groups: Array.from(lobby.groups.values()).map(g => ({
          name: g.name,
          score: g.score
        })),
        wheelResults: lobby.wheelResults
      });
    } catch (error) {
      callback({ error: error.message });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    logger.info('Client disconnected', { socketId: socket.id, roomCode: socket.roomCode, groupName: socket.groupName });

    // Check if this is a group
    if (socket.roomCode && socket.groupName) {
      const lobby = activeLobbies.get(socket.roomCode);
      if (lobby) {
        lobby.groups.delete(socket.groupName);
        lobby.lastActivity = Date.now();

        // Notify host
        io.to(`host-${socket.roomCode}`).emit('group-left', {
          groupName: socket.groupName,
          groupCount: lobby.groups.size,
          groups: Array.from(lobby.groups.values()).map(g => ({
            name: g.name,
            score: g.score
          }))
        });

        logger.info('Group left lobby', { groupName: socket.groupName, roomCode: socket.roomCode });
      }
    }
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIPAddress();
  console.log('='.repeat(60));
  console.log('🎯 reqll Multiplayer Server');
  console.log('='.repeat(60));
  console.log(`Server running on:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${ip}:${PORT}`);
  console.log('='.repeat(60));
  console.log('Share the network URL for hotspot connections');
  console.log('='.repeat(60));
});
