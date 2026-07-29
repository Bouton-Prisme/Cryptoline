export default function AlertsPanel({
  alerts,
  alertEvents,
  alertsError,
  isAlertsSyncing,
  refreshAlerts,
  runAlertCheck,
  alertName,
  setAlertName,
  alertSymbol,
  setAlertSymbol,
  selectionUniverse,
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
    <article className="card alerts-panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">Alertes</p>
          <h3>Créer une alerte</h3>
        </div>
      </div>

      <div className="alert-form simplified">
        <label className="field-block">
          <span>Actif surveillé</span>
          <select value={alertSymbol} onChange={(e) => setAlertSymbol(e.target.value)}>
            {selectionUniverse.map((item) => (
              <option key={item.symbol} value={item.symbol}>
                {item.symbol} - {item.name || item.symbol}
              </option>
            ))}
          </select>
        </label>

        <div className="field-block alert-condition-block">
          <span>Type d’alerte, condition et seuil</span>
          <div className="condition-list">
            {conditionDefinitions.map((definition) => {
              const state = conditionState[definition.key] || {};
              return (
                <div key={definition.key} className="condition-line">
                  <label className="condition-choice">
                    <input
                      type="checkbox"
                      checked={Boolean(state.enabled)}
                      onChange={() => toggleCondition(definition.key)}
                    />
                    <span>
                      <strong>{definition.label}</strong>
                      <small>{definition.description}</small>
                    </span>
                  </label>
                  {state.enabled && (
                    <div className="condition-threshold">
                      <input
                        type="number"
                        min={definition.min ?? undefined}
                        step={definition.step ?? "any"}
                        value={state.value}
                        onChange={(e) =>
                          updateConditionValue(definition.key, e.target.value)
                        }
                        placeholder={definition.placeholder}
                      />
                      <span>{definition.unit}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="field-block">
          <span>Canal</span>
          <div className="channel-switch">
            <button
              type="button"
              className={alertChannel === "push" ? "active" : ""}
              onClick={() => setAlertChannel("push")}
            >
              Push
            </button>
            <button
              type="button"
              className={alertChannel === "email" ? "active" : ""}
              onClick={() => setAlertChannel("email")}
            >
              Email
            </button>
          </div>
        </div>

        <label className="field-block">
          <span>Nom facultatif</span>
          <input
            type="text"
            value={alertName}
            onChange={(e) => setAlertName(e.target.value)}
            placeholder="Breakout BTC"
          />
        </label>

        <div className="alert-form-actions">
          <button
            type="button"
            className="primary-action"
            onClick={handleCreateAlert}
            disabled={!canSubmitAlert}
          >
            {isSubmittingAlert ? "Création..." : "Créer l’alerte"}
          </button>
        </div>
      </div>

      <details className="technical-details">
        <summary>Zone technique</summary>
        <div className="technical-row">
          <span>Supabase / Next API</span>
          {alertsError && (
            <span className="badge badge-danger" title={alertsError.message}>
              API alertes
            </span>
          )}
          {isAlertsSyncing && <span className="badge badge-muted">Sync...</span>}
          <button
            type="button"
            className="ghost"
            onClick={refreshAlerts}
            disabled={isAlertsSyncing}
          >
            Sync API
          </button>
          <button
            type="button"
            className="ghost"
            onClick={runAlertCheck}
            disabled={isAlertsSyncing}
          >
            Verifier maintenant
          </button>
        </div>
      </details>

      <div className="alerts-list simplified">
        <h4>Alertes existantes</h4>
        {alerts?.length === 0 && (
          <p className="empty">Aucune alerte active.</p>
        )}
        {alerts?.map((alert) => {
          const alertConditions = Array.isArray(alert.conditions)
            ? alert.conditions
            : [];
          const lastTrigger =
            alert.last_triggered_at ||
            alert.lastTriggeredAt ||
            alert.lastTriggerAt ||
            alert.last_triggered ||
            null;
          const channelLabel = alert.channel === "email" ? "Email" : "Push";
          return (
            <div key={alert.id || alert.label} className="alert-item">
              <div>
                <strong>{alert.label || `${alert.symbol} alert`}</strong>
                <p>
                  {alert.symbol} / {channelLabel} / {alert.status || "Actif"}
                </p>
              </div>
              <div className="condition-chips">
                {alertConditions.length === 0 && (
                  <span className="condition-chip muted">Conditions non fournies</span>
                )}
                {alertConditions.map((condition, index) => (
                  <span
                    key={`${alert.id || alert.label}-${condition.type}-${index}`}
                    className="condition-chip"
                  >
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
                <button
                  type="button"
                  className="ghost"
                  onClick={() => handleDeleteAlert(alert.id)}
                >
                  Supprimer
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="alerts-list simplified">
        <h4>Notifications in-app</h4>
        {alertEvents?.length === 0 && (
          <p className="empty">Aucun declenchement enregistre.</p>
        )}
        {alertEvents?.slice(0, 5).map((event) => (
          <div key={event.id} className="alert-item">
            <div>
              <strong>{event.label || `${event.symbol} alert`}</strong>
              <p>
                {event.symbol} / {event.status || "triggered"} /{" "}
                {event.created_at
                  ? new Date(event.created_at).toLocaleString("fr-FR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "2-digit",
                      month: "short",
                    })
                  : "Date inconnue"}
              </p>
            </div>
            <div className="condition-chips">
              {(Array.isArray(event.conditions) ? event.conditions : []).map(
                (condition, index) => (
                  <span
                    key={`${event.id}-${condition.type}-${index}`}
                    className="condition-chip"
                  >
                    {formatConditionPreview(condition)}
                  </span>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
