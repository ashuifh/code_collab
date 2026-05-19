const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// In-memory data store for prototype
const sessions = {};
// session structure:
// id: string
// hostId: string
// code: string
// language: string
// participants: { id, role, username }[]
// changeRequests: { id, requesterId, oldCode, proposedCode, status }[]

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create-session', ({ sessionId, username, language = 'javascript', password }) => {
    sessions[sessionId] = {
      id: sessionId,
      hostId: socket.id,
      password: password || null,
      code: '// Welcome to CollabCode!\n// Start coding here...',
      language,
      participants: [{ id: socket.id, role: 'host', username }],
      changeRequests: []
    };

    socket.join(sessionId);
    socket.emit('session-created', { sessionId, session: sessions[sessionId], role: 'host' });
    io.to(sessionId).emit('participants-updated', sessions[sessionId].participants);
  });

  socket.on('join-session', ({ sessionId, username, password }) => {
    const session = sessions[sessionId];
    if (session) {
      socket.join(sessionId);

      const role = (session.password && password === session.password) ? 'host' : 'guest';
      if (role === 'host') {
        session.hostId = socket.id; // Assign latest host
      }

      session.participants.push({ id: socket.id, role, username });
      socket.emit('session-joined', { session, role });
      io.to(sessionId).emit('participants-updated', session.participants);
    } else {
      socket.emit('error', 'Session not found');
    }
  });

  socket.on('host-code-change', ({ sessionId, newCode }) => {
    const session = sessions[sessionId];
    if (session && session.hostId === socket.id) {
      session.code = newCode;
      // Emit to all users, so they sync if they want
      io.to(sessionId).emit('code-updated', newCode);
    }
  });

  socket.on('submit-change-request', ({ sessionId, oldCode, proposedCode, description }) => {
    const session = sessions[sessionId];
    if (session) {
      const requestId = uuidv4();
      const request = {
        id: requestId,
        requesterId: socket.id,
        requesterName: session.participants.find(p => p.id === socket.id)?.username || 'Guest',
        oldCode,
        proposedCode,
        description,
        status: 'pending'
      };
      session.changeRequests.push(request);

      // Notify all hosts
      const hosts = session.participants.filter(p => p.role === 'host');
      hosts.forEach(host => {
        io.to(host.id).emit('new-change-request', request);
      });
    }
  });

  socket.on('resolve-change-request', ({ sessionId, requestId, action }) => {
    const session = sessions[sessionId];
    const isHost = session?.participants.find(p => p.id === socket.id)?.role === 'host';

    if (session && isHost) {
      const request = session.changeRequests.find(r => r.id === requestId);
      if (request) {
        request.status = action; // 'accepted' or 'rejected'

        if (action === 'accepted') {
          session.code = request.proposedCode;
          io.to(sessionId).emit('code-updated', session.code);
        }

        // Remove the resolved request from the pending array
        session.changeRequests = session.changeRequests.filter(r => r.id !== requestId);

        // Notify requester
        io.to(request.requesterId).emit('change-request-resolved', {
          requestId,
          action,
          code: session.code
        });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Remove user from all sessions they were part of
    Object.keys(sessions).forEach(sessionId => {
      const session = sessions[sessionId];
      const participantIndex = session.participants.findIndex(p => p.id === socket.id);
      if (participantIndex !== -1) {
        session.participants.splice(participantIndex, 1);
        io.to(sessionId).emit('participants-updated', session.participants);
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});