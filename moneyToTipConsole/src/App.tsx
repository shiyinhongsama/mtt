import {
  AppstoreOutlined,
  DashboardOutlined,
  ImportOutlined,
  DatabaseOutlined,
  FolderOutlined,
  MenuOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Button, Drawer, Grid, Layout, Menu, Typography } from "antd";
import { useEffect, useState } from "react";
import { clearToken, getToken } from "./api";
import AnkiPage from "./pages/AnkiPage";
import BanksPage from "./pages/BanksPage";
import CategoriesPage from "./pages/CategoriesPage";
import DashboardPage from "./pages/DashboardPage";
import DataPage from "./pages/DataPage";
import LoginPage from "./pages/LoginPage";
import QuestionsPage from "./pages/QuestionsPage";
import UsersPage from "./pages/UsersPage";

type PageKey = "dashboard" | "banks" | "questions" | "categories" | "users" | "data" | "anki";

const MENU: { key: PageKey; icon: React.ReactNode; label: string }[] = [
  { key: "dashboard", icon: <DashboardOutlined />, label: "仪表盘" },
  { key: "banks", icon: <AppstoreOutlined />, label: "题库" },
  { key: "questions", icon: <DatabaseOutlined />, label: "题目" },
  { key: "categories", icon: <FolderOutlined />, label: "分类" },
  { key: "users", icon: <TeamOutlined />, label: "账户" },
  { key: "data", icon: <SafetyCertificateOutlined />, label: "数据" },
  { key: "anki", icon: <ImportOutlined />, label: "Anki" },
];

export default function App() {
  const [logged, setLogged] = useState(Boolean(getToken()));
  const [page, setPage] = useState<PageKey>("dashboard");
  /** 从仪表盘跳转题目页时带的筛选 */
  const [questionStatus, setQuestionStatus] = useState<string>("active");
  const [questionBank, setQuestionBank] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md; // <768px：抽屉菜单 + 堆叠布局

  useEffect(() => {
    const onExpired = () => setLogged(false);
    window.addEventListener("mttc:expired", onExpired);
    return () => window.removeEventListener("mttc:expired", onExpired);
  }, []);

  if (!logged) {
    return <LoginPage onSuccess={() => setLogged(true)} />;
  }

  const goQuestions = (status: string) => {
    setQuestionStatus(status);
    setQuestionBank(null);
    setPage("questions");
  };

  const goBank = (bankId: number) => {
    setQuestionStatus("active");
    setQuestionBank(bankId);
    setPage("questions");
  };

  const nav = (key: PageKey) => {
    setPage(key);
    setMenuOpen(false);
  };

  const menuEl = (
    <Menu
      mode={isMobile ? "vertical" : "inline"}
      selectedKeys={[page]}
      onClick={(e) => nav(e.key as PageKey)}
      style={{ background: "transparent", borderInlineEnd: "none" }}
      items={MENU.map((m) => ({ key: m.key, icon: m.icon, label: m.label }))}
    />
  );

  const content = (
    <>
      {page === "dashboard" && <DashboardPage goQuestions={goQuestions} goBank={goBank} />}
      {page === "banks" && <BanksPage />}
      {page === "questions" && (
        <QuestionsPage key={`${questionStatus}-${questionBank}`}
                       initialStatus={questionStatus} initialBank={questionBank} />
      )}
      {page === "categories" && <CategoriesPage />}
      {page === "users" && <UsersPage />}
      {page === "data" && <DataPage />}
      {page === "anki" && <AnkiPage />}
    </>
  );

  const pageTitle = MENU.find((m) => m.key === page)?.label;

  const header = (
    <Layout.Header style={{
      background: "#FBF9F4", borderBottom: "1px solid #CFC9BA",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: isMobile ? "0 16px" : "0 28px", height: 56, lineHeight: "56px",
      position: "sticky", top: 0, zIndex: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {isMobile && (
          <Button type="text" icon={<MenuOutlined />} onClick={() => setMenuOpen(true)}
            aria-label="打开菜单" />
        )}
        <Typography.Title level={5} style={{ margin: 0, fontFamily: "'Noto Serif SC',serif" }}>
          {pageTitle}
        </Typography.Title>
      </div>
      <Button onClick={() => { clearToken(); setLogged(false); }}>退出登录</Button>
    </Layout.Header>
  );

  if (isMobile) {
    return (
      <Layout style={{ minHeight: "100vh" }}>
        {header}
        <Drawer
          placement="left"
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          width={230}
          styles={{ body: { padding: 0, background: "#F4F1EA" } }}
        >
          <div style={{ padding: "20px 20px 12px" }}>
            <Typography.Title level={4} style={{ fontFamily: "'Noto Serif SC',serif", margin: 0 }}>
              忙里偷题
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 11, letterSpacing: 3 }}>
              管理端 · CONSOLE
            </Typography.Text>
          </div>
          {menuEl}
        </Drawer>
        <Layout.Content style={{ padding: 16 }}>
          {content}
        </Layout.Content>
      </Layout>
    );
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Sider width={216} theme="light"
        style={{ borderRight: "1px solid #CFC9BA", background: "#F4F1EA" }}>
        <div style={{ padding: "22px 20px 18px" }}>
          <Typography.Title level={4} style={{ fontFamily: "'Noto Serif SC',serif", margin: 0 }}>
            忙里偷题
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 11, letterSpacing: 3 }}>
            MONEY TO TIP · 管理端
          </Typography.Text>
        </div>
        {menuEl}
        <div style={{ position: "absolute", bottom: 18, left: 20, fontSize: 11, color: "#777268" }}>
          Small tips, big steps.
        </div>
      </Layout.Sider>

      <Layout>
        {header}
        <Layout.Content style={{ padding: 28, maxWidth: 1080, width: "100%", margin: "0 auto" }}>
          {content}
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
