import {
  App as AntdApp, Button, Card, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { ApiTokenInfo, UserInfo } from "../types";

/** 账户管理：表格 + 新建（发放 token）+ 禁用/启用/删除 */
export default function UsersPage() {
  const { message, modal } = AntdApp.useApp();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [tokensOf, setTokensOf] = useState<UserInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await api<UserInfo[]>("/identity/users"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch((e) => message.error(e.message));
  }, [load, message]);

  const create = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try {
      const r = await api<{ token: string; username: string }>("/identity/users", {
        method: "POST",
        body: {
          username: v.username.trim(),
          password: v.password?.trim() || undefined,
          role: v.role,
        },
      });
      modal.success({
        title: `账户「${r.username}」已创建`,
        content: (
          <div>
            <p>初始 token（只显示这一次，请立即保存）：</p>
            <Input.TextArea readOnly value={r.token} autoSize rows={2} />
          </div>
        ),
        width: 480,
      });
      setCreating(false);
      form.resetFields();
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  const act = async (u: UserInfo, action: "disable" | "enable" | "delete") => {
    try {
      if (action === "delete") await api(`/identity/users/${u.id}`, { method: "DELETE" });
      else await api(`/identity/users/${u.id}/${action}`, { method: "POST" });
      message.success("已操作");
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  return (
    <Card title="账户列表" extra={<Button type="primary" onClick={() => setCreating(true)}>新建账户</Button>}>
      <Table<UserInfo>
        rowKey="id"
        size="middle"
        scroll={{ x: true }}
        loading={loading}
        dataSource={users}
        pagination={false}
        columns={[
          { title: "#", dataIndex: "id", width: 64 },
          { title: "用户名", dataIndex: "username" },
          { title: "角色", dataIndex: "role", width: 110,
            render: (r: string) => r === "admin"
              ? <Tag color="red">管理员</Tag> : <Tag>普通用户</Tag> },
          { title: "状态", dataIndex: "is_active", width: 90,
            render: (v: boolean) => v ? <Tag color="green">正常</Tag> : <Tag>已禁用</Tag> },
          { title: "创建时间", dataIndex: "created_at", width: 180,
            render: (v: string) => new Date(v).toLocaleString("zh-CN") },
          {
            title: "操作", key: "actions", width: 180,
            render: (_, u) => (
              <Space size={0}>
                <Button type="link" size="small" onClick={() => setTokensOf(u)}>令牌</Button>
                {u.is_active ? (
                  <Popconfirm title={`禁用「${u.username}」？立即无法登录。`}
                    okText="禁用" cancelText="取消" onConfirm={() => act(u, "disable")}>
                    <Button type="link" size="small">禁用</Button>
                  </Popconfirm>
                ) : (
                  <Button type="link" size="small" onClick={() => act(u, "enable")}>启用</Button>
                )}
                <Popconfirm title={`删除「${u.username}」及其全部个人数据？不可恢复。`}
                  okText="删除" cancelText="取消" onConfirm={() => act(u, "delete")}>
                  <Button type="link" size="small" danger>删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={creating}
        title="新建账户"
        onCancel={() => setCreating(false)}
        onOk={create}
        confirmLoading={busy}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" requiredMark={false} style={{ marginTop: 16 }}>
          <Form.Item name="username" label="用户名"
            rules={[{ required: true, message: "请输入用户名" }]}>
            <Input placeholder="登录用户名" />
          </Form.Item>
          <Form.Item name="password" label="初始密码（留空则随机生成）">
            <Input.Password placeholder="可留空" />
          </Form.Item>
          <Form.Item name="role" label="角色" initialValue="user"
            rules={[{ required: true }]}>
            <Select options={[
              { value: "user", label: "普通用户" },
              { value: "admin", label: "管理员" },
            ]} />
          </Form.Item>
        </Form>
      </Modal>

      <TokenDrawer user={tokensOf} onClose={() => setTokensOf(null)} />
    </Card>
  );
}

/** 账户令牌管理：查看 / 签发 / 吊销（R-identity-08） */
function TokenDrawer({ user, onClose }: { user: UserInfo | null; onClose: () => void }) {
  const { message, modal } = AntdApp.useApp();
  const [tokens, setTokens] = useState<ApiTokenInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      setTokens(await api<ApiTokenInfo[]>(`/identity/users/${user.id}/tokens`));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [user, message]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const create = async () => {
    try {
      const r = await api<{ token: string }>(`/identity/users/${user!.id}/tokens`, {
        method: "POST",
      });
      modal.success({
        title: "新令牌已签发",
        content: (
          <div>
            <p>只显示这一次，请立即保存：</p>
            <Input.TextArea readOnly value={r.token} autoSize rows={2} />
          </div>
        ),
        width: 480,
      });
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "签发失败");
    }
  };

  const revoke = async (t: ApiTokenInfo) => {
    try {
      await api(`/identity/tokens/${t.id}/revoke`, { method: "POST" });
      message.success("已吊销，该令牌立即失效");
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "吊销失败");
    }
  };

  return (
    <Drawer
      open={user !== null}
      title={user ? `「${user.username}」的令牌` : ""}
      onClose={onClose}
      width={560}
      extra={<Button type="primary" onClick={create}>签发新令牌</Button>}
    >
      <Table<ApiTokenInfo>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={tokens}
        pagination={false}
        columns={[
          { title: "#", dataIndex: "id", width: 56 },
          { title: "令牌", dataIndex: "masked", width: 170,
            render: (v: string, t) => (
              <Typography.Text copyable={{ text: t.token, tooltips: ["复制完整令牌", "已复制"] }}
                style={{ fontFamily: "monospace" }}>{v}</Typography.Text>
            ) },
          { title: "签发时间", dataIndex: "created_at", width: 150,
            render: (v: string) => new Date(v).toLocaleString("zh-CN") },
          { title: "最近使用", dataIndex: "last_used_at", width: 150,
            render: (v: string | null) => (v ? new Date(v).toLocaleString("zh-CN") : "—") },
          { title: "状态", dataIndex: "revoked", width: 80,
            render: (v: boolean) => v ? <Tag>已吊销</Tag> : <Tag color="green">正常</Tag> },
          {
            title: "操作", key: "actions", width: 80,
            render: (_, t) => !t.revoked && (
              <Popconfirm title="吊销后该令牌立即失效。" okText="吊销" cancelText="取消"
                onConfirm={() => revoke(t)}>
                <Button type="link" size="small" danger>吊销</Button>
              </Popconfirm>
            ),
          },
        ]}
      />
      <p style={{ color: "#999", marginTop: 12, fontSize: 12 }}>
        一个账户可持有多个令牌（多端使用）；令牌只在签发时显示一次。
      </p>
    </Drawer>
  );
}
