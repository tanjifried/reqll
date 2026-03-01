# Plan: Document-Style Player UI with Tabs

## Overview
Redesign player UI to look like a document/reviewer with multiple topics as tabs, similar to Excel sheets but in document form. Admin reveals answers per topic.

## Current State
- Single flat content with `title`, `text`, and `keyTerms`
- Dark theme UI with basic styling
- All answers revealed at once

## Target State
- **Document-style UI** - Clean, modern like Google Docs/Word
- **Multiple topic tabs** - Like Excel sheets but for documents
- **Per-topic reveal** - Admin reveals answers for each topic separately
- **Tab navigation** - Players switch between topics

---

## Research Findings

### Content Structure Needed
Current format:
```json
{
  "title": "Cell Biology Review",
  "text": "The {{blank-1}} is...",
  "keyTerms": [...]
}
```

New format needed:
```json
{
  "title": "Biology Full Review",
  "topics": [
    {
      "id": "cell-structure",
      "title": "Cell Structure",
      "text": "The {{blank-1}} is...",
      "keyTerms": [...]
    },
    {
      "id": "cell-division",
      "title": "Cell Division",
      "text": "{{blank-1}} is...",
      "keyTerms": [...]
    }
  ]
}
```

### Files to Modify
1. `public/player.html` - Add tab navigation UI
2. `public/css/player.css` - Document-style CSS
3. `public/js/player.js` - Tab handling, per-topic state
4. `server.js` - Update content loading for topics
5. Content JSON files - Convert to new multi-topic format
6. `public/js/host.js` - Per-topic reveal controls

---

## Implementation Plan

### Phase 1: Data Structure Changes
1. Update content JSON schema to support `topics` array
2. Create migration script or manually update existing content files
3. Update server.js to handle multi-topic content

### Phase 2: Player UI Redesign
1. Add tab bar at top (topic navigation)
2. Style content area like a document (white bg, clean typography)
3. Keep blank inputs embedded in text
4. Add revealed answers display per topic

### Phase 3: Host Controls Update
1. Add per-topic reveal button in host UI
2. Show which topic is currently active
3. Update socket events for topic-specific reveal

### Phase 4: Testing & Polish
1. Test multi-topic content flow
2. Test reveal per topic
3. Fix any UI issues

---

## Questions Answered
- **Structure**: Multiple topics/tabs ✓
- **Reveal**: Per topic ✓  
- **Style**: Word processor (clean, modern) ✓

---

## Risks
- Breaking existing content files (need migration)
- Need to update all existing content JSON
- Socket event changes may affect backward compatibility
