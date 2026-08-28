import React from 'react';
import { createRoot } from 'react-dom/client';
import ConcourseApp from '../ConcourseApp.jsx';
import './styles/index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConcourseApp />
  </React.StrictMode>,
);
