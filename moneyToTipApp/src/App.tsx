import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { getToken } from "./api/client";
import AppShell from "./components/AppShell";
import AddPage from "./pages/AddPage";
import LoginPage from "./pages/LoginPage";
import MePage from "./pages/MePage";
import PendingPage from "./pages/PendingPage";
import PlansPage from "./pages/PlansPage";
import ReviewPage from "./pages/ReviewPage";
import StatsPage from "./pages/StatsPage";
import TodayPage from "./pages/TodayPage";

function useAuthRedirect() {
  const [, setTick] = useState(0);
  const location = useLocation();
  useEffect(() => {
    const onReauth = () => setTick((tick) => tick + 1);
    window.addEventListener("mtt:reauth", onReauth);
    return () => window.removeEventListener("mtt:reauth", onReauth);
  }, []);
  return location;
}

export function handleApiError(error: unknown): string {
  return error instanceof Error ? error.message : "出错了";
}

export default function App() {
  const location = useAuthRedirect();
  const authed = Boolean(getToken());

  if (!authed) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <AppShell>
      <Routes location={location}>
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<TodayPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/add" element={<AddPage />} />
        <Route path="/library" element={<PendingPage />} />
        <Route path="/pending" element={<Navigate to="/library" replace />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/insights" element={<StatsPage />} />
        <Route path="/me" element={<MePage />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Routes>
    </AppShell>
  );
}
