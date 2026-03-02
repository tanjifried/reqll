/**
 * Host Module
 * Manages the lobby, content, and wheels
 */

class Host {
    constructor() {
        this.socket = null;
        this.roomCode = null;
        this.hostToken = null;
        this.groups = new Map();
        this.currentContent = null;
        this.topics = []; // Array of topics for multi-topic content
        this.currentTopicIndex = 0; // Current active topic
        this.selectedGroupName = null; // Selected group to view inputs
        this.wheels = new Map();
        this.wheelData = null;
        this.dependentMode = true;
        this.spinAllInProgress = false;
        this.wheelConfigs = [];
        this.currentWheelId = null;
        this.groupAnswers = new Map(); // Track answers per group
        this.spinResults = []; // Track all spin results
        this.activeSpinBatch = null;
        this.dependentSourceByWheel = new Map();
        this.feedbackTimer = null;
        this.pendingReconnect = null;
        this.inputLogs = [];
        this.maxInputLogs = 250;
        this.joinUrl = '';

        this.init();
    }

    init() {
        this.bindEvents();

        // Check for existing lobby in session
        const savedRoomCode = sessionStorage.getItem('roomCode');
        const savedHostToken = sessionStorage.getItem('hostToken');

        if (savedRoomCode && savedHostToken) {
            this.pendingReconnect = { roomCode: savedRoomCode, hostToken: savedHostToken };
        }

        this.connectSocket();
        this.loadWheelPresets();
        this.loadContentFiles();
    }

    tryReconnectHost(roomCode, hostToken) {
        this.socket.emit('host-reconnect', { roomCode, hostToken }, (response) => {
            if (response.success) {
                this.roomCode = roomCode;
                this.hostToken = hostToken;
                this.pendingReconnect = null;
                
                // Update UI
                document.getElementById('room-code-display').textContent = this.roomCode;
                
                // Restore groups
                response.groups.forEach(group => {
                    this.groups.set(group.name, group);
                });
                this.updateGroupsList();
                const connectedCount = response.groups.filter(group => group.connected !== false).length;
                document.getElementById('group-count').textContent = connectedCount;

                this.loadQRCode();

                this.socket.emit('get-lobby-state', { roomCode: this.roomCode }, (state) => {
                    if (!state?.success) return;

                    if (state.content) {
                        this.currentContent = state.content;
                        if (state.content.topics && Array.isArray(state.content.topics)) {
                            this.topics = this.normalizeTopics(state.content.topics);
                        } else {
                            this.topics = this.normalizeTopics([state.content]);
                        }
                        this.currentTopicIndex = 0;
                        this.showContentPreview(this.currentContent);
                        const revealBtn = document.getElementById('reveal-answers-btn');
                        if (revealBtn) revealBtn.disabled = false;
                    }
                });
                
                console.log('Host reconnected to lobby:', roomCode);
            } else {
                // Clear invalid session data
                sessionStorage.removeItem('roomCode');
                sessionStorage.removeItem('hostToken');
                this.pendingReconnect = null;
                this.createLobby();
            }
        });
    }

