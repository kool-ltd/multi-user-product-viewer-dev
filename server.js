"use strict";

// Load environment variables from .env immediately.
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Ensure the uploads folder exists.
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Serve static files from 'public' folder.
app.use(express.static('public'));

// Serve files from the uploads folder.
app.use('/uploads', express.static(uploadDir));

// Configure Multer for file uploads, keeping the original filename.
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage: storage });

// Global state for managing host and host-transfer requests.
let hostSocketId = null;
let pendingRequests = {}; // { requestId: { timeout: TimeoutObject, requester: socketId } }

// File Upload Endpoint.
app.post('/upload', upload.single('model'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Construct the base URL using environment variable or fallback to request host.
  const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  console.log("Using baseUrl:", baseUrl); // For debugging.

  const fileUrl = `${baseUrl}/uploads/${req.file.filename}`;

  // Extract uploader's socket id from custom header "x-socket-id".
  const uploaderId = req.headers['x-socket-id'];

  // Broadcast to all connected sockets except the uploader.
  if (uploaderId) {
    for (const [id, socketInstance] of io.of("/").sockets) {
      if (id !== uploaderId) {
        socketInstance.emit('model-uploaded', {
          url: fileUrl,
          name: req.file.originalname,
          id: uuidv4(),
          sender: uploaderId
        });
      }
    }
  } else {
    // Fallback broadcast if uploaderId is not provided.
    io.emit('model-uploaded', {
      url: fileUrl,
      name: req.file.originalname,
      id: uuidv4()
    });
  }

  res.json({ url: fileUrl, name: req.file.originalname });
});

// Socket communication.
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('register-host', () => {
    console.log(`register-host from ${socket.id}`);
    hostSocketId = socket.id;
    io.emit('host-changed', { hostSocketId });
  });

  socket.on('request-host', () => {
    console.log(`request-host from ${socket.id}`);
    if (!hostSocketId) {
      hostSocketId = socket.id;
      io.emit('host-changed', { hostSocketId });
    } else if (hostSocketId === socket.id) {
      console.log(`Socket ${socket.id} is already the host.`);
    } else {
      const requestId = uuidv4();
      const timeout = setTimeout(() => {
        console.log(`Auto transferring host role to ${socket.id} for request ${requestId}`);
        hostSocketId = socket.id;
        io.emit('host-changed', { hostSocketId });
        delete pendingRequests[requestId];
      }, 30000);
      pendingRequests[requestId] = { timeout, requester: socket.id };
      io.to(hostSocketId).emit('host-transfer-request', { requestId, requester: socket.id });
    }
  });

  socket.on('release-host', (data) => {
    const { requestId } = data;
    if (pendingRequests[requestId]) {
      const { timeout, requester } = pendingRequests[requestId];
      clearTimeout(timeout);
      hostSocketId = requester;
      io.emit('host-changed', { hostSocketId });
      delete pendingRequests[requestId];
    }
  });

  socket.on('deny-host', (data) => {
    const { requestId } = data;
    if (pendingRequests[requestId]) {
      const { timeout, requester } = pendingRequests[requestId];
      clearTimeout(timeout);
      io.to(requester).emit('transfer-denied', { requestId });
      delete pendingRequests[requestId];
    }
  });

  socket.on('give-up-host', () => {
    if (socket.id === hostSocketId) {
      hostSocketId = null;
      io.emit('host-changed', { hostSocketId: null });
    }
  });

  socket.on('model-transform', (modelState) => {
    if (socket.id === hostSocketId) {
      socket.broadcast.emit('model-transform', modelState);
    }
  });
  
  socket.on('camera-update', (cameraState) => {
    if (socket.id === hostSocketId) {
      socket.broadcast.emit('camera-update', cameraState);
    }
  });

  socket.on('disconnect', () => {
    if (socket.id === hostSocketId) {
      hostSocketId = null;
      io.emit('host-changed', { hostSocketId: null });
    }
    for (const reqId in pendingRequests) {
      if (pendingRequests[reqId].requester === socket.id) {
        clearTimeout(pendingRequests[reqId].timeout);
        delete pendingRequests[reqId];
      }
    }
  });
});

// Start the server.
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
