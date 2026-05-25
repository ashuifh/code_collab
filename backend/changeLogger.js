const { structuredPatch } = require('diff');
const { logChange } = require('./db');

const hostEditDebounce = new Map();
const pendingEditBaseline = new Map();
const lastLoggedCode = new Map();

function buildDiffMetadata(oldCode, newCode) {
  const oldLen = oldCode?.length ?? 0;
  const newLen = newCode?.length ?? 0;
  const patch = structuredPatch('code', 'code', oldCode || '', newCode || '');
  const linesAdded = patch.hunks.reduce((n, h) => n + h.lines.filter((l) => l.startsWith('+')).length, 0);
  const linesRemoved = patch.hunks.reduce((n, h) => n + h.lines.filter((l) => l.startsWith('-')).length, 0);

  return {
    oldLength: oldLen,
    newLength: newLen,
    charDelta: newLen - oldLen,
    linesAdded,
    linesRemoved
  };
}

async function recordChange(params) {
  const { oldCode, newCode, metadata = {}, ...rest } = params;
  const diffMeta = (oldCode != null || newCode != null)
    ? buildDiffMetadata(oldCode, newCode)
    : {};

  const entry = await logChange({
    ...rest,
    oldCode,
    newCode,
    metadata: { ...metadata, ...diffMeta }
  });
  return entry;
}

function scheduleHostEditLog({ sessionId, session, socket, newCode, io, previousCode }) {
  const key = sessionId;
  if (!pendingEditBaseline.has(key)) {
    pendingEditBaseline.set(key, previousCode ?? lastLoggedCode.get(key) ?? newCode);
  }
  if (hostEditDebounce.has(key)) {
    clearTimeout(hostEditDebounce.get(key));
  }

  hostEditDebounce.set(key, setTimeout(async () => {
    hostEditDebounce.delete(key);
    const previous = pendingEditBaseline.get(key) ?? lastLoggedCode.get(key) ?? newCode;
    pendingEditBaseline.delete(key);
    if (previous === newCode) return;

    const participant = session.participants.find((p) => p.id === socket.id);
    try {
      const entry = await recordChange({
        sessionId,
        changeType: 'host_edit',
        actorUsername: participant?.username || 'Host',
        actorRole: participant?.role || 'host',
        actorSocketId: socket.id,
        oldCode: previous,
        newCode,
        metadata: { language: session.language }
      });
      lastLoggedCode.set(key, newCode);
      io.to(sessionId).emit('change-history-entry', entry);
    } catch (err) {
      console.error('Failed to log host edit:', err.message);
    }
  }, 2000));
}

function initSessionBaseline(sessionId, code) {
  lastLoggedCode.set(sessionId, code);
}

module.exports = { recordChange, scheduleHostEditLog, initSessionBaseline, buildDiffMetadata };
