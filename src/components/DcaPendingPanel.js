import { getSubmittedTransaction, rememberTransaction } from "../lib/submittedTransactions";
import { useCallback, useEffect, useState } from "react";

export default function DcaPendingPanel({ authToken, walletAccount, sendSwapQuote, refreshWallet, refreshTick }) {
  const [orders, setOrders] = useState([]);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState("");
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(value => value + 1), []);

  useEffect(() => {
    setOrders([]);
    setMessage("");
    if (!authToken) return undefined;
    const controller = new AbortController();
    fetch("/api/dca-executions", { headers: { Authorization: `Bearer ${authToken}` }, signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Chargement des ordres en attente impossible.");
        const payload = await response.json();
        if (!controller.signal.aborted) setOrders(payload);
      })
      .catch(error => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, [authToken, tick, refreshTick]);

  async function processOrder(order, cancel = false) {
    setBusy(order.id);
    setMessage("");
    let txHash = getSubmittedTransaction(order.id);
    try {
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` };
      if (!cancel && !txHash) {
        const response = await fetch(`/api/dca-executions/${encodeURIComponent(order.id)}/quote`, { method: "POST", headers });
        const quote = await response.json();
        if (!response.ok) throw new Error(quote.error || "Actualisation du devis impossible.");
        txHash = await sendSwapQuote(quote);
        rememberTransaction(order.id, txHash);
      }
      const response = await fetch(`/api/dca-executions/${encodeURIComponent(order.id)}`, {
        method: "PATCH", headers,
        body: JSON.stringify(cancel && !txHash ? { status: "cancelled" } : { status: "submitted", tx_hash: txHash }),
      });
      if (!response.ok) throw new Error("Enregistrement du statut impossible.");
      setOrders(current => current.filter(item => item.id !== order.id));
      setMessage(cancel ? "Ordre annule. Le plan pourra proposer une nouvelle tentative." : `Transaction envoyee : ${txHash}`);
      if (!cancel) refreshWallet();
    } catch (error) {
      setMessage(txHash ? `Transaction envoyee : ${txHash}. Statut non synchronise ; ne la renvoie pas.` : error.message);
      if (txHash) setOrders(current => current.filter(item => item.id !== order.id));
    } finally {
      setBusy(null);
    }
  }

  if (!authToken) return null;
  return <div className="dca-section">
    <h4>Ordres en attente de signature</h4>
    <button type="button" className="ghost" disabled={Boolean(busy)} onClick={refresh}>Actualiser les ordres</button>
    {orders.length === 0 && <p className="helper-text">Aucun ordre en attente. Les plans sont prepares par le serveur toutes les cinq minutes.</p>}
    {orders.map(order => <div key={order.id} className="dca-summary">
      <strong>{order.metadata?.targetSymbol || order.metadata?.buyToken || "Achat"}</strong>
      <p className="helper-text">Wallet : {order.account}</p>
      <button type="button" className="primary-action"
        disabled={Boolean(busy) || (!getSubmittedTransaction(order.id) && (!walletAccount || walletAccount.toLowerCase() !== order.account.toLowerCase()))}
        onClick={() => processOrder(order)}>{busy === order.id ? "En cours..." : (getSubmittedTransaction(order.id) ? "Synchroniser la transaction envoyee" : "Actualiser et signer")}</button>
      <button type="button" className="ghost" disabled={Boolean(busy) || Boolean(getSubmittedTransaction(order.id))} onClick={() => processOrder(order, true)}>Annuler cet ordre</button>
    </div>)}
    {message && <p className="info-text" role="status">{message}</p>}
  </div>;
}
