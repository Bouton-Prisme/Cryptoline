import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import SidebarLayout from "./components/SidebarLayout";
import DashboardPage from "./pages/DashboardPage";
import AccountsPage from "./pages/AccountsPage";
import GuidePage from "./pages/GuidePage";
import PlaceholderPage from "./pages/PlaceholderPage";
import { AppPreferencesProvider } from "./context/AppPreferencesContext";
import { AuthProvider } from "./context/AuthContext";

export default function App() {
  return (
    <AuthProvider>
      <AppPreferencesProvider>
        <BrowserRouter>
          <SidebarLayout>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/historique" element={<PlaceholderPage title="Historique" />} />
              <Route path="/comptes" element={<AccountsPage />} />
              <Route path="/strategies" element={<PlaceholderPage title="Strategies" />} />
              <Route path="/mode-emploi" element={<GuidePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </SidebarLayout>
        </BrowserRouter>
      </AppPreferencesProvider>
    </AuthProvider>
  );
}
