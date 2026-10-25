import 'leaflet/dist/leaflet.css';
import './style.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';
import { NoticeProvider } from './components/Notices';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NoticeProvider>
      <App />
    </NoticeProvider>
  </StrictMode>,
);
