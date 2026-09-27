import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Optional URL switches: ?screen=admin, ?nav=0 (hide the prototype jumper), ?after=1 (After photo always required).
const q = new URLSearchParams(window.location.search);
const props = {
  startScreen: q.get('screen') || 'login',
  prototypeNav: q.get('nav') !== '0',
  afterPhotoAlwaysRequired: q.get('after') === '1',
};

createRoot(document.getElementById('root')).render(<App {...props} />);
