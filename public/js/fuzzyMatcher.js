/**
 * Fuzzy Matcher Module
 * Uses Fuse.js for intelligent string matching with typo tolerance
 * Supports 80% similarity threshold and alternative answers
 */

class FuzzyMatcher {
    constructor(options = {}) {
        this.similarityThreshold = options.similarityThreshold || 0.8;
        this.caseSensitive = options.caseSensitive || false;
        this.allowPartialMatches = options.allowPartialMatches !== false;
        
        // Fuse.js configuration
        this.fuseOptions = {
            includeScore: true,
            threshold: 1 - this.similarityThreshold, // Convert to Fuse threshold (0 = perfect match, 1 = match anything)
            distance: 100,
            ignoreLocation: true,
            useExtendedSearch: true,
        };
    }

    /**
     * Calculate similarity score between two strings
     * @param {string} input - User's answer
     * @param {string} target - Correct answer
     * @returns {number} Similarity score (0-1)
     */
    calculateSimilarity(input, target) {
        if (!input || !target) return 0;
        
        // Normalize strings
        const normalizedInput = this.caseSensitive ? input : input.toLowerCase().trim();
        const normalizedTarget = this.caseSensitive ? target : target.toLowerCase().trim();
        
        // Exact match
        if (normalizedInput === normalizedTarget) return 1;
        
        // Use Levenshtein distance for more accurate similarity
        const distance = this.levenshteinDistance(normalizedInput, normalizedTarget);
        const maxLength = Math.max(normalizedInput.length, normalizedTarget.length);
        const similarity = 1 - (distance / maxLength);
        
        return similarity;
    }

    /**
     * Calculate Levenshtein distance between two strings
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @returns {number} Edit distance
     */
    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        // Initialize matrix
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        // Fill matrix
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                const cost = str2[i - 1] === str1[j - 1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,      // Deletion
                    matrix[i][j - 1] + 1,      // Insertion
                    matrix[i - 1][j - 1] + cost // Substitution
                );
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    /**
     * Check if user input matches any of the acceptable answers
     * @param {string} input - User's answer
     * @param {Object} keyTerm - The key term object with term and alternatives
     * @returns {Object} Match result with isCorrect, score, and matchedTerm
     */
    checkAnswer(input, keyTerm) {
        if (!input || !keyTerm) {
            return { isCorrect: false, score: 0, matchedTerm: null };
        }

        const possibleAnswers = [keyTerm.term, ...(keyTerm.alternatives || [])];
        let bestMatch = { score: 0, matchedTerm: null };

        // Check all possible answers
        for (const answer of possibleAnswers) {
            const score = this.calculateSimilarity(input, answer);
            if (score > bestMatch.score) {
                bestMatch = { score, matchedTerm: answer };
            }
        }

        // Also check with Fuse.js for more sophisticated matching
        if (typeof Fuse !== 'undefined') {
            const fuse = new Fuse(possibleAnswers, this.fuseOptions);
            const fuseResults = fuse.search(input);
            
            if (fuseResults.length > 0) {
                const fuseScore = 1 - fuseResults[0].score;
                if (fuseScore > bestMatch.score) {
                    bestMatch = { 
                        score: fuseScore, 
                        matchedTerm: fuseResults[0].item 
                    };
                }
            }
        }

        return {
            isCorrect: bestMatch.score >= this.similarityThreshold,
            score: bestMatch.score,
            matchedTerm: bestMatch.matchedTerm,
            userInput: input,
            correctAnswer: keyTerm.term
        };
    }

    /**
     * Get suggestions for a partial match
     * @param {string} input - User's partial answer
     * @param {Array} keyTerms - Array of key terms to match against
     * @param {number} limit - Maximum number of suggestions
     * @returns {Array} Suggested matches
     */
    getSuggestions(input, keyTerms, limit = 3) {
        if (!input || !keyTerms || !keyTerms.length) return [];
        
        if (typeof Fuse === 'undefined') {
            // Fallback to basic filtering
            return keyTerms
                .filter(term => {
                    const termLower = term.term.toLowerCase();
                    const inputLower = input.toLowerCase();
                    return termLower.includes(inputLower) || inputLower.includes(termLower);
                })
                .slice(0, limit);
        }

        // Create searchable list from all possible answers
        const searchableItems = [];
        keyTerms.forEach(term => {
            searchableItems.push({ ...term, searchable: term.term });
            if (term.alternatives) {
                term.alternatives.forEach(alt => {
                    searchableItems.push({ ...term, searchable: alt, isAlternative: true });
                });
            }
        });

        const fuse = new Fuse(searchableItems, {
            ...this.fuseOptions,
            keys: ['searchable'],
            threshold: 0.4
        });

        const results = fuse.search(input);
        return results.slice(0, limit).map(result => ({
            ...result.item,
            score: 1 - result.score
        }));
    }

    /**
     * Update matcher options
     * @param {Object} options - New options
     */
    updateOptions(options) {
        if (options.similarityThreshold !== undefined) {
            this.similarityThreshold = options.similarityThreshold;
            this.fuseOptions.threshold = 1 - this.similarityThreshold;
        }
        if (options.caseSensitive !== undefined) {
            this.caseSensitive = options.caseSensitive;
        }
        if (options.allowPartialMatches !== undefined) {
            this.allowPartialMatches = options.allowPartialMatches;
        }
    }

    /**
     * Format match result for display
     * @param {Object} result - Match result object
     * @returns {string} Formatted feedback message
     */
    formatFeedback(result) {
        if (result.isCorrect) {
            if (result.score === 1) {
                return `✓ Perfect match!`;
            } else {
                return `✓ Correct (matched "${result.matchedTerm}", ${Math.round(result.score * 100)}% match)`;
            }
        } else {
            const score = Math.round(result.score * 100);
            return `✗ Incorrect (${score}% match). Expected: "${result.correctAnswer}"`;
        }
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FuzzyMatcher;
}