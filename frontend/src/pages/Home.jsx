import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';

export default function Home() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [joinSessionId, setJoinSessionId] = useState('');
  const [password, setPassword] = useState('');

  const handleCreateSession = (e) => {
    e.preventDefault();
    const finalUsername = username.trim() || 'Host';
    const newSessionId = uuidv4();
    navigate(`/session/${newSessionId}`, { state: { username: finalUsername, password, isHost: true } });
  };

  const handleJoinSession = (e) => {
    e.preventDefault();
    if (joinSessionId.trim()) {
      let finalId = joinSessionId.trim();
      if (finalId.includes('/session/')) {
        finalId = finalId.split('/session/')[1].split('/')[0];
      }
      const finalUsername = username.trim() || 'Guest';
      navigate(`/session/${finalId}`, { state: { username: finalUsername, password, isHost: false } });
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-950">
      <div className="bg-slate-900 p-8 rounded-xl shadow-2xl w-full max-w-md border border-slate-800">
        <h1 className="text-3xl font-bold text-center text-blue-400 mb-2">CollabCode</h1>
        <p className="text-center text-slate-400 mb-8">Real-time Collaborative Code Editor</p>

        <form onSubmit={handleCreateSession} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Your Name</label>
            <input
              type="text"
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-100 placeholder-slate-500 transition-colors"
              placeholder="Enter your name"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Admin Password (Optional)</label>
            <input 
              type="password" 
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-100 placeholder-slate-500 transition-colors"
              placeholder="Secure your session"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            Create New Session
          </button>
        </form>
        <div className="mt-8 pt-6 border-t border-slate-800 text-center">
          <p className="text-slate-400 text-sm">Have a session ID?</p>
          <form onSubmit={handleJoinSession} className="mt-2 flex flex-col gap-3">
            <input
              type="text"
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-100 placeholder-slate-500 text-sm"
              placeholder="Enter Session ID or Link"
              value={joinSessionId}
              onChange={(e) => setJoinSessionId(e.target.value)}
              required
            />
            <input
              type="text"
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-100 placeholder-slate-500 text-sm"
              placeholder="Your Name (optional)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input 
              type="password" 
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-100 placeholder-slate-500 text-sm"
              placeholder="Admin Password (if you are the host)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="submit"
              className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors text-sm"
            >
              Join
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}