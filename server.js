const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

// Global error handlers to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
  logger.error('Unhandled Rejection', { reason: String(reason) });
});

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 120000,
  pingInterval: 30000,
  transports: ['polling'], // Use polling only for better compatibility
  allowUpgrades: false,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Serve root index.html (standalone version)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Game state management
const activeLobbies = new Map();
const MAX_GROUPS_PER_LOBBY = 20;
const LOBBY_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
const DISCONNECTED_GROUP_TTL_MS = 20 * 60 * 1000; // 20 minutes

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

// HTML escape function for preventing XSS
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') return unsafe;
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function generateReconnectCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function countConnectedGroups(lobby) {
  return Array.from(lobby.groups.values()).filter((group) => group.connected !== false).length;
}

function getTopicBlankCount(content, topicId) {
  if (!content) return 0;

  if (content.topics && Array.isArray(content.topics) && content.topics.length > 0) {
    const topic = content.topics.find((entry, index) => {
      const id = entry?.id || `topic-${index + 1}`;
      return id === topicId;
    });
    return topic?.keyTerms?.length || 0;
  }

  return content.keyTerms?.length || 0;
}

function mapGroupsForHost(lobby) {
  return Array.from(lobby.groups.values()).map((group) => ({
    name: group.name,
    score: group.score,
    joinedAt: group.joinedAt,
    connected: group.connected !== false,
    disconnectedAt: group.disconnectedAt || null,
    reconnectCode: group.reconnectCode,
    reconnectToken: group.reconnectToken
  }));
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

  const isVirtualInterface = (name = '') => {
    const lower = name.toLowerCase();
    return (
      lower.includes('tailscale') ||
      lower.includes('docker') ||
      lower.includes('vbox') ||
      lower.includes('virbr') ||
      lower.includes('vmnet') ||
      lower.includes('br-')
    );
  };

  const primary = addresses.find(a => {
    const n = a.name.toLowerCase();
    return !isVirtualInterface(n) && (n.startsWith('wl') || n.startsWith('wlan') || n.startsWith('en') || n.startsWith('eth'));
  });
  if (primary) return primary.address;

  const privateLan = addresses.find(a => {
    if (isVirtualInterface(a.name)) return false;
    return a.address.startsWith('192.168.') || a.address.startsWith('10.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(a.address);
  });
  if (privateLan) return privateLan.address;

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
      continue;
    }

    let removedAnyGroup = false;
    lobby.groups.forEach((group, groupName) => {
      if (group.connected === false && group.disconnectedAt && (now - group.disconnectedAt) > DISCONNECTED_GROUP_TTL_MS) {
        lobby.groups.delete(groupName);
        removedAnyGroup = true;
        logger.info('Removed expired disconnected group', { roomCode: code, groupName });
      }
    });

    if (removedAnyGroup) {
      io.to(`host-${code}`).emit('group-left', {
        groupCount: countConnectedGroups(lobby),
        groups: mapGroupsForHost(lobby)
      });
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

// Generate QR code for an arbitrary link
app.get('/api/qr-link', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required' });
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'Invalid URL protocol' });
    }

    const qrCode = await QRCode.toDataURL(parsed.toString());
    res.json({ qrCode, url: parsed.toString() });
  } catch (error) {
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

  // Handle socket errors
  socket.on('error', (error) => {
    logger.error('Socket error', { socketId: socket.id, error: error.message });
  });

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
      const { roomCode, groupName, reconnectToken, reconnectCode } = data;
      const lobby = activeLobbies.get(roomCode);

      if (!lobby) {
        return callback({ error: 'Lobby not found' });
      }

      if (!groupName || groupName.trim().length === 0) {
        return callback({ error: 'Group name is required' });
      }

      if (groupName.length > 20) {
        return callback({ error: 'Group name must be 20 characters or less' });
      }

      // Validate group name (allowed characters: alphanumeric, spaces, hyphens, underscores)
      const validNameRegex = /^[a-zA-Z0-9\s\-_]+$/;
      if (!validNameRegex.test(groupName.trim())) {
        return callback({ error: 'Group name can only contain letters, numbers, spaces, hyphens, and underscores' });
      }

      // Sanitize group name (escape HTML but keep the characters)
      const sanitizedGroupName = escapeHtml(groupName.trim());

      if (lobby.groups.size >= MAX_GROUPS_PER_LOBBY) {
        return callback({ error: 'Lobby is full' });
      }

      if (lobby.groups.has(sanitizedGroupName)) {
        const existingGroup = lobby.groups.get(sanitizedGroupName);
        const matchesReconnectSecret =
          (typeof reconnectToken === 'string' && reconnectToken.length > 0 && reconnectToken === existingGroup.reconnectToken) ||
          (typeof reconnectCode === 'string' && reconnectCode.length > 0 && reconnectCode === existingGroup.reconnectCode);
        
        // Safely check if existing socket is still connected
        let isConnected = false;
        try {
          const existingSocket = io.sockets.sockets.get(existingGroup.socketId);
          isConnected = existingSocket && existingSocket.connected;
        } catch (err) {
          logger.error('Error checking existing socket', { error: err.message });
        }
        
        if (isConnected && !matchesReconnectSecret) {
          return callback({ error: 'Group name already taken' });
        } else {
          existingGroup.socketId = socket.id;
          existingGroup.connected = true;
          existingGroup.disconnectedAt = null;
          existingGroup.lastSeenAt = Date.now();

          if (!existingGroup.reconnectToken) {
            existingGroup.reconnectToken = uuidv4();
          }
          if (!existingGroup.reconnectCode) {
            existingGroup.reconnectCode = generateReconnectCode();
          }

          lobby.lastActivity = Date.now();
          socket.join(roomCode);
          socket.groupName = sanitizedGroupName;
          socket.roomCode = roomCode;

          io.to(`host-${roomCode}`).emit('group-joined', {
            groupName: sanitizedGroupName,
            groupCount: countConnectedGroups(lobby),
            groups: mapGroupsForHost(lobby)
          });

          callback({
            success: true,
            groupName: sanitizedGroupName,
            reconnectToken: existingGroup.reconnectToken,
            reconnectCode: existingGroup.reconnectCode,
            lobbyStatus: lobby.status,
            content: lobby.status === 'active' ? lobby.content : null
          });

          logger.info('Group rejoined lobby', { groupName: sanitizedGroupName, roomCode });
          return;
        }
      }

      // Add group to lobby
      const group = {
        id: uuidv4(),
        name: sanitizedGroupName,
        socketId: socket.id,
        answers: new Map(),
        score: 0,
        joinedAt: Date.now(),
        connected: true,
        disconnectedAt: null,
        lastSeenAt: Date.now(),
        reconnectToken: uuidv4(),
        reconnectCode: generateReconnectCode(),
        completedTopics: new Set()
      };

      lobby.groups.set(sanitizedGroupName, group);
      lobby.lastActivity = Date.now();
      socket.join(roomCode);
      socket.groupName = sanitizedGroupName;
      socket.roomCode = roomCode;

      // Notify host
      io.to(`host-${roomCode}`).emit('group-joined', {
        groupName: sanitizedGroupName,
        groupCount: countConnectedGroups(lobby),
        groups: mapGroupsForHost(lobby)
      });

      callback({
        success: true,
        groupName: sanitizedGroupName,
        reconnectToken: group.reconnectToken,
        reconnectCode: group.reconnectCode,
        lobbyStatus: lobby.status,
        content: lobby.status === 'active' ? lobby.content : null
      });

      logger.info('Group joined lobby', { groupName: sanitizedGroupName, roomCode });
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
      const { roomCode, groupName, topicId, blankId, answer } = data;
      const lobby = activeLobbies.get(roomCode);

      if (!lobby) {
        return callback({ error: 'Lobby not found' });
      }

      const group = lobby.groups.get(groupName);
      if (!group) {
        return callback({ error: 'Group not found' });
      }

      group.lastSeenAt = Date.now();
      group.connected = true;
      group.disconnectedAt = null;

      const normalizedTopicId = topicId || 'main';

      // Store answer
      group.answers.set(`${normalizedTopicId}:${blankId}`, {
        topicId: normalizedTopicId,
        blankId,
        answer: String(answer),
        submittedAt: Date.now()
      });

      lobby.lastActivity = Date.now();

      logger.info('Answer submitted', {
        roomCode,
        groupName,
        topicId: normalizedTopicId,
        blankId,
        answer: String(answer)
      });

      const topicAnswerCount = Array.from(group.answers.values())
        .filter(entry => entry.topicId === normalizedTopicId)
        .length;
      const topicBlankCount = getTopicBlankCount(lobby.content, normalizedTopicId);

      if (topicBlankCount > 0) {
        if (!group.completedTopics) {
          group.completedTopics = new Set();
        }

        if (topicAnswerCount >= topicBlankCount && !group.completedTopics.has(normalizedTopicId)) {
          group.completedTopics.add(normalizedTopicId);

          const completedAt = Date.now();
          const payload = {
            groupName,
            topicId: normalizedTopicId,
            completedAt,
            submittedCount: topicAnswerCount,
            requiredCount: topicBlankCount
          };

          io.to(`host-${roomCode}`).emit('topic-completed', payload);
          logger.info('Group completed topic input', {
            roomCode,
            ...payload
          });
        }
      }

      // Notify host - safely
      const hostRoom = io.sockets.adapter.rooms.get(`host-${roomCode}`);
      if (hostRoom && hostRoom.size > 0) {
        io.to(`host-${roomCode}`).emit('answer-submitted', {
          groupName,
          topicId: normalizedTopicId,
          blankId,
          answer: String(answer),
          totalAnswers: topicAnswerCount,
          submittedAt: Date.now()
        });
      }

      if (typeof callback === 'function') {
        callback({ success: true });
      }
    } catch (error) {
      logger.error('Error in submit-answer', { error: error.message });
      if (typeof callback === 'function') {
        callback({ error: error.message });
      }
    }
  });

  // Host reveals all answers
  socket.on('reveal-answers', (data) => {
    try {
      const { roomCode, hostToken, answers, topicId } = data;
      const lobby = activeLobbies.get(roomCode);

      if (!lobby || lobby.hostToken !== hostToken) return;

      lobby.lastActivity = Date.now();

      // Broadcast correct answers to all groups
      io.to(roomCode).emit('answers-revealed', { answers, topicId: topicId || 'main' });
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
          score: g.score,
          connected: g.connected !== false,
          disconnectedAt: g.disconnectedAt || null,
          reconnectCode: g.reconnectCode,
          reconnectToken: g.reconnectToken
        })),
        wheelResults: lobby.wheelResults
      });
    } catch (error) {
      callback({ error: error.message });
    }
  });

  // Host reconnects with token
  socket.on('host-reconnect', (data, callback) => {
    try {
      const { roomCode, hostToken } = data;
      const lobby = activeLobbies.get(roomCode);

      if (!lobby) {
        return callback({ error: 'Lobby not found' });
      }

      if (lobby.hostToken !== hostToken) {
        return callback({ error: 'Invalid host token' });
      }

      // Update host socket
      lobby.hostSocketId = socket.id;
      socket.join(`host-${roomCode}`);

      callback({
        success: true,
        roomCode,
        groups: mapGroupsForHost(lobby)
      });

      logger.info('Host reconnected', { roomCode });
    } catch (error) {
      callback({ error: error.message });
    }
  });

  // Handle disconnect
  socket.on('disconnect', (reason) => {
    logger.info('Client disconnected', { socketId: socket.id, roomCode: socket.roomCode, groupName: socket.groupName, reason });

    // Check if this is a group
    if (socket.roomCode && socket.groupName) {
      try {
        const lobby = activeLobbies.get(socket.roomCode);
        if (lobby) {
          const group = lobby.groups.get(socket.groupName);
          if (group) {
            group.connected = false;
            group.socketId = null;
            group.disconnectedAt = Date.now();
            group.lastSeenAt = Date.now();
          }
          lobby.lastActivity = Date.now();

          // Notify host - safe emit
          const hostRoom = io.sockets.adapter.rooms.get(`host-${socket.roomCode}`);
          if (hostRoom && hostRoom.size > 0) {
            io.to(`host-${socket.roomCode}`).emit('group-left', {
              groupName: socket.groupName,
              groupCount: countConnectedGroups(lobby),
              groups: mapGroupsForHost(lobby)
            });
          }

          logger.info('Group marked disconnected', { groupName: socket.groupName, roomCode: socket.roomCode });
        }
      } catch (error) {
        logger.error('Error in disconnect handler', { error: error.message });
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
