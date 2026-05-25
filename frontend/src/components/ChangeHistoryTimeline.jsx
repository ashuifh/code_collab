import React, { useState } from 'react';

const CHANGE_TYPE_CONFIG = {
  session_created: { label: 'Session started', dotClass: 'bg-blue-500', icon: '▶' },
  participant_joined: { label: 'Joined session', dotClass: 'bg-emerald-500', icon: '👤' },
  participant_left: { label: 'Left session', dotClass: 'bg-slate-500', icon: '↩' },
  host_edit: { label: 'Code edited', dotClass: 'bg-indigo-500', icon: '✎' },
  change_request_submitted: { label: 'Change proposed', dotClass: 'bg-amber-500', icon: '↑' },
  change_request_accepted: { label: 'Change merged', dotClass: 'bg-green-500', icon: '✓' },
  change_request_rejected: { label: 'Change rejected', dotClass: 'bg-red-500', icon: '✕' }
};

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function DiffStats({ metadata }) {
  if (!metadata) return null;
  const { linesAdded, linesRemoved, charDelta } = metadata;
  if (linesAdded == null && linesRemoved == null && charDelta == null) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-1.5 text-[10px]">
      {linesAdded > 0 && (
        <span className="text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">+{linesAdded} lines</span>
      )}
      {linesRemoved > 0 && (
        <span className="text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">-{linesRemoved} lines</span>
      )}
      {charDelta !== 0 && charDelta != null && (
        <span className="text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
          {charDelta > 0 ? '+' : ''}{charDelta} chars
        </span>
      )}
    </div>
  );
}

export default function ChangeHistoryTimeline({ history }) {
  const [expandedId, setExpandedId] = useState(null);

  if (!history?.length) {
    return (
      <div className="text-center py-10 text-slate-500 text-sm">
        <p>No changes recorded yet.</p>
        <p className="text-xs mt-1 text-slate-600">Edits and change requests will appear here.</p>
      </div>
    );
  }

  const sorted = [...history].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  return (
    <div className="relative pl-4">
      <div className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-700" />
      <ul className="space-y-4">
        {sorted.map((entry) => {
          const config = CHANGE_TYPE_CONFIG[entry.changeType] || {
            label: entry.changeType,
            dotClass: 'bg-slate-500',
            icon: '•'
          };
          const isExpanded = expandedId === entry.id;
          const hasCode = entry.oldCode || entry.newCode;

          return (
            <li key={entry.id} className="relative pl-6">
              <span
                className={`absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full border-2 border-slate-900 ${config.dotClass}`}
                title={config.label}
              />

              <div
                className={`rounded-lg border border-slate-800 bg-slate-950/80 p-3 transition-colors ${
                  hasCode ? 'cursor-pointer hover:border-slate-600' : ''
                }`}
                onClick={() => hasCode && setExpandedId(isExpanded ? null : entry.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-200">
                        {config.icon} {config.label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      <span className="text-slate-300 font-medium">{entry.actorUsername}</span>
                      {entry.actorRole && (
                        <span className="ml-1 text-slate-500">({entry.actorRole})</span>
                      )}
                    </p>
                    {entry.description && (
                      <p className="text-xs text-slate-500 mt-1 italic line-clamp-2">
                        "{entry.description}"
                      </p>
                    )}
                    <DiffStats metadata={entry.metadata} />
                    {entry.metadata?.requesterName && (
                      <p className="text-[10px] text-slate-500 mt-1">
                        Requester: {entry.metadata.requesterName}
                      </p>
                    )}
                  </div>
                  <time className="text-[10px] text-slate-500 shrink-0 whitespace-nowrap">
                    {formatTime(entry.createdAt)}
                  </time>
                </div>

                {isExpanded && hasCode && (
                  <div className="mt-3 pt-3 border-t border-slate-800 space-y-2 max-h-48 overflow-y-auto">
                    {entry.oldCode && (
                      <div>
                        <span className="text-[10px] uppercase text-red-400/80 font-medium">Before</span>
                        <pre className="text-xs text-red-300/90 mt-1 p-2 bg-red-950/20 rounded overflow-x-auto whitespace-pre-wrap font-mono">
                          {entry.oldCode.slice(0, 800)}{entry.oldCode.length > 800 ? '…' : ''}
                        </pre>
                      </div>
                    )}
                    {entry.newCode && (
                      <div>
                        <span className="text-[10px] uppercase text-green-400/80 font-medium">After</span>
                        <pre className="text-xs text-green-300/90 mt-1 p-2 bg-green-950/20 rounded overflow-x-auto whitespace-pre-wrap font-mono">
                          {entry.newCode.slice(0, 800)}{entry.newCode.length > 800 ? '…' : ''}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
