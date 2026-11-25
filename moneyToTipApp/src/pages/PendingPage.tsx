import LibraryPage from "./LibraryPage";

/** 兼容旧链接；待确认已统一进入题库状态筛选。 */
export default function PendingPage() {
  return <LibraryPage initialStatus="pending" />;
}
