const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const peersCountEl = document.getElementById("peersCount");
const currentRoomEl = document.getElementById("currentRoom");
const remoteVideo = document.getElementById("remoteVideo");
const overlay = document.getElementById("overlay");

const btnCreate = document.getElementById("btnCreate");
const btnJoin = document.getElementById("btnJoin");
const btnShare = document.getElementById("btnShare");
const btnControl = document.getElementById("btnControl");
const roomIdInput = document.getElementById("roomId");

function log(message) {
  const now = new Date().toLocaleTimeString();
  logEl.textContent += `\n[${now}] ${message}`;
  logEl.scrollTop = logEl.scrollHeight;
}

const signalingUrl = "wss://remotedesk-production.up.railway.app/ws";
let ws;
let roomId = null;
let peers = new Map();

let localStream = null;
let dataChannel = null;
let selfId = null;

// cursors state for multi-mouse overlay
const peerIdToCursorEl = new Map();

function updatePeersCount() {
  peersCountEl.textContent = String(peers.size);
}

function setStatus(text) {
  statusEl.textContent = text;
}

function ensureSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  ws = new WebSocket(signalingUrl);
  ws.onopen = () => log("Signaling connected");
  ws.onclose = () => log("Signaling disconnected");
  ws.onmessage = onSignalMessage;
}

function onSignalMessage(event) {
  const msg = JSON.parse(event.data);
  if (msg.type === "welcome") {
    selfId = msg.peerId;
    log(`Your ID: ${selfId}`);
    return;
  }
  if (msg.type === "room-created") {
    roomId = msg.roomId;
    currentRoomEl.textContent = roomId;
    roomIdInput.value = roomId;
    setStatus("Room created");
    return;
  }
  if (msg.type === "room-joined") {
    setStatus("Joined room");
    return;
  }
  if (msg.type === "peer-joined") {
    log(`Peer joined: ${msg.peerId}`);
    peers.set(msg.peerId, {});
    updatePeersCount();
    createPeerConnection(true, msg.peerId);
    return;
  }
  if (msg.type === "peer-left") {
    const { peerId } = msg;
    log(`Peer left: ${peerId}`);
    peers.delete(peerId);
    const el = peerIdToCursorEl.get(peerId);
    if (el) {
      el.remove();
      peerIdToCursorEl.delete(peerId);
    }
    updatePeersCount();
    return;
  }
  if (msg.type === "signal") {
    const { from, to, payload } = msg;
    if (to && selfId && to !== selfId) return;
    let pc = peers.get(from)?.pc;
    if (!pc) {
      pc = createPeerConnection(false, from);
    }
    if (payload.sdp) {
      pc.setRemoteDescription(payload).then(async () => {
        if (payload.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send(
            JSON.stringify({
              type: "signal",
              to: from,
              payload: pc.localDescription,
            })
          );
        }
      });
    }
    return;
  }
  if (msg.type === "ice-candidate") {
    const { from, to, payload } = msg;
    if (to && selfId && to !== selfId) return;
    const pc = peers.get(from)?.pc;
    if (pc && payload) {
      pc.addIceCandidate(payload).catch(() => {});
    }
    return;
  }
  if (msg.type === "error") {
    log(`Error: ${msg.error}`);
  }
}

function createCursor(peerId) {
  const el = document.createElement("div");
  el.className = "cursor";
  overlay.appendChild(el);
  peerIdToCursorEl.set(peerId, el);
  return el;
}

function updateCursor(peerId, x, y) {
  const el = peerIdToCursorEl.get(peerId) || createCursor(peerId);

  // Convert absolute screen coordinates to relative position on video element
  const rect = remoteVideo.getBoundingClientRect();
  const relativeX = x / remoteVideo.videoWidth;
  const relativeY = y / remoteVideo.videoHeight;

  el.style.left = `${rect.left + relativeX * rect.width}px`;
  el.style.top = `${rect.top + relativeY * rect.height}px`;
}

function createPeerConnection(isInitiator, peerId) {
  ensureSocket();
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  peers.set(peerId, { pc });
  updatePeersCount();

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      ws.send(
        JSON.stringify({
          type: "ice-candidate",
          to: peerId,
          payload: e.candidate,
        })
      );
    }
  };

  pc.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
  };

  if (localStream) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  let dc;
  if (isInitiator) {
    dc = pc.createDataChannel("control");
    setupDataChannel(dc);
    pc.createOffer().then(async (offer) => {
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: "signal", to: peerId, payload: offer }));
    });
  } else {
    pc.ondatachannel = (e) => {
      dc = e.channel;
      setupDataChannel(dc);
    };
  }

  return pc;
}

