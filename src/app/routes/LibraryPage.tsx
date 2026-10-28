import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProjectStore } from '../../stores/projectStore';
import type { Project } from '../../types/project';

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function LibraryPage() {
  const loadAllProjects = useProjectStore((s) => s.loadAllProjects);
  const projects = useProjectStore((s) => s.projects);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAllProjects().finally(() => setLoading(false));
  }, [loadAllProjects]);

  const sorted: Project[] = Object.values(projects).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-medium mb-1">Library</h1>
          <p className="text-text-muted text-sm">Your local recordings and projects — stored in this browser only</p>
        </div>
        <Link
          to="/setup"
          className="inline-flex items-center justify-center h-9 px-4 rounded-md bg-focus text-focus-ink text-sm font-medium"
        >
          New recording
        </Link>
      </header>

      {loading ? (
        <div className="flex items-center gap-3 text-text-muted py-12 justify-center">
          <span className="w-5 h-5 border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
          Loading recordings…
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface-1 p-12 text-center">
          <p className="text-text-muted mb-4 text-lg">No recordings yet.</p>
          <p className="text-text-muted text-sm mb-6">Record a page to get your first demo video.</p>
          <Link
            to="/setup"
            className="inline-flex items-center justify-center h-10 px-5 rounded-md bg-focus text-focus-ink text-sm font-medium"
          >
            Start recording
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sorted.map((p) => (
            <Link
              key={p.id}
              to={`/editor/${p.id}`}
              className="rounded-lg border border-line bg-surface-1 p-5 hover:border-focus transition-colors group block"
            >
              {/* Thumbnail placeholder */}
              <div className="w-full h-32 rounded-md bg-surface-2 border border-line mb-4 flex items-center justify-center text-text-muted text-sm">
                <span className="text-2xl">🎬</span>
              </div>
              <div className="font-medium truncate group-hover:text-focus transition-colors text-sm mb-1">
                {p.name}
              </div>
              <div className="flex items-center justify-between text-xs text-text-muted">
                <span>{formatDuration(p.media.durationMs)}</span>
                <span>{formatDate(p.createdAt)}</span>
              </div>
              {p.analysis && (
                <div className="mt-2 text-xs text-text-muted">
                  URL: <span className="text-text truncate">{p.analysis.url}</span>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
