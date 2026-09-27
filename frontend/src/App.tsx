import { BrowserRouter, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AppLayout from './components/AppLayout';
import { NotFound } from './components/NotFound';
import LoginPage from './pages/LoginPage';
import SetupPage from './pages/SetupPage';
import DashboardPage from './pages/DashboardPage';
import InventoryPage from './pages/InventoryPage';
import ItemFormPage from './pages/ItemFormPage';
import AssetDetailPage from './pages/AssetDetailPage';
import LocationsPage from './pages/LocationsPage';
import LocationFormPage from './pages/LocationFormPage';
import LocationDetailPage from './pages/LocationDetailPage';
import CasesPage from './pages/CasesPage';
import CaseFormPage from './pages/CaseFormPage';
import CaseDetailPage from './pages/CaseDetailPage';
import LabelsPage from './pages/LabelsPage';
import EventsPage from './pages/EventsPage';
import EventFormPage from './pages/EventFormPage';
import EventDetailPage from './pages/EventDetailPage';
import QrRedirect from './pages/QrRedirect';
import UsersPage from './pages/UsersPage';
import SettingsPage from './pages/SettingsPage';
import type { ReactNode } from 'react';

function FullScreenLoading() {
  return (
    <div className="auth-page">
      <span className="spinner" />
    </div>
  );
}

function ConnectionFailed() {
  const { refresh } = useAuth();
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Server nicht erreichbar</h1>
        <p className="auth-hint">
          Die Anwendung konnte keine Verbindung zum Backend herstellen. Bitte
          Netzwerk und Serverstatus prüfen.
        </p>
        <button className="btn btn-primary" onClick={() => void refresh()}>
          Erneut versuchen
        </button>
      </div>
    </div>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading, connectionError } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoading />;
  if (connectionError) return <ConnectionFailed />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}


function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'administrator') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoading />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Router() {
  return (
    <Routes>
      <Route
        path="/setup"
        element={
          <GuestOnly>
            <SetupPage />
          </GuestOnly>
        }
      />
      <Route
        path="/login"
        element={
          <GuestOnly>
            <LoginPage />
          </GuestOnly>
        }
      />
      <Route
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/inventar" element={<InventoryPage />} />
        <Route path="/inventar/new" element={<ItemFormPage />} />
        <Route path="/inventar/detail" element={<AssetDetailPage />} />
        <Route path="/lagerorte" element={<LocationsPage />} />
        <Route path="/lagerorte/new" element={<LocationFormPage />} />
        <Route path="/lagerorte/detail" element={<LocationDetailPage />} />
        <Route path="/cases" element={<CasesPage />} />
        <Route path="/cases/new" element={<CaseFormPage />} />
        <Route path="/cases/detail" element={<CaseDetailPage />} />
        <Route path="/labels" element={<LabelsPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/events/new" element={<EventFormPage />} />
        <Route path="/events/detail" element={<EventDetailPage />} />
        <Route path="/a/:token" element={<QrRedirect />} />
        <Route path="/l/:token" element={<QrRedirect />} />
        <Route path="/c/:token" element={<QrRedirect />} />
        <Route
          path="/users"
          element={
            <AdminOnly>
              <UsersPage />
            </AdminOnly>
          }
        />
        <Route
          path="/settings"
          element={
            <AdminOnly>
              <SettingsPage />
            </AdminOnly>
          }
        />
        <Route
          path="*"
          element={
            <NotFound
              title="Seite nicht gefunden"
              hint="Die aufgerufene Adresse ist nicht (mehr) vorhanden."
              backTo="/"
              backLabel="Zur Startseite"
            />
          }
        />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/lagersystem">
        <Router />
      </BrowserRouter>
    </AuthProvider>
  );
}