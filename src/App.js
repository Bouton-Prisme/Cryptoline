import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import SidebarLayout from "./components/SidebarLayout";
import DashboardPage from "./pages/DashboardPage";
import AccountsPage from "./pages/AccountsPage";
import PlaceholderPage from "./pages/PlaceholderPage";
import { AppPreferencesProvider } from "./context/AppPreferencesContext";

export default function App() {
  return (
    <AppPreferencesProvider>
      <BrowserRouter>
        <SidebarLayout>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/historique" element={<PlaceholderPage title="Historique" />} />
            <Route path="/comptes" element={<AccountsPage />} />
            <Route path="/strategies" element={<PlaceholderPage title="Strategies" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SidebarLayout>
      </BrowserRouter>
    </AppPreferencesProvider>
  );
}
