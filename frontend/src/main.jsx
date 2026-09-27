import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo/700.css';
import '@fontsource/archivo/800.css';
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/source-sans-3/700.css';
import '@fontsource/jetbrains-mono/500.css';
import App from './App.jsx';
import { captureSetupLink } from './api.js';
import './index.css';

// A setup link (?backend=<Apps Script URL>) connects this phone to the Google backend once.
captureSetupLink();

// Demo-only URL switches: ?screen=admin, ?nav=0, ?after=1. Ignored when connected to the backend.
const q = new URLSearchParams(window.location.search);
const props = {
  startScreen: q.get('screen') || 'login',
  prototypeNav: q.get('nav') !== '0',
  afterPhotoAlwaysRequired: q.get('after') === '1',
};

createRoot(document.getElementById('root')).render(<App {...props} />);
