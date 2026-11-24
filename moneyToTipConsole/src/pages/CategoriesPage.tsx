import { App as AntdApp, Button, Card, Input, Modal, Popconfirm, Space, Table } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { Category } from "../types";

/** 所有有子节点的 key（可展开的行） */
function expandableKeys(nodes: Category[]): number[] {
  return nodes.flatMap((n) =>
    n.children.length ? [n.id, ...expandableKeys(n.children)] : []);
}

/** 分类管理：树形表格 + 新建/子类/重命名/删除 */
export default function CategoriesPage() {
  const { message } = AntdApp.useApp();
  const [tree, setTree] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedKeys, setExpandedKeys] = useState<number[]>([]);
  const allKeys = useMemo(() => expandableKeys(tree), [tree]);
  const [edit, setEdit] = useState<{ open: boolean; parentId: number | null; node: Category | null }>({
    open: false, parentId: null, node: null,
  });
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await api<Category[]>("/questions/categories/tree");
      setTree(t);
      setExpandedKeys(expandableKeys(t)); // 加载后默认全部展开
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch((e) => message.error(e.message));
  }, [load, message]);

  const openCreate = (parentId: number | null) => {
    setEdit({ open: true, parentId, node: null });
    setName("");
  };
  const openRename = (node: Category) => {
    setEdit({ open: true, parentId: null, node });
    setName(node.name);
  };

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    try {
      if (edit.node) {
        await api(`/questions/categories/${edit.node.id}`, { method: "PATCH", body: { name: n } });
        message.success("已重命名");
      } else {
        await api("/questions/categories", {
          method: "POST", body: { name: n, parent_id: edit.parentId },
        });
        message.success("已创建");
      }
      setEdit({ open: false, parentId: null, node: null });
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  const remove = async (c: Category) => {
    try {
      await api(`/questions/categories/${c.id}`, { method: "DELETE" });
      message.success(`已删除「${c.name}」，子分类上移`);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  interface Row {
    key: number;
    name: string;
    children?: Row[];
  }
  const toRows = (nodes: Category[]): Row[] =>
    nodes.map((c) => ({ key: c.id, name: c.name, children: toRows(c.children) }));
  const find = (nodes: Category[], id: number): Category | null =>
    nodes.map((n) => (n.id === id ? n : find(n.children, id)))
      .find(Boolean) ?? null;

  return (
    <Card
      title="分类树"
      extra={
        <Space>
          <Button size="small" onClick={() => setExpandedKeys(allKeys)}>展开全部</Button>
          <Button size="small" onClick={() => setExpandedKeys([])}>折叠全部</Button>
          <Button type="primary" size="small" onClick={() => openCreate(null)}>新建根分类</Button>
        </Space>
      }
    >
      <Table<Row>
        rowKey="key"
        size="middle"
        scroll={{ x: true }}
        loading={loading}
        dataSource={toRows(tree)}
        pagination={false}
        expandable={{
          expandedRowKeys: expandedKeys,
          onExpandedRowsChange: (keys) => setExpandedKeys(keys as number[]),
        }}
        columns={[
          { title: "名称", dataIndex: "name" },
          {
            title: "操作", key: "actions", width: 280,
            render: (_, row) => {
              const node = find(tree, row.key)!;
              return (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => openCreate(node.id)}>加子类</Button>
                  <Button type="link" size="small" onClick={() => openRename(node)}>重命名</Button>
                  <Popconfirm title={`删除「${node.name}」？子分类上移，题目保留。`}
                    okText="删除" cancelText="取消" onConfirm={() => remove(node)}>
                    <Button type="link" size="small" danger>删除</Button>
                  </Popconfirm>
                </Space>
              );
            },
          },
        ]}
      />

      <Modal
        open={edit.open}
        title={edit.node ? "重命名分类" : edit.parentId ? "新建子分类" : "新建根分类"}
        onCancel={() => setEdit({ open: false, parentId: null, node: null })}
        onOk={save}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Input value={name} onChange={(e) => setName(e.target.value)}
          onPressEnter={save} placeholder="分类名称" style={{ marginTop: 8 }} />
      </Modal>
    </Card>
  );
}
