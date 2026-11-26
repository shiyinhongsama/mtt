import { Link } from "react-router-dom";
import type { Bank, Plan } from "../../api/types";
import Button from "../../components/ui/Button";
import styles from "./TodayPlans.module.css";

interface Props {
  plans: Plan[];
  banks: Bank[];
}

/** 今日计划：每个计划独立进度和入口；进度的事实源在服务端 */
export default function TodayPlans({ plans, banks }: Props) {
  const bankName = (id: number | null) =>
    id === null ? "全部题库" : banks.find((bank) => bank.id === id)?.name ?? `题库 #${id}`;

  return (
    <section className={styles.section} aria-labelledby="today-plans-title">
      <div className={styles.heading}>
        <h2 id="today-plans-title">今日计划</h2>
        <Link className={styles.textLink} to="/plans">管理计划</Link>
      </div>
      <ul className={styles.list}>
        {plans.map((plan) => {
          const done = Math.min(plan.today_done, plan.daily_goal);
          const action = plan.goal_met ? "加练" : done > 0 ? "继续" : "开始";
          return (
            <li className={styles.card} key={plan.id}>
              <h3 className={styles.name}>{plan.name}</h3>
              <p className={styles.scope}>{bankName(plan.bank_id)} · 每天 {plan.daily_goal} 题</p>
              <div
                className={styles.track}
                role="progressbar"
                aria-label={`${plan.name}今日进度`}
                aria-valuemin={0}
                aria-valuemax={plan.daily_goal}
                aria-valuenow={done}
              >
                <span style={{ width: `${plan.daily_goal > 0 ? done / plan.daily_goal * 100 : 100}%` }} />
              </div>
              <div className={styles.foot}>
                <div className={styles.status}>
                  <span>今日 {done} / {plan.daily_goal} 题</span>
                  {plan.goal_met && <em className={styles.met}>已达成</em>}
                </div>
                <Link className={styles.action} to={`/review?plan=${plan.id}`} aria-label={`${action}「${plan.name}」`}>
                  <Button variant={plan.goal_met ? "secondary" : "primary"}>{action}</Button>
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
      <Link className={styles.textLink} to="/review">不按计划，自由刷题</Link>
    </section>
  );
}
