/**
 * Player Module
 * Handles group player interactions with the lobby
 */

class Player {
    constructor() {
        this.socket = null;
        this.roomCode = '';
        this.groupName = '';
        this.currentScreen = 'join';
        this.content = null;
        this.keyTerms = [];
        this.userAnswers = new Map();
        
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
            // Auto-reconnect after socket connects
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
        this.socket = io();

        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.showConnectionStatus(true);
            
            // Auto-reconnect if we have session data
            if (this.roomCode && this.groupName) {
                this.reconnect();
            }
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.showConnectionStatus(false);
            this.switchScreen('disconnected');
        });

        this.socket.on('content-loaded', (data) => {
            this.loadContent(data.content);
        });

        this.socket.on('answers-revealed', (data) => {
            this.showRevealedAnswers(data.answers);
        });

        this.socket.on('wheel-spun', (data) => {
            this.showWheelResult(data.result);
        });

        this.socket.on('lobby-closed', () => {
            alert('The lobby has been closed.');
            window.location.reload();
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

        this.socket.emit('join-lobby', { roomCode, groupName }, (response) => {
            if (response.error) {
                this.showError(response.error);
                return;
            }

            document.getElementById('player-group-name').textContent = this.groupName;
            document.getElementById('waiting-group-name').textContent = `Joined as: ${this.groupName}`;

            if (response.lobbyStatus === 'active' && response.content) {
                this.loadContent(response.content);
            } else {
                this.switchScreen('waiting');
            }
        });
    }

    loadContent(content) {
        this.content = content;
        this.switchScreen('game');

        const contentArea = document.getElementById('content-area');
        
        if (content.title) {
            contentArea.innerHTML = `<h2 class="content-title">${content.title}</h2>`;
        }

        this.keyTerms = content.keyTerms || [];
        let html = content.text || '';

        this.keyTerms.forEach(term => {
            const input = `<input type="text" class="blank-input" data-term-id="${term.id}" placeholder="?" autocomplete="off">`;
            html = html.replace(`{{${term.id}}}`, input);
        });

        const textEl = document.createElement('div');
        textEl.className = 'content-text';
        textEl.innerHTML = html;
        contentArea.appendChild(textEl);

        contentArea.querySelectorAll('.blank-input').forEach(input => {
            input.addEventListener('blur', () => {
                this.submitAnswer(input.dataset.termId, input.value);
            });

            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.submitAnswer(input.dataset.termId, input.value);
                    input.blur();
                }
            });
        });

        document.getElementById('answers-revealed').classList.add('hidden');
        document.getElementById('wheel-result').classList.add('hidden');
    }

    submitAnswer(blankId, answer) {
        if (!answer.trim()) return;

        this.userAnswers.set(blankId, answer);

        this.socket.emit('submit-answer', {
            roomCode: this.roomCode,
            groupName: this.groupName,
            blankId,
            answer
        });
    }

    showRevealedAnswers(answers) {
        const revealedArea = document.getElementById('answers-revealed');
        const revealedContent = document.getElementById('revealed-content');
        
        revealedContent.innerHTML = answers.map(ans => `
            <div class="revealed-item">
                <span class="blank-label">Blank ${ans.blankId}:</span>
                <span class="correct-answer">${ans.answer}</span>
            </div>
        `).join('');

        revealedArea.classList.remove('hidden');
        
        answers.forEach(ans => {
            const input = document.querySelector(`[data-term-id="${ans.blankId}"]`);
            if (input) {
                input.value = ans.answer;
                input.classList.add('revealed');
                input.readOnly = true;
            }
        });
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
        setTimeout(() => errorEl.style.display = 'none', 3000);
    }

    showConnectionStatus(connected) {
        const statusEl = document.querySelector('.connection-status');
        if (statusEl) {
            statusEl.textContent = connected ? '● Connected' : '● Disconnected';
            statusEl.className = `connection-status ${connected ? 'connected' : 'disconnected'}`;
        }
    }

    reconnect() {
        // Try session storage first
        if (!this.roomCode) {
            this.roomCode = sessionStorage.getItem('roomCode');
            this.groupName = sessionStorage.getItem('groupName');
        }

        if (this.roomCode && this.groupName) {
            this.socket.emit('join-lobby', { roomCode: this.roomCode, groupName: this.groupName }, (response) => {
                if (response.error) {
                    this.showError(response.error);
                    this.switchScreen('join');
                    return;
                }

                document.getElementById('player-group-name').textContent = this.groupName;
                document.getElementById('waiting-group-name').textContent = `Joined as: ${this.groupName}`;

                if (response.lobbyStatus === 'active' && response.content) {
                    this.loadContent(response.content);
                } else {
                    this.switchScreen('waiting');
                }
            });
        } else {
            this.switchScreen('join');
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.player = new Player();
});
