/**
 * Player Module
 * Handles group player interactions with the lobby
 */

// Global error handlers for debugging
window.addEventListener('error', (e) => {
    console.error('Global error:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e.reason);
});

class Player {
    constructor() {
        this.socket = null;
        this.roomCode = '';
        this.groupName = '';
        this.currentScreen = 'join';
        this.content = null;
        this.keyTerms = [];
        this.userAnswers = new Map();
        
        // Multi-topic support
        this.topics = []; // Array of topic objects
        this.currentTopicIndex = 0;
        this.topicAnswers = {}; // { topicId: { blankId: answer } }
        this.revealedTopics = new Set(); // Track which topics have revealed answers
        
        this.init();
    }

    init() {
        this.parseUrlParams();
        this.bindEvents();
        this.connectSocket();
        
        // Check for existing session and auto-reconnect
        const savedRoomCode = sessionStorage.getItem('roomCode');
        const savedGroupName = sessionStorage.getItem('groupName');
        
        if (savedRoomCode && savedGroupName) {
            this.roomCode = savedRoomCode;
            this.groupName = savedGroupName;
        }
    }

    parseUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const roomCode = params.get('room');
        if (roomCode) {
            document.getElementById('room-code').value = roomCode.toUpperCase();
        }
    }

    bindEvents() {
        document.getElementById('join-btn').addEventListener('click', () => {
            this.joinLobby();
        });

        document.getElementById('reconnect-btn').addEventListener('click', () => {
            this.reconnect();
        });

        ['room-code', 'group-name'].forEach(id => {
            document.getElementById(id).addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.joinLobby();
            });
        });
    }

    connectSocket() {
        this.socket = io({
            transports: ['polling'], // Use polling only for better compatibility
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000
        });

        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.showConnectionStatus(true);
            
            // Auto-reconnect if we have session data
            if (this.roomCode && this.groupName) {
                this.reconnect();
            }
        });

        this.socket.on('disconnect', (reason) => {
            console.log('Disconnected from server:', reason);
            this.showConnectionStatus(false);
            
            // Only show disconnected screen for server-initiated disconnects
            // Let Socket.IO auto-reconnect handle transient network issues
            if (reason === 'io server disconnect') {
                this.switchScreen('disconnected');
            }
        });

        this.socket.on('reconnect', (attemptNumber) => {
            console.log('Reconnected after', attemptNumber, 'attempts');
            // Try to rejoin lobby automatically
            if (this.roomCode && this.groupName) {
                this.reconnect();
            }
        });

        this.socket.on('reconnect_failed', () => {
            console.log('Reconnection failed');
            this.switchScreen('disconnected');
        });

        this.socket.on('content-loaded', (data) => {
            try {
                this.loadContent(data.content);
            } catch (err) {
                console.error('Error in content-loaded handler:', err);
            }
        });

        this.socket.on('answers-revealed', (data) => {
            try {
                this.showRevealedAnswers(data.answers);
            } catch (err) {
                console.error('Error in answers-revealed handler:', err);
            }
        });

        this.socket.on('wheel-spun', (data) => {
            try {
                this.showWheelResult(data.result);
            } catch (err) {
                console.error('Error in wheel-spun handler:', err);
            }
        });

        this.socket.on('lobby-closed', () => {
            try {
                alert('The lobby has been closed.');
                this.clearSession();
                window.location.reload();
            } catch (err) {
                console.error('Error in lobby-closed handler:', err);
            }
        });
    }

    joinLobby() {
        const roomCode = document.getElementById('room-code').value.trim().toUpperCase();
        const groupName = document.getElementById('group-name').value.trim();

        if (!roomCode || roomCode.length !== 6) {
            this.showError('Please enter a valid 6-character room code');
            return;
        }

        if (!groupName) {
            this.showError('Please enter a group name');
            return;
        }

        this.roomCode = roomCode;
        this.groupName = groupName;

        // Save to session for reconnection
        sessionStorage.setItem('roomCode', this.roomCode);
        sessionStorage.setItem('groupName', this.groupName);

        // Disable button to prevent double-join
        const joinBtn = document.getElementById('join-btn');
        joinBtn.disabled = true;
        joinBtn.textContent = 'Joining...';

        // Check if socket is connected
        if (!this.socket.connected) {
            this.showError('Connection lost. Please wait...');
            joinBtn.disabled = false;
            joinBtn.textContent = 'Join Game';
            return;
        }

        this.socket.emit('join-lobby', { roomCode, groupName }, (response) => {
            joinBtn.disabled = false;
            joinBtn.textContent = 'Join Game';
            
            if (response.error) {
                this.showError(response.error);
                // Clear session on error (except for lobby not found)
                if (response.error !== 'Lobby not found') {
                    this.clearSession();
                }
                return;
            }

            document.getElementById('player-group-name').textContent = this.groupName;
            document.getElementById('waiting-group-name').textContent = `Joined as: ${this.groupName}`;

            if (response.lobbyStatus === 'active' && response.content) {
                this.loadContent(response.content);
            } else {
                this.switchScreen('waiting');
                this.showToast('Joined successfully! Waiting for host...', 'success');
            }
        });
    }

    loadContent(content) {
        try {
            this.content = content;
            this.switchScreen('game');

            // Reset topic state
            this.topics = [];
            this.currentTopicIndex = 0;
            this.topicAnswers = {};
            this.revealedTopics = new Set();

            // Show room code in header
            document.getElementById('display-room-code').textContent = this.roomCode;

            // Check if multi-topic content
            if (content.topics && Array.isArray(content.topics) && content.topics.length > 0) {
                this.topics = content.topics;
                document.getElementById('topic-tabs').classList.remove('hidden');
                document.getElementById('topic-progress').classList.remove('hidden');
                this.renderTabs();
                this.loadTopic(0);
            } else {
                // Single topic - backward compatible
                this.topics = [{
                    id: 'main',
                    title: content.title || 'Content',
                    text: content.text || '',
                    keyTerms: content.keyTerms || []
                }];
                document.getElementById('topic-tabs').classList.add('hidden');
                document.getElementById('topic-progress').classList.add('hidden');
                this.loadTopic(0);
            }

            document.getElementById('answers-section').classList.add('hidden');
            document.getElementById('wheel-result').classList.add('hidden');
            
            this.showToast('Content loaded!', 'success');
        } catch (error) {
            console.error('Error loading content:', error);
            this.showToast('Error loading content. Please refresh.', 'error');
        }
    }

    renderTabs() {
        const tabsContainer = document.getElementById('topic-tabs');
        
        tabsContainer.innerHTML = this.topics.map((topic, index) => `
            <button class="tab ${index === this.currentTopicIndex ? 'active' : ''}" 
                    data-topic-index="${index}">
                <span class="tab-number">${index + 1}</span>
                ${topic.title}
            </button>
        `).join('');

        // Add click handlers
        tabsContainer.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const topicIndex = parseInt(tab.dataset.topicIndex);
                this.switchTopic(topicIndex);
            });
        });
    }

    updateProgress() {
        const currentTopic = this.topics[this.currentTopicIndex];
        if (!currentTopic) return;

        const totalBlanks = currentTopic.keyTerms?.length || 0;
        const savedAnswers = this.topicAnswers[currentTopic.id] || {};
        const filledBlanks = Object.keys(savedAnswers).filter(k => savedAnswers[k] && savedAnswers[k].trim()).length;

        document.getElementById('filled-count').textContent = filledBlanks;
        document.getElementById('total-count').textContent = totalBlanks;

        const percentage = totalBlanks > 0 ? (filledBlanks / totalBlanks) * 100 : 0;
        document.getElementById('progress-fill').style.width = percentage + '%';
    }

    switchTopic(topicIndex) {
        // Save current topic state before switching
        this.saveCurrentTopicAnswers();

        this.currentTopicIndex = topicIndex;
        
        // Update tab UI
        document.querySelectorAll('.topic-tabs .tab').forEach((tab, index) => {
            tab.classList.toggle('active', index === topicIndex);
        });

        this.loadTopic(topicIndex);
    }

    saveCurrentTopicAnswers() {
        const currentTopic = this.topics[this.currentTopicIndex];
        if (!currentTopic) return;

        // Save all current input values
        const inputs = document.querySelectorAll('.doc-content .blank-input');
        inputs.forEach(input => {
            const blankId = input.dataset.blankId;
            if (blankId && input.value) {
                if (!this.topicAnswers[currentTopic.id]) {
                    this.topicAnswers[currentTopic.id] = {};
                }
                this.topicAnswers[currentTopic.id][blankId] = input.value;
            }
        });
    }

    loadTopic(topicIndex) {
        const topic = this.topics[topicIndex];
        if (!topic) return;

        const contentArea = document.getElementById('content-area');
        
        // Set title
        contentArea.innerHTML = `<h2 class="doc-title">${topic.title}</h2>`;

        const keyTerms = topic.keyTerms || [];
        let html = topic.text || '';

        // Replace blanks with inputs
        keyTerms.forEach(term => {
            const input = `<input type="text" 
                class="blank-input" 
                data-blank-id="${term.id}" 
                data-topic-id="${topic.id}"
                placeholder="?" 
                autocomplete="off">`;
            html = html.replace(`{{${term.id}}}`, input);
        });

        const textEl = document.createElement('div');
        textEl.className = 'doc-content';
        textEl.innerHTML = html;
        contentArea.appendChild(textEl);

        // Restore saved answers for this topic
        const savedAnswers = this.topicAnswers[topic.id] || {};
        Object.keys(savedAnswers).forEach(blankId => {
            const input = contentArea.querySelector(`[data-blank-id="${blankId}"]`);
            if (input) {
                input.value = savedAnswers[blankId];
                input.classList.add('filled');
            }
        });

        // Add event listeners
        contentArea.querySelectorAll('.blank-input').forEach(input => {
            input.addEventListener('blur', () => {
                try {
                    input.classList.add('filled');
                    this.submitAnswer(input.dataset.topicId, input.dataset.blankId, input.value);
                } catch (err) {
                    console.error('Error in submitAnswer:', err);
                }
            });

            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    try {
                        input.classList.add('filled');
                        this.submitAnswer(input.dataset.topicId, input.dataset.blankId, input.value);
                        input.blur();
                    } catch (err) {
                        console.error('Error in submitAnswer:', err);
                    }
                }
            });
        });

        // Show revealed answers if this topic was revealed
        if (this.revealedTopics.has(topic.id)) {
            this.showRevealedForTopic(topic.id);
        } else {
            document.getElementById('answers-section').classList.add('hidden');
        }

        // Update progress
        this.updateProgress();
    }

    submitAnswer(topicId, blankId, answer) {
        if (!answer || !answer.trim()) return;

        // Store answer per topic
        if (!this.topicAnswers[topicId]) {
            this.topicAnswers[topicId] = {};
        }
        this.topicAnswers[topicId][blankId] = answer;

        // Update progress
        this.updateProgress();

        // Also maintain backward compatibility
        this.userAnswers.set(blankId, answer);

        // Only submit if socket is connected
        if (!this.socket.connected) {
            console.log('Socket not connected, answer saved locally');
            return;
        }

        this.socket.emit('submit-answer', {
            roomCode: this.roomCode,
            groupName: this.groupName,
            topicId: topicId,
            blankId: blankId,
            answer: answer
        });
    }

    showRevealedAnswers(data) {
        // Handle both single-topic (array) and multi-topic (object) formats
        const answers = data.answers || data;
        const topicId = data.topicId;
        
        // If topicId provided, only reveal for that topic
        if (topicId) {
            this.revealedTopics.add(topicId);
            this.showRevealedForTopic(topicId, answers);
            return;
        }

        // Backward compatibility - reveal all
        const currentTopic = this.topics[this.currentTopicIndex];
        if (currentTopic) {
            this.revealedTopics.add(currentTopic.id);
        }
        
        this.showRevealedForTopic(topicId, answers);
    }

    showRevealedForTopic(topicId, answers) {
        const answersSection = document.getElementById('answers-section');
        const revealedContent = document.getElementById('revealed-content');
        
        if (!answers || answers.length === 0) {
            answersSection.classList.add('hidden');
            return;
        }

        revealedContent.innerHTML = answers.map(ans => `
            <div class="revealed-item">
                <span class="blank-label">${ans.blankId}:</span>
                <span class="correct-answer">${ans.answer}</span>
            </div>
        `).join('');

        answersSection.classList.remove('hidden');
        
        // Update the inputs in the current topic
        const currentTopic = this.topics[this.currentTopicIndex];
        if (currentTopic && currentTopic.id === topicId) {
            answers.forEach(ans => {
                const input = document.querySelector(`[data-blank-id="${ans.blankId}"]`);
                if (input) {
                    input.value = ans.answer;
                    input.classList.add('revealed');
                    input.classList.add('filled');
                    input.readOnly = true;
                }
            });
        }

        // Update tab to show completed
        const tabIndex = this.topics.findIndex(t => t.id === topicId);
        if (tabIndex >= 0) {
            const tab = document.querySelector(`.topic-tabs .tab[data-topic-index="${tabIndex}"]`);
            if (tab) {
                tab.classList.add('completed');
            }
        }
    }

    showWheelResult(result) {
        const wheelResult = document.getElementById('wheel-result');
        wheelResult.querySelector('.result-value').textContent = result.value;
        wheelResult.classList.remove('hidden');
        wheelResult.classList.add('highlight');
        setTimeout(() => wheelResult.classList.remove('highlight'), 1000);
    }

    switchScreen(screenName) {
        const screenMap = {
            'join': 'join-screen',
            'waiting': 'waiting-screen',
            'game': 'game-screen',
            'disconnected': 'disconnected-screen'
        };
        
        const targetScreen = screenMap[screenName] || screenName;
        
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        
        const screenEl = document.getElementById(targetScreen);
        if (screenEl) {
            screenEl.classList.add('active');
        } else {
            console.error('Screen not found:', targetScreen);
        }
    }

    showError(message) {
        const errorEl = document.getElementById('join-error');
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        setTimeout(() => errorEl.style.display = 'none', 4000);
    }

    showToast(message, type = 'info') {
        // Remove existing toast
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    showConnectionStatus(connected) {
        const statusEl = document.querySelector('.connection-status');
        if (statusEl) {
            const textEl = statusEl.querySelector('.status-text');
            if (textEl) {
                textEl.textContent = connected ? 'Connected' : 'Disconnected';
            }
            statusEl.className = `connection-status ${connected ? 'connected' : 'disconnected'}`;
        }
    }

    reconnect() {
        // Try session storage first
        if (!this.roomCode) {
            this.roomCode = sessionStorage.getItem('roomCode');
            this.groupName = sessionStorage.getItem('groupName');
        }

        if (!this.roomCode || !this.groupName) {
            this.switchScreen('join');
            return;
        }

        // Ensure socket is connected before trying to rejoin
        if (!this.socket.connected) {
            console.log('Socket not connected, waiting for reconnect...');
            
            // Listen for the next connect event
            this.socket.once('connect', () => {
                console.log('Socket connected, attempting to rejoin...');
                this.attemptRejoin();
            });
            
            // Trigger manual reconnect attempt
            this.socket.connect();
        } else {
            this.attemptRejoin();
        }
    }

    attemptRejoin() {
        this.socket.emit('join-lobby', { roomCode: this.roomCode, groupName: this.groupName }, (response) => {
            if (response.error) {
                console.log('Failed to rejoin:', response.error);
                this.showError(response.error);
                // Don't switch to join - stay on disconnected, allow retry
                return;
            }

            console.log('Successfully rejoined lobby');
            document.getElementById('player-group-name').textContent = this.groupName;
            document.getElementById('waiting-group-name').textContent = `Joined as: ${this.groupName}`;

            if (response.lobbyStatus === 'active' && response.content) {
                this.loadContent(response.content);
            } else {
                this.switchScreen('waiting');
            }
        });
    }

    clearSession() {
        sessionStorage.removeItem('roomCode');
        sessionStorage.removeItem('groupName');
        this.roomCode = '';
        this.groupName = '';
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.player = new Player();
});