function setupDataChannel(dc) {
  dataChannel = dc;
  dc.onopen = () => log("DataChannel open");
  dc.onclose = () => log("DataChannel closed");
  dc.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "cursor") {
        updateCursor(msg.from || "peer", msg.x, msg.y);
      } else if (msg.type === "mouse") {
        if (
          msg.action === "move" &&
          typeof msg.x === "number" &&
          typeof msg.y === "number"
        ) {
          window.electronAPI.simulateMouse({
            type: "move",
            x: msg.x,
            y: msg.y,
          });
        } else if (msg.action === "down") {
          window.electronAPI.simulateMouse({ type: "down" });
        } else if (msg.action === "up") {
          window.electronAPI.simulateMouse({ type: "up" });
        }
      }
    } catch (_) {}
  };
}

btnCreate.onclick = () => {
  ensureSocket();
  // انتظر الاتصال ينجح
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "create" }));
  } else {
    // لو لسه connecting، انتظر
    const checkConnection = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "create" }));
      } else if (ws.readyState === WebSocket.CONNECTING) {
        setTimeout(checkConnection, 100);
      } else {
        log("Failed to connect to signaling server");
      }
    };
    setTimeout(checkConnection, 100);
  }
};

btnJoin.onclick = () => {
  ensureSocket();
  const rid = roomIdInput.value.trim();
  if (!rid) return;
  roomId = rid;
  currentRoomEl.textContent = roomId;
  // انتظر الاتصال ينجح
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "join", roomId }));
  } else {
    // لو لسه connecting، انتظر
    const checkConnection = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "join", roomId }));
      } else if (ws.readyState === WebSocket.CONNECTING) {
        setTimeout(checkConnection, 100);
      } else {
        log("Failed to connect to signaling server");
      }
    };
    setTimeout(checkConnection, 100);
  }
};

btnShare.onclick = async () => {
  setStatus("Selecting source...");
  const sources = await window.electronAPI.getDesktopSources();
  // naive pick first screen
  const screen =
    sources.find((s) => s.id.toLowerCase().includes("screen")) || sources[0];
  if (!screen) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: screen.id,
        },
      },
    });
  } catch (err) {
    // fallback
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
  }
  localStream = stream;
  // renegotiate on existing PCs
  for (const [, { pc }] of peers) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }
  setStatus("Sharing");
};

// local cursor broadcast
window.addEventListener("mousemove", (e) => {
  if (!dataChannel || dataChannel.readyState !== "open") return;
  // Send absolute screen coordinates instead of normalized window coordinates
  const rect = remoteVideo.getBoundingClientRect();
  const scaleX = remoteVideo.videoWidth / rect.width;
  const scaleY = remoteVideo.videoHeight / rect.height;

  // Calculate position relative to the video element
  const relativeX = (e.clientX - rect.left) / rect.width;
  const relativeY = (e.clientY - rect.top) / rect.height;

  // Convert to screen coordinates of the remote machine
  const screenX = Math.round(relativeX * remoteVideo.videoWidth);
  const screenY = Math.round(relativeY * remoteVideo.videoHeight);

  dataChannel.send(JSON.stringify({ type: "cursor", x: screenX, y: screenY }));
});

btnControl.onclick = () => {
  // demo: simulate local control event to remote
  window.addEventListener(
    "click",
    (e) => {
      if (!dataChannel || dataChannel.readyState !== "open") return;

      // Calculate screen coordinates for the click
      const rect = remoteVideo.getBoundingClientRect();
      const relativeX = (e.clientX - rect.left) / rect.width;
      const relativeY = (e.clientY - rect.top) / rect.height;
      const screenX = Math.round(relativeX * remoteVideo.videoWidth);
      const screenY = Math.round(relativeY * remoteVideo.videoHeight);

      dataChannel.send(
        JSON.stringify({
          type: "mouse",
          action: "move",
          x: screenX,
          y: screenY,
        })
      );
      dataChannel.send(JSON.stringify({ type: "mouse", action: "down" }));
      dataChannel.send(JSON.stringify({ type: "mouse", action: "up" }));
    },
    { once: true }
  );
  log("Next click will be sent as remote mouse click");
};
