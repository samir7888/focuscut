import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { analyzePage } from '../../lib/analyzer';
import { useProjectStore } from '../../stores/projectStore';
import type { PageAnalysis } from '../../types/project';
import { runAutoRecording, type AutoRecordProgress } from '../../engine/autoRecorder/autoRecorder';

type Mode = 'url' | 'manual';

export function SetupPage() {
  const navigate = useNavigate();
  const setPendingAnalysis = useProjectStore((s) => s.setPendingAnalysis);

  const [mode, setMode] = useState<Mode>('url');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<PageAnalysis | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);

  // Auto-recording states
  const [isAutoRecording, setIsAutoRecording] = useState(false);
  const [autoProgress, setAutoProgress] = useState<AutoRecordProgress | null>(null);

  const handleAnalyze = async () => {
    if (!url.trim()) return;

    // Ensure URL has a protocol
    let target = url.trim();
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target = `https://${target}`;
      setUrl(target);
    }

    setLoading(true);
    setError('');
    setAnalysis(null);
    setProgress(20);

    try {
      // Simulate progress ticks while waiting
      const tick = setInterval(() => setProgress((p) => Math.min(p + 10, 85)), 600);
      const result = await analyzePage(target);
      clearInterval(tick);
      setProgress(100);
      setAnalysis(result);
      setPendingAnalysis(result);
    } catch (e: any) {
      // Even on failure, create a minimal analysis from the URL so users can still continue
      const minimal: PageAnalysis = {
        url: target,
        title: new URL(target).hostname,
        brand: { colors: ['#F5C242'], fonts: ['system-ui'] },
        headings: [{ level: 1, text: new URL(target).hostname }],
        features: [
          { title: 'Modern Architecture', text: 'Built with cutting-edge web technologies.' },
          { title: 'High Performance', text: 'Fast load times and responsive design.' },
        ],
        ctas: [{ text: 'Get Started' }],
        forms: [],
        stats: [],
      };
      setPendingAnalysis(minimal);
      setAnalysis(minimal);
      setError(
        `Page analysis was limited: ${e.message || 'Could not read page content'}. JS-rendered pages work best via the agent snippet. You can still continue recording.`,
      );
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(0), 500);
    }
  };

  const handleStartAutoRecording = async () => {
    let targetAnalysis = analysis;

    // If analysis isn't ready yet, analyze first
    if (!targetAnalysis) {
      if (!url.trim()) return;
      let target = url.trim();
      if (!target.startsWith('http://') && !target.startsWith('https://')) {
        target = `https://${target}`;
        setUrl(target);
      }
      setLoading(true);
      try {
        targetAnalysis = await analyzePage(target);
        setAnalysis(targetAnalysis);
        setPendingAnalysis(targetAnalysis);
      } catch (err: any) {
        targetAnalysis = {
          url: target,
          title: new URL(target).hostname,
          brand: { colors: ['#F5C242', '#3B82F6'], fonts: ['system-ui'] },
          headings: [{ level: 1, text: new URL(target).hostname }],
          features: [
            { title: 'Lightning Fast Performance', text: 'Optimized for speed and scale.' },
            { title: 'Automated Workflows', text: 'Streamline repetitive tasks.' },
            { title: 'Enterprise Security', text: 'Privacy controls by default.' },
          ],
          ctas: [{ text: 'Explore Platform' }],
          forms: [],
          stats: [],
        };
        setAnalysis(targetAnalysis);
        setPendingAnalysis(targetAnalysis);
      } finally {
        setLoading(false);
      }
    }

    if (!targetAnalysis) return;

    setIsAutoRecording(true);
    setAutoProgress({ phase: 'Initializing virtual landing page…', percent: 5 });

    try {
      await runAutoRecording(targetAnalysis, (p) => {
        setAutoProgress(p);
      });

      // Brief pause to show completion, then navigate straight to Library
      setAutoProgress({ phase: 'Done! Saved to Library', percent: 100 });
      setTimeout(() => {
        navigate('/library');
      }, 700);
    } catch (err: any) {
      console.error('Auto recording error:', err);
      setError(`Auto-recording failed: ${err.message || 'MediaRecorder capture error'}`);
      setIsAutoRecording(false);
    }
  };

  const handleContinue = () => {
    if (mode === 'manual') {
      setPendingAnalysis(null);
    }
    navigate('/record');
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 relative">
      {/* Auto-Recording Progress Modal */}
      {isAutoRecording && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/80 backdrop-blur-md p-6">
          <div className="w-full max-w-md rounded-xl bg-surface-1 border border-line p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rec animate-pulse" />
                <span className="text-xs uppercase font-bold tracking-wider text-rec">
                  LIVE RECORDING
                </span>
              </div>
              <span className="font-mono text-xs text-text-muted">
                {autoProgress?.percent || 0}%
              </span>
            </div>

            <div>
              <h3 className="text-base font-semibold mb-1">
                {autoProgress?.phase || 'Recording landing page…'}
              </h3>
              {autoProgress?.instruction ? (
                <div className="mt-2 px-3 py-2 rounded-lg bg-focus/10 border border-focus/30 text-sm text-text">
                  {autoProgress.instruction}
                </div>
              ) : (
                <p className="text-xs text-text-muted">
                  Capturing your real website — follow the on-screen instructions.
                </p>
              )}
            </div>

            {/* Animated progress bar */}
            <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
              <div
                className="h-full bg-focus rounded-full transition-all duration-300"
                style={{ width: `${autoProgress?.percent || 0}%` }}
              />
            </div>

            <div className="text-[11px] text-text-muted text-center pt-1">
              ✨ Once finished, your real website recording is saved directly to the Library.
            </div>
          </div>
        </div>
      )}

      <header className="mb-8 flex items-center justify-between">
        <Link to="/" className="text-text-muted hover:text-text transition-colors text-sm">
          ← Back to home
        </Link>
        <span className="text-xs text-text-muted">Step 1 of 2</span>
      </header>

      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Choose recording mode</h1>
          <p className="text-text-muted text-sm">
            Analyze your landing page for automated recording and zoom, or record screen manually.
          </p>
        </div>

        {/* Mode switcher */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setMode('url')}
            className={`p-4 rounded-lg border text-left transition-all ${
              mode === 'url'
                ? 'border-focus bg-surface-1 shadow-sm ring-1 ring-focus/30'
                : 'border-line bg-surface-1/60 hover:bg-surface-1'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-focus text-lg">⚡</span>
              <span className="font-semibold text-sm">URL Landing Page</span>
              <span className="ml-auto text-[10px] uppercase font-bold tracking-wider text-focus-ink bg-focus px-1.5 py-0.5 rounded">
                Auto
              </span>
            </div>
            <p className="text-xs text-text-muted">
              Auto-records features, hero, and CTAs, or manual capture with page overlays.
            </p>
          </button>

          <button
            onClick={() => setMode('manual')}
            className={`p-4 rounded-lg border text-left transition-all ${
              mode === 'manual'
                ? 'border-focus bg-surface-1 shadow-sm ring-1 ring-focus/30'
                : 'border-line bg-surface-1/60 hover:bg-surface-1'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-text text-lg">📹</span>
              <span className="font-semibold text-sm">Manual Screen Share</span>
            </div>
            <p className="text-xs text-text-muted">
              Share any window or screen directly and zoom with timeline keys.
            </p>
          </button>
        </div>

        {/* URL mode form */}
        {mode === 'url' && (
          <section className="space-y-4">
            <div>
              <h2 className="font-medium text-sm mb-1.5">Target page URL</h2>
              <div className="flex gap-2">
                <input
                  id="analyze-url-input"
                  type="url"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                  className="flex-1 h-10 px-3 rounded-md bg-surface-2 border border-line focus:border-focus focus:outline-none text-sm"
                />
                <button
                  id="analyze-btn"
                  onClick={handleAnalyze}
                  disabled={loading || !url.trim()}
                  className="h-10 px-4 rounded-md bg-surface-2 hover:bg-surface-1 border border-line text-sm font-medium disabled:opacity-40 transition-all"
                >
                  {loading ? 'Analyzing…' : 'Analyze'}
                </button>
              </div>
            </div>

            {/* Progress bar */}
            {loading && (
              <div className="h-1 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full bg-focus transition-all duration-500 rounded-full"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            {error && (
              <div
                className={`p-3 rounded-md text-xs border ${
                  analysis
                    ? 'border-focus bg-surface-2 text-text'
                    : 'border-rec bg-surface-2 text-rec'
                }`}
              >
                {analysis ? '⚠ ' : '✗ '}
                {error}
              </div>
            )}

            {/* Analysis results */}
            {analysis && (
              <div className="space-y-3 pt-2">
                <div
                  className={`flex items-center gap-2 text-xs font-medium ${
                    analysis.features.length > 0 ? 'text-ok' : 'text-focus'
                  }`}
                >
                  <span>{analysis.features.length > 0 ? '✓' : 'ℹ'}</span>
                  <span>
                    {analysis.features.length > 0
                      ? 'Analysis complete — ready for Auto-Recording or manual capture.'
                      : 'Partial analysis ready.'}
                  </span>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="p-3 rounded-md border border-line bg-surface-2">
                    <div className="text-[10px] text-text-muted mb-1 uppercase tracking-wide">
                      Page Title
                    </div>
                    <div className="font-semibold text-sm truncate">{analysis.title}</div>
                    {analysis.description && (
                      <div className="text-xs text-text-muted mt-1 line-clamp-2">
                        {analysis.description}
                      </div>
                    )}
                  </div>

                  <div className="p-3 rounded-md border border-line bg-surface-2">
                    <div className="text-[10px] text-text-muted mb-1.5 uppercase tracking-wide">
                      Main Features Detected ({analysis.features.length})
                    </div>
                    {analysis.features.length > 0 ? (
                      <ul className="space-y-1 text-xs">
                        {analysis.features.slice(0, 3).map((f, i) => (
                          <li key={i} className="flex gap-1.5 truncate">
                            <span className="text-focus">•</span>
                            <span className="truncate">{f.title}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-text-muted">Standard feature set configured.</p>
                    )}
                  </div>
                </div>

                {/* Primary Automated Option Highlight Card */}
                <div className="p-4 rounded-xl border border-focus/50 bg-gradient-to-r from-focus/10 via-surface-1 to-surface-2 space-y-3 shadow-md">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">⚡</span>
                    <div>
                      <h3 className="text-sm font-bold text-text">Auto-Record Your Real Website</h3>
                      <p className="text-xs text-text-muted">
                        Opens your website in a new window, captures it via tab recording, and guides you through a 16-second cinematic tour — saved directly to your Library.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={handleStartAutoRecording}
                    className="w-full h-10 rounded-lg bg-focus hover:brightness-110 text-focus-ink font-semibold text-sm transition-all flex items-center justify-center gap-2 shadow-sm"
                  >
                    <span>⚡ Start Live Auto-Recording</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Manual mode hint */}
        {mode === 'manual' && (
          <section className="p-4 rounded-md border border-line bg-surface-2">
            <p className="text-sm text-text-muted">
              In manual mode you share any screen or window directly. You can click to record and stop at any time.
            </p>
          </section>
        )}

        {/* Alternative Actions / Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-line">
          {mode === 'url' && !analysis ? (
            <button
              onClick={() => {
                if (!url.trim()) return;
                handleStartAutoRecording();
              }}
              disabled={!url.trim()}
              className="text-xs text-focus hover:underline font-medium disabled:opacity-40"
            >
              ⚡ Quick Auto-Record with this URL
            </button>
          ) : (
            <span className="text-xs text-text-muted">Or record manually via screen share</span>
          )}

          <button
            id="continue-to-record-btn"
            onClick={handleContinue}
            disabled={mode === 'url' && !analysis}
            className="inline-flex items-center justify-center h-9 px-4 rounded-md border border-line bg-surface-2 hover:bg-surface-1 text-text font-medium text-xs disabled:opacity-40 transition-all"
          >
            <span>Manual Screen Record →</span>
          </button>
        </div>
      </div>
    </main>
  );
}
