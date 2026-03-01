# Prompt for Task 2: Player UI Redesign

## Context

### Project Overview
**reqll** is a multiplayer classroom engagement tool where:
- **Host** (teacher) creates a lobby and shares a room code
- **Players** (students) join with room code + group name
- Host broadcasts content (fill-in-blank questions) to all players
- Players fill in blanks, host reveals answers

### Current Issue Being Fixed
There was a persistent "transport error" disconnect bug when players clicked between textboxes. Root cause was server-side errors crashing Socket.IO connections. Fixed with comprehensive error handling.

### New Feature: Document-Style UI with Tabs

**User Vision:**
1. **Document-like experience** - Player sees content like reading a Word/Google Docs
2. **Multiple topics/sections** - Like Excel sheets but for documents, each topic has its own "tab"
3. **Admin-controlled reveals** - Admin reveals answers per topic after each section is completed

**Example Flow:**
1. Host loads a multi-topic review (e.g., "Biology Full Review")
2. Players see tabs: [Cell Structure] [Cell Division] [Energy Processes]
3. Players work on first topic, fill in blanks
4. Host clicks "Reveal Answers" - only first topic's answers shown
5. Players move to next tab, repeat
6. Host reveals that topic's answers

### Task 1 (Completed)
- Updated content JSON schema to support multiple topics
- Created new format with `topics` array
- Updated server.js to handle multi-topic content
- Existing single-topic format still works (backward compatible)

---

## Task 2: Player UI Redesign

### Requirements

**1. Tab Navigation**
- Display tabs for each topic at the top of content area
- Show topic titles as tab labels
- Active tab visually highlighted
- Click tab to switch topics
- Each topic maintains its own state (answers, revealed status)

**2. Document-Style Appearance**
- Clean, white background (like Google Docs/Word)
- Proper typography with good readability
- Content centered with appropriate margins
- Professional, academic document feel

**3. Embedded Blank Inputs**
- Keep blank inputs inline within text flow
- Style them to look like underlined blanks in a document
- Visual distinction between unfilled, filled, and revealed states

**4. Per-Topic Answer Reveal**
- Show "Revealed Answers" section per topic when host reveals
- Only show answers for the active topic

### Technical Implementation Notes

**HTML Structure:**
```html
<!-- Tab Navigation -->
<div class="topic-tabs">
  <button class="tab active" data-topic="cell-structure">Cell Structure</button>
  <button class="tab" data-topic="cell-division">Cell Division</button>
</div>

<!-- Document Content -->
<div class="document-container">
  <div class="document-page">
    <h1 class="doc-title">Cell Structure</h1>
    <div class="doc-content">
      The <input class="blank-input"> is...
    </div>
  </div>
</div>

<!-- Answers Section (per topic) -->
<div class="answers-section">
  <!-- Show only for current topic -->
</div>
```

**CSS Styling:**
- `.document-container` - White background, centered, max-width ~800px
- `.doc-content` - Line-height ~1.8, font-size ~16px
- `.blank-input` - Underline style (border-bottom only), transparent bg

**JavaScript Logic:**
```javascript
class Player {
  currentTopicIndex = 0;
  topicAnswers = {}; // { topicId: { blankId: answer } }
  revealedTopics = new Set(); // Track which topics have revealed answers

  switchTopic(topicIndex) {
    // Save current topic state
    // Switch to new topic
    // Load new content
    // Show revealed answers if this topic was revealed
  }
}
```

### Files to Modify
1. `public/player.html` - Add tab structure
2. `public/css/player.css` - Document styling
3. `public/js/player.js` - Tab handling logic

### Socket Events to Handle
- `topic-changed` - When host switches topics (optional - if host controls)
- Keep existing `content-loaded` event structure but now contains topics array

### Testing Checklist
- [ ] Tab navigation works correctly
- [ ] Switching topics preserves answer state
- [ ] Document styling looks clean and professional
- [ ] Blank inputs are clearly visible and usable
- [ ] Per-topic answer reveal works correctly
- [ ] Works with existing single-topic content (backward compat)
