const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Create a basic HTTP server to serve static files
const server = http.createServer((req, res) => {
  if (req.url === '/') {
    // Serve your HTML file
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        return res.end('Error loading page');
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else if (req.url === '/favicon.ico') {
    // Serve a favicon if it exists
    fs.readFile(path.join(__dirname, 'favicon.ico'), (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'image/x-icon' });
      res.end(data);
    });
  } else {
    // Serve other static files (CSS, JS, etc.)
    const filePath = path.join(__dirname, req.url);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('File not found');
      }
      res.writeHead(200);
      res.end(data);
    });
  }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    // Broadcast incoming message to all clients
    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  ws.on('close', () => {
    // Handle client disconnect
  });
});

// Start the HTTP server
server.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
});
