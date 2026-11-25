import Button from "../../components/ui/Button";
import styles from "./BulkConfirmBar.module.css";

export default function BulkConfirmBar({ count, pending, onConfirm, onClear }: {
  count: number;
  pending: boolean;
  onConfirm: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return <div className={styles.bar}><strong>已选 {count} 项</strong><Button variant="ghost" onClick={onClear}>取消选择</Button><Button loading={pending} onClick={onConfirm}>批量确认</Button></div>;
}
