import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { io } from 'socket.io-client';

export default function EditorPage() {
  const { sessionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [code, setCode] = useState('// Welcome to CollabCode!\n// Start coding here...');
  const [participants, setParticipants] = useState([]);
  const [language, setLanguage] = useState('javascript');
  const [output, setOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isOutputVisible, setIsOutputVisible] = useState(false);
  const [changeRequests, setChangeRequests] = useState([]);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [changeDescription, setChangeDescription] = useState('');

  // AI Assistant States
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAIAssistant, setShowAIAssistant] = useState(true);
  const [aiReviews, setAiReviews] = useState({});
  const [isReviewingAI, setIsReviewingAI] = useState(false);

  const socketRef = useRef(null);
  const editorRef = useRef(null);
  const analyzeTimeoutRef = useRef(null);
  const [username] = useState(() => {
    if (location.state?.username) return location.state.username;
    return window.prompt("Welcome to CollabCode! Please enter your name to join:") || 'Guest User';
  });
  const [memberId] = useState(() => Math.floor(10000 + Math.random() * 90000));
  const [isHost, setIsHost] = useState(location.state?.isHost || false);
  const password = location.state?.password || '';

  useEffect(() => {
    // Initialize socket connection
    // We'll connect to the backend running on port 3001
    socketRef.current = io('http://localhost:3001');
    const socket = socketRef.current;

    socket.on('connect', () => {
      console.log('Connected to server');
      if (location.state?.isHost) {
        socket.emit('create-session', { sessionId, username, language, password });
      } else {
        socket.emit('join-session', { sessionId, username, password });
      }
    });

    socket.on('session-created', ({ sessionId: id, session, role }) => {
      setParticipants(session.participants);
      setCode(session.code);
      setLanguage(session.language);
      setIsHost(role === 'host');
    });

    socket.on('session-joined', ({ session, role }) => {
      setParticipants(session.participants);
      setCode(session.code);
      setLanguage(session.language);
      setIsHost(role === 'host');
      setChangeRequests(session.changeRequests);
    });

    socket.on('participants-updated', (updatedParticipants) => {
      setParticipants(updatedParticipants);
    });

    socket.on('code-updated', (newCode) => {
      setCode(newCode);
    });

    socket.on('new-change-request', (request) => {
      setChangeRequests(prev => [...prev, request]);
    });

    socket.on('change-request-resolved', ({ requestId, action, code: newCode }) => {
      alert(`Your change request was ${action}!`);
      if (action === 'accepted' && newCode) {
        setCode(newCode);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [sessionId, username, isHost]);

  const handleEditorChange = (value) => {
    setCode(value);
    // If host, broadcast changes instantly. If guest, we'll implement change request flow soon.
    if (isHost && socketRef.current) {
      socketRef.current.emit('host-code-change', { sessionId, newCode: value });
    }
  };

  const handleShareLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert('Link copied to clipboard! Share it with others so they can join.');
  };

  const handleLogout = () => {
    if (window.confirm("Are you sure you want to leave the session?")) {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      navigate('/');
    }
  };

  const handleRunCode = async () => {
    setIsRunning(true);
    setIsOutputVisible(true);
    setOutput('Running code...\n');

    // Map our languages to Judge0 CE Language IDs (CodeArena)
    const languageMap = {
      javascript: 63, // Node.js
      python: 71,     // Python 3
      cpp: 54,        // C++ (GCC)
      c: 50,          // C (GCC)
      java: 62,       // Java
      go: 60,         // Go
      rust: 73,       // Rust
    };

    const langId = languageMap[language];

    if (!langId) {
      setOutput(`Error: Running ${language} is not supported directly in this prototype yet.\n`);
      setIsRunning(false);
      return;
    }

    try {
      // We use 'wait=true' to get the execution result directly in one request
      const response = await fetch('https://judge029.p.rapidapi.com/submissions?base64_encoded=false&wait=true', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-RapidAPI-Key': import.meta.env.VITE_RAPIDAPI_KEY, // We will use env variable for safety
          'X-RapidAPI-Host': 'judge029.p.rapidapi.com'
        },
        body: JSON.stringify({
          language_id: langId,
          source_code: code
        })
      });
      const data = await response.json();

      // Handle different types of outputs from Judge0
      if (response.status !== 200 && response.status !== 201) {
        // If API key is missing or invalid, this will trigger
        if (response.status === 401 || response.status === 403) {
          setOutput("Authentication Error: Invalid or missing RapidAPI Key. Please check your .env file.");
        } else {
          setOutput(`API Error: ${data.message || 'Failed to submit code'}`);
        }
      } else if (data.compile_output) {
        setOutput(`Compilation Error:\n${data.compile_output}`);
      } else if (data.stderr) {
        setOutput(`Runtime Error:\n${data.stderr}`);
      } else if (data.stdout !== null) {
        setOutput(data.stdout || 'Execution finished successfully. (No output)');
      } else {
        setOutput(data.status?.description || 'Execution completed.');
      }
    } catch (error) {
      setOutput(`Failed to execute code: ${error.message}`);
    }
    setIsRunning(false);
  };

  const handleSubmitChange = () => {
    if (socketRef.current) {
      // Find the host's current code to use as oldCode
      socketRef.current.emit('submit-change-request', {
        sessionId,
        oldCode: '// Previous code version', // In a real app, track the base version the guest edited
        proposedCode: code,
        description: changeDescription
      });
      setShowSubmitModal(false);
      setChangeDescription('');
      alert('Change request sent to host!');
    }
  };

  const handleResolveRequest = (requestId, action) => {
    if (socketRef.current) {
      socketRef.current.emit('resolve-change-request', {
        sessionId,
        requestId,
        action
      });
      setChangeRequests(prev => prev.filter(r => r.id !== requestId));
    }
  };

  // --- AI Assistant Logic ---
  const handleAnalyzeCode = async () => {
    if (!code || code.trim().length < 5) {
      alert("Please write some code first!");
      return;
    }

    setIsAnalyzing(true);
    setAiSuggestions([{ type: 'info', title: 'Analyzing Code', desc: 'Understanding your code...' }]);

    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey || apiKey === 'your_gemini_api_key_here') throw new Error('No API Key');

      const prompt = `Explain this ${language} code in detail. Tell me what I am doing, what is inside this code, and what everything does. Be concise but clear. Do not use markdown blocks for the final answer, keep it readable.\n\nCode:\n${code}`;
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      
      const data = await response.json();
      const text = data.candidates[0].content.parts[0].text;
      
      setAiSuggestions([{ type: 'info', title: 'Code Explanation', desc: text }]);
    } catch (e) {
       setAiSuggestions([{ type: 'warning', title: 'Analysis Failed', desc: e.message === 'No API Key' ? 'Please add VITE_GEMINI_API_KEY in .env' : 'API error occurred.' }]);
    }
    setIsAnalyzing(false);
  };

  const handleAIReviewRequest = async (req) => {
    setIsReviewingAI(true);
    setAiReviews(prev => ({ ...prev, [req.id]: '🤖 AI is analyzing the changes...' }));

    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey || apiKey === 'your_gemini_api_key_here') throw new Error('No API Key');

      const prompt = `You are a strict code reviewer. Review the following code change proposed by a user.
Original Code:
${req.oldCode}

Proposed Code:
${req.proposedCode}

Developer's Comment: ${req.description}

Write a very brief review (2-3 sentences max) explaining what changed, if it looks correct, and if the admin should merge it. Keep it concise without markdown.`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      
      const data = await response.json();
      const text = data.candidates[0].content.parts[0].text;
      
      setAiReviews(prev => ({ ...prev, [req.id]: text }));
    } catch (e) {
      setAiReviews(prev => ({ ...prev, [req.id]: 'AI Review failed. Ensure your Gemini API key is correct in .env' }));
    }
    setIsReviewingAI(false);
  };

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
  };
  // -------------------------

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100">
      {/* Sidebar */}
      <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col z-10 shadow-lg">
        <div className="p-4 border-b border-slate-800">
          <h2 className="font-bold text-xl text-blue-400">CollabCode</h2>
          <p className="text-xs text-slate-500 truncate mt-1 cursor-pointer hover:text-slate-400" onClick={handleShareLink} title="Click to copy link">
            ID: {sessionId}
          </p>
        </div>
        <div className="p-4 flex-1 overflow-y-auto">
          <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">Participants ({participants.length})</h3>
          <ul className="space-y-3">
            {participants.map((p, i) => (
              <li key={i} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                  <span className={p.username === username ? "font-semibold text-white" : "text-slate-300"}>
                    {p.username} {p.username === username && '(You)'}
                  </span>
                </div>
                {p.role === 'host' && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">Host</span>
                )}
              </li>
            ))}
            {participants.length === 0 && (
              <li className="flex items-center gap-2 text-sm text-slate-400">
                <span className="w-2 h-2 rounded-full bg-slate-600"></span>
                <span>Connecting...</span>
              </li>
            )}
          </ul>
        </div>

        {/* User Profile & Connection Footer */}
        <div className="border-t border-slate-800 bg-slate-900/80 p-4">
          <div className="flex items-center gap-3 mb-3">
            {/* Avatar */}
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow-sm shrink-0">
              {username.charAt(0).toUpperCase()}
            </div>
            {/* User Info */}
            <div className="flex-1 overflow-hidden">
              <div className="text-sm font-semibold text-white truncate">{username}</div>
              <div className="text-xs text-slate-400 truncate">ID: #{memberId}</div>
            </div>
            {/* Logout Button */}
            <button 
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-md transition-colors shrink-0"
              title="Logout"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
            </button>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]"></div>
              <span>Connected</span>
            </div>
            <span className="bg-slate-800 px-2 py-0.5 rounded text-[10px] uppercase font-medium text-slate-300">{isHost ? 'Host' : 'Guest'}</span>
          </div>
        </div>
      </div>

      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col relative bg-[#1e1e1e]">
        {/* Topbar */}
        <div className="h-14 border-b border-slate-800 flex items-center px-6 justify-between bg-[#1e1e1e] z-10 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="text-sm font-medium text-slate-300 px-3 py-1 bg-slate-800 rounded-md">main.js</div>

            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="bg-slate-800 border-none text-slate-300 text-sm rounded-md px-2 py-1 focus:ring-1 focus:ring-blue-500 outline-none"
            >
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
              <option value="cpp">C++</option>
              <option value="c">C</option>
              <option value="java">Java</option>
              <option value="go">Go</option>
              <option value="rust">Rust</option>
              <option value="html">HTML</option>
              <option value="css">CSS</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleRunCode}
              disabled={isRunning}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
            >
              {isRunning ? (
                <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              )}
              Run Code
            </button>

            {isHost && changeRequests.length > 0 && (
              <button
                onClick={() => setShowReviewModal(true)}
                className="px-4 py-1.5 bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30 border border-yellow-500/30 rounded-md text-sm font-medium transition-all shadow-sm flex items-center gap-2"
              >
                <span className="bg-yellow-500 text-yellow-950 text-xs font-bold px-1.5 rounded-full">{changeRequests.length}</span>
                Review Changes
              </button>
            )}

            {!isHost && (
              <button
                onClick={() => setShowSubmitModal(true)}
                className="px-4 py-1.5 bg-green-600/20 text-green-400 hover:bg-green-600/30 border border-green-500/30 rounded-md text-sm font-medium transition-all shadow-sm flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></svg>
                Submit Change
              </button>
            )}
            <button
              onClick={() => setShowAIAssistant(!showAIAssistant)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all shadow-sm flex items-center gap-2 ${showAIAssistant ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30 hover:bg-purple-600/30' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></svg>
              AI Assistant
            </button>
            <button
              onClick={handleShareLink}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors shadow-sm shadow-blue-900/20 flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" x2="15.42" y1="13.51" y2="17.49" /><line x1="15.41" x2="8.59" y1="6.51" y2="10.49" /></svg>
              Share
            </button>
          </div>
        </div>

        {/* Monaco Editor Container */}
        <div className="flex-1 w-full relative flex flex-col">
          <div className="flex-1 min-h-0 relative">
            <Editor
              height="100%"
              language={language === 'c' || language === 'cpp' ? 'cpp' : language}
              theme="vs-dark"
              value={code}
              onChange={handleEditorChange}
              onMount={handleEditorDidMount}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                padding: { top: 20 },
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                cursorBlinking: "smooth",
                cursorSmoothCaretAnimation: "on",
                formatOnPaste: true,
                renderWhitespace: "selection",
                bracketPairColorization: { enabled: true },
              }}
            />
          </div>

          {/* Output Terminal Pane */}
          {isOutputVisible && (
            <div className="h-48 border-t border-slate-800 bg-[#1e1e1e] flex flex-col">
              <div className="h-8 border-b border-slate-800 bg-slate-900/40 flex items-center justify-between px-4">
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Output</span>
                <button onClick={() => setIsOutputVisible(false)} className="text-slate-500 hover:text-slate-300">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
              <div className="flex-1 p-4 overflow-y-auto font-mono text-sm text-slate-300 whitespace-pre-wrap">
                {output}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI Assistant Sidebar */}
      {showAIAssistant && (
        <div className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col z-10 shadow-[-4px_0_15px_rgba(0,0,0,0.3)]">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-slate-200 flex items-center gap-2">
              <svg className="text-purple-500" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></svg>
              AI Assistant
            </h2>
            {isAnalyzing && (
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-500"></span>
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 bg-slate-950/50">
            <p className="text-xs text-slate-500 mb-4 italic">Automatically analyzing code every 2 seconds...</p>

            <div className="space-y-3">
              {aiSuggestions.map((sug, i) => {
                let badgeColor = 'bg-slate-700 text-slate-300';
                if (sug.type === 'bug') badgeColor = 'bg-red-500/20 text-red-400 border border-red-500/30';
                if (sug.type === 'warning') badgeColor = 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30';
                if (sug.type === 'style') badgeColor = 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
                if (sug.type === 'success') badgeColor = 'bg-green-500/20 text-green-400 border border-green-500/30';
                if (sug.type === 'info') badgeColor = 'bg-purple-500/20 text-purple-400 border border-purple-500/30';

                return (
                  <div key={i} className={`p-3 rounded-lg bg-slate-900 border border-slate-800 ${sug.type === 'info' ? 'animate-pulse' : ''}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-sm text-slate-200">{sug.title}</span>
                      <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${badgeColor}`}>
                        {sug.type}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">{sug.desc}</p>
                  </div>
                );
              })}

              {aiSuggestions.length === 0 && !isAnalyzing && (
                <div className="text-center py-8">
                  <div className="text-slate-600 mb-2">
                    <svg className="mx-auto" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></svg>
                  </div>
                  <p className="text-sm text-slate-500">Click Analyze Code below to get an explanation.</p>
                </div>
              )}
            </div>
          </div>

          <div className="p-3 border-t border-slate-800 bg-slate-900">
            <button
              onClick={handleAnalyzeCode}
              className="w-full py-2 bg-slate-800 hover:bg-purple-600/20 text-slate-300 hover:text-purple-300 border border-slate-700 hover:border-purple-500/30 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>
              Analyze Full Code
            </button>
          </div>
        </div>
      )}

      {/* Submit Change Modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
              <h3 className="font-semibold text-lg text-slate-100">Submit Change Request</h3>
              <button onClick={() => setShowSubmitModal(false)} className="text-slate-400 hover:text-white">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            <div className="p-4">
              <label className="block text-sm font-medium text-slate-300 mb-2">Description of changes</label>
              <textarea
                className="w-full h-24 px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 resize-none"
                placeholder="E.g., Fixed the bug in calculateSum function..."
                value={changeDescription}
                onChange={(e) => setChangeDescription(e.target.value)}
              />
            </div>
            <div className="p-4 border-t border-slate-800 flex justify-end gap-3 bg-slate-900">
              <button
                onClick={() => setShowSubmitModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitChange}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Send Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Changes Modal */}
      {showReviewModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-4xl max-h-[80vh] shadow-2xl flex flex-col">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
              <h3 className="font-semibold text-lg text-slate-100 flex items-center gap-2">
                Pending Change Requests
                <span className="bg-yellow-500/20 text-yellow-500 text-xs px-2 py-0.5 rounded-full">{changeRequests.length}</span>
              </h3>
              <button onClick={() => setShowReviewModal(false)} className="text-slate-400 hover:text-white">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {changeRequests.map((req, idx) => (
                <div key={req.id} className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
                  <div className="p-3 bg-slate-800/50 border-b border-slate-800 flex justify-between items-center">
                    <div>
                      <span className="font-medium text-blue-400">{req.requesterName}</span>
                      <span className="text-slate-400 text-sm ml-2">proposed a change</span>
                    </div>
                  </div>
                  {req.description && (
                    <div className="p-3 border-b border-slate-800 text-sm text-slate-300 italic bg-slate-900/30">
                      "{req.description}"
                    </div>
                  )}
                  <div className="p-4 bg-[#1e1e1e] max-h-60 overflow-y-auto font-mono text-sm">
                    <pre className="text-green-400">{req.proposedCode}</pre>
                  </div>
                  {aiReviews[req.id] && (
                    <div className="p-3 bg-purple-900/20 border-t border-purple-500/30 text-sm text-purple-200">
                      <span className="font-bold text-purple-400 mr-2">🤖 AI Review:</span> 
                      {aiReviews[req.id]}
                    </div>
                  )}
                  <div className="p-3 bg-slate-900 border-t border-slate-800 flex gap-3 justify-between items-center">
                    <button
                      onClick={() => handleAIReviewRequest(req)}
                      disabled={isReviewingAI}
                      className="px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 border border-purple-500/30 rounded-md text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
                      Ask AI for Review
                    </button>
                    <div className="flex gap-3">
                      <button
                        onClick={() => handleResolveRequest(req.id, 'rejected')}
                        className="px-4 py-1.5 bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 rounded-md text-sm font-medium transition-colors"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => handleResolveRequest(req.id, 'accepted')}
                        className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-md text-sm font-medium transition-colors shadow-sm"
                      >
                        Accept & Merge
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {changeRequests.length === 0 && (
                <div className="text-center py-10 text-slate-500">
                  No pending change requests.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
