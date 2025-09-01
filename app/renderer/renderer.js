class RemoteDeskApp {
  constructor() {
    this.userId = null;
    this.ws = null;
    this.peerConnection = null;
    this.isHost = true;
    this.remoteVideo = null;
    this.localStream = null;

    this.init();
  }

  async init() {
    try {
      this.userId = await window.electronAPI.getUserId();
      this.displayUserId();
      this.connectToServer();
      this.setupEventListeners();
    } catch (error) {
      console.error("Failed to initialize app:", error);
    }
  }

  displayUserId() {
    const userIdElement = document.getElementById("userId");
    userIdElement.textContent = this.userId;
    userIdElement.style.cursor = "pointer";
  }

  connectToServer() {
    // Connect to the signaling server
    this.ws = new WebSocket("wss://remotedesk-production.up.railway.app//ws");

    this.ws.onopen = () => {
      console.log("Connected to signaling server");
      this.updateConnectionStatus("Connected to server");
      // Register with our user ID
      this.registerWithServer();
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };

    this.ws.onclose = () => {
      console.log("Disconnected from signaling server");
      this.updateConnectionStatus("Disconnected from server");
      // Attempt to reconnect after 5 seconds
      setTimeout(() => this.connectToServer(), 5000);
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      this.updateConnectionStatus("Connection error");
    };
  }

  registerWithServer() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "register",
          userId: this.userId,
        })
      );
    }
  }

  handleMessage(message) {
    switch (message.type) {
      case "welcome":
        // Server assigned us our peer ID
        console.log("Welcome, my peer ID is:", message.peerId);
        this.peerId = message.peerId;
        break;

      case "registered":
        console.log("Successfully registered with user ID:", message.userId);
        break;

      case "peer-joined":
        // Someone is trying to connect to us
        this.handleIncomingConnection(message.peerId);
        break;

      case "signal":
        this.handleSignal(message);
        break;

      case "ice-candidate":
        this.handleIceCandidate(message);
        break;

      case "error":
        console.error("Server error:", message.error);
        this.updateConnectionStatus(`Error: ${message.error}`);
        break;
    }
  }

  async handleIncomingConnection(peerId) {
    console.log("Incoming connection from:", peerId);
    this.updateConnectionStatus("Incoming connection...");

    // Automatically accept the connection (no permission prompt)
    await this.setupPeerConnection(peerId);
  }

  async setupPeerConnection(peerId) {
    try {
      this.peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });

      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendSignal(peerId, {
            type: "ice-candidate",
            payload: event.candidate,
          });
        }
      };

      this.peerConnection.ontrack = (event) => {
        console.log("Received remote stream");
        this.handleRemoteStream(event.streams[0]);
      };

      // Get screen sharing stream
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      this.localStream = stream;
      stream.getTracks().forEach((track) => {
        this.peerConnection.addTrack(track, stream);
      });

      // Create and send offer
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      this.sendSignal(peerId, {
        type: "signal",
        payload: offer,
      });

      this.updateConnectionStatus("Screen sharing active");
    } catch (error) {
      console.error("Error setting up peer connection:", error);
      this.updateConnectionStatus("Connection failed");
    }
  }

  handleSignal(message) {
    if (!this.peerConnection) return;

    const { payload } = message;

    if (payload.type === "offer") {
      this.peerConnection
        .setRemoteDescription(new RTCSessionDescription(payload))
        .then(() => this.peerConnection.createAnswer())
        .then((answer) => this.peerConnection.setLocalDescription(answer))
        .then(() => {
          this.sendSignal(message.from, {
            type: "signal",
            payload: this.peerConnection.localDescription,
          });
        })
        .catch((error) => console.error("Error handling offer:", error));
    } else if (payload.type === "answer") {
      this.peerConnection
        .setRemoteDescription(new RTCSessionDescription(payload))
        .catch((error) => console.error("Error handling answer:", error));
    }
  }

  handleIceCandidate(message) {
    if (!this.peerConnection) return;

    this.peerConnection
      .addIceCandidate(new RTCIceCandidate(message.payload))
      .catch((error) => console.error("Error adding ICE candidate:", error));
  }

  sendSignal(targetId, message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: message.type,
          to: targetId,
          payload: message.payload,
        })
      );
    }
  }

  handleRemoteStream(stream) {
    // Create video element for remote screen if it doesn't exist
    if (!this.remoteVideo) {
      this.remoteVideo = document.createElement("video");
      this.remoteVideo.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: black;
                z-index: 1000;
                object-fit: contain;
            `;
      this.remoteVideo.autoplay = true;
      document.body.appendChild(this.remoteVideo);
    }

    this.remoteVideo.srcObject = stream;
    this.updateConnectionStatus("Connected - sharing screen");
  }

  updateConnectionStatus(status) {
    const statusElement = document.getElementById("connectionStatus");
    statusElement.textContent = status;
  }

  connectToUser(targetUserId) {
    if (!targetUserId || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.updateConnectionStatus("Not connected to server");
      return;
    }

    console.log("Attempting to connect to user:", targetUserId);
    this.updateConnectionStatus("Connecting...");

    this.ws.send(
      JSON.stringify({
        type: "connect",
        targetUserId: targetUserId,
      })
    );
  }

  setupEventListeners() {
    // Handle window close to clean up streams
    window.addEventListener("beforeunload", () => {
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => track.stop());
      }
      if (this.ws) {
        this.ws.close();
      }
    });

    // Handle keyboard shortcut for connecting (Ctrl+Shift+C)
    document.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.shiftKey && event.key === "C") {
        event.preventDefault();
        this.showConnectDialog();
      }
    });

    // Connect dialog event listeners
    const connectCancel = document.getElementById("connectCancel");
    const connectSubmit = document.getElementById("connectSubmit");
    const connectInput = document.getElementById("connectInput");
    const connectDialog = document.getElementById("connectDialog");

    if (connectCancel) {
      connectCancel.addEventListener("click", () => {
        this.hideConnectDialog();
      });
    }

    if (connectSubmit) {
      connectSubmit.addEventListener("click", () => {
        this.submitConnectDialog();
      });
    }

    if (connectInput) {
      // Handle Enter key in input field
      connectInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.submitConnectDialog();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          this.hideConnectDialog();
        }
      });

      // Auto-format input to uppercase and validate hex characters
      connectInput.addEventListener("input", (event) => {
        let value = event.target.value.toUpperCase();
        // Only allow hexadecimal characters (0-9, A-F)
        value = value.replace(/[^0-9A-F]/g, "");
        event.target.value = value;
      });
    }

    // Close dialog when clicking outside
    if (connectDialog) {
      connectDialog.addEventListener("click", (event) => {
        if (event.target === connectDialog) {
          this.hideConnectDialog();
        }
      });
    }
  }

  showConnectDialog() {
    const dialog = document.getElementById("connectDialog");
    const input = document.getElementById("connectInput");

    // Clear previous input
    input.value = "";
    input.focus();

    // Show dialog
    dialog.classList.add("show");
  }

  hideConnectDialog() {
    const dialog = document.getElementById("connectDialog");
    dialog.classList.remove("show");
  }

  submitConnectDialog() {
    const input = document.getElementById("connectInput");
    const targetId = input.value.trim().toUpperCase();

    if (targetId) {
      this.connectToUser(targetId);
      this.hideConnectDialog();
    }
  }
}

// Copy user ID to clipboard
function copyUserId() {
  const userId = document.getElementById("userId").textContent;
  if (userId && userId !== "Loading...") {
    navigator.clipboard
      .writeText(userId)
      .then(() => {
        showCopyNotification();
      })
      .catch((err) => {
        console.error("Failed to copy ID:", err);
        // Fallback for older browsers
        const textArea = document.createElement("textarea");
        textArea.value = userId;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        showCopyNotification();
      });
  }
}

function showCopyNotification() {
  const notification = document.getElementById("copyNotification");
  notification.classList.add("show");
  setTimeout(() => {
    notification.classList.remove("show");
  }, 2000);
}

// Initialize the app when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new RemoteDeskApp();
});
