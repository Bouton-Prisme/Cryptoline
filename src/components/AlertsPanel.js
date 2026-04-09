export default function AlertsPanel({
  alerts,
  alertsError,
  isAlertsSyncing,
  refreshAlerts,
  alertName,
  setAlertName,
  alertSymbol,
  setAlertSymbol,
  selectionUniverse,
  alertNote,
  setAlertNote,
  alertChannel,
  setAlertChannel,
  conditionDefinitions,
  conditionState,
  toggleCondition,
  updateConditionValue,
  canSubmitAlert,
  isSubmittingAlert,
  handleCreateAlert,
  handleDeleteAlert,
  formatConditionPreview,
}) {
  return (
    <article className="card">
      <div className="alert-head">
        <div>
          <p className="eyebrow">Alertes intelligentes</p>
          <p className="helper-text">Multi-conditions et webhooks traites par Supabase/Next API.</p>
        </div>
        <div className="alert-head-actions">
          {alertsError && (
            <span className="badge badge-danger" title={alertsError.message}>
              API alertes
            </span>
          )}
          {isAlertsSyncing && <span className="badge badge-muted">Sync backend...</span>}
          <button type="button" className="ghost" onClick={refreshAlerts} disabled={isAlertsSyncing}>
            Sync API
          </button>
        </div>
      </div>

      <div className="alert-form">
        <label className="field-block">
          <span>Nom</span>
          <input
            type="text"
            value={alertName}
            onChange={(e) => setAlertName(e.target.value)}
            placeholder="Breakout BTC"
          />
        </label>
        <label className="field-block">
          <span>Actif</span>
          <select value={alertSymbol} onChange={(e) => setAlertSymbol(e.target.value)}>
            {selectionUniverse.map((item) => (
              <option key={item.symbol} value={item.symbol}>
                {item.symbol} - {item.name || item.symbol}
              </option>
            ))}
          </select>
        </label>
        <label className="field-block">
          <span>Note</span>
          <input
            type="text"
            value={alertNote}
            onChange={(e) => setAlertNote(e.target.value)}
            placeholder="Lien doc / scenario"
          />
        </label>
        <div className="field-block">
          <span>Canal</span>
          <div className="channel-switch">
            <button type="button" className={alertChannel === "push" ? "active" : ""} onClick={() => setAlertChannel("push")}>
              Push
            </button>
            <button type="button" className={alertChannel === "email" ? "active" : ""} onClick={() => setAlertChannel("email")}>
              Email
            </button>
          </div>
        </div>
      </div>

      <div className="condition-grid">
        {conditionDefinitions.map((definition) => {
          const state = conditionState[definition.key] || {};
          return (
            <div key={definition.key} className={`condition-card ${state.enabled ? "active" : ""}`}>
              <div className="condition-card-head">
                <div>
                  <strong>{definition.label}</strong>
                  <p>{definition.description}</p>
                </div>
                <button
                  type="button"
                  className={`condition-toggle ${state.enabled ? "active" : ""}`}
                  onClick={() => toggleCondition(definition.key)}
                >
                  {state.enabled ? "Actif" : "Off"}
                </button>
              </div>
              <div className="condition-input">
                <input
                  type="number"
                  min={definition.min ?? undefined}
                  step={definition.step ?? "any"}
                  value={state.value}
                  onChange={(e) => updateConditionValue(definition.key, e.target.value)}
                  placeholder={definition.placeholder}
                />
                <span>{definition.unit}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="alert-form-actions">
        <button type="button" onClick={handleCreateAlert} disabled={!canSubmitAlert}>
          {isSubmittingAlert ? "Programmation..." : "Programmer l'alerte"}
        </button>
        <small>Persiste dans Supabase / Next API + declenchement webhook serveur.</small>
      </div>

      <div className="alerts-list advanced">
        {alerts?.length === 0 && <p className="empty">Aucune alerte active. Programme ton premier trigger.</p>}
        {alerts?.map((alert) => {
          const alertConditions = Array.isArray(alert.conditions) ? alert.conditions : [];
          const lastTrigger =
            alert.last_triggered_at ||
            alert.lastTriggeredAt ||
            alert.lastTriggerAt ||
            alert.last_triggered ||
            null;
          const channelLabel = alert.channel === "email" ? "EMAIL" : "PUSH";
          return (
            <div key={alert.id || alert.label} className="alert-item">
              <div className="alert-item-head">
                <div>
                  <strong>{alert.label || `${alert.symbol} alert`}</strong>
                  <p>
                    {alert.symbol} · {channelLabel} · {alert.status || "Actif"}
                  </p>
                </div>
                <span className={`badge ${alert.channel === "email" ? "badge-muted" : "badge-success"}`}>{channelLabel}</span>
              </div>
              <div className="condition-chips">
                {alertConditions.length === 0 && <span className="condition-chip muted">Conditions non fournies</span>}
                {alertConditions.map((condition, index) => (
                  <span key={`${alert.id || alert.label}-${condition.type}-${index}`} className="condition-chip">
                    {formatConditionPreview(condition)}
                  </span>
                ))}
              </div>
              <div className="alert-item-footer">
                <small>
                  Dernier trigger:{" "}
                  {lastTrigger
                    ? new Date(lastTrigger).toLocaleString("fr-FR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        day: "2-digit",
                        month: "short",
                      })
                    : "Jamais"}
                </small>
                <div className="alert-actions">
                  <button type="button" className="ghost" onClick={() => handleDeleteAlert(alert.id)}>
                    Supprimer
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}
