import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { captureAppLink } from './api.js';
import './index.css';

// The app link from the office (?backend=<Apps Script URL>) connects this phone to the Google Sheet once.
captureAppLink();

/** Last line of defence: a crash never leaves a blank screen, and never deletes unsent work. */
class Guard extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { try { console.error(error); } catch (e) {} }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ minHeight: '100vh', background: '#0F2540', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'center' }}>
          <b style={{ fontSize: 20 }}>Something went wrong on this screen.</b>
          <span style={{ fontSize: 15 }}>Your report and photos are still saved on this phone. Reload to continue.</span>
          <button onClick={() => window.location.reload()} style={{ minHeight: 52, background: '#E8760F', color: '#FFFFFF', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 17 }}>Reload</button>
          <span style={{ fontSize: 12, color: '#AFC0D6', overflowWrap: 'anywhere' }}>{String(this.state.error && this.state.error.message || this.state.error)}</span>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(<Guard><App /></Guard>);
