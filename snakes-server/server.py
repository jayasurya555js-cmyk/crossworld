"""
Snakes & Ladders room server
============================

A tiny WebSocket relay. The *host's browser* still runs the game (it rolls the
dice and decides the moves); this server only does three jobs:

  1. keeps a room open under an id like "cwsl-ab12cd",
  2. passes messages between the host and the guests,
  3. holds a room / seat for a short while if a phone drops off for a moment
     (e.g. the host switches to WhatsApp to send the invite link) so the
     player can come back without losing the room.

Run locally:   pip install -r requirements.txt  &&  python server.py
Environment variables (all optional):
  PORT              port to listen on (hosting platforms set this for you)
  ALLOWED_ORIGINS   comma separated list, e.g. "https://cross-world.in"
                    If set, other websites cannot use your server.
"""

import asyncio
import json
import os
import re
import time

HOST_GRACE = 180      # seconds a host may be away before the room closes
GUEST_GRACE = 60      # seconds a guest may be away before their seat is freed
MAX_GUESTS = 7        # per room
MAX_ROOMS = 2000
MAX_OUTBOX = 300      # messages buffered for a player who is briefly away
MAX_MSG_BYTES = 8192
ROOM_IDLE_TTL = 6 * 3600

ID_RE = re.compile(r"^[A-Za-z0-9_-]{3,40}$")
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{6,80}$")


class Conn:
    """A player's seat in a room. It outlives a single websocket."""

    def __init__(self, role, token, gid=None):
        self.role = role          # "host" or "guest"
        self.token = token
        self.gid = gid            # guest number (None for the host)
        self.sock = None          # current socket, None while away
        self.outbox = []          # messages waiting for the player to return
        self.timer = None         # grace-period task


class Room:
    def __init__(self, room_id, host):
        self.id = room_id
        self.host = host
        self.guests = {}          # gid -> Conn
        self.next_gid = 1
        self.touched = time.time()


class Session:
    """State attached to one websocket connection."""

    def __init__(self):
        self.conn = None
        self.room = None


