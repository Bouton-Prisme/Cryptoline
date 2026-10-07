import { formatMoney } from "../utils/formatters";

export default function PortfolioCard({
  totalValue,
  sentiment,
  allocation,
  holdings,
}) {
  const visibleAllocation = allocation.filter((item) => item.value > 0);
  const zeroAllocation = allocation.filter((item) => item.value <= 0);

  return (
    <article className="card stats-panel portfolio-panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">Portefeuille</p>
          <h3>{formatMoney(totalValue)}</h3>
          <p className="sentiment">{sentiment}</p>
        </div>
      </div>

      <div className="portfolio-donut" aria-hidden="true">
        <div className="donut-ring" />
        <div>
          <small>Répartition active</small>
          <strong>{visibleAllocation.length}</strong>
        </div>
      </div>

      <div className="allocation-list detailed">
        {visibleAllocation.map((item) => {
          const amount = Number(holdings[item.symbol] || 0);
          return (
            <div key={item.symbol} className="allocation-row">
              <strong>{item.symbol}</strong>
              <span>{amount.toLocaleString("fr-FR", { maximumFractionDigits: 4 })}</span>
              <span>{formatMoney(item.value)}</span>
              <span>{item.pct.toFixed(1)}%</span>
              <div className="bar">
                <div style={{ width: `${Math.min(100, item.pct)}%` }} />
              </div>
            </div>
          );
        })}
        {visibleAllocation.length === 0 && (
          <p className="empty">Synchronise des actifs pour visualiser l’allocation.</p>
        )}
      </div>

      {zeroAllocation.length > 0 && (
        <details className="zero-assets">
          <summary>{zeroAllocation.length} actifs à zéro</summary>
          <div className="zero-assets-list">
            {zeroAllocation.map((item) => (
              <span key={item.symbol}>{item.symbol}</span>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}
