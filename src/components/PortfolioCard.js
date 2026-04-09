import { formatMoney } from "../utils/formatters";

export default function PortfolioCard({ totalValue, sentiment, allocation, holdings }) {
  return (
    <article className="card stats-panel portfolio-panel">
      <p className="eyebrow">Allocation portefeuille</p>
      <h3>{formatMoney(totalValue)}</h3>
      <p className="sentiment">{sentiment}</p>

      <div className="allocation-list">
        {allocation.map((item) => (
          <div key={item.symbol}>
            <div className="row">
              <span>
                {item.symbol} ({(holdings[item.symbol] || 0).toLocaleString("fr-FR")})
              </span>
              <span>{item.pct.toFixed(1)}%</span>
            </div>
            <div className="bar">
              <div style={{ width: `${item.pct}%` }} />
            </div>
          </div>
        ))}
        {allocation.length === 0 && (
          <p className="empty">Synchronise des actifs pour visualiser l'allocation.</p>
        )}
      </div>
    </article>
  );
}
