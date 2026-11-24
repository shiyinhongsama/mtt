import { ConfigProvider, App as AntdApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./global.css";

// 纸墨基调：主色朱砂，低圆角，克制
createRoot(document.getElementById("root")!).render(
  <ConfigProvider
    locale={zhCN}
    theme={{
      token: {
        colorPrimary: "#C1442E",
        colorBgLayout: "#F4F1EA",
        colorBgContainer: "#FBF9F4",
        borderRadius: 2,
        fontFamily: `'Noto Sans SC','PingFang SC',-apple-system,sans-serif`,
      },
    }}
  >
    <AntdApp>
      <App />
    </AntdApp>
  </ConfigProvider>,
);
