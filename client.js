// Configuration
const SIGNALING_SERVER = "wss://ca24-2400-1a00-bd11-e08c-8619-943e-70fa-7e29.ngrok-free.app"
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
]

// DOM Elements
const localVideo = document.getElementById("localVideo")
const roomInput = document.getElementById("room-input")
const joinBtn = document.getElementById("join-btn")
const createBtn = document.getElementById("create-btn")
const roomInfo = document.getElementById("room-info")
const roomIdDisplay = document.getElementById("room-id-display")
const copyRoomIdBtn = document.getElementById("copy-room-id")
const callContainer = document.getElementById("call-container")
const welcomeScreen = document.getElementById("welcome-screen")
const connectionStatus = document.getElementById("connection-status")
const micBtn = document.getElementById("mic-btn")
const cameraBtn = document.getElementById("camera-btn")
const screenBtn = document.getElementById("screen-btn")
const endCallBtn = document.getElementById("end-call-btn")
const chatInput = document.getElementById("chat-input")
const sendMsgBtn = document.getElementById("send-msg-btn")
const chatMessages = document.getElementById("chat-messages")
const localVideoOff = document.getElementById("local-video-off")
const toast = document.getElementById("toast")
const toastMessage = document.getElementById("toast-message")

// Function to create a remote video element
function createRemoteVideoElement(peerId) {
  const videoContainer = document.createElement("div")
  videoContainer.className = "relative rounded-xl overflow-hidden video-container bg-gray-800"
  videoContainer.id = `video-container-${peerId}`

  const videoElement = document.createElement("video")
  videoElement.id = `remote-video-${peerId}`
  videoElement.autoplay = true
  videoElement.playsinline = true
  videoElement.className = "w-full h-full object-cover"

  const videoOffPlaceholder = document.createElement("div")
  videoOffPlaceholder.id = `remote-video-off-${peerId}`
  videoOffPlaceholder.className = "absolute inset-0 video-off-placeholder flex"
  videoOffPlaceholder.innerHTML = '<i class="fas fa-user-circle"></i>'

  const nameTag = document.createElement("div")
  nameTag.id = `remote-user-name-${peerId}`
  nameTag.className = "absolute bottom-4 left-4 px-3 py-1 rounded-lg glass text-sm"
  nameTag.textContent = `Participant ${peerId.substring(0, 4)}`

  videoContainer.appendChild(videoElement)
  videoContainer.appendChild(videoOffPlaceholder)
  videoContainer.appendChild(nameTag)

  document.getElementById("videos-container").appendChild(videoContainer)

  return {
    container: videoContainer,
    video: videoElement,
    placeholder: videoOffPlaceholder,
    nameTag: nameTag,
  }
}

// Function to remove a remote video element
function removeRemoteVideoElement(peerId) {
  const container = document.getElementById(`video-container-${peerId}`)
  if (container) {
    container.remove()
  }
}

// State variables
let peerConnections = {}
let localStream
let screenStream
let roomId
let ws
let isScreenSharing = false
let isMuted = false
let isCameraOff = false
let participantCount = 1
const participantCountElement = document.getElementById("participant-count")

// Initialize the application
async function init() {
  try {
    // Get local media stream with audio and video
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    })

    // Display local video
    localVideo.srcObject = localStream

    // Set up event listeners
    setupEventListeners()
  } catch (error) {
    showToast(`Error accessing media devices: ${error.message}`)
    console.error("Error accessing media devices:", error)
  }
}

// Set up WebSocket connection to signaling server
function connectToSignalingServer() {
  ws = new WebSocket(SIGNALING_SERVER)

  ws.onopen = () => {
    updateConnectionStatus("Connected", "bg-green-600")

    // Join or create room after connection is established
    if (roomId) {
      ws.send(
        JSON.stringify({
          type: "join",
          room: roomId,
        }),
      )
    }
  }

  ws.onclose = () => {
    updateConnectionStatus("Disconnected", "bg-red-600")
    setTimeout(connectToSignalingServer, 5000) // Try to reconnect after 5 seconds
  }

  ws.onerror = (error) => {
    console.error("WebSocket error:", error)
    updateConnectionStatus("Connection Error", "bg-red-600")
  }

  ws.onmessage = handleSignalingMessage
}

