
const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const { v4: uuidv4 } = require("uuid");

/**
 * Starts the signaling server (Express + WebSocket)
 * @param {object} options
 * @param {number} [options.port=3001]
 * @param {boolean} [options.probe=false] - If true, auto-stop shortly after start (for CI sanity checks)
 * @returns {{ httpServer: import('http').Server, wss: import('ws').WebSocketServer }}
 */
function start(options = {}) {
  // Use environment variable PORT if available, otherwise fallback to 5005
  const port = process.env.PORT || options.port || 5005;
  // Use environment variable HOST if available, otherwise fallback to 0.0.0.0 for production
  const host = process.env.HOST || '0.0.0.0';

  console.log(`[config] Starting server with port=${port}, host=${host}`);
  console.log(`[config] NODE_ENV=${process.env.NODE_ENV}`);

  const app = express();
  app.use(express.json());

  app.get("/health", (req, res) => {
    console.log(`[health] Health check request from ${req.ip}`);
    res.status(200).send("ok");
  });

  app.get("/", (req, res) => {
    res.status(200).send("RemoteDesk Signaling Server is running");
  });

  app.get("/status", (req, res) => {
    res.json({
      status: "running",
      port: port,
      host: host,
      nodeEnv: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    });
  });

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  const rooms = new Map(); // roomId -> Set<WebSocket>

  function send(ws, message) {
    try {
      ws.send(JSON.stringify(message));
    } catch (_) {
      // ignore send errors
    }
  }

  function broadcastToRoom(roomId, message, exclude) {
    const clients = rooms.get(roomId);
    if (!clients) return;
    for (const client of clients) {
      if (client !== exclude && client.readyState === 1) {
        send(client, message);
      }
    }
  }

  wss.on("connection", (ws) => {
    ws.id = uuidv4();
    ws.roomId = null;

    // greet client with its assigned id
    send(ws, { type: "welcome", peerId: ws.id });

    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (err) {
        return;
      }

      const { type, roomId, payload, to: targetId } = msg || {};

      if (type === "create") {
        const newRoomId = uuidv4().slice(0, 8);
        const set = new Set();
        set.add(ws);
        rooms.set(newRoomId, set);
        ws.roomId = newRoomId;
        send(ws, { type: "room-created", roomId: newRoomId });
        return;
      }

      if (type === "join") {
        if (!roomId || !rooms.has(roomId)) {
          send(ws, { type: "error", error: "ROOM_NOT_FOUND" });
          return;
        }
        const set = rooms.get(roomId);
        set.add(ws);
        ws.roomId = roomId;
        send(ws, { type: "room-joined", roomId });
        // Notify others that a peer joined
        broadcastToRoom(roomId, { type: "peer-joined", peerId: ws.id }, ws);
        return;
      }

      if (type === "signal") {
        if (!ws.roomId) return;
        if (targetId) {
          const clients = rooms.get(ws.roomId);
          for (const client of clients || []) {
            if (client.id === targetId && client.readyState === 1) {
              send(client, {
                type: "signal",
                from: ws.id,
                to: targetId,
                payload,
              });
            }
          }
        } else {
          broadcastToRoom(
            ws.roomId,
            { type: "signal", from: ws.id, payload },
            ws
          );
        }
        return;
      }

      if (type === "ice-candidate") {
        if (!ws.roomId) return;
        if (targetId) {
          const clients = rooms.get(ws.roomId);
          for (const client of clients || []) {
            if (client.id === targetId && client.readyState === 1) {
              send(client, {
                type: "ice-candidate",
                from: ws.id,
                to: targetId,
                payload,
              });
            }
          }
        } else {
          broadcastToRoom(
            ws.roomId,
            { type: "ice-candidate", from: ws.id, payload },
            ws
          );
        }
        return;
      }
    });

    ws.on("close", () => {
      const { roomId } = ws;
      if (!roomId) return;
      const set = rooms.get(roomId);
      if (!set) return;
      set.delete(ws);
      broadcastToRoom(roomId, { type: "peer-left", peerId: ws.id }, ws);
      if (set.size === 0) {
        rooms.delete(roomId);
      }
    });
  });

  httpServer.listen(port, host, () => {
    console.log(`[signaling] listening on http://${host}:${port}`);
    console.log(`[signaling] WebSocket available at ws://${host}:${port}/ws`);
    console.log(`[signaling] Health check available at http://${host}:${port}/health`);
    console.log(`[signaling] Status available at http://${host}:${port}/status`);
  });

  httpServer.on('error', (err) => {
    console.error(`[error] Server error: ${err.message}`);
    if (err.code === 'EADDRINUSE') {
      console.error(`[error] Port ${port} is already in use`);
    }
  });

  if (options.probe) {
    setTimeout(() => {
      try {
        wss.close();
        httpServer.close();
      } catch (_) {}
    }, 300);
  }

  return { httpServer, wss };
}

if (require.main === module) {
  start();
}

module.exports = { start };
