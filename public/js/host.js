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
        this.wheels = new Map();
        this.wheelData = null;
        this.dependentMode = true;
        this.spinAllInProgress = false;
        this.wheelConfigs = [];
        this.currentWheelId = null;
        this.groupAnswers = new Map(); // Track answers per group

        this.init();
    }

    init() {
        this.bindEvents();
        this.connectSocket();
        this.loadWheelPresets();
    }

    connectSocket() {
        this.socket = io();

        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.showConnectionStatus(true);
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
    }

    bindEvents() {
        // Login screen
        document.getElementById('create-lobby-btn').addEventListener('click', () => {
            this.createLobby();
        });

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

        // Close lobby
        document.getElementById('close-lobby-btn').addEventListener('click', () => {
            if (confirm('Are you sure you want to close this lobby?')) {
                this.closeLobby();
            }
        });

        // Content tab
        document.getElementById('content-file').addEventListener('change', (e) => {
            this.handleContentFile(e.target.files[0]);
        });

        document.getElementById('broadcast-content-btn').addEventListener('click', () => {
            this.broadcastContent();
        });

        document.getElementById('reveal-answers-btn').addEventListener('click', () => {
            this.revealAnswers();
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
        document.getElementById('create-lobby-btn').classList.add('hidden');
        document.getElementById('loading-indicator').classList.remove('hidden');

        this.socket.emit('create-lobby', {}, (response) => {
            document.getElementById('loading-indicator').classList.add('hidden');

            if (response.error) {
                alert('Error creating lobby: ' + response.error);
                document.getElementById('create-lobby-btn').classList.remove('hidden');
                return;
            }

            this.roomCode = response.roomCode;
            this.hostToken = response.hostToken;

            // Update UI
            document.getElementById('room-code-display').textContent = this.roomCode;
            document.getElementById('join-url').value = response.joinUrl;

            // Load QR code
            this.loadQRCode();

            // Switch to dashboard
            document.getElementById('login-screen').classList.remove('active');
            document.getElementById('dashboard-screen').classList.add('active');

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
        document.getElementById('group-count').textContent = data.groupCount;
    }

    handleGroupLeft(data) {
        this.groups.clear();
        data.groups.forEach(group => {
            this.groups.set(group.name, group);
        });

        this.updateGroupsList();
        document.getElementById('group-count').textContent = data.groupCount;
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
            return;
        }

        container.innerHTML = Array.from(this.groups.values()).map(group => `
            <div class="group-card" data-group="${group.name}">
                <div class="group-info">
                    <span class="group-name">${group.name}</span>
                    <span class="group-status">Connected</span>
                </div>
                <div class="group-stats">
                    <span class="group-answers">0/0 answered</span>
                </div>
            </div>
        `).join('');
    }

    handleAnswerSubmitted(data) {
        const { groupName, blankId, answer, totalAnswers } = data;
        
        // Store answer
        if (!this.groupAnswers.has(groupName)) {
            this.groupAnswers.set(groupName, new Map());
        }
        this.groupAnswers.get(groupName).set(blankId, answer);

        // Update UI
        const groupCard = document.querySelector(`.group-card[data-group="${groupName}"]`);
        if (groupCard) {
            const stats = groupCard.querySelector('.group-answers');
            const totalBlanks = this.currentContent?.keyTerms?.length || 0;
            stats.textContent = `${totalAnswers}/${totalBlanks} answered`;
        }
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
                this.showContentPreview(content);
                document.getElementById('broadcast-content-btn').disabled = false;
            } catch (error) {
                console.error('Error loading content:', error);
                alert('Error loading content file');
            }
        };
        reader.readAsText(file);
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

    showContentPreview(content) {
        const container = document.getElementById('content-preview');
        
        let html = content.text || '';
        content.keyTerms?.forEach(term => {
            html = html.replace(`{{${term.id}}}`, `<span class="blank">[${term.term}]</span>`);
        });

        container.innerHTML = `
            <div class="content-header">
                <h3>${content.title}</h3>
                <span class="blank-count">${content.keyTerms?.length || 0} blanks</span>
            </div>
            <div class="content-body">${html}</div>
        `;
    }

    broadcastContent() {
        if (!this.currentContent) return;

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
            
            // Show progress section
            document.getElementById('group-progress').classList.remove('hidden');
            document.getElementById('reveal-answers-btn').disabled = false;

            // Update progress list
            this.updateProgressList();

            alert('Content broadcasted to all groups!');
        });
    }

    updateProgressList() {
        const container = document.getElementById('progress-list');
        const totalBlanks = this.currentContent?.keyTerms?.length || 0;

        container.innerHTML = Array.from(this.groups.values()).map(group => `
            <div class="progress-item" data-group="${group.name}">
                <span class="group-name">${group.name}</span>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: 0%"></div>
                </div>
                <span class="progress-text">0/${totalBlanks}</span>
            </div>
        `).join('');
    }

    revealAnswers() {
        if (!this.currentContent) return;

        const answers = this.currentContent.keyTerms.map(term => ({
            blankId: term.id,
            answer: term.term
        }));

        this.socket.emit('reveal-answers', {
            roomCode: this.roomCode,
            hostToken: this.hostToken,
            answers
        });

        // Update preview to show answers
        const container = document.getElementById('content-preview');
        let html = this.currentContent.text || '';
        this.currentContent.keyTerms?.forEach(term => {
            html = html.replace(`{{${term.id}}}`, `<span class="blank revealed">${term.term}</span>`);
        });

        const body = container.querySelector('.content-body');
        if (body) {
            body.innerHTML = html;
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
            this.updateWheelResult(config.id, data.result);
            
            if (this.dependentMode && config.type === 'independent') {
                this.handleDependentUpdate(config.id, data.result);
            }

            // Broadcast to groups
            this.socket.emit('spin-wheel', {
                roomCode: this.roomCode,
                hostToken: this.hostToken,
                wheelId: config.id,
                result: data.result
            });
        };

        card.querySelector('.spin-btn').addEventListener('click', () => wheel.spin());
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

    handleDependentUpdate(sourceWheelId, result) {
        if (!result) return;

        this.wheels.forEach((wheel, wheelId) => {
            if (wheel.wheelConfig?.type === 'dependent' && 
                wheel.wheelConfig?.dependsOn === sourceWheelId) {
                
                const dependentData = wheel.wheelConfig.data;
                const newItems = dependentData[result.value] || [];
                
                wheel.setItems(newItems, true);
                
                setTimeout(() => {
                    if (newItems.length > 0) {
                        wheel.spin();
                    }
                }, 800);
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
        if (this.spinAllInProgress) return;

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

        try {
            await Promise.all(independentWheels.map(wheel => wheel.spin()));
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