// Handle incoming signaling messages
async function handleSignalingMessage(event) {
  const data = JSON.parse(event.data)

  switch (data.type) {
    case "room_created":
      handleRoomCreated(data)
      break
    case "room_joined":
      handleRoomJoined(data)
      break
    case "room_full":
      showToast("Room is full, please try another room")
      break
    case "new_participant":
      handleNewParticipant(data)
      break
    case "offer":
      await handleOffer(data)
      break
    case "answer":
      await handleAnswer(data)
      break
    case "candidate":
      await handleCandidate(data)
      break
    case "user_disconnected":
      handleUserDisconnected(data)
      break
    case "chat_message":
      addChatMessage(data.sender, data.message, false)
      break
    default:
      console.log("Unknown message type:", data.type)
  }
}

// Create a new room
function createRoom() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    roomId = generateRoomId()
    ws.send(
      JSON.stringify({
        type: "create",
        room: roomId,
      }),
    )
  } else {
    showToast("Signaling server connection not established")
  }
}

// Join an existing room
function joinRoom() {
  const roomInputValue = roomInput.value.trim()

  if (!roomInputValue) {
    showToast("Please enter a room ID")
    return
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    roomId = roomInputValue
    ws.send(
      JSON.stringify({
        type: "join",
        room: roomId,
      }),
    )
  } else {
    showToast("Signaling server connection not established")
  }
}

// Handle room created event
function handleRoomCreated(data) {
  showToast("Room created successfully")
  showCallInterface(data.room)
}

// Handle room joined event
function handleRoomJoined(data) {
  showToast("Joined room successfully")
  showCallInterface(data.room)

  // Update participant count
  participantCount = data.participants.length
  participantCountElement.textContent = participantCount

  // Create peer connections with existing participants
  data.participants.forEach((peerId) => {
    if (peerId !== ws.id) {
      const peerConnection = createPeerConnection(peerId, true)
      createAndSendOffer(peerId)
    }
  })
}

// Handle new participant event
function handleNewParticipant(data) {
  const peerId = data.peerId

  showToast(`New participant joined: ${peerId.substring(0, 4)}`)

  // Update participant count
  participantCount++
  participantCountElement.textContent = participantCount
}

// Handle user disconnected event
function handleUserDisconnected(data) {
  const peerId = data.peerId

  showToast(`Participant ${peerId.substring(0, 4)} disconnected`)

  // Clean up peer connection
  if (peerConnections[peerId]) {
    peerConnections[peerId].connection.close()
    delete peerConnections[peerId]
  }

  // Remove video element
  removeRemoteVideoElement(peerId)

  // Update participant count
  participantCount--
  participantCountElement.textContent = participantCount
}

// Create WebRTC peer connection for a specific peer
function createPeerConnection(peerId, initiator = false) {
  if (peerConnections[peerId]) {
    console.log(`Peer connection to ${peerId} already exists`)
    return peerConnections[peerId].connection
  }

  const peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS })

  // Add local tracks to the peer connection
  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream)
  })

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(
        JSON.stringify({
          type: "candidate",
          candidate: event.candidate,
          room: roomId,
          target: peerId,
          sender: ws.id,
        }),
      )
    }
  }

  // Handle connection state changes
  peerConnection.onconnectionstatechange = () => {
    console.log(`Connection state with ${peerId}:`, peerConnection.connectionState)
  }

  // Create video elements for this peer
  const videoElements = createRemoteVideoElement(peerId)

  // Handle incoming tracks
  peerConnection.ontrack = (event) => {
    videoElements.video.srcObject = event.streams[0]
    videoElements.placeholder.classList.add("hidden")
  }

  // Store the connection and related elements
  peerConnections[peerId] = {
    connection: peerConnection,
    videoElements: videoElements,
    initiator: initiator,
  }

  return peerConnection
}

// Create and send offer to a specific peer
async function createAndSendOffer(peerId) {
  try {
    const peerConnection = peerConnections[peerId].connection

    const offer = await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer)

    ws.send(
      JSON.stringify({
        type: "offer",
        offer: peerConnection.localDescription,
        room: roomId,
        target: peerId,
        sender: ws.id,
      }),
    )
  } catch (error) {
    console.error(`Error creating offer for ${peerId}:`, error)
    showToast("Error creating offer")
  }
}

