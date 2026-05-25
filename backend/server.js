require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { initDb, getChangeHistory } = require('./db');
const { recordChange, scheduleHostEditLog, initSessionBaseline } = require('./changeLogger');

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

const sessions = {};

app.get('/api/sessions/:sessionId/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const history = await getChangeHistory(req.params.sessionId, limit);
    res.json(history);
  } catch (err) {
    console.error('History fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch change history' });
  }
});

async function emitHistoryEntry(sessionId, entry) {
  io.to(sessionId).emit('change-history-entry', entry);
}

async function logAndBroadcast(params) {
  const entry = await recordChange(params);
  await emitHistoryEntry(params.sessionId, entry);
  return entry;
}

function getParticipant(session, socketId) {
  return session.participants.find((p) => p.id === socketId);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create-session', async ({ sessionId, username, language = 'javascript', password }) => {
    sessions[sessionId] = {
      id: sessionId,
      hostId: socket.id,
      password: password || null,
      code: '// Welcome to CollabCode!\n// Start coding here...',
      language,
      participants: [{ id: socket.id, role: 'host', username }],
      changeRequests: []
    };

    initSessionBaseline(sessionId, sessions[sessionId].code);

    socket.join(sessionId);
    socket.emit('session-created', { sessionId, session: sessions[sessionId], role: 'host' });
    io.to(sessionId).emit('participants-updated', sessions[sessionId].participants);

    try {
      await logAndBroadcast({
        sessionId,
        changeType: 'session_created',
        actorUsername: username,
        actorRole: 'host',
        actorSocketId: socket.id,
        newCode: sessions[sessionId].code,
        metadata: { language, hasPassword: !!password }
      });
    } catch (err) {
      console.error('Failed to log session_created:', err.message);
    }
  });

  socket.on('join-session', async ({ sessionId, username, password }) => {
    const session = sessions[sessionId];
    if (session) {
      socket.join(sessionId);

      const role = (session.password && password === session.password) ? 'host' : 'guest';
      if (role === 'host') {
        session.hostId = socket.id;
      }

      session.participants.push({ id: socket.id, role, username });
      socket.emit('session-joined', { session, role });
      io.to(sessionId).emit('participants-updated', session.participants);

      try {
        await logAndBroadcast({
          sessionId,
          changeType: 'participant_joined',
          actorUsername: username,
          actorRole: role,
          actorSocketId: socket.id,
          metadata: { participantCount: session.participants.length }
        });
      } catch (err) {
        console.error('Failed to log participant_joined:', err.message);
      }
    } else {
      socket.emit('error', 'Session not found');
    }
  });

  socket.on('host-code-change', ({ sessionId, newCode }) => {
    const session = sessions[sessionId];
    if (session && session.hostId === socket.id) {
      const previousCode = session.code;
      session.code = newCode;
      io.to(sessionId).emit('code-updated', newCode);
      scheduleHostEditLog({ sessionId, session, socket, newCode, io, previousCode: previousCode });
    }
  });

  socket.on('submit-change-request', async ({ sessionId, oldCode, proposedCode, description }) => {
    const session = sessions[sessionId];
    if (session) {
      const participant = getParticipant(session, socket.id);
      const requestId = uuidv4();
      const request = {
        id: requestId,
        requesterId: socket.id,
        requesterName: participant?.username || 'Guest',
        oldCode,
        proposedCode,
        description,
        status: 'pending'
      };
      session.changeRequests.push(request);

      const hosts = session.participants.filter((p) => p.role === 'host');
      hosts.forEach((host) => {
        io.to(host.id).emit('new-change-request', request);
      });

      try {
        await logAndBroadcast({
          sessionId,
          changeType: 'change_request_submitted',
          actorUsername: participant?.username || 'Guest',
          actorRole: participant?.role || 'guest',
          actorSocketId: socket.id,
          description,
          oldCode,
          newCode: proposedCode,
          metadata: { requestId, status: 'pending' }
        });
      } catch (err) {
        console.error('Failed to log change_request_submitted:', err.message);
      }
    }
  });

  socket.on('resolve-change-request', async ({ sessionId, requestId, action }) => {
    const session = sessions[sessionId];
    const participant = session?.participants.find((p) => p.id === socket.id);
    const isHost = participant?.role === 'host';

    if (session && isHost) {
      const request = session.changeRequests.find((r) => r.id === requestId);
      if (request) {
        request.status = action;
        const previousCode = session.code;

        if (action === 'accepted') {
          session.code = request.proposedCode;
          initSessionBaseline(sessionId, session.code);
          io.to(sessionId).emit('code-updated', session.code);
        }

        session.changeRequests = session.changeRequests.filter((r) => r.id !== requestId);

        io.to(request.requesterId).emit('change-request-resolved', {
          requestId,
          action,
          code: session.code
        });

        try {
          await logAndBroadcast({
            sessionId,
            changeType: action === 'accepted' ? 'change_request_accepted' : 'change_request_rejected',
            actorUsername: participant.username,
            actorRole: 'host',
            actorSocketId: socket.id,
            description: request.description,
            oldCode: action === 'accepted' ? previousCode : request.oldCode,
            newCode: action === 'accepted' ? session.code : request.proposedCode,
            metadata: {
              requestId,
              requesterName: request.requesterName,
              requesterId: request.requesterId,
              status: action
            }
          });
        } catch (err) {
          console.error('Failed to log change_request resolution:', err.message);
        }
      }
    }
  });

  socket.on('get-change-history', async ({ sessionId }) => {
    try {
      const history = await getChangeHistory(sessionId);
      socket.emit('change-history', history);
    } catch (err) {
      console.error('Failed to get change history:', err.message);
      socket.emit('change-history', []);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    Object.keys(sessions).forEach((sessionId) => {
      const session = sessions[sessionId];
      const leaving = session.participants.find((p) => p.id === socket.id);
      const participantIndex = session.participants.findIndex((p) => p.id === socket.id);
      if (participantIndex !== -1) {
        session.participants.splice(participantIndex, 1);
        io.to(sessionId).emit('participants-updated', session.participants);

        if (leaving) {
          recordChange({
            sessionId,
            changeType: 'participant_left',
            actorUsername: leaving.username,
            actorRole: leaving.role,
            actorSocketId: socket.id,
            metadata: { participantCount: session.participants.length }
          }).then((entry) => emitHistoryEntry(sessionId, entry))
            .catch((err) => console.error('Failed to log participant_left:', err.message));
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3001;

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Database init failed:', err.message);
    process.exit(1);
  });
