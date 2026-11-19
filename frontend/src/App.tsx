import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { AppLayout } from './layouts/AppLayout';
import { AssistantPage } from './pages/AssistantPage';
import { AuthPage } from './pages/AuthPage';
import { CrewGanttPage } from './pages/CrewGanttPage';
import { CrewsEquipmentPage } from './pages/CrewsEquipmentPage';
import { DashboardPage } from './pages/DashboardPage';
import { GovernancePage } from './pages/GovernancePage';
import { GrowerHomePage } from './pages/GrowerHomePage';
import { NotificationsPage } from './pages/NotificationsPage';
import { OperationsPlannerPage } from './pages/OperationsPlannerPage';
import { PlotsPage } from './pages/PlotsPage';
import { PolicyArenaPage } from './pages/PolicyArenaPage';
import { RainGapPage } from './pages/RainGapPage';
import { ReplanningPage } from './pages/ReplanningPage';
import { RiskTwinPage } from './pages/RiskTwinPage';
import { SettingsPage } from './pages/SettingsPage';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F6F5F0] p-8">
          <div className="max-w-lg w-full bg-white rounded-2xl border border-red-200 p-6 shadow-sm space-y-3">
            <h1 className="text-lg font-bold text-red-900">Application Interface Error</h1>
            <p className="text-xs text-stone-600">{this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-[#0C1F17] text-white text-xs font-bold"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function getRoleHome(role?: string): string {
  if (role === 'farmer') return '/grower';
  if (role === 'admin') return '/governance';
  return '/';
}

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useApp();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

const RoleHomeRedirect: React.FC = () => {
  const { user } = useApp();
  if (user?.role === 'farmer') {
    return <Navigate to="/grower" replace />;
  }
  if (user?.role === 'admin') {
    return <Navigate to="/governance" replace />;
  }
  return <DashboardPage />;
};

const RequireRole: React.FC<{
  allowedRoles: ('coordinator' | 'farmer' | 'admin')[];
  children: React.ReactNode;
}> = ({ allowedRoles, children }) => {
  const { user } = useApp();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={getRoleHome(user.role)} replace />;
  }
  return <>{children}</>;
};

export function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<AuthPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<RoleHomeRedirect />} />
              <Route
                path="grower"
                element={
                  <RequireRole allowedRoles={['farmer']}>
                    <GrowerHomePage />
                  </RequireRole>
                }
              />
              <Route
                path="rain-gap"
                element={
                  <RequireRole allowedRoles={['farmer', 'coordinator', 'admin']}>
                    <RainGapPage />
                  </RequireRole>
                }
              />
              <Route
                path="risk-twin"
                element={
                  <RequireRole allowedRoles={['admin']}>
                    <RiskTwinPage />
                  </RequireRole>
                }
              />
              <Route
                path="plots"
                element={
                  <RequireRole allowedRoles={['farmer', 'coordinator']}>
                    <PlotsPage />
                  </RequireRole>
                }
              />
              <Route
                path="crews"
                element={
                  <RequireRole allowedRoles={['coordinator']}>
                    <CrewsEquipmentPage />
                  </RequireRole>
                }
              />
              <Route
                path="planner"
                element={
                  <RequireRole allowedRoles={['coordinator']}>
                    <OperationsPlannerPage />
                  </RequireRole>
                }
              />
              <Route
                path="gantt"
                element={
                  <RequireRole allowedRoles={['coordinator']}>
                    <CrewGanttPage />
                  </RequireRole>
                }
              />
              <Route
                path="policy-arena"
                element={
                  <RequireRole allowedRoles={['coordinator', 'admin']}>
                    <PolicyArenaPage />
                  </RequireRole>
                }
              />
              <Route
                path="replanning"
                element={
                  <RequireRole allowedRoles={['coordinator']}>
                    <ReplanningPage />
                  </RequireRole>
                }
              />
              <Route
                path="assistant"
                element={
                  <RequireRole allowedRoles={['coordinator']}>
                    <AssistantPage />
                  </RequireRole>
                }
              />
              <Route
                path="governance"
                element={
                  <RequireRole allowedRoles={['admin']}>
                    <GovernancePage />
                  </RequireRole>
                }
              />
              <Route
                path="notifications"
                element={
                  <RequireRole allowedRoles={['farmer', 'coordinator', 'admin']}>
                    <NotificationsPage />
                  </RequireRole>
                }
              />
              <Route
                path="settings"
                element={
                  <RequireRole allowedRoles={['farmer', 'coordinator', 'admin']}>
                    <SettingsPage />
                  </RequireRole>
                }
              />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </ErrorBoundary>
  );
}

export default App;
