const WebSocket = require("ws")
const http = require("http")
const fs = require("fs")
const path = require("path")
const url = require("url")

// Create HTTP server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url)
  let filePath = "." + parsedUrl.pathname

  if (filePath === "./") {
    filePath = "./index.html"
  }

  const extname = path.extname(filePath)
  let contentType = "text/html"

  switch (extname) {
    case ".js":
      contentType = "text/javascript"
      break
    case ".css":
      contentType = "text/css"
      break
    case ".json":
      contentType = "application/json"
      break
    case ".png":
      contentType = "image/png"
      break
    case ".jpg":
      contentType = "image/jpg"
      break
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        // File not found
        fs.readFile("./404.html", (error, content) => {
          res.writeHead(404, { "Content-Type": "text/html" })
          res.end(content, "utf-8")
        })
      } else {
        // Server error
        res.writeHead(500)
        res.end(`Server Error: ${error.code}`)
      }
    } else {
      // Success
      res.writeHead(200, { "Content-Type": contentType })
      res.end(content, "utf-8")
    }
  })
})

// Create WebSocket server
const wss = new WebSocket.Server({ server })

// Store active rooms and their participants
const rooms = {}

wss.on("connection", (ws) => {
  console.log("New client connected")

  // Assign a unique ID to this client
  ws.id = generateId()

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message)
      console.log("Received:", data)

      switch (data.type) {
        case "create":
          handleCreateRoom(ws, data)
          break
        case "join":
          handleJoinRoom(ws, data)
          break
        case "offer":
          handleOffer(ws, data)
          break
        case "answer":
          handleAnswer(ws, data)
          break
        case "candidate":
          handleCandidate(ws, data)
          break
        case "leave":
          handleLeaveRoom(ws, data)
          break
        case "chat_message":
          handleChatMessage(ws, data)
          break
        default:
          console.log("Unknown message type:", data.type)
      }
    } catch (error) {
      console.error("Error parsing message:", error)
    }
  })

  ws.on("close", () => {
    console.log("Client disconnected")
    // Find and remove client from any room they were in
    for (const roomId in rooms) {
      const room = rooms[roomId]
      if (room.clients.includes(ws.id)) {
        handleLeaveRoom(ws, { room: roomId })
        break
      }
    }
  })
})

// Handle room creation
function handleCreateRoom(ws, data) {
  const roomId = data.room

  // Check if room already exists
  if (rooms[roomId]) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Room already exists",
      }),
    )
    return
  }

  // Create new room
  rooms[roomId] = {
    creator: ws.id,
    clients: [ws.id],
    clientsMap: { [ws.id]: ws },
  }

  // Store room ID in the WebSocket object for easy access
  ws.roomId = roomId

  // Send confirmation
  ws.send(
    JSON.stringify({
      type: "room_created",
      room: roomId,
    }),
  )

  console.log(`Room created: ${roomId}`)
}

// Handle room join
function handleJoinRoom(ws, data) {
  const roomId = data.room

  // Check if room exists
  if (!rooms[roomId]) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Room does not exist",
      }),
    )
    return
  }

  // Check if room is full (max 4 clients)
  if (rooms[roomId].clients.length >= 4) {
    ws.send(
      JSON.stringify({
        type: "room_full",
        room: roomId,
      }),
    )
    return
  }

  // Add client to room
  rooms[roomId].clients.push(ws.id)
  rooms[roomId].clientsMap[ws.id] = ws

  // Store room ID in the WebSocket object for easy access
  ws.roomId = roomId

  // Send confirmation to the joining client with list of all participants
  ws.send(
    JSON.stringify({
      type: "room_joined",
      room: roomId,
      participants: rooms[roomId].clients,
    }),
  )

  // Notify other clients in the room about the new participant
  rooms[roomId].clients.forEach((clientId) => {
    if (clientId !== ws.id) {
      const client = rooms[roomId].clientsMap[clientId]
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            type: "new_participant",
            peerId: ws.id,
            room: roomId,
          }),
        )
      }
    }
  })

  console.log(`Client ${ws.id} joined room: ${roomId}`)
}

// Handle WebRTC offer
function handleOffer(ws, data) {
  const roomId = data.room
  const targetPeerId = data.target

  if (!rooms[roomId]) return

  // Forward offer to the specific target client
  const targetClient = rooms[roomId].clientsMap[targetPeerId]
  if (targetClient && targetClient.readyState === WebSocket.OPEN) {
    targetClient.send(
      JSON.stringify({
        type: "offer",
        offer: data.offer,
        room: roomId,
        sender: ws.id,
      }),
    )
  }
}

// Handle WebRTC answer
function handleAnswer(ws, data) {
  const roomId = data.room
  const targetPeerId = data.target

  if (!rooms[roomId]) return

  // Forward answer to the specific target client
  const targetClient = rooms[roomId].clientsMap[targetPeerId]
  if (targetClient && targetClient.readyState === WebSocket.OPEN) {
    targetClient.send(
      JSON.stringify({
        type: "answer",
        answer: data.answer,
        room: roomId,
        sender: ws.id,
      }),
    )
  }
}

// Handle ICE candidate
function handleCandidate(ws, data) {
  const roomId = data.room
  const targetPeerId = data.target

  if (!rooms[roomId]) return

  // Forward ICE candidate to the specific target client
  const targetClient = rooms[roomId].clientsMap[targetPeerId]
  if (targetClient && targetClient.readyState === WebSocket.OPEN) {
    targetClient.send(
      JSON.stringify({
        type: "candidate",
        candidate: data.candidate,
        room: roomId,
        sender: ws.id,
      }),
    )
  }
}

// Handle client leaving room
function handleLeaveRoom(ws, data) {
  const roomId = data.room

  if (!rooms[roomId]) return

  // Remove client from room
  const index = rooms[roomId].clients.indexOf(ws.id)
  if (index !== -1) {
    rooms[roomId].clients.splice(index, 1)
    delete rooms[roomId].clientsMap[ws.id]

    // Notify other clients that this user disconnected
    rooms[roomId].clients.forEach((clientId) => {
      const client = rooms[roomId].clientsMap[clientId]
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            type: "user_disconnected",
            peerId: ws.id,
            room: roomId,
          }),
        )
      }
    })

    // If room is empty, delete it
    if (rooms[roomId].clients.length === 0) {
      delete rooms[roomId]
      console.log(`Room deleted: ${roomId}`)
    }

    console.log(`Client ${ws.id} left room: ${roomId}`)
  }
}

// Handle chat message
function handleChatMessage(ws, data) {
  const roomId = data.room

  if (!rooms[roomId]) return

  // Forward chat message to all other clients in the room
  rooms[roomId].clients.forEach((clientId) => {
    if (clientId !== ws.id) {
      const client = rooms[roomId].clientsMap[clientId]
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            type: "chat_message",
            sender: `Participant ${ws.id.substring(0, 4)}`,
            message: data.message,
            room: roomId,
          }),
        )
      }
    }
  })
}

// Generate a unique ID
function generateId() {
  return Math.random().toString(36).substring(2, 10)
}

// Start the server
const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`)
})
