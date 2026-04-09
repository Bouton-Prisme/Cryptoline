import { formatPct } from "../utils/formatters";

export default function WatchlistPanel({ watchlist, coins, onSelect }) {
  const watchlistCoins = coins.filter((item) => watchlist.includes(item.symbol));

  return (
    <article className="card watchlist-panel">
      <p className="eyebrow">Watchlist rapide</p>
      <div className="watchlist-grid">
        {watchlistCoins.map((item) => (
          <button key={item.symbol} type="button" onClick={() => onSelect(item.symbol)}>
            <span>{item.symbol}</span>
            <strong className={item.change24h >= 0 ? "up" : "down"}>{formatPct(item.change24h)}</strong>
          </button>
        ))}
        {watchlistCoins.length === 0 && (
          <p className="empty">Ajoute des actifs dans la watchlist pour les retrouver ici.</p>
        )}
      </div>
    </article>
  );
}