// Handle incoming offer from a specific peer
async function handleOffer(data) {
  try {
    const peerId = data.sender
    const peerConnection = createPeerConnection(peerId)

    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer))

    const answer = await peerConnection.createAnswer()
    await peerConnection.setLocalDescription(answer)

    ws.send(
      JSON.stringify({
        type: "answer",
        answer: peerConnection.localDescription,
        room: roomId,
        target: peerId,
        sender: ws.id,
      }),
    )
  } catch (error) {
    console.error("Error handling offer:", error)
    showToast("Error handling offer")
  }
}

// Handle incoming answer from a specific peer
async function handleAnswer(data) {
  try {
    const peerId = data.sender

    if (peerConnections[peerId]) {
      const peerConnection = peerConnections[peerId].connection
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer))
    }
  } catch (error) {
    console.error("Error handling answer:", error)
    showToast("Error handling answer")
  }
}

// Handle incoming ICE candidate from a specific peer
async function handleCandidate(data) {
  try {
    const peerId = data.sender

    if (peerConnections[peerId]) {
      const peerConnection = peerConnections[peerId].connection
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
    }
  } catch (error) {
    console.error("Error adding ICE candidate:", error)
  }
}

// Toggle microphone
function toggleMicrophone() {
  if (localStream) {
    const audioTracks = localStream.getAudioTracks()
    if (audioTracks.length > 0) {
      isMuted = !isMuted
      audioTracks[0].enabled = !isMuted

      // Update UI
      if (isMuted) {
        micBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>'
        micBtn.classList.add("bg-red-600")
        micBtn.classList.remove("bg-gray-700")
      } else {
        micBtn.innerHTML = '<i class="fas fa-microphone"></i>'
        micBtn.classList.remove("bg-red-600")
        micBtn.classList.add("bg-gray-700")
      }
    }
  }
}

// Toggle camera
function toggleCamera() {
  if (localStream) {
    const videoTracks = localStream.getVideoTracks()
    if (videoTracks.length > 0) {
      isCameraOff = !isCameraOff
      videoTracks[0].enabled = !isCameraOff

      // Update UI
      if (isCameraOff) {
        cameraBtn.innerHTML = '<i class="fas fa-video-slash"></i>'
        cameraBtn.classList.add("bg-red-600")
        cameraBtn.classList.remove("bg-gray-700")
        localVideoOff.classList.remove("hidden")
      } else {
        cameraBtn.innerHTML = '<i class="fas fa-video"></i>'
        cameraBtn.classList.remove("bg-red-600")
        cameraBtn.classList.add("bg-gray-700")
        localVideoOff.classList.add("hidden")
      }
    }
  }
}

// Toggle screen sharing
async function toggleScreenSharing() {
  if (Object.keys(peerConnections).length === 0) {
    showToast("Cannot share screen: No active connections")
    return
  }

  if (isScreenSharing) {
    // Stop screen sharing
    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop())
    }

    // Replace with camera stream again for all peer connections
    const videoTrack = localStream.getVideoTracks()[0]

    Object.values(peerConnections).forEach(({ connection }) => {
      const senders = connection.getSenders()
      const sender = senders.find((s) => s.track.kind === "video")
      if (sender && videoTrack) {
        sender.replaceTrack(videoTrack)
      }
    })

    // Update UI
    localVideo.srcObject = localStream
    screenBtn.innerHTML = '<i class="fas fa-desktop"></i>'
    screenBtn.classList.remove("bg-purple-600")
    screenBtn.classList.add("bg-gray-700")
    isScreenSharing = false
  } else {
    // Start screen sharing
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true })

      // Replace video track with screen sharing track for all peer connections
      const screenTrack = screenStream.getVideoTracks()[0]

      Object.values(peerConnections).forEach(({ connection }) => {
        const senders = connection.getSenders()
        const sender = senders.find((s) => s.track.kind === "video")
        if (sender) {
          sender.replaceTrack(screenTrack)
        }
      })

      // Update UI
      localVideo.srcObject = screenStream
      screenBtn.innerHTML = '<i class="fas fa-desktop"></i>'
      screenBtn.classList.add("bg-purple-600")
      screenBtn.classList.remove("bg-gray-700")
      isScreenSharing = true

      // Handle screen sharing ended by user
      screenTrack.onended = () => {
        toggleScreenSharing()
      }
    } catch (error) {
      console.error("Error sharing screen:", error)
      showToast("Error sharing screen")
    }
  }
}

