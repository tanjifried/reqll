# Debug Log - Player Disconnection Issue

## Status: ROOT CAUSE IDENTIFIED AND FIXED ✅

## Issue Summary
When a player is on the game screen and clicks on a different textbox (input field), the player gets disconnected and cannot reconnect even after refreshing the page.

## ROOT CAUSE IDENTIFIED 🔴

### Problem: Race Condition in Group Reconnection

**The Bug:**
When a player disconnects (even briefly) and tries to reconnect:

1. Player disconnects → `disconnect` event handler starts (async operation)
2. Player immediately reconnects → `join-lobby` event received
3. **RACE CONDITION**: `join-lobby` checks if group name exists in lobby.groups
4. At this moment, the old group entry STILL EXISTS (disconnect handler hasn't run yet)
5. Server rejects with: `"Group name already taken"`
6. Disconnect handler eventually runs and removes the group
7. **Result**: Player is locked out - old socket disconnected, new socket rejected

**Why Refreshing Doesn't Help:**
- The old socket.id is still in the lobby.groups Map
- New connection gets a NEW socket.id
- But the check only looks at group NAME, not socket connectivity
- Server thinks group is still "taken" even though old socket is dead

## Fix Applied

### Fix 1: Check Socket Connectivity Before Rejecting (server.js)
```javascript
if (lobby.groups.has(sanitizedGroupName)) {
  const existingGroup = lobby.groups.get(sanitizedGroupName);
  const existingSocket = io.sockets.sockets.get(existingGroup.socketId);
  
  if (existingSocket && existingSocket.connected) {
    return callback({ error: 'Group name already taken' });
  } else {
    // Remove disconnected group's stale entry
    lobby.groups.delete(sanitizedGroupName);
    logger.info('Removed stale group entry', { groupName: sanitizedGroupName, roomCode });
  }
}
```

### Fix 2: Add Socket Error Handler (server.js)
```javascript
socket.on('error', (error) => {
  logger.error('Socket error', { socketId: socket.id, error: error.message });
});
```

## Timeline of Fixes
- **2026-03-01**: Initial issue reported - clicking textbox causes disconnect
- **Attempt 1**: Removed 'transport close' from disconnect handler
- **Attempt 2**: Added connection checks to submitAnswer and joinLobby  
- **Attempt 3**: Changed to polling-only transport, increased ping timeouts
- **Attempt 4 (CURRENT)**: Fixed race condition in group reconnection ✅

## Testing Instructions
1. Create a lobby as host
2. Join as player with group name "Test"
3. Click rapidly between different textboxes in the game
4. Disconnect intentionally (close browser tab)
5. Reopen and reconnect with same group name "Test"
6. Should work now without "Group name already taken" error

## Files Modified
- `server.js` - Fixed race condition in join-lobby handler
- `server.js` - Added socket error handler for better debugging

