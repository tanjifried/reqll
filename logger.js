const fs = require('fs');
const path = require('path');

class Logger {
    constructor(logFile = 'logs/app.log') {
        this.logFile = logFile;
        this.logs = [];
        this.maxLogsInMemory = 500;
        
        // Ensure logs directory exists
        const logDir = path.dirname(this.logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }

    /**
     * Format log entry with timestamp
     */
    formatLog(level, message, meta = {}) {
        const timestamp = new Date().toISOString();
        return {
            timestamp,
            level,
            message,
            ...meta
        };
    }

    /**
     * Write log to file
     */
    writeToFile(logEntry) {
        try {
            let logLine = `[${logEntry.timestamp}] [${logEntry.level.toUpperCase()}] ${logEntry.message}`;
            if (Object.keys(logEntry).length > 3) {
                logLine += ` ${JSON.stringify(logEntry)}`;
            }
            
            fs.appendFileSync(this.logFile, logLine + '\n');
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }

    /**
     * Store log in memory
     */
    storeInMemory(logEntry) {
        this.logs.push(logEntry);
        
        // Keep only recent logs in memory
        if (this.logs.length > this.maxLogsInMemory) {
            this.logs.shift();
        }
    }

    /**
     * Generic log method
     */
    log(level, message, meta = {}) {
        const logEntry = this.formatLog(level, message, meta);
        
        // Console output with color
        const colors = {
            debug: '\x1b[36m',
            info: '\x1b[32m',
            warn: '\x1b[33m',
            error: '\x1b[31m',
            reset: '\x1b[0m'
        };
        
        console.log(`${colors[level]}${logEntry.timestamp} [${level.toUpperCase()}] ${message}${colors.reset}`, meta || '');
        
        // Write to file and store in memory
        this.writeToFile(logEntry);
        this.storeInMemory(logEntry);
    }

    debug(message, meta = {}) {
        this.log('debug', message, meta);
    }

    info(message, meta = {}) {
        this.log('info', message, meta);
    }

    warn(message, meta = {}) {
        this.log('warn', message, meta);
    }

    error(message, meta = {}) {
        this.log('error', message, meta);
    }

    /**
     * Get recent logs from memory
     */
    getRecentLogs(limit = 100) {
        return this.logs.slice(-limit);
    }

    /**
     * Get logs by level
     */
    getLogsByLevel(level, limit = 100) {
        return this.logs.filter(log => log.level === level).slice(-limit);
    }

    /**
     * Get logs by page for pagination
     */
    getLogs(page = 0, pageSize = 50) {
        const start = page * pageSize;
        const end = start + pageSize;
        const logs = this.logs.slice().reverse();
        
        return {
            logs: logs.slice(start, end),
            total: logs.length,
            page,
            pageSize,
            totalPages: Math.ceil(logs.length / pageSize)
        };
    }

    /**
     * Clear logs from memory
     */
    clearMemory() {
        this.logs = [];
    }
}

// Create singleton instance
const logger = new Logger(path.join(__dirname, 'logs', 'app.log'));

module.exports = logger;
