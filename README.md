# reqll - Classroom Engagement Tool

A powerful classroom engagement tool featuring smart fill-in-the-blank reviews and multi-dimensional spinning wheels with dependent logic.

## Features

### 📝 Smart Fill-in-the-Blanks (Reviewer Mode)
- Accepts JSON or Markdown content with hidden key terms
- Fuzzy matching with 80% similarity threshold using Fuse.js
- Real-time feedback with visual indicators (green/red styling)
- Typo-tolerant answers for better user experience
- Presenter "Reveal All" functionality
- Progress tracking with accuracy percentage

### 🎡 Multi-Dimensional Wheels
- Canvas-based spinning wheels with smooth animations
- Support for multiple wheels displayed simultaneously
- **Dependent Mode**: Wheel B automatically updates based on Wheel A's result
- Synchronized "Spin All" functionality
- Customizable colors, duration, and easing
- High-energy animations suitable for classroom projectors

## Data Structures

### Fill-in-the-Blank Format
```json
{
  "fillInTheBlank": {
    "title": "Cell Biology Review",
    "text": "The {{cell membrane}} is composed of a {{phospholipid bilayer}}...",
    "keyTerms": [
      {
        "id": "blank-1",
        "term": "cell membrane",
        "alternatives": ["plasma membrane"]
      }
    ],
    "settings": {
      "similarityThreshold": 0.8,
      "caseSensitive": false
    }
  }
}
```

Or Markdown format:
```markdown
# Cell Biology Review

The {{cell membrane}} is composed of a {{phospholipid bilayer}}...
```

### Wheels Format
```json
{
  "wheels": [
    {
      "id": "wheel-groups",
      "name": "Groups",
      "type": "independent",
      "items": ["Group A", "Group B", "Group C", "Group D"],
      "colors": ["#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A"]
    },
    {
      "id": "wheel-members",
      "name": "Members",
      "type": "dependent",
      "dependsOn": "wheel-groups",
      "data": {
        "Group A": ["Alice", "Bob", "Charlie", "Diana"],
        "Group B": ["Eve", "Frank", "Grace", "Henry"]
      }
    }
  ]
}
```

## Usage

1. **Open `index.html`** in a modern web browser
2. **Reviewer Tab**: Load JSON/Markdown files with fill-in-the-blank content
3. **Wheels Tab**: Load wheel configurations or use sample data
4. **Settings Tab**: Adjust fuzzy matching threshold and animation settings

## Project Structure

```
reqll/
├── index.html              # Main application entry point
├── css/
│   └── styles.css        # Dark mode styling and animations
├── js/
│   ├── app.js            # Main application controller
│   ├── reviewer.js       # Fill-in-the-blank logic
│   ├── wheel.js          # Canvas wheel component
│   └── fuzzyMatcher.js   # Fuzzy string matching engine
├── data/
│   ├── fill-in-blank-example.json
│   └── wheels-example.json
└── README.md
```

## Browser Requirements

- Modern browser with ES6+ support
- Canvas API support
- Fuse.js loaded from CDN

## Keyboard Shortcuts

- **Enter**: Check current answer in reviewer mode
- **Tab**: Navigate between blanks

## Customization

### Colors
Edit the CSS variables in `css/styles.css`:
```css
:root {
  --accent-primary: #3b82f6;
  --accent-success: #22c55e;
  --accent-error: #ef4444;
  /* ... */
}
```

### Wheel Appearance
Modify the `Wheel` class options:
```javascript
new Wheel(canvasId, {
  colors: ['#FF6B6B', '#4ECDC4', ...],
  spinDuration: 3000,
  fontSize: 14
});
```

## License

MIT License - Feel free to use for educational purposes!