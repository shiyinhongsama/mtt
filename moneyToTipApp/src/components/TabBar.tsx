import { NavLink } from "react-router-dom";

const tabs = [
  { to: "/today", label: "今日" },
  { to: "/library", label: "题库" },
  { to: "/add", label: "导入" },
  { to: "/me", label: "我的" },
];

export default function TabBar() {
  return (
    <nav id="tabbar" aria-label="主导航">
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} className={({ isActive }) => (isActive ? "active" : "")}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
