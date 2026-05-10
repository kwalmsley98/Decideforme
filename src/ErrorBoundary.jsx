import { Component } from "react";

/**
 * Catches render errors so a blank screen becomes a recoverable message.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const msg = this.state.error?.message || String(this.state.error || "Unknown error");
      return (
        <div
          className="error-boundary-fallback"
          style={{
            minHeight: "100vh",
            padding: "28px 20px",
            boxSizing: "border-box",
            background: "#05070e",
            color: "#f6f7ff",
            fontFamily: "system-ui, sans-serif",
            maxWidth: "560px",
            margin: "0 auto"
          }}
        >
          <h1 style={{ fontSize: "1.25rem", margin: "0 0 12px", color: "#f5e642" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 16px", lineHeight: 1.5, opacity: 0.9 }}>
            The app hit an error while loading. You can try again or refresh the page.
          </p>
          <pre
            style={{
              fontSize: "0.82rem",
              padding: "12px 14px",
              borderRadius: "12px",
              background: "rgba(255,255,255,0.06)",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word"
            }}
          >
            {msg}
          </pre>
          <button
            type="button"
            onClick={() => globalThis.location?.reload?.()}
            style={{
              marginTop: "20px",
              padding: "12px 20px",
              borderRadius: "12px",
              border: "none",
              fontWeight: 700,
              cursor: "pointer",
              background: "#f5e642",
              color: "#0a0a12"
            }}
          >
            Refresh page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
