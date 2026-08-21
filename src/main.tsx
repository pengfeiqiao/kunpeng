import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyPrivateDefaults } from './lib/privateDefaults';
import './index.css';

// Fire-and-forget: public builds ship no overlay and this no-ops.
void applyPrivateDefaults();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
