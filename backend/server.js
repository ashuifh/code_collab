require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    app: 'CollabCode Backend',
    message: '🚀 Server is running. Connect via WebSocket for real-time collaboration.',
    version: '1.0.0'
  });
});
// ─────────────────────────────────────────────────────────────────────────────

// ── AI Proxy ──────────────────────────────────────────────────────────────────
app.post('/api/ai/analyze', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY not configured on server' });

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024,
        temperature: 0.7
      })
    });

    const data = await response.json();
    console.log(`[AI] Groq status=${response.status}`, response.ok ? 'OK' : data.error);

    if (response.ok && data.choices?.[0]?.message?.content) {
      return res.json({ text: data.choices[0].message.content });
    }

    const errMsg = data.error?.message || `Groq error (${response.status})`;
    console.error('[AI] Groq failed:', errMsg);
    res.status(502).json({ error: errMsg });

  } catch (err) {
    console.error('[AI] fetch error:', err.message);
    res.status(502).json({ error: err.message });
  }
});
// ─────────────────────────────────────────────────────────────────────────────

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
        session.hostId = socket.id;
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
        request.status = action;

        if (action === 'accepted') {
          session.code = request.proposedCode;
          io.to(sessionId).emit('code-updated', session.code);
        }

        session.changeRequests = session.changeRequests.filter(r => r.id !== requestId);

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