    connectSocket() {
        this.socket = io();

        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.showConnectionStatus(true);

            if (this.roomCode && this.hostToken) {
                this.tryReconnectHost(this.roomCode, this.hostToken);
                return;
            }

            if (this.pendingReconnect) {
                this.tryReconnectHost(this.pendingReconnect.roomCode, this.pendingReconnect.hostToken);
                return;
            }

            this.createLobby();
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.showConnectionStatus(false);
        });

        this.socket.on('group-joined', (data) => {
            this.handleGroupJoined(data);
        });

        this.socket.on('group-left', (data) => {
            this.handleGroupLeft(data);
        });

        this.socket.on('answer-submitted', (data) => {
            this.handleAnswerSubmitted(data);
        });

        this.socket.on('topic-completed', (data) => {
            this.handleTopicCompleted(data);
        });
    }

    bindEvents() {
        // Sidebar navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Room code copy
        document.getElementById('copy-room-btn').addEventListener('click', () => {
            this.copyToClipboard(this.roomCode);
        });

        document.getElementById('copy-url-btn').addEventListener('click', () => {
            const url = document.getElementById('join-url').value;
            this.copyToClipboard(url);
        });

        document.getElementById('reconnect-list')?.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            const btn = target.closest('button[data-action]');
            if (!btn) return;

            const groupName = btn.dataset.groupName;
            const reconnectCode = btn.dataset.reconnectCode;
            if (!groupName || !reconnectCode) return;

            const link = this.buildReconnectLink(groupName, reconnectCode);
            if (btn.dataset.action === 'copy-link') {
                this.copyToClipboard(link);
            }

            if (btn.dataset.action === 'copy-code') {
                this.copyToClipboard(reconnectCode);
            }
        });

        // Close lobby
        document.getElementById('close-lobby-btn').addEventListener('click', () => {
            if (confirm('Are you sure you want to close this lobby?')) {
                this.closeLobby();
            }
        });

        // Content tab - file upload
        document.getElementById('content-file').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                document.getElementById('selected-file-name').textContent = file.name;
                this.handleContentFile(file);
            }
        });

        // Content tab - select from saved
        document.getElementById('content-select').addEventListener('change', (e) => {
            const select = e.target;
            const loadBtn = document.getElementById('load-selected-content-btn');
            loadBtn.disabled = !select.value;
        });

        document.getElementById('load-selected-content-btn').addEventListener('click', async () => {
            const filename = document.getElementById('content-select').value;
            if (filename) {
                await this.loadSelectedContent(filename);
            }
        });

        document.getElementById('broadcast-content-btn').addEventListener('click', () => {
            this.broadcastContent();
        });

        document.getElementById('reveal-answers-btn').addEventListener('click', () => {
            this.revealAnswers();
        });

        // Topic navigation
        document.getElementById('prev-topic-btn').addEventListener('click', () => {
            this.switchTopic(this.currentTopicIndex - 1);
        });

        document.getElementById('next-topic-btn').addEventListener('click', () => {
            this.switchTopic(this.currentTopicIndex + 1);
        });

        // Wheels tab
        document.getElementById('new-wheel-btn').addEventListener('click', () => {
            this.openWheelModal();
        });

        document.getElementById('save-wheels-btn').addEventListener('click', () => {
            this.saveWheelsToFile();
        });

        document.getElementById('spin-all-btn').addEventListener('click', () => {
            this.spinAllWheels();
        });

        document.getElementById('dependent-mode').addEventListener('change', (e) => {
            this.dependentMode = e.target.checked;
        });

        document.getElementById('preset-select').addEventListener('change', (e) => {
            this.loadWheelPreset(e.target.value);
        });

        // Modal events
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.target.closest('.modal').classList.remove('active');
            });
        });

        // Results modal buttons
        document.getElementById('dismiss-results-btn')?.addEventListener('click', () => {
            this.setSpinFeedback('');
            document.getElementById('result-modal').classList.remove('active');
        });

        document.getElementById('clear-results-btn')?.addEventListener('click', () => {
            this.spinResults = [];
            this.renderSpinResults();
            this.setSpinFeedback('');
            document.getElementById('result-modal').classList.remove('active');
        });

        document.getElementById('wheel-type').addEventListener('change', (e) => {
            this.handleWheelTypeChange(e.target.value);
        });

        document.getElementById('save-wheel-btn').addEventListener('click', () => {
            this.saveWheel();
        });

        document.getElementById('delete-wheel-btn').addEventListener('click', () => {
            this.deleteWheel();
        });

        // Close modal on backdrop click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });
    }

    createLobby() {
        this.socket.emit('create-lobby', {}, (response) => {
            if (response.error) {
                console.error('Error creating lobby:', response.error);
                alert('Error creating lobby: ' + response.error);
                return;
            }

            this.roomCode = response.roomCode;
            this.hostToken = response.hostToken;
            
            // Save to session for reconnection
            sessionStorage.setItem('roomCode', this.roomCode);
            sessionStorage.setItem('hostToken', this.hostToken);

            // Update UI
            document.getElementById('room-code-display').textContent = this.roomCode;
            document.getElementById('join-url').value = response.joinUrl;
            this.joinUrl = response.joinUrl;

            // Load QR code
            this.loadQRCode();

            console.log(`Lobby created: ${this.roomCode}`);
        });
    }

    async loadQRCode() {
        try {
            const response = await fetch(`/api/qr/${this.roomCode}`);
            const data = await response.json();
            document.getElementById('qr-code').src = data.qrCode;
        } catch (error) {
            console.error('Error loading QR code:', error);
        }
    }

    handleGroupJoined(data) {
        this.groups.clear();
        data.groups.forEach(group => {
            this.groups.set(group.name, group);
        });

        this.updateGroupsList();
        document.getElementById('group-count').textContent = data.groupCount ?? Array.from(this.groups.values()).filter(group => group.connected !== false).length;
        
        // Update group tabs and inputs
        this.updateGroupTabs();
    }

    handleGroupLeft(data) {
        this.groups.clear();
        data.groups.forEach(group => {
            this.groups.set(group.name, group);
        });

        this.updateGroupsList();
        document.getElementById('group-count').textContent = data.groupCount ?? Array.from(this.groups.values()).filter(group => group.connected !== false).length;
        
        // Update group tabs and inputs
        if (this.selectedGroupName && !this.groups.has(this.selectedGroupName)) {
            this.selectedGroupName = null;
        }
        this.updateGroupTabs();
    }

    updateGroupsList() {
        const container = document.getElementById('groups-list');

        if (this.groups.size === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>No groups connected yet</p>
                    <p class="hint">Share the room code or QR code to let groups join</p>
                </div>
            `;
            this.renderReconnectList();
            return;
        }

        container.innerHTML = Array.from(this.groups.values()).map(group => `
            <div class="group-card" data-group="${group.name}">
                <div class="group-info">
                    <span class="group-name">${group.name}</span>
                    <span class="group-status ${group.connected === false ? 'offline' : 'online'}">${group.connected === false ? 'Disconnected' : 'Connected'}</span>
                </div>
                <div class="group-stats">
                    <span class="group-answers">0/0 answered</span>
                </div>
            </div>
        `).join('');

        this.refreshGroupStatsForCurrentTopic();
        this.renderReconnectList();
    }

    handleAnswerSubmitted(data) {
        const { groupName, blankId, answer, totalAnswers, topicId, submittedAt } = data;
        const normalizedTopicId = topicId || 'main';
        
        // Store answer per group and topic
        if (!this.groupAnswers.has(groupName)) {
            this.groupAnswers.set(groupName, new Map());
        }
        const groupTopicAnswers = this.groupAnswers.get(groupName);
        if (!groupTopicAnswers.has(normalizedTopicId)) {
            groupTopicAnswers.set(normalizedTopicId, new Map());
        }
        groupTopicAnswers.get(normalizedTopicId).set(blankId, answer);

        // Update UI
        const groupCard = document.querySelector(`.group-card[data-group="${groupName}"]`);
        if (groupCard) {
            const stats = groupCard.querySelector('.group-answers');
            // Get total blanks from current topic
            const currentTopic = this.topics[this.currentTopicIndex] || this.currentContent;
            const totalBlanks = currentTopic?.keyTerms?.length || 0;
            if ((currentTopic?.id || 'main') === normalizedTopicId) {
                stats.textContent = `${totalAnswers}/${totalBlanks} answered`;
            }
        }

        // Update group inputs if visible
        if (this.selectedGroupName === groupName) {
            this.updateGroupInputs();
        }

        this.addInputLogEntry({
            type: 'answer',
            groupName,
            topicId: normalizedTopicId,
            blankId,
            answer,
            submittedAt: submittedAt || Date.now()
        });
    }

    handleTopicCompleted(data) {
        this.addInputLogEntry({
            type: 'topic-complete',
            groupName: data.groupName,
            topicId: data.topicId,
            submittedAt: data.completedAt || Date.now(),
            submittedCount: data.submittedCount,
            requiredCount: data.requiredCount
        });
    }

    buildReconnectLink(groupName, reconnectCode) {
        const origin = window.location.origin;
        const params = new URLSearchParams({
            room: this.roomCode,
            group: groupName,
            reconnect: reconnectCode
        });
        return `${origin}/player.html?${params.toString()}`;
    }

    renderReconnectList() {
        const reconnectList = document.getElementById('reconnect-list');
        if (!reconnectList) return;

        const disconnectedGroups = Array.from(this.groups.values())
            .filter(group => group.connected === false && group.reconnectCode)
            .sort((a, b) => (b.disconnectedAt || 0) - (a.disconnectedAt || 0));

        if (disconnectedGroups.length === 0) {
            reconnectList.innerHTML = '<p class="empty-hint">No disconnected groups.</p>';
            return;
        }

        reconnectList.innerHTML = disconnectedGroups.map(group => {
            const timestamp = group.disconnectedAt ? this.formatTime(group.disconnectedAt) : 'Unknown time';
            const safeGroupName = this.escapeHtml(group.name);
            const safeCode = this.escapeHtml(group.reconnectCode);
            return `
                <div class="reconnect-row">
                    <div class="reconnect-meta">
                        <div class="group-name">${safeGroupName}</div>
                        <div class="hint">Left at ${timestamp}</div>
                    </div>
                    <code class="reconnect-code">${safeCode}</code>
                    <button class="btn btn-secondary" data-action="copy-link" data-group-name="${safeGroupName}" data-reconnect-code="${safeCode}">Copy Link</button>
                    <button class="btn btn-secondary" data-action="copy-code" data-group-name="${safeGroupName}" data-reconnect-code="${safeCode}">Copy Code</button>
                </div>
            `;
        }).join('');
    }

    addInputLogEntry(entry) {
        this.inputLogs.unshift(entry);
        if (this.inputLogs.length > this.maxInputLogs) {
            this.inputLogs.length = this.maxInputLogs;
        }

        this.renderInputLog();
    }

    renderInputLog() {
        const container = document.getElementById('input-log-list');
        if (!container) return;

        if (this.inputLogs.length === 0) {
            container.innerHTML = '<p class="empty-hint">No input activity yet.</p>';
            return;
        }

        container.innerHTML = this.inputLogs.map((entry) => {
            const timestamp = this.formatTime(entry.submittedAt || Date.now());
            const safeGroupName = this.escapeHtml(entry.groupName || 'Unknown Group');
            const safeTopicId = this.escapeHtml(entry.topicId || 'main');
            if (entry.type === 'topic-complete') {
                return `
                    <div class="log-row complete">
                        <span class="log-time">${timestamp}</span>
                        <span class="log-text"><strong>${safeGroupName}</strong> finished <strong>${safeTopicId}</strong> (${entry.submittedCount}/${entry.requiredCount}).</span>
                    </div>
                `;
            }

            const safeBlankId = this.escapeHtml(entry.blankId || 'blank');
            const safeAnswer = this.escapeHtml(String(entry.answer || ''));

            return `
                <div class="log-row">
                    <span class="log-time">${timestamp}</span>
                    <span class="log-text"><strong>${safeGroupName}</strong> - ${safeTopicId}/${safeBlankId}: ${safeAnswer}</span>
                </div>
            `;
        }).join('');
    }

    formatTime(value) {
        const time = value ? new Date(value) : new Date();
        return time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    handleContentFile(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                let content;
                
                if (file.name.endsWith('.json')) {
                    content = JSON.parse(e.target.result);
                } else {
                    content = this.parseMarkdown(e.target.result);
                }

                this.currentContent = content;
                
                // Set up topics - support both multi-topic and single-topic formats
                if (content.topics && Array.isArray(content.topics)) {
                    this.topics = this.normalizeTopics(content.topics);
                } else {
                    // Single topic - wrap in array for consistency
                    this.topics = this.normalizeTopics([content]);
                }
                this.currentTopicIndex = 0;
                
                this.showContentPreview(content);
                document.getElementById('broadcast-content-btn').disabled = false;
            } catch (error) {
                console.error('Error loading content:', error);
                alert('Error loading content file');
            }
        };
        reader.readAsText(file);
    }

    async loadSelectedContent(filename) {
        try {
            const response = await fetch(`/api/content/${filename}`);
            if (!response.ok) {
                throw new Error('Failed to load content');
            }
            const content = await response.json();
            
            this.currentContent = content;
            
            // Set up topics - support both multi-topic and single-topic formats
            if (content.topics && Array.isArray(content.topics)) {
                this.topics = this.normalizeTopics(content.topics);
            } else {
                // Single topic - wrap in array for consistency
                this.topics = this.normalizeTopics([content]);
            }
            this.currentTopicIndex = 0;
            
            this.showContentPreview(content);
            document.getElementById('broadcast-content-btn').disabled = false;
        } catch (error) {
            console.error('Error loading selected content:', error);
            alert('Error loading content file');
        }
    }

    parseMarkdown(markdown) {
        const lines = markdown.split('\n');
        let title = 'Untitled';
        let text = '';
        const keyTerms = [];
        let blankIndex = 0;

        lines.forEach((line, index) => {
            if (line.startsWith('# ') && index === 0) {
                title = line.substring(2).trim();
                return;
            }

            const processedLine = line.replace(/\{\{(.+?)\}\}/g, (match, term) => {
                const blankId = `blank-${blankIndex++}`;
                keyTerms.push({
                    id: blankId,
                    term: term.trim(),
                    alternatives: []
                });
                return `{{${blankId}}}`;
            });

            text += processedLine + ' ';
        });

        return { title, text: text.trim(), keyTerms };
    }

    normalizeTopics(topics) {
        return (topics || []).map((topic, index) => ({
            ...topic,
            id: topic?.id || `topic-${index + 1}`
        }));
    }

    async loadContentFiles() {
        try {
            const response = await fetch('/api/content');
            const data = await response.json();

            const select = document.getElementById('content-select');
            
            if (data.files && data.files.length > 0) {
                select.innerHTML = '<option value="">-- Select content --</option>' +
                    data.files.map(file => 
                        `<option value="${file.filename}">${file.name}</option>`
                    ).join('');
            } else {
                select.innerHTML = '<option value="">No content files found</option>';
            }
        } catch (error) {
            console.error('Error loading content files:', error);
            document.getElementById('content-select').innerHTML = '<option value="">Error loading content</option>';
        }
    }

    showContentPreview(content) {
        const container = document.getElementById('content-preview');
        
        // Get current topic - either from multi-topic or single topic format
        let currentTopic;
        if (this.topics && this.topics.length > 0) {
            currentTopic = this.topics[this.currentTopicIndex];
        } else {
            currentTopic = content;
        }
        
        let html = currentTopic.text || '';
        currentTopic.keyTerms?.forEach(term => {
            html = html.replace(`{{${term.id}}}`, `<span class="blank">${this.buildBlankHint(term.term || '')}</span>`);
        });

        const totalTopics = this.topics?.length || 1;
        
        container.innerHTML = `
            <div class="content-header">
                <h3>${currentTopic.title || content.title}</h3>
                <span class="topic-info">Topic ${this.currentTopicIndex + 1} of ${totalTopics}</span>
                <span class="blank-count">${currentTopic.keyTerms?.length || 0} blanks</span>
            </div>
            <div class="content-body">${html}</div>
        `;

        // Show/hide topic tabs based on content type
        this.updateTopicTabs();

        // Show/hide group tabs and inputs
        this.updateGroupTabs();

        // Update navigation buttons
        this.updateTopicNavButtons();
    }

    updateTopicTabs() {
        const tabsContainer = document.getElementById('admin-topic-tabs');
        if (!tabsContainer) return;

        if (this.topics && this.topics.length > 1) {
            tabsContainer.classList.remove('hidden');
            tabsContainer.innerHTML = this.topics.map((topic, index) => `
                <button class="tab ${index === this.currentTopicIndex ? 'active' : ''}" 
                        data-topic-index="${index}">
                    ${topic.title || `Topic ${index + 1}`}
                </button>
            `).join('');

            // Add click handlers
            tabsContainer.querySelectorAll('.tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    this.switchTopic(parseInt(tab.dataset.topicIndex));
                });
            });
        } else {
            tabsContainer.classList.add('hidden');
        }
    }

    buildBlankHint(answer) {
        if (!answer) return '____';

        const words = answer.trim().split(/\s+/).filter(Boolean);
        if (words.length === 0) return '____';

        return words.map(word => {
            const cleanLen = (word.match(/[A-Za-z0-9]/g) || []).length;
            const len = Math.max(2, Math.min(cleanLen || word.length, 12));
            return '_'.repeat(len);
        }).join(' ');
    }

    switchTopic(index) {
        if (index < 0 || index >= this.topics.length) return;
        
        this.currentTopicIndex = index;
        this.showContentPreview(this.currentContent);
        this.updateGroupInputs();
        this.refreshGroupStatsForCurrentTopic();
    }

    getCurrentTopicId() {
        const currentTopic = this.topics[this.currentTopicIndex] || this.currentContent;
        return currentTopic?.id || 'main';
    }

    getGroupTopicAnswers(groupName, topicId = this.getCurrentTopicId()) {
        return this.groupAnswers.get(groupName)?.get(topicId) || new Map();
    }

    refreshGroupStatsForCurrentTopic() {
        const currentTopic = this.topics[this.currentTopicIndex] || this.currentContent;
        const totalBlanks = currentTopic?.keyTerms?.length || 0;
        const topicId = this.getCurrentTopicId();

        document.querySelectorAll('.group-card').forEach(card => {
            const groupName = card.dataset.group;
            const answersMap = this.getGroupTopicAnswers(groupName, topicId);
            const stats = card.querySelector('.group-answers');
            if (stats) {
                stats.textContent = `${answersMap.size}/${totalBlanks} answered`;
            }
        });
    }

    updateTopicNavButtons() {
        const prevBtn = document.getElementById('prev-topic-btn');
        const nextBtn = document.getElementById('next-topic-btn');
        
        if (prevBtn && nextBtn) {
            prevBtn.disabled = this.currentTopicIndex <= 0;
            nextBtn.disabled = this.currentTopicIndex >= this.topics.length - 1;
        }
    }

    updateGroupTabs() {
        const groupTabsContainer = document.getElementById('group-tabs');
        const groupInputsContainer = document.getElementById('group-inputs');
        
        if (!groupTabsContainer || !groupInputsContainer) return;

        const groups = Array.from(this.groups.values());
        
        if (groups.length > 0 && this.currentContent) {
            groupTabsContainer.classList.remove('hidden');
            groupInputsContainer.classList.remove('hidden');
            
            // Auto-select first group if none selected
            if (!this.selectedGroupName) {
                this.selectedGroupName = groups[0].name;
            }

            const tabsList = document.getElementById('group-tabs-list');
            tabsList.innerHTML = groups.map(group => `
                <button class="tab ${group.name === this.selectedGroupName ? 'active' : ''}" 
                        data-group-name="${group.name}">
                    ${group.name}
                </button>
            `).join('');

            // Add click handlers
            tabsList.querySelectorAll('.tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    this.selectedGroupName = tab.dataset.groupName;
                    this.updateGroupTabs();
                    this.updateGroupInputs();
                });
            });

            this.updateGroupInputs();
        } else {
            groupTabsContainer.classList.add('hidden');
            groupInputsContainer.classList.add('hidden');
        }
    }

    updateGroupInputs() {
        const inputsList = document.getElementById('group-inputs-list');
        if (!inputsList) return;

        const currentTopic = this.topics[this.currentTopicIndex] || this.currentContent;
        if (!currentTopic || !this.selectedGroupName) {
            inputsList.innerHTML = '<p class="empty-state">Select a group to view inputs</p>';
            return;
        }

        const group = this.groups.get(this.selectedGroupName);
        const topicId = currentTopic.id || 'main';
        const groupAnswersMap = this.getGroupTopicAnswers(this.selectedGroupName, topicId);
        
        if (!group) {
            inputsList.innerHTML = '<p class="empty-state">Group not found</p>';
            return;
        }

        const keyTerms = currentTopic.keyTerms || [];
        
        let html = `<div class="input-card">
            <div class="group-name">${group.name}</div>`;
        
        keyTerms.forEach(term => {
            const answer = groupAnswersMap?.get(term.id);
            const isCorrect = answer && (answer.toLowerCase() === term.term.toLowerCase() || 
                (term.alternatives && term.alternatives.some(a => a.toLowerCase() === answer.toLowerCase())));
            
            html += `
                <div class="input-item">
                    <span class="blank-label">${term.id}:</span>
                    <span class="user-input ${answer ? (isCorrect ? 'correct' : 'incorrect') : ''}">${answer || '—'}</span>
                </div>
            `;
        });
        
        html += '</div>';
        inputsList.innerHTML = html;
    }

    broadcastContent() {
        if (!this.currentContent) return;

        if (!this.socket.connected) {
            alert('Connection lost. Please refresh the page.');
            return;
        }

        this.socket.emit('load-content', {
            roomCode: this.roomCode,
            hostToken: this.hostToken,
            content: this.currentContent
        }, (response) => {
            if (response?.error) {
                alert('Error broadcasting content: ' + response.error);
                return;
            }

            // Reset group answers tracking
            this.groupAnswers.clear();

            const revealBtn = document.getElementById('reveal-answers-btn');
            if (revealBtn) {
                revealBtn.disabled = false;
            }

            this.refreshGroupStatsForCurrentTopic();

            alert('Content broadcasted to all groups!');
        });
    }

    revealAnswers() {
        if (!this.currentContent) return;

        if (!this.socket.connected) {
            alert('Connection lost. Please refresh the page.');
            return;
        }

        // Get current topic - either from multi-topic or single topic format
        let currentTopic;
        let topicId;
        
        if (this.topics && this.topics.length > 0) {
            // Multi-topic content
            currentTopic = this.topics[this.currentTopicIndex];
            topicId = currentTopic?.id;
        } else {
            // Single topic (backward compatible)
            currentTopic = this.currentContent;
        }

        if (!currentTopic || !currentTopic.keyTerms) {
            alert('No content to reveal');
            return;
        }

        const answers = currentTopic.keyTerms.map(term => ({
            blankId: term.id,
            answer: term.term
        }));

        this.socket.emit('reveal-answers', {
            roomCode: this.roomCode,
            hostToken: this.hostToken,
            answers,
            topicId
        });

        // Update preview to show answers for current topic
        const container = document.getElementById('content-preview');
        if (container) {
            let html = currentTopic.text || '';
            currentTopic.keyTerms?.forEach(term => {
                html = html.replace(`{{${term.id}}}`, `<span class="blank revealed">${term.term}</span>`);
            });

            const body = container.querySelector('.content-body');
            if (body) {
                body.innerHTML = html;
            }
        }

        alert('Answers revealed to all groups!');
    }

    // Wheel management
    async loadWheelPresets() {
        try {
            const response = await fetch('/api/wheels');
            const data = await response.json();
            this.wheelConfigs = [...(data.presets || []), ...(data.custom || [])];

            // Populate preset select
            const select = document.getElementById('preset-select');
            select.innerHTML = '<option value="">Select a preset...</option>' +
                this.wheelConfigs.map(config => 
                    `<option value="${config.id}">${config.name}</option>`
                ).join('');
        } catch (error) {
            console.error('Error loading wheel presets:', error);
        }
    }

    loadWheelPreset(configId) {
        if (!configId) return;

        const config = this.wheelConfigs.find(c => c.id === configId);
        if (config && config.wheels) {
            this.loadWheels({ wheels: config.wheels });
        }
    }

    loadWheels(data) {
        this.wheelData = data;
        this.wheels.clear();

        const container = document.getElementById('wheels-display');
        container.innerHTML = '';

        data.wheels.forEach((config, index) => {
            this.createWheelCard(config, index, container);
        });

        this.updateWheelsEditorList();
    }

    createWheelCard(config, index, container) {
        const wheelId = `wheel-canvas-${index}`;
        
        const card = document.createElement('div');
        card.className = 'wheel-card';
        card.innerHTML = `
            <div class="wheel-header">
                <h3>${config.name}</h3>
                <button class="btn-icon edit-wheel-btn" data-wheel-index="${index}">✏️</button>
            </div>
            <div class="wheel-canvas-container">
                <canvas id="${wheelId}" class="wheel-canvas"></canvas>
            </div>
            <div class="wheel-result" id="result-${config.id}">
                <span class="result-label">Result:</span>
                <span class="result-value">-</span>
            </div>
            <div class="wheel-controls">
                <button class="btn btn-primary spin-btn" data-wheel-id="${config.id}">Spin</button>
                <button class="btn btn-secondary remove-last-btn" data-wheel-id="${config.id}">Remove Result</button>
                <button class="btn btn-secondary reset-btn" data-wheel-id="${config.id}">Reset</button>
            </div>
        `;

        container.appendChild(card);

        // Initialize wheel
        const wheel = new Wheel(wheelId, {
            id: config.id,
            name: config.name,
            items: config.type === 'dependent' ? [] : config.items,
            colors: config.colors,
            spinDuration: config.settings?.spinDuration || 3000
        });

        wheel.wheelConfig = config;
        this.wheels.set(config.id, wheel);

        // Event handlers
        wheel.onSpinComplete = (data) => {
            this.handleWheelSpinComplete(config, data);
        };

        card.querySelector('.spin-btn').addEventListener('click', () => this.spinSingleWheel(config.id));
        card.querySelector('.remove-last-btn').addEventListener('click', () => this.removeLastResultForWheel(config.id));
        card.querySelector('.reset-btn').addEventListener('click', () => wheel.reset());
        card.querySelector('.edit-wheel-btn').addEventListener('click', () => {
            this.openWheelModal(config.id);
        });

        if (config.type === 'dependent') {
            wheel.parentWheelId = config.dependsOn;
        }
    }

    updateWheelResult(wheelId, result) {
        const resultEl = document.getElementById(`result-${wheelId}`);
        if (resultEl) {
            resultEl.querySelector('.result-value').textContent = result ? result.value : '-';
        }
    }

    handleWheelSpinComplete(config, data) {
        this.updateWheelResult(config.id, data.result);

        if (data.result) {
            this.spinResults.push({
                wheelId: config.id,
                wheelName: config.name,
                wheelType: config.type,
                result: data.result.value,
                sourceKey: config.type === 'dependent' ? (this.dependentSourceByWheel.get(config.id) || null) : null,
                timestamp: Date.now()
            });
        }

        if (this.dependentMode && config.type === 'independent') {
            this.handleDependentUpdate(config.id, data.result);
        }

        this.socket.emit('spin-wheel', {
            roomCode: this.roomCode,
            hostToken: this.hostToken,
            wheelId: config.id,
            result: data.result
        });
    }

    startSpinBatch() {
        if (this.activeSpinBatch) {
            return this.activeSpinBatch;
        }

        let resolveDone;
        const donePromise = new Promise((resolve) => {
            resolveDone = resolve;
        });

        this.spinResults = [];
        this.renderSpinResults();
        document.getElementById('result-modal').classList.remove('active');

        this.activeSpinBatch = {
            pending: 0,
            resolveDone,
            donePromise
        };

        return this.activeSpinBatch;
    }

    queueWheelSpin(wheel, sourceKey = null, delayMs = 0) {
        const batch = this.startSpinBatch();
        batch.pending += 1;

        if (sourceKey) {
            this.dependentSourceByWheel.set(wheel.id, sourceKey);
        }

        const runSpin = () => {
            wheel.spin()
                .catch(error => {
                    console.error('Error spinning wheel:', wheel?.wheelConfig?.name || wheel.id, error);
                })
                .finally(() => {
                    this.finishWheelSpin();
                });
        };

        if (delayMs > 0) {
            setTimeout(runSpin, delayMs);
        } else {
            runSpin();
        }
    }

    finishWheelSpin() {
        if (!this.activeSpinBatch) return;

        this.activeSpinBatch.pending = Math.max(0, this.activeSpinBatch.pending - 1);

        if (this.activeSpinBatch.pending === 0) {
            this.showResultsModal();
            this.activeSpinBatch.resolveDone();
            this.activeSpinBatch = null;
        }
    }

    async spinSingleWheel(wheelId) {
        if (this.activeSpinBatch) return;

        const wheel = this.wheels.get(wheelId);
        if (!wheel || wheel.isCurrentlySpinning()) return;

        const batch = this.startSpinBatch();
        this.queueWheelSpin(wheel);
        await batch.donePromise;
    }

    showResultsModal() {
        this.renderSpinResults();
        document.getElementById('result-modal').classList.add('active');
    }

    renderSpinResults() {
        const container = document.getElementById('spin-results-list');
        
        if (this.spinResults.length === 0) {
            container.innerHTML = '<div class="spin-results-empty">No spin results yet. Spin some wheels!</div>';
            return;
        }

        container.innerHTML = this.spinResults.map((result, index) => `
            <div class="spin-result-item" data-index="${index}">
                <div class="result-info">
                    <div class="wheel-name">${result.wheelName} (${result.wheelType})</div>
                    <div class="result-value">${result.result}</div>
                </div>
                <button class="remove-btn" onclick="host.removeSpinResult(${index})" title="Remove">✕</button>
            </div>
        `).join('');
    }

    removeSpinResult(index) {
        const result = this.spinResults[index];
        if (!result) return;

        const removed = this.removeResultFromWheel(result);
        if (!removed) {
            this.setSpinFeedback('Could not remove that name from the wheel.', 'error');
            return;
        }

        this.spinResults.splice(index, 1);
        this.renderSpinResults();
        this.setSpinFeedback(`Removed "${result.result}" from ${result.wheelName}.`, 'success');
        
        if (this.spinResults.length === 0) {
            document.getElementById('result-modal').classList.remove('active');
        }
    }

    removeLastResultForWheel(wheelId) {
        const wheel = this.wheels.get(wheelId);
        if (!wheel) return;

        const latest = [...this.spinResults].reverse().find(r => r.wheelId === wheelId);
        const resultValue = latest?.result || wheel.getResult()?.value;

        if (!resultValue) {
            this.setSpinFeedback('Spin the wheel first before removing a result.', 'error');
            return;
        }

        const removed = this.removeResultFromWheel({
            wheelId,
            result: resultValue,
            sourceKey: latest?.sourceKey || null
        });

        if (!removed) {
            this.setSpinFeedback('Could not remove that name from the wheel.', 'error');
            return;
        }

        this.spinResults = this.spinResults.filter(r => !(r.wheelId === wheelId && r.result === resultValue));
        this.renderSpinResults();
        this.updateWheelResult(wheelId, null);
        wheel.result = null;
        this.setSpinFeedback(`Removed "${resultValue}" from ${wheel.wheelConfig?.name || 'wheel'}.`, 'success');
    }

    setSpinFeedback(message, type = '') {
        const feedbackEl = document.getElementById('spin-results-feedback');
        if (!feedbackEl) return;

        feedbackEl.textContent = message || '';
        feedbackEl.className = `spin-feedback${type ? ` ${type}` : ''}`;

        if (this.feedbackTimer) {
            clearTimeout(this.feedbackTimer);
            this.feedbackTimer = null;
        }

        if (message) {
            this.feedbackTimer = setTimeout(() => {
                feedbackEl.textContent = '';
                feedbackEl.className = 'spin-feedback';
                this.feedbackTimer = null;
            }, 2500);
        }
    }

    removeResultFromWheel(spinResult) {
        const wheel = this.wheels.get(spinResult.wheelId);
        if (!wheel || !wheel.wheelConfig) return false;

        const config = wheel.wheelConfig;
        let removed = false;

        const dependentKey = spinResult.sourceKey || this.dependentSourceByWheel.get(spinResult.wheelId) || null;

        if (config.type === 'dependent' && dependentKey && config.data?.[dependentKey]) {
            removed = this.removeFirstItem(config.data[dependentKey], spinResult.result);

            if (removed) {
                const activeSource = this.dependentSourceByWheel.get(spinResult.wheelId);
                if (activeSource && config.data?.[activeSource]) {
                    wheel.setItems([...config.data[activeSource]], false);
                } else {
                    wheel.setItems([...wheel.currentItems], false);
                }
            }
        } else {
            removed = this.removeFirstItem(config.items, spinResult.result);

            if (removed) {
                wheel.items = [...config.items];
                wheel.setItems([...config.items], false);
            }
        }

        return removed;
    }

    removeFirstItem(items, value) {
        if (!Array.isArray(items)) return false;
        const index = items.indexOf(value);
        if (index === -1) return false;
        items.splice(index, 1);
        return true;
    }

    handleDependentUpdate(sourceWheelId, result) {
        if (!result || !result.value) return;

        console.log('Handling dependent update:', sourceWheelId, result.value);

        this.wheels.forEach((wheel, wheelId) => {
            if (wheel.wheelConfig?.type === 'dependent' && 
                wheel.wheelConfig?.dependsOn === sourceWheelId) {
                
                console.log('Found dependent wheel:', wheelId, wheel.wheelConfig.name);
                
                const dependentData = wheel.wheelConfig.data;
                console.log('Dependent data:', dependentData);
                console.log('Looking for key:', result.value);
                
                const newItems = dependentData[result.value] || [];
                console.log('New items:', newItems);
                
                if (newItems.length > 0) {
                    wheel.setItems(newItems, true);
                    this.dependentSourceByWheel.set(wheelId, result.value);

                    console.log('Auto-spinning dependent wheel:', wheel.wheelConfig.name);
                    this.queueWheelSpin(wheel, result.value, 800);
                } else {
                    console.log('No items found for:', result.value);
                }
            }
        });
    }

    updateWheelsEditorList() {
        const container = document.getElementById('wheels-editor-list');
        
        if (this.wheels.size === 0) {
            container.innerHTML = '<p class="empty-hint">No wheels configured</p>';
            return;
        }

        container.innerHTML = Array.from(this.wheels.values()).map((wheel, index) => `
            <div class="wheel-editor-item" data-wheel-id="${wheel.wheelConfig.id}">
                <span class="wheel-name">${index + 1}. ${wheel.wheelConfig.name}</span>
                <span class="wheel-type">${wheel.wheelConfig.type}</span>
            </div>
        `).join('');
    }

    openWheelModal(wheelId = null) {
        this.currentWheelId = wheelId;
        const modal = document.getElementById('wheel-modal');
        const title = document.getElementById('modal-title');

        if (wheelId) {
            const wheel = Array.from(this.wheels.values()).find(w => w.wheelConfig.id === wheelId);
            if (wheel) {
                title.textContent = 'Edit Wheel';
                this.populateWheelForm(wheel.wheelConfig);
            }
        } else {
            title.textContent = 'New Wheel';
            this.clearWheelForm();
        }

        modal.classList.add('active');
    }

    populateWheelForm(config) {
        document.getElementById('wheel-name').value = config.name;
        document.getElementById('wheel-type').value = config.type;
        document.getElementById('wheel-duration').value = config.settings?.spinDuration || 3000;
        document.getElementById('wheel-items').value = config.items?.join('\n') || '';

        this.handleWheelTypeChange(config.type);

        if (config.type === 'dependent') {
            document.getElementById('depends-on').value = config.dependsOn || '';
            
            // Format dependent data
            let dataText = '';
            for (const [key, values] of Object.entries(config.data || {})) {
                dataText += `${key}: ${values.join(', ')}\n`;
            }
            document.getElementById('wheel-data').value = dataText.trim();
        }
    }

    clearWheelForm() {
        document.getElementById('wheel-name').value = '';
        document.getElementById('wheel-type').value = 'independent';
        document.getElementById('wheel-duration').value = 3000;
        document.getElementById('wheel-items').value = '';
        document.getElementById('wheel-data').value = '';
        this.handleWheelTypeChange('independent');
    }

    handleWheelTypeChange(type) {
        const dependsOnGroup = document.getElementById('depends-on-group');
        const dependentData = document.getElementById('dependent-data');
        const dependsOn = document.getElementById('depends-on');

        if (type === 'dependent') {
            dependsOnGroup.classList.remove('hidden');
            dependentData.classList.remove('hidden');

            // Populate depends-on select
            const independentWheels = Array.from(this.wheels.values())
                .filter(w => w.wheelConfig.type === 'independent');
            
            dependsOn.innerHTML = independentWheels.map(w => 
                `<option value="${w.wheelConfig.id}">${w.wheelConfig.name}</option>`
            ).join('') || '<option value="">No independent wheels</option>';
        } else {
            dependsOnGroup.classList.add('hidden');
            dependentData.classList.add('hidden');
        }
    }

    saveWheel() {
        const name = document.getElementById('wheel-name').value.trim();
        const type = document.getElementById('wheel-type').value;
        const duration = parseInt(document.getElementById('wheel-duration').value);
        const itemsText = document.getElementById('wheel-items').value;

        if (!name) {
            alert('Please enter a wheel name');
            return;
        }

        const items = itemsText.split('\n').map(item => item.trim()).filter(item => item);

        const wheelConfig = {
            id: this.currentWheelId || `wheel-${Date.now()}`,
            name,
            type,
            items,
            colors: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#96CEB4', '#FFEAA7'],
            settings: { spinDuration: duration }
        };

        if (type === 'dependent') {
            wheelConfig.dependsOn = document.getElementById('depends-on').value;
            wheelConfig.data = this.parseDependentData(document.getElementById('wheel-data').value);
        }

        // Update or add wheel
        const wheels = this.wheelData?.wheels || [];
        const existingIndex = wheels.findIndex(w => w.id === wheelConfig.id);

        if (existingIndex >= 0) {
            wheels[existingIndex] = wheelConfig;
        } else {
            wheels.push(wheelConfig);
        }

        this.loadWheels({ wheels });
        document.getElementById('wheel-modal').classList.remove('active');

        // Broadcast wheel update to groups
        this.socket.emit('update-wheels', {
            roomCode: this.roomCode,
            hostToken: this.hostToken,
            wheels
        });
    }

    parseDependentData(text) {
        const data = {};
        text.split('\n').forEach(line => {
            const [key, valuesStr] = line.split(':');
            if (key && valuesStr) {
                data[key.trim()] = valuesStr.split(',').map(v => v.trim()).filter(v => v);
            }
        });
        return data;
    }

    deleteWheel() {
        if (!this.currentWheelId) return;

        if (!confirm('Are you sure you want to delete this wheel?')) return;

        const wheels = this.wheelData?.wheels.filter(w => w.id !== this.currentWheelId) || [];
        this.loadWheels({ wheels });
        document.getElementById('wheel-modal').classList.remove('active');
    }

    async saveWheelsToFile() {
        if (!this.wheelData?.wheels || this.wheelData.wheels.length === 0) {
            alert('No wheels to save');
            return;
        }

        const name = prompt('Enter a name for this wheel configuration:', 'My Wheels');
        if (!name) return;

        try {
            const response = await fetch('/api/wheels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    wheels: this.wheelData.wheels
                })
            });

            const result = await response.json();
            if (result.success) {
                alert('Wheels saved successfully!');
                this.loadWheelPresets();
            } else {
                alert('Error saving wheels: ' + result.error);
            }
        } catch (error) {
            console.error('Error saving wheels:', error);
            alert('Error saving wheels');
        }
    }

    async spinAllWheels() {
        if (this.spinAllInProgress || this.activeSpinBatch) return;

        this.spinAllInProgress = true;
        const spinBtn = document.getElementById('spin-all-btn');
        spinBtn.textContent = 'Spinning...';
        spinBtn.disabled = true;

        const independentWheels = [];
        this.wheels.forEach(wheel => {
            if (wheel.wheelConfig?.type !== 'dependent') {
                independentWheels.push(wheel);
            }
        });

        if (independentWheels.length === 0) {
            this.spinAllInProgress = false;
            spinBtn.textContent = '🎲 Spin All';
            spinBtn.disabled = false;
            return;
        }

        try {
            const batch = this.startSpinBatch();
            independentWheels.forEach(wheel => this.queueWheelSpin(wheel));
            await batch.donePromise;
        } catch (error) {
            console.error('Error spinning wheels:', error);
        } finally {
            this.spinAllInProgress = false;
            spinBtn.textContent = '🎲 Spin All';
            spinBtn.disabled = false;
        }
    }

    switchTab(tabName) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.tab === tabName);
        });

        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.toggle('active', tab.id === `${tabName}-tab`);
        });
    }

    closeLobby() {
        if (this.socket) {
            this.socket.disconnect();
        }
        window.location.reload();
    }

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            alert('Copied to clipboard!');
        });
    }

    showConnectionStatus(connected) {
        const status = document.querySelector('.connection-status .status-dot');
        if (status) {
            status.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.host = new Host();
});
