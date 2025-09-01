class RemoteDeskApp {
  constructor() {
    this.userId = null;
    this.ws = null;
    this.peerConnection = null;
    this.isHost = true;
    this.remoteVideo = null;
    this.localStream = null;

    // Mouse control properties
    this.mouseControlEnabled = false;
    this.dataChannel = null;
    this.remoteScreenSize = { width: 1920, height: 1080 }; // Default fallback
    this.localScreenSize = { width: 1920, height: 1080 };

    this.init();
  }

  async init() {
    try {
      this.userId = await window.electronAPI.getUserId();
      this.displayUserId();

      // Get local screen size for mouse coordinate mapping
      try {
        this.localScreenSize = await window.electronAPI.getScreenSize();
        console.log("Local screen size:", this.localScreenSize);
      } catch (error) {
        console.warn("Failed to get screen size, using defaults:", error);
      }

      // Check screen sharing support
      if (!this.isScreenSharingSupported()) {
        this.updateConnectionStatus(
          "⚠️ Screen sharing not supported in this environment"
        );
        console.warn("Screen sharing not supported");
      } else {
        console.log("Screen sharing is supported");
      }

      this.connectToServer();
      this.setupEventListeners();
    } catch (error) {
      console.error("Failed to initialize app:", error);
      this.updateConnectionStatus("❌ Initialization failed");
    }
  }

  displayUserId() {
    const userIdElement = document.getElementById("userId");
    userIdElement.textContent = this.userId;
    userIdElement.style.cursor = "pointer";
  }

  connectToServer() {
    // Connect to the signaling server
    this.ws = new WebSocket("wss://remotedesk-production.up.railway.app/ws");

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
      // Check if screen sharing is supported before proceeding
      if (!this.isScreenSharingSupported()) {
        throw new Error("Screen sharing is not supported in this environment");
      }

      console.log("Setting up peer connection for peer:", peerId);
      this.updateConnectionStatus("Setting up connection...");

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

      // Create data channel for mouse control
      this.dataChannel = this.peerConnection.createDataChannel("mouse-control");
      this.setupDataChannel();

      // Get screen sharing stream using Electron API
      let stream;
      try {
        console.log("Requesting screen sharing...");
        this.updateConnectionStatus("Requesting screen sharing permission...");

        // Get screen source info from Electron main process
        const sourceInfo = await window.electronAPI.getScreenSourceInfo();
        console.log("Got screen source:", sourceInfo);

        // Use Electron-specific constraints for desktop capture
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: sourceInfo.id,
              minWidth: 1280,
              maxWidth: 1920,
              minHeight: 720,
              maxHeight: 1080,
              maxFrameRate: 30,
            },
          },
        });

        console.log("Successfully got screen sharing stream");

        // Verify the stream has video tracks
        if (!stream.getVideoTracks() || stream.getVideoTracks().length === 0) {
          throw new Error("No video track found in screen sharing stream");
        }
      } catch (mediaError) {
        console.error("Error getting media stream:", mediaError);

        // Provide more specific error messages
        let errorMessage = "Screen sharing failed: ";
        if (mediaError.name === "NotAllowedError") {
          errorMessage +=
            "Permission denied. Please allow screen sharing when prompted.";
        } else if (mediaError.name === "NotFoundError") {
          errorMessage += "No screen found to share.";
        } else if (mediaError.name === "NotSupportedError") {
          errorMessage += "Screen sharing not supported in this environment.";
        } else if (mediaError.name === "NotReadableError") {
          errorMessage += "Screen is already being shared or not available.";
        } else {
          errorMessage += mediaError.message || "Unknown error occurred";
        }

        throw new Error(errorMessage);
      }

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

      // Provide user-friendly error messages
      let userMessage = "Connection failed";
      if (error.message.includes("Screen sharing")) {
        userMessage = error.message; // Already formatted error message
      } else if (error.message.includes("Permission denied")) {
        userMessage =
          "❌ Permission denied. Please allow screen sharing and try again.";
      } else if (error.message.includes("network")) {
        userMessage = "❌ Network error. Check your connection and try again.";
      } else {
        userMessage = `❌ ${error.message || "Unknown connection error"}`;
      }

      this.updateConnectionStatus(userMessage);

      // Clean up any partial connection
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }

      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => track.stop());
        this.localStream = null;
      }
    }
  }

  // Set up peer connection as receiver (when someone connects to us)
  async setupPeerConnectionAsReceiver(peerId) {
    console.log("Setting up peer connection as receiver for peer:", peerId);
    this.updateConnectionStatus("Receiving connection...");

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
      console.log("Received remote stream as receiver");
      this.handleRemoteStream(event.streams[0]);
      this.updateConnectionStatus("Connected - viewing remote screen");
    };

    // Handle incoming data channels
    this.peerConnection.ondatachannel = (event) => {
      if (event.channel.label === "mouse-control") {
        this.dataChannel = event.channel;
        this.setupDataChannel();
      }
    };

    // Note: As receiver, we don't need to add any tracks or create offers
    // We'll wait for the offer from the sender and respond with an answer
  }

  async handleSignal(message) {
    const { payload } = message;

    // If we don't have a peer connection but received an offer,
    // we need to set one up (this happens when we're the receiver)
    if (!this.peerConnection && payload.type === "offer") {
      console.log(
        "Received offer but no peer connection exists, setting one up..."
      );
      try {
        await this.setupPeerConnectionAsReceiver(message.from);
      } catch (error) {
        console.error("Failed to set up peer connection as receiver:", error);
        return;
      }
    }

    if (!this.peerConnection) return;

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
                cursor: ${this.mouseControlEnabled ? "crosshair" : "default"};
            `;
      this.remoteVideo.autoplay = true;
      document.body.appendChild(this.remoteVideo);

      // Set up mouse event listeners for remote control
      this.setupMouseEventListeners();
    }

    this.remoteVideo.srcObject = stream;
    this.updateConnectionStatus("Connected - sharing screen");
    this.updateMouseControlButton();
  }

  setupMouseEventListeners() {
    if (!this.remoteVideo) return;

    // Mouse move events
    this.remoteVideo.addEventListener("mousemove", (event) => {
      if (!this.mouseControlEnabled) return;

      const rect = this.remoteVideo.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      this.sendMouseEvent({
        type: "mousemove",
        x: x,
        y: y,
        timestamp: Date.now(),
      });
    });

    // Mouse button events
    this.remoteVideo.addEventListener("mousedown", (event) => {
      if (!this.mouseControlEnabled) return;

      event.preventDefault();

      const rect = this.remoteVideo.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      this.sendMouseEvent({
        type: "mousedown",
        x: x,
        y: y,
        button: event.button,
        timestamp: Date.now(),
      });
    });

    this.remoteVideo.addEventListener("mouseup", (event) => {
      if (!this.mouseControlEnabled) return;

      event.preventDefault();

      const rect = this.remoteVideo.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      this.sendMouseEvent({
        type: "mouseup",
        x: x,
        y: y,
        button: event.button,
        timestamp: Date.now(),
      });
    });

    // Click events
    this.remoteVideo.addEventListener("click", (event) => {
      if (!this.mouseControlEnabled) return;

      const rect = this.remoteVideo.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      this.sendMouseEvent({
        type: "click",
        x: x,
        y: y,
        button: event.button,
        timestamp: Date.now(),
      });
    });

    this.remoteVideo.addEventListener("dblclick", (event) => {
      if (!this.mouseControlEnabled) return;

      event.preventDefault();

      const rect = this.remoteVideo.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      this.sendMouseEvent({
        type: "dblclick",
        x: x,
        y: y,
        button: event.button,
        timestamp: Date.now(),
      });
    });

    // Wheel events
    this.remoteVideo.addEventListener("wheel", (event) => {
      if (!this.mouseControlEnabled) return;

      event.preventDefault();

      this.sendMouseEvent({
        type: "wheel",
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaZ: event.deltaZ,
        timestamp: Date.now(),
      });
    });

    // Context menu (right-click menu)
    this.remoteVideo.addEventListener("contextmenu", (event) => {
      if (!this.mouseControlEnabled) return;
      event.preventDefault();
    });
  }

  updateConnectionStatus(status) {
    const statusElement = document.getElementById("connectionStatus");
    const retryButton = document.getElementById("retryButton");

    statusElement.textContent = status;

    // Show retry button for error states
    if (
      status.includes("❌") ||
      status.includes("failed") ||
      status.includes("not supported")
    ) {
      retryButton.style.display = "inline-block";
    } else {
      retryButton.style.display = "none";
    }
  }

  isScreenSharingSupported() {
    // Check if we're running in Electron
    if (!window.electronAPI || !window.electronAPI.getScreenSourceInfo) {
      console.error("Electron screen sharing API not available");
      return false;
    }

    // Check if mediaDevices API is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.error("getUserMedia not supported");
      return false;
    }

    // Check if we're in a secure context (required for screen sharing)
    if (!window.isSecureContext && location.protocol !== "file:") {
      console.error("Screen sharing requires a secure context (HTTPS)");
      return false;
    }

    return true;
  }

  // Data channel setup for mouse control
  setupDataChannel() {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      console.log("Mouse control data channel opened");
      this.updateMouseControlStatus();
    };

    this.dataChannel.onclose = () => {
      console.log("Mouse control data channel closed");
      this.dataChannel = null;
      this.updateMouseControlStatus();
    };

    this.dataChannel.onerror = (error) => {
      console.error("Data channel error:", error);
    };

    this.dataChannel.onmessage = (event) => {
      try {
        const mouseEvent = JSON.parse(event.data);
        this.handleMouseEvent(mouseEvent);
      } catch (error) {
        console.error("Failed to parse mouse event:", error);
      }
    };
  }

  // Handle incoming mouse events from remote control
  async handleMouseEvent(mouseEvent) {
    if (!this.mouseControlEnabled) return;

    try {
      switch (mouseEvent.type) {
        case "mousemove":
          await this.handleMouseMove(mouseEvent);
          break;
        case "mousedown":
          await this.handleMouseDown(mouseEvent);
          break;
        case "mouseup":
          await this.handleMouseUp(mouseEvent);
          break;
        case "click":
          await this.handleMouseClick(mouseEvent);
          break;
        case "dblclick":
          await this.handleMouseDoubleClick(mouseEvent);
          break;
        case "wheel":
          await this.handleMouseWheel(mouseEvent);
          break;
        default:
          console.warn("Unknown mouse event type:", mouseEvent.type);
      }
    } catch (error) {
      console.error("Error handling mouse event:", error);
    }
  }

  // Convert video coordinates to screen coordinates
  convertVideoToScreenCoords(videoX, videoY) {
    if (!this.remoteVideo) return { x: videoX, y: videoY };

    const videoRect = this.remoteVideo.getBoundingClientRect();
    const scaleX = this.localScreenSize.width / videoRect.width;
    const scaleY = this.localScreenSize.height / videoRect.height;

    return {
      x: Math.round(videoX * scaleX),
      y: Math.round(videoY * scaleY),
    };
  }

  async handleMouseMove(event) {
    const coords = this.convertVideoToScreenCoords(event.x, event.y);
    await window.electronAPI.mouse.move(coords.x, coords.y);
  }

  async handleMouseDown(event) {
    const button = this.mapButton(event.button);
    await window.electronAPI.mouse.toggle(button, true);
  }

  async handleMouseUp(event) {
    const button = this.mapButton(event.button);
    await window.electronAPI.mouse.toggle(button, false);
  }

  async handleMouseClick(event) {
    const button = this.mapButton(event.button);
    await window.electronAPI.mouse.click(button, false);
  }

  async handleMouseDoubleClick(event) {
    const button = this.mapButton(event.button);
    await window.electronAPI.mouse.click(button, true);
  }

  async handleMouseWheel(event) {
    // Convert wheel delta to scroll amount
    const scrollX = event.deltaX > 0 ? 1 : event.deltaX < 0 ? -1 : 0;
    const scrollY = event.deltaY > 0 ? 1 : event.deltaY < 0 ? -1 : 0;
    await window.electronAPI.mouse.scroll(scrollX, scrollY);
  }

  mapButton(button) {
    switch (button) {
      case 0:
        return "left";
      case 1:
        return "middle";
      case 2:
        return "right";
      default:
        return "left";
    }
  }

  // Send mouse event through data channel
  sendMouseEvent(event) {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      return;
    }

    try {
      this.dataChannel.send(JSON.stringify(event));
    } catch (error) {
      console.error("Failed to send mouse event:", error);
    }
  }

  // Toggle mouse control
  toggleMouseControl() {
    this.mouseControlEnabled = !this.mouseControlEnabled;
    this.updateMouseControlStatus();
    console.log(
      "Mouse control:",
      this.mouseControlEnabled ? "enabled" : "disabled"
    );
  }

  updateMouseControlStatus() {
    const status =
      this.mouseControlEnabled &&
      this.dataChannel &&
      this.dataChannel.readyState === "open"
        ? "Mouse control active"
        : "Mouse control inactive";
    this.updateConnectionStatus(status);
    this.updateMouseControlButton();
    this.updateRemoteVideoCursor();
  }

  updateMouseControlButton() {
    const mouseControlButton = document.getElementById("mouseControlButton");
    if (!mouseControlButton) return;

    // Only show button when connected
    if (this.peerConnection && this.remoteVideo) {
      mouseControlButton.style.display = "inline-block";

      if (this.mouseControlEnabled) {
        mouseControlButton.textContent = "🖱️ Disable Mouse Control";
        mouseControlButton.classList.add("active");
      } else {
        mouseControlButton.textContent = "🖱️ Enable Mouse Control";
        mouseControlButton.classList.remove("active");
      }
    } else {
      mouseControlButton.style.display = "none";
    }
  }

  updateRemoteVideoCursor() {
    if (this.remoteVideo) {
      this.remoteVideo.style.cursor = this.mouseControlEnabled
        ? "crosshair"
        : "default";
    }
  }

  connectToUser(targetUserId) {
    if (!targetUserId || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.updateConnectionStatus("Not connected to server");
      return;
    }

    console.log("Attempting to connect to user:", targetUserId);
    this.updateConnectionStatus("Connecting...");

    // Store the target user ID for when we receive signals
    this.targetUserId = targetUserId;

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
      if (this.dataChannel) {
        this.dataChannel.close();
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

    // Retry button event listener
    const retryButton = document.getElementById("retryButton");
    if (retryButton) {
      retryButton.addEventListener("click", () => {
        this.retryConnection();
      });
    }

    // Mouse control button event listener
    const mouseControlButton = document.getElementById("mouseControlButton");
    if (mouseControlButton) {
      mouseControlButton.addEventListener("click", () => {
        this.toggleMouseControl();
        this.updateMouseControlButton();
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

  retryConnection() {
    console.log("Retrying connection...");
    this.updateConnectionStatus("Retrying...");

    // Clean up any existing connections
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    // Clean up remote video and mouse control
    if (this.remoteVideo) {
      this.remoteVideo.remove();
      this.remoteVideo = null;
    }

    // Reset mouse control state
    this.mouseControlEnabled = false;
    this.dataChannel = null;
    this.updateMouseControlButton();

    // Reconnect to server if needed
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connectToServer();
    } else {
      this.updateConnectionStatus("Ready - waiting for connections");
    }
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
    // Use Electron's clipboard API for better compatibility
    if (window.electronAPI && window.electronAPI.clipboard) {
      try {
        window.electronAPI.clipboard.writeText(userId);
        showCopyNotification();
      } catch (err) {
        console.error("Failed to copy ID using Electron API:", err);
        fallbackCopy(userId);
      }
    } else {
      // Fallback to browser clipboard API
      navigator.clipboard
        .writeText(userId)
        .then(() => {
          showCopyNotification();
        })
        .catch((err) => {
          console.error("Failed to copy ID:", err);
          fallbackCopy(userId);
        });
    }
  }
}

// Fallback copy method
function fallbackCopy(text) {
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
    showCopyNotification();
  } catch (err) {
    console.error("Fallback copy failed:", err);
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
