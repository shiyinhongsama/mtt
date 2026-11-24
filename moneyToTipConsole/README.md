# 忙里偷题 · 管理端（Console）

> Small tips, big steps.

React 18 + TypeScript + Vite + **Ant Design 5**。管理员的电脑 Web 管理台，独立于 App 端工程
（moneyToTipApp），消费 moneyToTip 服务端（FastAPI）的 `/api/v1`。

## 开发

```bash
npm install
npm run dev      # http://localhost:5174/console/（/api 代理到 127.0.0.1:8000）
```

前提：服务端已启动（`mtt serve`，见 moneyToTip 工程）。

## 生产

```bash
npm run build    # 产物 dist/，由服务端挂在 /console/
```

## 功能

- 左侧导航 + 页头的经典后台布局（Layout / Menu / Card / Table / Form / Modal）
- 仪表盘：KPI 卡片、待办预警（预览区/已标记/已暂停）、30 天热力图、分类掌握
- 题库：状态筛选 + 搜索 + 分页表格 + 弹窗新建/编辑，确认入队 / 标记 / 暂停 / 恢复 / 删除
- 分类：树形表格，新建 / 子类 / 重命名 / 删除（子分类上移）
- 账户：表格 + 弹窗创建（token 只显示一次）、禁用 / 启用、删除（级联清除）
- 数据：导出 JSON / 拖拽导入（自动去重）/ 手动备份 / 危险区清空
- 账号密码登录（仅管理员；token 可被吊销）
