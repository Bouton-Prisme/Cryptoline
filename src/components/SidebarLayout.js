import { NavLink } from "react-router-dom";
import { useState } from "react";

const NAV_LINKS = [
  { icon: "D", label: "Dashboard", path: "/" },
  { icon: "H", label: "Historique", path: "/historique" },
  { icon: "C", label: "Comptes", path: "/comptes" },
  { icon: "S", label: "Strategies", path: "/strategies" },
  { icon: "?", label: "Mode d'emploi", path: "/mode-emploi" },
];

export default function SidebarLayout({ children }) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="app">
      <div className="bg-layer" />
      <div className={`app-shell ${isCollapsed ? "sidebar-collapsed" : ""}`}>
        <aside className="sidebar">
          <div className="sidebar-brand">
            <img src="/cryptolinelogo.png" alt="CryptoLine" />
            <button
              type="button"
              className="sidebar-toggle"
              onClick={() => setIsCollapsed((value) => !value)}
              aria-label={isCollapsed ? "Déplier la navigation" : "Replier la navigation"}
            >
              {isCollapsed ? ">" : "<"}
            </button>
          </div>
          <nav className="sidebar-nav">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.path}
                to={link.path}
                end={link.path === "/"}
                className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
              >
                <span className="nav-icon">{link.icon}</span>
                <span className="nav-label">{link.label}</span>
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
