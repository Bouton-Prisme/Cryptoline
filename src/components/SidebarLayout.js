import { NavLink } from "react-router-dom";
import { useAppPreferences } from "../context/AppPreferencesContext";

const NAV_LINKS = [
  { label: "Dashboard", path: "/" },
  { label: "Historique", path: "/historique" },
  { label: "Comptes", path: "/comptes" },
  { label: "Strategies", path: "/strategies" },
];

export default function SidebarLayout({ children }) {
  const { theme } = useAppPreferences();

  return (
    <div className="app" data-theme={theme}>
      <div className="bg-layer" />
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <img src="/cryptolinelogo.png" alt="CryptoLine" />
            <strong>CryptoLine Hub</strong>
            <p>Monitoring + Execution</p>
          </div>
          <nav className="sidebar-nav">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.path}
                to={link.path}
                end={link.path === "/"}
                className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="app-content">
          <main className="shell">{children}</main>
        </div>
      </div>
    </div>
  );
}
