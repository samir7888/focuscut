import { Route, Routes } from 'react-router-dom';
import { HomePage } from './routes/HomePage';
import { SetupPage } from './routes/SetupPage';
import { RecordPage } from './routes/RecordPage';
import { EditorPage } from './routes/EditorPage';
import { LibraryPage } from './routes/LibraryPage';
import { BrowserCheck } from '../components/BrowserCheck';

export default function App() {
  return (
    <div className="min-h-screen bg-surface-0 text-text">
      <BrowserCheck />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/record" element={<RecordPage />} />
        <Route path="/editor/:id" element={<EditorPage />} />
      </Routes>
    </div>
  );
}
