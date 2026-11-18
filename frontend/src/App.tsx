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

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useApp();
  if (!user) {
    return <Navigate to="/login" replace />;
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
              <Route index element={<DashboardPage />} />
              <Route path="rain-gap" element={<RainGapPage />} />
              <Route path="risk-twin" element={<RiskTwinPage />} />
              <Route path="plots" element={<PlotsPage />} />
              <Route path="crews" element={<CrewsEquipmentPage />} />
              <Route path="planner" element={<OperationsPlannerPage />} />
              <Route path="gantt" element={<CrewGanttPage />} />
              <Route path="policy-arena" element={<PolicyArenaPage />} />
              <Route path="replanning" element={<ReplanningPage />} />
              <Route path="assistant" element={<AssistantPage />} />
              <Route path="governance" element={<GovernancePage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </ErrorBoundary>
  );
}

export default App;
