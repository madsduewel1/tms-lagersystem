import { BrowserRouter, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AppLayout from './components/AppLayout';
import { NotFound } from './components/NotFound';
import LoginPage from './pages/LoginPage';
import SetupPage from './pages/SetupPage';
import DashboardPage from './pages/DashboardPage';
import SearchPage from './pages/SearchPage';
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
import UserFormPage from './pages/UserFormPage';
import SettingsPage from './pages/SettingsPage';
import CategoryFormPage from './pages/CategoryFormPage';
import TasksPage from './pages/TasksPage';
import TaskFormPage from './pages/TaskFormPage';
import BoardPage from './pages/BoardPage';
import PostFormPage from './pages/PostFormPage';
import MessagesPage from './pages/MessagesPage';
import CalendarPage from './pages/CalendarPage';
import AppointmentFormPage from './pages/AppointmentFormPage';
import NotificationsPage from './pages/NotificationsPage';
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


function RequirePermission({
  any,
  all,
  children,
}: {
  any?: string[];
  all?: string[];
  children: ReactNode;
}) {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const ok = all
    ? all.every((code) => permissions.includes(code))
    : (any ?? []).some((code) => permissions.includes(code));
  if (!ok) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Wrappt ein Seitenelement so, dass mindestens eines der Rechte nötig ist. */
function guarded(element: ReactNode, ...any: string[]) {
  return <RequirePermission any={any}>{element}</RequirePermission>;
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
        <Route path="/suche" element={<SearchPage />} />
        <Route path="/inventar" element={guarded(<InventoryPage />, 'inventory.view')} />
        <Route path="/inventar/new" element={guarded(<ItemFormPage />, 'inventory.manage')} />
        <Route path="/inventar/edit" element={guarded(<ItemFormPage />, 'inventory.manage')} />
        <Route path="/inventar/detail" element={guarded(<AssetDetailPage />, 'inventory.view')} />
        <Route path="/lagerorte" element={guarded(<LocationsPage />, 'locations.view')} />
        <Route path="/lagerorte/new" element={guarded(<LocationFormPage />, 'locations.manage')} />
        <Route path="/lagerorte/edit" element={guarded(<LocationFormPage />, 'locations.manage')} />
        <Route path="/lagerorte/detail" element={guarded(<LocationDetailPage />, 'locations.view')} />
        <Route path="/cases" element={guarded(<CasesPage />, 'cases.view')} />
        <Route path="/cases/new" element={guarded(<CaseFormPage />, 'cases.manage')} />
        <Route path="/cases/edit" element={guarded(<CaseFormPage />, 'cases.manage')} />
        <Route path="/cases/detail" element={guarded(<CaseDetailPage />, 'cases.view')} />
        <Route path="/labels" element={guarded(<LabelsPage />, 'labels.print')} />
        <Route path="/events" element={guarded(<EventsPage />, 'events.view')} />
        <Route path="/events/new" element={guarded(<EventFormPage />, 'events.manage')} />
        <Route path="/events/edit" element={guarded(<EventFormPage />, 'events.manage')} />
        <Route path="/events/detail" element={guarded(<EventDetailPage />, 'events.view')} />
        <Route path="/aufgaben" element={guarded(<TasksPage />, 'tasks.view')} />
        <Route path="/aufgaben/new" element={guarded(<TaskFormPage />, 'tasks.manage')} />
        <Route path="/aufgaben/edit" element={guarded(<TaskFormPage />, 'tasks.manage')} />
        <Route path="/pinnwand" element={guarded(<BoardPage />, 'board.view')} />
        <Route path="/pinnwand/new" element={guarded(<PostFormPage />, 'board.manage')} />
        <Route path="/nachrichten" element={guarded(<MessagesPage />, 'messages.use')} />
        <Route path="/kalender" element={guarded(<CalendarPage />, 'calendar.view')} />
        <Route path="/kalender/new" element={guarded(<AppointmentFormPage />, 'calendar.manage')} />
        <Route path="/kalender/edit" element={guarded(<AppointmentFormPage />, 'calendar.manage')} />
        <Route path="/benachrichtigungen" element={<NotificationsPage />} />
        <Route path="/a/:token" element={<QrRedirect />} />
        <Route path="/l/:token" element={<QrRedirect />} />
        <Route path="/c/:token" element={<QrRedirect />} />
        <Route path="/users" element={guarded(<UsersPage />, 'users.manage', 'roles.manage')} />
        <Route path="/users/new" element={guarded(<UserFormPage />, 'users.manage')} />
        <Route path="/settings" element={guarded(<SettingsPage />, 'settings.manage')} />
        <Route path="/kategorien/new" element={guarded(<CategoryFormPage />, 'categories.manage')} />
        <Route path="/kategorien/edit" element={guarded(<CategoryFormPage />, 'categories.manage')} />
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