class Hub:
    def __init__(self, host_grace=HOST_GRACE, guest_grace=GUEST_GRACE):
        self.rooms = {}
        self.host_grace = host_grace
        self.guest_grace = guest_grace

    # ---------- sending ----------

    async def push(self, conn, obj):
        """Send to a player now, or hold it until they reconnect."""
        sock = conn.sock
        if sock is not None and not sock.closed:
            try:
                await sock.send(obj)
                return
            except Exception:
                conn.sock = None
        conn.outbox.append(obj)
        if len(conn.outbox) > MAX_OUTBOX:
            del conn.outbox[0]

    # ---------- incoming messages ----------

    async def handle(self, sock, session, m):
        t = m.get("type")

        if t == "ping":
            await sock.send({"type": "pong"})
            return

        if session.conn is None:
            if t in ("create", "join", "resume"):
                await self.attach(sock, session, t, m)
            return

        room, conn = session.room, session.conn
        room.touched = time.time()

        if t == "relay":
            await self.relay(room, conn, m)
        elif t == "kick" and conn.role == "host":
            guest = room.guests.pop(m.get("gid"), None)
            if guest:
                self.cancel_timer(guest)
                if guest.sock:
                    await guest.sock.close()
        elif t == "leave":
            await self.remove(room, conn, notify=True)
            session.conn = session.room = None

    async def attach(self, sock, session, t, m):
        room_id, token = m.get("room"), m.get("token")
        if not (isinstance(room_id, str) and ID_RE.match(room_id)
                and isinstance(token, str) and TOKEN_RE.match(token)):
            await sock.send({"type": "error", "reason": "bad-request"})
            return

        if t == "create":
            if room_id in self.rooms:
                await sock.send({"type": "error", "reason": "taken"})
                return
            if len(self.rooms) >= MAX_ROOMS:
                await sock.send({"type": "error", "reason": "busy"})
                return
            conn = Conn("host", token)
            conn.sock = sock
            room = self.rooms[room_id] = Room(room_id, conn)
            session.conn, session.room = conn, room
            await sock.send({"type": "created"})

        elif t == "join":
            room = self.rooms.get(room_id)
            if room is None:
                await sock.send({"type": "error", "reason": "no-room"})
                return
            if len(room.guests) >= MAX_GUESTS:
                await sock.send({"type": "error", "reason": "full"})
                return
            gid = room.next_gid
            room.next_gid += 1
            conn = Conn("guest", token, gid)
            conn.sock = sock
            room.guests[gid] = conn
            session.conn, session.room = conn, room
            await sock.send({"type": "joined", "gid": gid})
            # If the host is away right now this waits in their outbox.
            await self.push(room.host, {"type": "guest-joined", "gid": gid})

        else:  # resume
            room = self.rooms.get(room_id)
            conn = None
            if room is not None:
                if room.host.token == token:
                    conn = room.host
                else:
                    conn = next((g for g in room.guests.values() if g.token == token), None)
            if conn is None:
                await sock.send({"type": "error", "reason": "expired"})
                return
            self.cancel_timer(conn)
            old = conn.sock
            conn.sock = sock
            if old is not None and old is not sock and not old.closed:
                try:
                    await old.close()
                except Exception:
                    pass
            session.conn, session.room = conn, room
            await sock.send({"type": "resumed", "gid": conn.gid})
            pending, conn.outbox = conn.outbox, []
            for obj in pending:
                await self.push(conn, obj)

        room.touched = time.time()

    async def relay(self, room, conn, m):
        data = m.get("data")
        if len(json.dumps(data)) > MAX_MSG_BYTES:
            return
        if conn.role == "guest":
            await self.push(room.host, {"type": "msg", "from": conn.gid, "data": data})
            return
        to = m.get("to")
        if to == "all":
            for g in list(room.guests.values()):
                await self.push(g, {"type": "msg", "data": data})
        elif to in room.guests:
            await self.push(room.guests[to], {"type": "msg", "data": data})

    # ---------- disconnects ----------

    async def closed(self, sock, session):
        """A websocket went away. Keep the seat for a grace period."""
        conn, room = session.conn, session.room
        if conn is None or conn.sock is not sock:
            return
        if conn.role == "guest" and room.guests.get(conn.gid) is not conn:
            return  # seat already freed (kicked or left)
        conn.sock = None
        self.cancel_timer(conn)
        grace = self.host_grace if conn.role == "host" else self.guest_grace
        conn.timer = asyncio.ensure_future(self.expire_later(room, conn, grace))

    async def expire_later(self, room, conn, grace):
        try:
            await asyncio.sleep(grace)
        except asyncio.CancelledError:
            return
        conn.timer = None
        await self.remove(room, conn, notify=True)

    def cancel_timer(self, conn):
        if conn.timer is not None:
            conn.timer.cancel()
            conn.timer = None

    async def remove(self, room, conn, notify):
        self.cancel_timer(conn)
        if conn.role == "host":
            if self.rooms.get(room.id) is room:
                del self.rooms[room.id]
            for g in list(room.guests.values()):
                self.cancel_timer(g)
                if notify and g.sock is not None and not g.sock.closed:
                    try:
                        await g.sock.send({"type": "host-left"})
                    except Exception:
                        pass
                if g.sock is not None:
                    try:
                        await g.sock.close()
                    except Exception:
                        pass
            room.guests.clear()
        else:
            room.guests.pop(conn.gid, None)
            if notify and self.rooms.get(room.id) is room:
                await self.push(room.host, {"type": "guest-left", "gid": conn.gid})
        if conn.sock is not None:
            try:
                await conn.sock.close()
            except Exception:
                pass

    async def sweep(self):
        """Drop rooms nobody has touched for a long time."""
        while True:
            await asyncio.sleep(300)
            cutoff = time.time() - ROOM_IDLE_TTL
            for room in [r for r in self.rooms.values() if r.touched < cutoff]:
                await self.remove(room, room.host, notify=True)


# ---------------------------------------------------------------------------
# aiohttp glue (only needed when actually running the server)
# ---------------------------------------------------------------------------

def make_app():
    from aiohttp import WSMsgType, web

    hub = Hub()
    allowed = {o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()}

    class AioSocket:
        def __init__(self, ws):
            self.ws = ws

        @property
        def closed(self):
            return self.ws.closed

        async def send(self, obj):
            await self.ws.send_str(json.dumps(obj, separators=(",", ":")))

        async def close(self):
            await self.ws.close()

    async def ws_handler(request):
        origin = request.headers.get("Origin")
        if allowed and origin not in allowed:
            return web.Response(status=403, text="origin not allowed")
        ws = web.WebSocketResponse(heartbeat=20, max_msg_size=MAX_MSG_BYTES * 2)
        await ws.prepare(request)
        sock, session = AioSocket(ws), Session()
        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    m = json.loads(msg.data)
                except ValueError:
                    continue
                if isinstance(m, dict):
                    await hub.handle(sock, session, m)
        finally:
            await hub.closed(sock, session)
        return ws

    async def health(request):
        return web.json_response({"ok": True, "rooms": len(hub.rooms)},
                                 headers={"Access-Control-Allow-Origin": "*"})

    async def start_sweeper(app):
        app["sweeper"] = asyncio.ensure_future(hub.sweep())

    async def stop_sweeper(app):
        app["sweeper"].cancel()

    app = web.Application()
    app.router.add_get("/", health)
    app.router.add_get("/health", health)
    app.router.add_get("/ws", ws_handler)
    app.on_startup.append(start_sweeper)
    app.on_cleanup.append(stop_sweeper)
    return app


if __name__ == "__main__":
    from aiohttp import web

    web.run_app(make_app(), host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
