import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort boundary. Without it a render error unmounted the whole terminal
 * and left a blank page with no way to recover or report what happened.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[PatternHunter] Unhandled render error:", error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen bg-[#070b14] text-white flex items-center justify-center p-6 font-mono">
        <div className="max-w-lg w-full rounded-xl border border-red-500/30 bg-red-500/5 p-6 space-y-4">
          <h1 className="text-lg font-bold text-red-400">Terminal error</h1>
          <p className="text-sm text-slate-300">
            The interface hit an unexpected error. Your exchange positions and saved data are
            unaffected.
          </p>
          <pre className="text-[11px] whitespace-pre-wrap break-all rounded bg-black/40 p-3 text-slate-400">
            {this.state.error.message}
          </pre>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={this.reload}
              className="rounded bg-cyan-500 px-4 py-2 text-xs font-bold text-black hover:bg-cyan-400"
            >
              Reload terminal
            </button>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded border border-slate-600 px-4 py-2 text-xs font-bold text-slate-300 hover:border-slate-400"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}
