/**
 * Wheel Component
 * Canvas-based spinning wheel with physics-based animation
 */

class Wheel {
    constructor(canvasId, options = {}) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            console.error('Canvas not found:', canvasId);
            return;
        }
        
        this.ctx = this.canvas.getContext('2d');
        this.options = {
            size: 350,
            centerX: 175,
            centerY: 175,
            radius: 150,
            spinDuration: 3000,
            easing: 'easeOut',
            colors: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#96CEB4', '#FFEAA7'],
            textColor: '#FFFFFF',
            fontSize: 14,
            fontFamily: 'Inter, sans-serif',
            borderWidth: 4,
            borderColor: '#1e293b',
            pointerColor: '#f59e0b',
            ...options
        };
        
        this.id = options.id || `wheel-${Date.now()}`;
        this.name = options.name || 'Wheel';
        this.items = options.items || [];
        this.currentItems = [...this.items];
        
        // Animation state
        this.angle = 0;
        this.startAngle = 0;
        this.velocity = 0;
        this.isSpinning = false;
        this.animationId = null;
        this.quickSpinAnimationId = null;
        this.startTime = null;
        this.targetAngle = null;
        this.result = null;
        
        // Event callbacks
        this.onSpinStart = null;
        this.onSpinComplete = null;
        this.onResult = null;
        
        this.init();
    }

    init() {
        this.setupCanvas();
        this.draw();
    }

    setupCanvas() {
        const size = this.options.size;
        this.canvas.width = size;
        this.canvas.height = size;
        this.canvas.style.width = `${size}px`;
        this.canvas.style.height = `${size}px`;
    }

    /**
     * Draw the wheel
     */
    draw() {
        const { ctx, options, currentItems } = this;
        const { centerX, centerY, radius, colors, textColor, fontSize, borderWidth, borderColor } = options;
        
        // Clear canvas
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        if (currentItems.length === 0) {
            this.drawEmptyWheel();
            return;
        }
        
        const sliceAngle = (2 * Math.PI) / currentItems.length;
        
        // Save context
        ctx.save();
        
        // Rotate based on current angle
        ctx.translate(centerX, centerY);
        ctx.rotate(this.angle);
        ctx.translate(-centerX, -centerY);
        
        // Draw slices
        currentItems.forEach((item, index) => {
            const startAngle = index * sliceAngle;
            const endAngle = (index + 1) * sliceAngle;
            const color = colors[index % colors.length];
            
            // Draw slice
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, startAngle, endAngle);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            
            // Draw slice border
            ctx.lineWidth = 2;
            ctx.strokeStyle = borderColor;
            ctx.stroke();
            
            // Draw text
            ctx.save();
            ctx.translate(centerX, centerY);
            ctx.rotate(startAngle + sliceAngle / 2);
            ctx.translate(radius * 0.65, 0);
            ctx.rotate(Math.PI / 2);
            
            ctx.fillStyle = textColor;
            ctx.font = `bold ${fontSize}px ${options.fontFamily}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // Truncate text if too long
            let text = item;
            if (text.length > 15) {
                text = text.substring(0, 12) + '...';
            }
            
            ctx.fillText(text, 0, 0);
            ctx.restore();
        });
        
        ctx.restore();
        
        // Draw center circle
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius * 0.08, 0, 2 * Math.PI);
        ctx.fillStyle = borderColor;
        ctx.fill();
        
        // Draw outer border
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.lineWidth = borderWidth;
        ctx.strokeStyle = borderColor;
        ctx.stroke();
        
        // Draw pointer
        this.drawPointer();
    }

    /**
     * Draw empty wheel placeholder
     */
    drawEmptyWheel() {
        const { ctx, options } = this;
        const { centerX, centerY, radius } = options;
        
        // Draw empty circle
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.fillStyle = '#334155';
        ctx.fill();
        
        // Draw border
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#475569';
        ctx.stroke();
        
        // Draw text
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 16px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No items', centerX, centerY);
    }

    /**
     * Draw the pointer indicator
     */
    drawPointer() {
        const { ctx, options } = this;
        const { centerX, centerY, radius, pointerColor } = options;
        
        // Pointer at top (0 degrees)
        ctx.save();
        ctx.translate(centerX, centerY - radius - 15);
        
        // Draw pointer triangle
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-12, -20);
        ctx.lineTo(12, -20);
        ctx.closePath();
        ctx.fillStyle = pointerColor;
        ctx.fill();
        
        // Draw pointer border
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#1e293b';
        ctx.stroke();
        
        // Draw center dot
        ctx.beginPath();
        ctx.arc(0, -10, 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.stroke();
        
        ctx.restore();
    }

    /**
     * Spin the wheel
     * @param {number} duration - Spin duration in ms
     * @returns {Promise} Resolves when spin completes
     */
    spin(duration = this.options.spinDuration) {
        return new Promise((resolve) => {
            if (this.isSpinning || this.currentItems.length === 0) {
                resolve(null);
                return;
            }
            
            this.isSpinning = true;
            this.result = null;
            this.startTime = performance.now();
            this.startAngle = this.angle;
            
            // Random target angle (5-10 full rotations + random position)
            const minRotations = 5;
            const maxRotations = 10;
            const rotations = minRotations + Math.random() * (maxRotations - minRotations);
            const randomAngle = Math.random() * 2 * Math.PI;
            this.targetAngle = this.startAngle + rotations * 2 * Math.PI + randomAngle;
            
            if (this.onSpinStart) {
                this.onSpinStart({ wheelId: this.id, wheelName: this.name });
            }
            
            this.animate(resolve);
        });
    }

    /**
     * Animation loop
     */
    animate(resolve) {
        const now = performance.now();
        const elapsed = now - this.startTime;
        const duration = this.options.spinDuration;
        const progress = Math.min(elapsed / duration, 1);
        
        // Apply easing
        const easedProgress = this.easeOut(progress);
        
        // Calculate current angle using proper interpolation from start angle
        this.angle = this.startAngle + (this.targetAngle - this.startAngle) * easedProgress;
        
        // Redraw
        this.draw();
        
        if (progress < 1) {
            this.animationId = requestAnimationFrame(() => this.animate(resolve));
        } else {
            // Spin complete
            this.isSpinning = false;
            this.angle = this.targetAngle % (2 * Math.PI);
            this.calculateResult();
            this.animationId = null;
            
            if (this.onSpinComplete) {
                this.onSpinComplete({ 
                    wheelId: this.id, 
                    wheelName: this.name,
                    result: this.result 
                });
            }
            
            if (this.onResult) {
                this.onResult({ 
                    wheelId: this.id, 
                    wheelName: this.name,
                    result: this.result 
                });
            }
            
            resolve(this.result);
        }
    }

    /**
     * Easing function (easeOut cubic)
     */
    easeOut(t) {
        switch (this.options.easing) {
            case 'easeOut':
                return 1 - Math.pow(1 - t, 3);
            case 'easeInOut':
                return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            case 'linear':
            default:
                return t;
        }
    }

    /**
     * Calculate which item the pointer landed on
     */
    calculateResult() {
        if (this.currentItems.length === 0) {
            this.result = null;
            return;
        }
        
        // Normalize angle to 0-2π
        let normalizedAngle = this.angle % (2 * Math.PI);
        if (normalizedAngle < 0) normalizedAngle += 2 * Math.PI;
        
        // The pointer is at the top (0 angle), so we need to find which slice
        // is at that position based on the wheel's rotation
        const sliceAngle = (2 * Math.PI) / this.currentItems.length;
        
        // The wheel rotates clockwise, so we need to reverse the calculation
        const pointerAngle = (2 * Math.PI - normalizedAngle) % (2 * Math.PI);
        const index = Math.floor(pointerAngle / sliceAngle);
        
        this.result = {
            index: index,
            value: this.currentItems[index],
            timestamp: Date.now()
        };
    }

    /**
     * Update the items on the wheel
     * @param {Array} items - New items array
     * @param {boolean} animate - Whether to animate the change
     */
    setItems(items, animate = true) {
        this.currentItems = items || [];
        
        if (animate) {
            // Quick spin to show update
            this.quickSpin();
        } else {
            this.draw();
        }
    }

    /**
     * Quick spin animation for updates
     */
    quickSpin() {
        // Cancel any existing quick spin
        if (this.quickSpinAnimationId) {
            cancelAnimationFrame(this.quickSpinAnimationId);
        }
        
        const startAngle = this.angle;
        const targetAngle = startAngle + Math.PI * 2;
        const duration = 500;
        const startTime = performance.now();
        
        const animate = () => {
            const now = performance.now();
            const progress = Math.min((now - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            
            this.angle = startAngle + (targetAngle - startAngle) * eased;
            this.draw();
            
            if (progress < 1) {
                this.quickSpinAnimationId = requestAnimationFrame(animate);
            } else {
                this.quickSpinAnimationId = null;
            }
        };
        
        this.quickSpinAnimationId = requestAnimationFrame(animate);
    }

    /**
     * Get current result
     * @returns {Object|null} Current result
     */
    getResult() {
        return this.result;
    }

    /**
     * Check if wheel is spinning
     * @returns {boolean}
     */
    isCurrentlySpinning() {
        return this.isSpinning;
    }

    /**
     * Stop the spin (for emergency)
     */
    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.quickSpinAnimationId) {
            cancelAnimationFrame(this.quickSpinAnimationId);
            this.quickSpinAnimationId = null;
        }
        this.isSpinning = false;
    }

    /**
     * Reset the wheel
     */
    reset() {
        this.stop();
        this.angle = 0;
        this.startAngle = 0;
        this.result = null;
        this.currentItems = [...this.items];
        this.draw();
    }

    /**
     * Destroy the wheel and cleanup resources
     */
    destroy() {
        this.stop();
        this.onSpinStart = null;
        this.onSpinComplete = null;
        this.onResult = null;
    }

    /**
     * Update wheel options
     * @param {Object} options - New options
     */
    updateOptions(options) {
        this.options = { ...this.options, ...options };
        this.setupCanvas();
        this.draw();
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Wheel;
}
