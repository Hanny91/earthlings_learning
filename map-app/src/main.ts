import 'leaflet/dist/leaflet.css';
import './style.css';
import { loadSession, onAuthChange } from './auth';
import { SurveyMap } from './map';

// Header, sign-in panel, add-pin form and pin popups are wired in step 8.
const container = document.querySelector<HTMLDivElement>('#map');
if (container) {
  const surveyMap = new SurveyMap(container, {
    onLoadError: (error) => console.error('Failed to load pins:', error),
  });

  // Signing in or out changes which pins RLS returns, so reload on change.
  let first = true;
  onAuthChange(() => {
    if (first) {
      first = false;
      return;
    }
    void surveyMap.reload();
  });
  void loadSession().catch((error) => console.error('Failed to load session:', error));
}
