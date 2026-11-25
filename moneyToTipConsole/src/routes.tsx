import { Spin } from "antd";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import BanksPage from "./pages/BanksPage";
import CategoriesPage from "./pages/CategoriesPage";
import DashboardPage from "./pages/DashboardPage";

const QuestionsPage = lazy(() => import("./pages/QuestionsPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const DataPage = lazy(() => import("./pages/DataPage"));
const AnkiPage = lazy(() => import("./pages/AnkiPage"));

function QuestionsRoute() {
  const [params] = useSearchParams();
  const bankParam = Number(params.get("bank"));
  const bank = Number.isInteger(bankParam) && bankParam > 0 ? bankParam : null;
  const status = params.get("status") ?? "active";
  return <QuestionsPage key={`${status}-${bank}`} initialStatus={status} initialBank={bank} />;
}

/** 管理端路由集中在 URL 中，刷新和分享链接都保留当前位置。 */
export default function ConsoleRoutes() {
  return (
    <Suspense fallback={<div role="status" style={{ padding: 48, textAlign: "center" }}><Spin /></div>}>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/banks" element={<BanksPage />} />
        <Route path="/questions" element={<QuestionsRoute />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/data" element={<DataPage />} />
        <Route path="/anki" element={<AnkiPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
