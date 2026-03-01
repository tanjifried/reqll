# reqll - Multiplayer Classroom Engagement Tool

A multi-device classroom engagement tool featuring:
- 📝 **Fill-in-the-blank** collaborative reviews with real-time group participation
- 🎡 **Multi-dimensional spinning wheels** with dependent logic (Group → Member)
- 👥 **Lobby system** with QR code joining over hotspot
- 💾 **Wheel configuration saving** - create, edit, and save wheel presets

## Features

### Host (Teacher/Presenter)
- Create lobbies with unique room codes
- Load content (JSON/Markdown) and broadcast to all groups
- Real-time view of group progress
- Editable wheel configurations (add/remove items)
- Save wheel presets for future use
- QR code generation for easy joining
- Spin wheels individually or all at once
- Dependent wheel mode (Group → Member)

### Players (Groups)
- Join via room code or QR scan
- Fill-in-the-blank answers from their device
- See wheel spin results in real-time
- View correct answers when revealed

## Installation

```bash
npm install
```

## Usage

### Start the Server

```bash
npm start
```

The server starts on port **3001** by default. You'll see the access URLs:

```
Server running on:
  Local:   http://localhost:3001
  Network: http://192.168.x.x:3001
```

### For Host

1. Open `http://localhost:3001` or the network URL
2. Click **"Create New Lobby"**
3. Share the:
   - **Room Code** (6 characters)
   - **QR Code** (scan to join)
   - **Join URL** (send to groups)

4. In **Content** tab:
   - Load a JSON/Markdown file
   - Click **"Broadcast to Groups"**
   - Monitor progress
   - Click **"Reveal Answers"** when ready

5. In **Wheels** tab:
   - Create new wheels or load presets
   - Edit wheel items
   - Save configurations
   - Spin to pick groups/members

### For Players (Groups)

1. Open `http://localhost:3001/player.html` or scan QR code
2. Enter room code
3. Enter group name
4. Wait for host to load content
5. Fill in the blanks

## Content Format

### Fill-in-the-Blank JSON

```json
{
  "title": "Cell Biology Review",
  "text": "The {{blank-1}} is composed of a {{blank-2}}...",
  "keyTerms": [
    {
      "id": "blank-1",
      "term": "cell membrane",
      "alternatives": ["plasma membrane"]
    }
  ]
}
```

### Fill-in-the-Blank Markdown

```markdown
# Cell Biology Review

The {{cell membrane}} is composed of a {{phospholipid bilayer}}...
```

## Wheel Configuration

Wheels can be **independent** (standalone) or **dependent** (updates based on another wheel).

### Dependent Wheel Setup

Use the syntax `GroupName: Member1, Member2, Member3`:

```
Group A: Alice, Bob, Charlie
Group B: David, Eve, Frank
```

### Saving Wheel Presets

1. Configure your wheels in the Wheels tab
2. Click **"Save Configuration"**
3. Enter a name
4. Presets are saved to `data/wheels-config.json`

## File Structure

```
reqll/
├── server.js              # Main Node.js server
├── package.json           # Dependencies
├── public/
│   ├── index.html          # Host dashboard
│   ├── player.html         # Player join screen
│   ├── css/
│   │   ├── host.css        # Host styles
│   │   ├── player.css      # Player styles
│   │   └── styles.css      # Shared styles
│   └── js/
│       ├── host.js         # Host logic
│       ├── player.js       # Player logic
│       ├── wheel.js        # Canvas wheel component
│       ├── reviewer.js     # Fill-in-the-blank logic
│       └── fuzzyMatcher.js # Fuzzy matching
├── data/
│   └── wheels-config.json  # Saved wheel configs
└── README.md
```

## Hotspot Usage

1. Start server
2. Connect devices to hotspot
3. Share network URL with groups
4. Groups open player URL and join

## Port Configuration

Default port: `3001`

To change:

```bash
PORT=8080 npm start
```

## Technology

- **Backend**: Node.js, Express, Socket.IO
- **Frontend**: Vanilla JavaScript
- **Real-time**: Socket.IO for live sync
- **QR Codes**: qrcode library

## License

MIT License

## Legacy Version

The original single-device version is still accessible at:
- `public/js/app.js` (original single-player app logic)
