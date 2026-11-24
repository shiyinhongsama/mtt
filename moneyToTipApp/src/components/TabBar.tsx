import { NavLink } from "react-router-dom";

const tabs = [
  { to: "/review", label: "刷题" },
  { to: "/plans", label: "计划" },
  { to: "/add", label: "加题" },
  { to: "/pending", label: "预览区" },
  { to: "/stats", label: "统计" },
  { to: "/me", label: "我的" },
];

/** 底部主导航：拇指可达（屏幕下半部，R-session-03）。管理端是独立入口 /console/ */
export default function TabBar() {
  return (
    <nav id="tabbar">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? "active" : "")}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
