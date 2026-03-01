/**
 * Main Application Module
 * Manages all components and implements dependent wheel logic
 */

class ReqllApp {
    constructor() {
        this.reviewer = null;
        this.wheels = new Map();
        this.wheelData = null;
        this.dependentMode = true;
        this.spinAllInProgress = false;
        this.dependentTimeouts = new Map();
        this.eventListeners = [];
        
        this.init();
    }

    init() {
        this.initReviewer();
        this.bindEvents();
        this.loadSampleData();
    }

    /**
     * Initialize the fill-in-the-blank reviewer
     */
    initReviewer() {
        this.reviewer = new FillInTheBlankReviewer('content-area', {
            similarityThreshold: 0.8,
            caseSensitive: false,
            autoCheck: true
        });

        // Set up callbacks
        this.reviewer.onProgressUpdate = (progress) => {
            this.updateReviewerControls(progress);
        };

        this.reviewer.onAnswerCheck = (result) => {
            // Could trigger sounds or animations here
            console.log('Answer checked:', result);
        };
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Navigation tabs
        const tabHandler = (e) => {
            this.switchView(e.target.dataset.view);
        };
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', tabHandler);
            this.eventListeners.push({ el: tab, type: 'click', handler: tabHandler });
        });

        // File inputs
        const reviewerFileHandler = (e) => {
            this.handleReviewerFile(e.target.files[0]);
        };
        const reviewerFileInput = document.getElementById('reviewer-file');
        if (reviewerFileInput) {
            reviewerFileInput.addEventListener('change', reviewerFileHandler);
            this.eventListeners.push({ el: reviewerFileInput, type: 'change', handler: reviewerFileHandler });
        }

        const wheelsFileHandler = (e) => {
            this.handleWheelsFile(e.target.files[0]);
        };
        const wheelsFileInput = document.getElementById('wheels-file-input');
        if (wheelsFileInput) {
            wheelsFileInput.addEventListener('change', wheelsFileHandler);
            this.eventListeners.push({ el: wheelsFileInput, type: 'change', handler: wheelsFileHandler });
        }

        // Buttons
        const revealAllHandler = () => {
            this.reviewer.revealAll();
        };
        const revealAllBtn = document.getElementById('reveal-all-btn');
        if (revealAllBtn) {
            revealAllBtn.addEventListener('click', revealAllHandler);
            this.eventListeners.push({ el: revealAllBtn, type: 'click', handler: revealAllHandler });
        }

        const loadWheelsHandler = () => {
            document.getElementById('wheels-file-input').click();
        };
        const loadWheelsBtn = document.getElementById('load-wheels-btn');
        if (loadWheelsBtn) {
            loadWheelsBtn.addEventListener('click', loadWheelsHandler);
            this.eventListeners.push({ el: loadWheelsBtn, type: 'click', handler: loadWheelsHandler });
        }

        const spinAllHandler = () => {
            this.spinAll();
        };
        const spinAllBtn = document.getElementById('spin-all-btn');
        if (spinAllBtn) {
            spinAllBtn.addEventListener('click', spinAllHandler);
            this.eventListeners.push({ el: spinAllBtn, type: 'click', handler: spinAllHandler });
        }

        // Settings
        const similarityHandler = (e) => {
            const value = e.target.value;
            e.target.nextElementSibling.textContent = `${value}%`;
            this.reviewer.updateOptions({ similarityThreshold: value / 100 });
        };
        const similarityInput = document.getElementById('similarity-threshold');
        if (similarityInput) {
            similarityInput.addEventListener('input', similarityHandler);
            this.eventListeners.push({ el: similarityInput, type: 'input', handler: similarityHandler });
        }

        const caseSensitiveHandler = (e) => {
            this.reviewer.updateOptions({ caseSensitive: e.target.checked });
        };
        const caseSensitiveInput = document.getElementById('case-sensitive');
        if (caseSensitiveInput) {
            caseSensitiveInput.addEventListener('change', caseSensitiveHandler);
            this.eventListeners.push({ el: caseSensitiveInput, type: 'change', handler: caseSensitiveHandler });
        }

        const spinDurationHandler = (e) => {
            const duration = parseInt(e.target.value);
            this.wheels.forEach(wheel => {
                wheel.updateOptions({ spinDuration: duration });
            });
        };
        const spinDurationInput = document.getElementById('spin-duration');
        if (spinDurationInput) {
            spinDurationInput.addEventListener('change', spinDurationHandler);
            this.eventListeners.push({ el: spinDurationInput, type: 'change', handler: spinDurationHandler });
        }

        const animationSpeedHandler = (e) => {
            const value = e.target.value;
            e.target.nextElementSibling.textContent = `${value}x`;
        };
        const animationSpeedInput = document.getElementById('animation-speed');
        if (animationSpeedInput) {
            animationSpeedInput.addEventListener('input', animationSpeedHandler);
            this.eventListeners.push({ el: animationSpeedInput, type: 'input', handler: animationSpeedHandler });
        }

        // Dependent mode toggle
        const dependentModeHandler = (e) => {
            this.dependentMode = e.target.checked;
        };
        const dependentModeInput = document.getElementById('dependent-mode');
        if (dependentModeInput) {
            dependentModeInput.addEventListener('change', dependentModeHandler);
            this.eventListeners.push({ el: dependentModeInput, type: 'change', handler: dependentModeHandler });
        }

        // Modal close
        const modalCloseHandler = () => {
            this.hideModal();
        };
        const modalCloseBtn = document.querySelector('.modal-close');
        if (modalCloseBtn) {
            modalCloseBtn.addEventListener('click', modalCloseHandler);
            this.eventListeners.push({ el: modalCloseBtn, type: 'click', handler: modalCloseHandler });
        }

        const modalBackdropHandler = (e) => {
            if (e.target === e.currentTarget) {
                this.hideModal();
            }
        };
        const modalEl = document.getElementById('result-modal');
        if (modalEl) {
            modalEl.addEventListener('click', modalBackdropHandler);
            this.eventListeners.push({ el: modalEl, type: 'click', handler: modalBackdropHandler });
        }
    }

    /**
     * Cleanup all event listeners
     */
    cleanupEventListeners() {
        this.eventListeners.forEach(({ el, type, handler }) => {
            el.removeEventListener(type, handler);
        });
        this.eventListeners = [];
    }

    /**
     * Cleanup dependent wheel timeouts
     */
    cleanupDependentTimeouts() {
        this.dependentTimeouts.forEach(timeoutId => {
            clearTimeout(timeoutId);
        });
        this.dependentTimeouts.clear();
    }

    /**
     * Cleanup all wheel instances
     */
    cleanupWheels() {
        this.wheels.forEach(wheel => {
            if (typeof wheel.destroy === 'function') {
                wheel.destroy();
            }
        });
        this.wheels.clear();
    }

    /**
     * Switch between views
     * @param {string} viewName - Name of view to switch to
     */
    switchView(viewName) {
        // Update tabs
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.view === viewName);
        });

        // Update views
        document.querySelectorAll('.view').forEach(view => {
            view.classList.toggle('active', view.id === `${viewName}-view`);
        });
    }

    /**
     * Handle reviewer file upload
     * @param {File} file - Uploaded file
     */
    handleReviewerFile(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const success = this.reviewer.loadContent(e.target.result);
            if (success) {
                document.getElementById('reveal-all-btn').disabled = false;
            }
        };
        reader.readAsText(file);
    }

    /**
     * Update reviewer controls based on progress
     * @param {Object} progress - Progress data
     */
    updateReviewerControls(progress) {
        const revealBtn = document.getElementById('reveal-all-btn');
        if (revealBtn) {
            revealBtn.disabled = progress.total === 0;
        }
    }

    /**
     * Handle wheels file upload
     * @param {File} file - Uploaded file
     */
    handleWheelsFile(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                this.loadWheels(data);
            } catch (error) {
                console.error('Error parsing wheels file:', error);
                this.showModal('⚠️', 'Error', 'Failed to load wheels file. Please check the format.');
            }
        };
        reader.readAsText(file);
    }

    /**
     * Load wheels from data
     * @param {Object} data - Wheels configuration data
     */
    loadWheels(data) {
        // Cleanup existing wheels first
        this.cleanupDependentTimeouts();
        this.cleanupWheels();
        
        this.wheelData = data;

        const container = document.getElementById('wheels-container');
        container.innerHTML = '';

        // Create wheel cards
        data.wheels.forEach((wheelConfig, index) => {
            this.createWheelCard(wheelConfig, index, container);
        });

        // Update dependent mode from settings
        if (data.globalSettings?.dependentMode !== undefined) {
            this.dependentMode = data.globalSettings.dependentMode;
            document.getElementById('dependent-mode').checked = this.dependentMode;
        }
    }

    /**
     * Create a wheel card with canvas
     * @param {Object} config - Wheel configuration
     * @param {number} index - Wheel index
     * @param {HTMLElement} container - Container element
     */
    createWheelCard(config, index, container) {
        const wheelId = `wheel-canvas-${index}`;
        
        const card = document.createElement('div');
        card.className = 'wheel-card';
        card.innerHTML = `
            <div class="wheel-header">
                <h3>${config.name}</h3>
                <span class="wheel-status" id="status-${config.id}">Ready</span>
            </div>
            <div class="wheel-canvas-container">
                <canvas id="${wheelId}" class="wheel-canvas"></canvas>
            </div>
            <div class="wheel-result" id="result-${config.id}">
                <div class="wheel-result-label">Result</div>
                <div class="wheel-result-value">-</div>
            </div>
            <div class="wheel-controls">
                <button class="btn btn-primary spin-btn" data-wheel-id="${config.id}">🎯 Spin</button>
                <button class="btn btn-secondary reset-btn" data-wheel-id="${config.id}">↺ Reset</button>
            </div>
        `;
        
        container.appendChild(card);

        // Create wheel instance
        const wheel = new Wheel(wheelId, {
            id: config.id,
            name: config.name,
            items: config.type === 'dependent' ? [] : config.items,
            colors: config.colors,
            spinDuration: config.settings?.spinDuration || 3000,
            easing: config.settings?.easing || 'easeOut',
            size: 320
        });

        // Store wheel info
        wheel.wheelConfig = config;
        wheel.wheelCard = card;
        this.wheels.set(config.id, wheel);

        // Set up event handlers
        wheel.onSpinStart = (data) => {
            this.updateWheelStatus(config.id, 'spinning');
        };

        wheel.onSpinComplete = (data) => {
            this.updateWheelStatus(config.id, 'completed');
            this.updateWheelResult(config.id, data.result);
            
            // Handle dependent mode
            if (this.dependentMode && config.type === 'independent') {
                this.handleDependentUpdate(config.id, data.result);
            }
        };

        // Bind buttons
        card.querySelector('.spin-btn').addEventListener('click', () => {
            wheel.spin();
        });

        card.querySelector('.reset-btn').addEventListener('click', () => {
            wheel.reset();
            this.updateWheelStatus(config.id, 'ready');
            this.updateWheelResult(config.id, null);
        });

        // If it's a dependent wheel, store reference to its parent
        if (config.type === 'dependent') {
            wheel.parentWheelId = config.dependsOn;
        }
    }

    /**
     * Handle dependent wheel updates
     * @param {string} sourceWheelId - ID of wheel that just finished spinning
     * @param {Object} result - Spin result
     */
    handleDependentUpdate(sourceWheelId, result) {
        if (!result) return;

        const sourceValue = result.value;
        
        // Find dependent wheels
        this.wheels.forEach((wheel, wheelId) => {
            if (wheel.wheelConfig?.type === 'dependent' && 
                wheel.wheelConfig?.dependsOn === sourceWheelId) {
                
                // Update dependent wheel's items based on source result
                const dependentData = wheel.wheelConfig.data;
                const newItems = dependentData[sourceValue] || [];
                
                // Animate the update
                wheel.setItems(newItems, true);
                
                // Update status
                this.updateWheelStatus(wheelId, 'updated');
                
                // Clear any existing timeout for this wheel
                if (this.dependentTimeouts.has(wheelId)) {
                    clearTimeout(this.dependentTimeouts.get(wheelId));
                }
                
                // Auto-spin dependent wheel after a short delay
                const timeoutId = setTimeout(() => {
                    if (newItems.length > 0 && this.wheels.has(wheelId)) {
                        wheel.spin();
                    }
                    this.dependentTimeouts.delete(wheelId);
                }, 800);
                
                this.dependentTimeouts.set(wheelId, timeoutId);
            }
        });
    }

    /**
     * Update wheel status display
     * @param {string} wheelId - Wheel ID
     * @param {string} status - Status text
     */
    updateWheelStatus(wheelId, status) {
        const statusEl = document.getElementById(`status-${wheelId}`);
        if (statusEl) {
            statusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
            statusEl.className = `wheel-status ${status}`;
        }
    }

    /**
     * Update wheel result display
     * @param {string} wheelId - Wheel ID
     * @param {Object} result - Result object
     */
    updateWheelResult(wheelId, result) {
        const resultEl = document.getElementById(`result-${wheelId}`);
        if (resultEl) {
            const valueEl = resultEl.querySelector('.wheel-result-value');
            valueEl.textContent = result ? result.value : '-';
        }
    }

    /**
     * Spin all wheels simultaneously
     */
    async spinAll() {
        if (this.spinAllInProgress) return;
        
        this.spinAllInProgress = true;
        const spinBtn = document.getElementById('spin-all-btn');
        spinBtn.disabled = true;
        spinBtn.textContent = '🎲 Spinning...';

        // Get all independent wheels
        const independentWheels = [];
        this.wheels.forEach(wheel => {
            if (wheel.wheelConfig?.type !== 'dependent') {
                independentWheels.push(wheel);
            }
        });

        // Spin all independent wheels
        const spinPromises = independentWheels.map(wheel => wheel.spin());
        
        try {
            await Promise.all(spinPromises);
            
            // Show completion modal
            this.showModal('🎉', 'Spin Complete!', 'All wheels have finished spinning!');
        } catch (error) {
            console.error('Error during spin all:', error);
        } finally {
            this.spinAllInProgress = false;
            spinBtn.disabled = false;
            spinBtn.textContent = '🎲 Spin All';
        }
    }

    /**
     * Show modal with result
     * @param {string} icon - Icon emoji
     * @param {string} title - Modal title
     * @param {string} message - Modal message
     */
    showModal(icon, title, message) {
        const modal = document.getElementById('result-modal');
        document.getElementById('result-icon').textContent = icon;
        document.getElementById('result-title').textContent = title;
        document.getElementById('result-message').textContent = message;
        modal.classList.add('active');
    }

    /**
     * Hide the modal
     */
    hideModal() {
        document.getElementById('result-modal').classList.remove('active');
    }

    /**
     * Load sample data for demo
     */
    loadSampleData() {
        // Load sample reviewer content
        const sampleContent = {
            title: "Cell Biology Review",
            text: "The {{blank-1}} is composed of a {{blank-2}} that regulates what enters and exits the cell. Within the cell, the {{blank-3}} contains the genetic material. The {{blank-4}} are responsible for producing ATP through cellular respiration. {{blank-5}} synthesize proteins by translating mRNA.",
            keyTerms: [
                { id: "blank-1", term: "cell membrane", alternatives: ["plasma membrane"] },
                { id: "blank-2", term: "phospholipid bilayer", alternatives: ["lipid bilayer"] },
                { id: "blank-3", term: "nucleus", alternatives: [] },
                { id: "blank-4", term: "mitochondria", alternatives: ["mitochondrion"] },
                { id: "blank-5", term: "Ribosomes", alternatives: ["ribosome"] }
            ]
        };

        this.reviewer.loadContent(sampleContent);
        document.getElementById('reveal-all-btn').disabled = false;

        // Load sample wheels
        const sampleWheels = {
            wheels: [
                {
                    id: "wheel-groups",
                    name: "Groups",
                    type: "independent",
                    items: ["Group A", "Group B", "Group C", "Group D"],
                    colors: ["#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A"],
                    settings: { spinDuration: 3000 }
                },
                {
                    id: "wheel-members",
                    name: "Members",
                    type: "dependent",
                    dependsOn: "wheel-groups",
                    data: {
                        "Group A": ["Alice", "Bob", "Charlie", "Diana"],
                        "Group B": ["Eve", "Frank", "Grace", "Henry"],
                        "Group C": ["Ivy", "Jack", "Kate", "Liam"],
                        "Group D": ["Mia", "Noah", "Olivia", "Paul"]
                    },
                    colors: ["#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8"],
                    settings: { spinDuration: 2500 }
                },
                {
                    id: "wheel-topics",
                    name: "Topics",
                    type: "independent",
                    items: ["Cell Biology", "Genetics", "Ecology", "Evolution"],
                    colors: ["#F7DC6F", "#BB8FCE", "#85C1E2", "#F8B739"],
                    settings: { spinDuration: 3500 }
                }
            ],
            globalSettings: { dependentMode: true }
        };

        this.loadWheels(sampleWheels);
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.reqllApp = new ReqllApp();
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ReqllApp;
}
