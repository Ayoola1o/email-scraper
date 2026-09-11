import React from 'react';
import { createRoot } from 'react-dom/client';
import { EmailScraperDashboard } from './EmailScraperDashboard';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<EmailScraperDashboard />);
}
