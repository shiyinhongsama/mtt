import { Link } from "react-router-dom";
import type { TodayStats } from "../../api/types";
import styles from "./LoadForecast.module.css";

export default function LoadForecast({ forecast }: { forecast: TodayStats["forecast"] }) {
  const maximum = Math.max(1, ...forecast.map((day) => day.count));
  return (
    <section className={styles.section} aria-labelledby="forecast-title">
      <div className={styles.heading}><h2 id="forecast-title">未来 7 天</h2><span>按到期日分布</span></div>
      <div className={styles.days}>
        {forecast.map((day, index) => {
          const date = new Date(`${day.date}T12:00:00`);
          return (
            <Link key={day.date} to={`/library?due=${day.date}`} className={styles.day} aria-label={`${day.date}，${day.count} 题`}>
              <span className={styles.bar}><i style={{ height: `${Math.max(4, day.count / maximum * 100)}%` }} /></span>
              <b>{day.count}</b>
              <small>{index === 0 ? "今天" : `${date.getMonth() + 1}/${date.getDate()}`}</small>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
