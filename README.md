# Snakes & Ladders room server

A small Python WebSocket server. The game still runs in the players' browsers;
this server only passes messages between them and keeps a room open for a few
minutes if a phone leaves the page (for example to send the invite on WhatsApp).

## Files
- `server.py`          the server
- `requirements.txt`   its one dependency (aiohttp)

## 1. Put it on a host that runs Python
GitHub Pages and other static hosts cannot run Python, so the code must be
deployed to a service that runs a web process (Render, Railway, Fly.io, Koyeb, a
small VPS, ...). Connect your repository and use:

- Build command:  `pip install -r requirements.txt`
- Start command:  `python server.py`
- Root directory: the folder that holds these files (e.g. `snakes-server`)

The host sets the `PORT` variable; the server reads it automatically.
Optional: set `ALLOWED_ORIGINS=https://cross-world.in` so only your site can use it.

## 2. Check it is running
Open `https://YOUR-APP-URL/health`. You should see `{"ok": true, "rooms": 0}`.

## 3. Point the game at it
In `snakesladders.js` (or the inline script of `snakesladders-single.html`) change

    const SERVER_URL = window.SNAKES_SERVER_URL || 'wss://YOUR-SERVER.onrender.com/ws';

to your address, keeping `wss://` at the start and `/ws` at the end,
e.g. `wss://snakes-rooms.onrender.com/ws`.

## Notes
- Free plans often put a server to sleep when idle, so the first connection can
  take 30-60 seconds. The game pings `/health` when the page opens to wake it,
  and a free uptime monitor hitting `/health` every 5 minutes keeps it awake.
- Rooms live in memory. Restarting the server closes all rooms (fine for a game).
- A host may be away for 3 minutes and a guest for 1 minute before their seat is freed.
