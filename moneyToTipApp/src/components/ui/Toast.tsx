import type { ReactNode } from "react";
import styles from "./Toast.module.css";

export default function Toast({ children, tone = "default" }: {
  children: ReactNode;
  tone?: "default" | "error";
}) {
  return <div className={`${styles.toast} ${tone === "error" ? styles.error : ""}`} role="status">{children}</div>;
}
