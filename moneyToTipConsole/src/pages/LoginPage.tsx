import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Card, Form, Input, Typography } from "antd";
import { useState } from "react";
import { api, setToken } from "../api";

/** 管理端登录：账号密码（仅管理员），签发 API token */
export default function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const { message } = AntdApp.useApp();
  const [busy, setBusy] = useState(false);

  const submit = async (values: { username: string; password: string }) => {
    setBusy(true);
    try {
      const r = await api<{ token: string }>("/identity/login", {
        method: "POST",
        body: values,
      });
      setToken(r.token);
      message.success("欢迎回来");
      onSuccess();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#F4F1EA",
    }}>
      <Card style={{ width: 380, boxShadow: "0 8px 32px rgba(26,24,21,.08)" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <Typography.Title level={3} style={{ fontFamily: "'Noto Serif SC',serif", marginBottom: 4 }}>
            忙里偷题
          </Typography.Title>
          <Typography.Text type="secondary" style={{ letterSpacing: 4, fontSize: 12 }}>
            管理端 · CONSOLE
          </Typography.Text>
        </div>
        <Form layout="vertical" onFinish={submit} requiredMark={false}>
          <Form.Item name="username" label="用户名"
            rules={[{ required: true, message: "请输入用户名" }]}>
            <Input prefix={<UserOutlined />} placeholder="管理员用户名" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码"
            rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码"
              autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={busy} style={{ height: 42 }}>
            登 录
          </Button>
        </Form>
      </Card>
    </div>
  );
}
