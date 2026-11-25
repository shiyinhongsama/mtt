import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import TabBar from "./TabBar";
import TopBar from "./TopBar";
import styles from "./AppShell.module.css";

export default function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const focused = ["/review", "/insights"].some((path) => location.pathname.startsWith(path));

  return (
    <div className={focused ? styles.focused : styles.shell}>
      {!focused && <TopBar />}
      <main id="view" className={focused ? styles.focusView : undefined}>{children}</main>
      {!focused && <TabBar />}
    </div>
  );
}
