import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Category } from "../api/types";

/** 分类选择：树形拍平成缩进下拉 */
export default function CategorySelect({
  value,
  onChange,
  emptyLabel = "未分类",
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  emptyLabel?: string;
}) {
  const [options, setOptions] = useState<{ id: number; label: string }[]>([]);

  useEffect(() => {
    api<Category[]>("/questions/categories/tree")
      .then((tree) => {
        const out: { id: number; label: string }[] = [];
        const walk = (nodes: Category[], depth: number) =>
          nodes.forEach((n) => {
            out.push({ id: n.id, label: "　".repeat(depth) + n.name });
            walk(n.children, depth + 1);
          });
        walk(tree, 0);
        setOptions(out);
      })
      .catch(() => undefined);
  }, []);

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">{emptyLabel}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.label}</option>
      ))}
    </select>
  );
}
