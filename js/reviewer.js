/**
 * Fill-in-the-Blank Reviewer Module
 * Handles smart text parsing, fuzzy matching, and progress tracking
 */

class FillInTheBlankReviewer {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.options = {
            similarityThreshold: 0.8,
            caseSensitive: false,
            allowPartialMatches: true,
            autoCheck: true,
            debounceDelay: 500,
            ...options
        };
        
        this.fuzzyMatcher = new FuzzyMatcher({
            similarityThreshold: this.options.similarityThreshold,
            caseSensitive: this.options.caseSensitive,
            allowPartialMatches: this.options.allowPartialMatches
        });
        
        this.content = null;
        this.keyTerms = [];
        this.userAnswers = new Map();
        this.revealedBlanks = new Set();
        this.correctAnswers = new Set();
        this.onProgressUpdate = null;
        this.onAnswerCheck = null;
        
        this.debounceTimer = null;
        
        this.init();
    }

    init() {
        if (!this.container) {
            console.error('Reviewer container not found:', this.container);
            return;
        }
        
        this.bindEvents();
    }

    bindEvents() {
        // Input event delegation for dynamic inputs
        this.container.addEventListener('input', (e) => {
            if (e.target.classList.contains('blank-input')) {
                this.handleInput(e.target);
            }
        });

        // Check answer on blur
        this.container.addEventListener('blur', (e) => {
            if (e.target.classList.contains('blank-input')) {
                this.checkAnswer(e.target);
            }
        }, true);

        // Allow Enter key to check answer
        this.container.addEventListener('keydown', (e) => {
            if (e.target.classList.contains('blank-input') && e.key === 'Enter') {
                this.checkAnswer(e.target);
                e.target.blur();
            }
        });
    }

    /**
     * Load content from JSON or Markdown string
     * @param {string|Object} data - JSON string, Markdown string, or parsed object
     */
    loadContent(data) {
        try {
            let parsed;
            
            if (typeof data === 'string') {
                // Try parsing as JSON first
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    // If not JSON, treat as Markdown
                    parsed = this.parseMarkdown(data);
                }
            } else {
                parsed = data;
            }

            this.content = parsed;
            this.keyTerms = parsed.keyTerms || [];
            this.userAnswers.clear();
            this.revealedBlanks.clear();
            this.correctAnswers.clear();
            
            this.render();
            this.updateProgress();
            
            return true;
        } catch (error) {
            console.error('Error loading content:', error);
            this.showError('Failed to load content. Please check the file format.');
            return false;
        }
    }

    /**
     * Parse Markdown format with embedded key terms
     * Format: {{term}} for blanks
     * @param {string} markdown - Markdown content
     * @returns {Object} Parsed content object
     */
    parseMarkdown(markdown) {
        const lines = markdown.split('\n');
        let title = 'Untitled';
        let text = '';
        const keyTerms = [];
        let blankIndex = 0;

        lines.forEach((line, index) => {
            // Extract title from first H1
            if (line.startsWith('# ') && index === 0) {
                title = line.substring(2).trim();
                return;
            }

            // Process content lines
            // Replace {{term}} patterns with blank markers
            const processedLine = line.replace(/\{\{(.+?)\}\}/g, (match, term) => {
                const blankId = `blank-${blankIndex++}`;
                keyTerms.push({
                    id: blankId,
                    term: term.trim(),
                    alternatives: [],
                    original: match
                });
                return `{{${blankId}}}`;
            });

            text += processedLine + ' ';
        });

        return {
            title,
            text: text.trim(),
            keyTerms,
            settings: this.options
        };
    }

    /**
     * Render the fill-in-the-blank content
     */
    render() {
        if (!this.content) {
            this.container.innerHTML = `
                <div class="placeholder">
                    <span class="placeholder-icon">📝</span>
                    <p>Load a JSON or Markdown file to start</p>
                </div>
            `;
            return;
        }

        let html = this.content.text;
        
        // Replace blank markers with input elements
        this.keyTerms.forEach(term => {
            const input = `
                <input type="text" 
                       class="blank-input" 
                       data-term-id="${term.id}" 
                       data-term="${this.escapeHtml(term.term)}"
                       placeholder="..."
                       autocomplete="off"
                       spellcheck="false"
                >
            `;
            html = html.replace(`{{${term.id}}}`, input);
        });

        // Wrap in content text container
        this.container.innerHTML = `
            <div class="content-header">
                <h3>${this.escapeHtml(this.content.title)}</h3>
            </div>
            <div class="content-text">${html}</div>
        `;
    }

    /**
     * Handle input changes with debouncing
     * @param {HTMLInputElement} input - The input element
     */
    handleInput(input) {
        const termId = input.dataset.termId;
        this.userAnswers.set(termId, input.value);

        if (this.options.autoCheck) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => {
                this.checkAnswer(input);
            }, this.options.debounceDelay);
        }

        // Remove styling while typing
        input.classList.remove('correct', 'incorrect');
    }

    /**
     * Check if user's answer is correct
     * @param {HTMLInputElement} input - The input element
     */
    checkAnswer(input) {
        const termId = input.dataset.termId;
        const userAnswer = input.value.trim();
        const keyTerm = this.keyTerms.find(t => t.id === termId);

        if (!keyTerm) return;

        // Don't recheck if already revealed
        if (this.revealedBlanks.has(termId)) return;

        const result = this.fuzzyMatcher.checkAnswer(userAnswer, keyTerm);
        
        // Update styling
        input.classList.remove('correct', 'incorrect');
        
        if (result.isCorrect) {
            input.classList.add('correct');
            this.correctAnswers.add(termId);
            
            // Optional: Show checkmark or animation
            this.showCorrectAnimation(input);
        } else if (userAnswer.length > 0) {
            input.classList.add('incorrect');
            this.correctAnswers.delete(termId);
        }

        // Update progress
        this.updateProgress();

        // Trigger callback
        if (this.onAnswerCheck) {
            this.onAnswerCheck({
                termId,
                result,
                userAnswer,
                keyTerm
            });
        }
    }

    /**
     * Reveal all answers (presenter mode)
     */
    revealAll() {
        const inputs = this.container.querySelectorAll('.blank-input');
        
        inputs.forEach(input => {
            const termId = input.dataset.termId;
            const correctTerm = input.dataset.term;
            
            input.value = correctTerm;
            input.classList.remove('correct', 'incorrect');
            input.classList.add('revealed');
            input.readOnly = true;
            
            this.revealedBlanks.add(termId);
        });

        this.updateProgress();
    }

    /**
     * Update progress bar and stats
     */
    updateProgress() {
        const total = this.keyTerms.length;
        const correct = this.correctAnswers.size;
        const revealed = this.revealedBlanks.size;
        
        const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        const accuracyEl = document.getElementById('accuracy');

        if (progressFill) {
            progressFill.style.width = `${percentage}%`;
        }

        if (progressText) {
            progressText.textContent = `${correct}/${total} Correct (${revealed} Revealed)`;
        }

        if (accuracyEl) {
            accuracyEl.textContent = `${percentage}%`;
        }

        // Update feedback panel
        this.updateFeedbackPanel();

        // Trigger progress callback
        if (this.onProgressUpdate) {
            this.onProgressUpdate({
                total,
                correct,
                revealed,
                percentage
            });
        }
    }

    /**
     * Update the feedback panel with current status
     */
    updateFeedbackPanel() {
        const feedbackList = document.getElementById('feedback-list');
        if (!feedbackList) return;

        feedbackList.innerHTML = this.keyTerms.map(term => {
            const userAnswer = this.userAnswers.get(term.id) || '';
            const isRevealed = this.revealedBlanks.has(term.id);
            const isCorrect = this.correctAnswers.has(term.id);
            
            let statusClass = '';
            let statusIcon = '⏳';
            
            if (isRevealed) {
                statusClass = 'revealed';
                statusIcon = '👁️';
            } else if (isCorrect) {
                statusClass = 'correct';
                statusIcon = '✓';
            } else if (userAnswer) {
                statusClass = 'incorrect';
                statusIcon = '✗';
            }

            return `
                <div class="feedback-item ${statusClass}">
                    <span class="status-icon">${statusIcon}</span>
                    <span class="term-name">${this.escapeHtml(term.term)}</span>
                    ${userAnswer ? `<span class="user-answer">"${this.escapeHtml(userAnswer)}"</span>` : ''}
                </div>
            `;
        }).join('');
    }

    /**
     * Show animation when answer is correct
     * @param {HTMLInputElement} input - The input element
     */
    showCorrectAnimation(input) {
        input.style.transform = 'scale(1.05)';
        setTimeout(() => {
            input.style.transform = 'scale(1)';
        }, 200);
    }

    /**
     * Show error message
     * @param {string} message - Error message
     */
    showError(message) {
        this.container.innerHTML = `
            <div class="placeholder" style="color: var(--accent-error)">
                <span class="placeholder-icon">⚠️</span>
                <p>${message}</p>
            </div>
        `;
    }

    /**
     * Escape HTML special characters
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Get current score
     * @returns {Object} Score information
     */
    getScore() {
        return {
            total: this.keyTerms.length,
            correct: this.correctAnswers.size,
            revealed: this.revealedBlanks.size,
            percentage: this.keyTerms.length > 0 
                ? Math.round((this.correctAnswers.size / this.keyTerms.length) * 100) 
                : 0
        };
    }

    /**
     * Reset all answers
     */
    reset() {
        this.userAnswers.clear();
        this.revealedBlanks.clear();
        this.correctAnswers.clear();
        this.render();
        this.updateProgress();
    }

    /**
     * Update reviewer options
     * @param {Object} options - New options
     */
    updateOptions(options) {
        this.options = { ...this.options, ...options };
        this.fuzzyMatcher.updateOptions({
            similarityThreshold: this.options.similarityThreshold,
            caseSensitive: this.options.caseSensitive,
            allowPartialMatches: this.options.allowPartialMatches
        });
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FillInTheBlankReviewer;
}