// End the call
function endCall() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "leave",
        room: roomId,
      }),
    )
  }

  // Clean up resources
  Object.values(peerConnections).forEach(({ connection }) => {
    connection.close()
  })
  peerConnections = {}

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop())
  }

  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop())
  }

  // Reset UI
  localVideo.srcObject = null

  // Clear all remote videos
  const videosContainer = document.getElementById("videos-container")
  while (videosContainer.children.length > 1) {
    videosContainer.removeChild(videosContainer.lastChild)
  }

  // Show welcome screen
  callContainer.classList.add("hidden")
  roomInfo.classList.add("hidden")
  welcomeScreen.classList.remove("hidden")

  // Reset state
  roomId = null
  isScreenSharing = false
  isMuted = false
  isCameraOff = false
  participantCount = 1

  // Reset UI elements
  micBtn.innerHTML = '<i class="fas fa-microphone"></i>'
  micBtn.classList.remove("bg-red-600")
  micBtn.classList.add("bg-gray-700")

  cameraBtn.innerHTML = '<i class="fas fa-video"></i>'
  cameraBtn.classList.remove("bg-red-600")
  cameraBtn.classList.add("bg-gray-700")

  screenBtn.innerHTML = '<i class="fas fa-desktop"></i>'
  screenBtn.classList.remove("bg-purple-600")
  screenBtn.classList.add("bg-gray-700")

  // Reinitialize
  init()
}

// Send chat message
function sendChatMessage() {
  const message = chatInput.value.trim()

  if (!message) return

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "chat_message",
        room: roomId,
        message: message,
      }),
    )

    // Add message to chat
    addChatMessage("You", message, true)

    // Clear input
    chatInput.value = ""
  } else {
    showToast("Cannot send message: Connection lost")
  }
}

// Add chat message to the UI
function addChatMessage(sender, message, isLocal) {
  const messageElement = document.createElement("div")
  messageElement.className = isLocal
    ? "ml-auto max-w-[80%] p-3 rounded-lg bg-indigo-600"
    : "mr-auto max-w-[80%] p-3 rounded-lg bg-gray-700"

  const senderElement = document.createElement("div")
  senderElement.className = "font-semibold text-sm"
  senderElement.textContent = sender

  const textElement = document.createElement("div")
  textElement.textContent = message

  messageElement.appendChild(senderElement)
  messageElement.appendChild(textElement)

  chatMessages.appendChild(messageElement)

  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight
}

// Show call interface
function showCallInterface(roomIdValue) {
  roomIdDisplay.textContent = roomIdValue
  welcomeScreen.classList.add("hidden")
  roomInfo.classList.remove("hidden")
  callContainer.classList.remove("hidden")
}

// Update connection status
function updateConnectionStatus(status, bgClass) {
  connectionStatus.textContent = status
  connectionStatus.className = `px-4 py-2 rounded-full text-sm font-medium ${bgClass}`
  connectionStatus.classList.remove("hidden")
}

// Show toast notification
function showToast(message) {
  toastMessage.textContent = message
  toast.classList.remove("hidden")

  setTimeout(() => {
    toast.classList.add("hidden")
  }, 3000)
}

// Generate random room ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 10)
}

// Copy room ID to clipboard
function copyRoomId() {
  navigator.clipboard
    .writeText(roomId)
    .then(() => {
      showToast("Room ID copied to clipboard")
    })
    .catch((err) => {
      console.error("Failed to copy room ID:", err)
      showToast("Failed to copy room ID")
    })
}

// Set up event listeners
function setupEventListeners() {
  joinBtn.addEventListener("click", joinRoom)
  createBtn.addEventListener("click", createRoom)
  copyRoomIdBtn.addEventListener("click", copyRoomId)
  micBtn.addEventListener("click", toggleMicrophone)
  cameraBtn.addEventListener("click", toggleCamera)
  screenBtn.addEventListener("click", toggleScreenSharing)
  endCallBtn.addEventListener("click", endCall)
  sendMsgBtn.addEventListener("click", sendChatMessage)

  chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      sendChatMessage()
    }
  })
}

// Initialize the application
init()

// Connect to signaling server
connectToSignalingServer()
