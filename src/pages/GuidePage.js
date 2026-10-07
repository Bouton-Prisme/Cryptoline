const GUIDE_SECTIONS = [
  {
    title: "Premiere visite",
    items: [
      "Commence par le Dashboard pour voir les prix, les tendances et l'etat global du marche crypto.",
      "Choisis un actif comme BTC, ETH ou SOL dans le selecteur pour adapter les graphiques et les informations.",
      "Ajoute les actifs que tu suis souvent a la watchlist pour les retrouver plus vite.",
    ],
  },
  {
    title: "Connecter son portefeuille",
    items: [
      "Va dans Comptes pour renseigner ton adresse wallet publique ou connecter ton wallet depuis le dashboard.",
      "Une fois connecte, CryptoLine peut afficher certains soldes disponibles sur les reseaux supportes.",
      "Tu peux aussi ajouter manuellement des positions conservees ailleurs, par exemple sur un exchange.",
    ],
  },
  {
    title: "Comprendre les cartes",
    items: [
      "La grande carte principale montre le prix, la variation et le graphique de l'actif selectionne.",
      "Le portefeuille resume la valeur estimee de tes positions et leur repartition.",
      "Les blocs de contexte marche donnent une lecture rapide du sentiment, de la dominance et de l'activite futures.",
    ],
  },
  {
    title: "Recevoir des alertes",
    items: [
      "Dans le panneau Alertes, choisis un actif puis active une condition simple comme un prix a atteindre.",
      "Tu peux combiner plusieurs signaux, par exemple prix, volume ou baisse depuis le dernier plus haut.",
      "Quand une condition est atteinte, le declenchement apparait dans les notifications in-app.",
    ],
  },
  {
    title: "DCA",
    items: [
      "Le DCA sert a investir progressivement un montant fixe au lieu d'acheter en une seule fois.",
      "Choisis l'actif, le montant, la frequence, la duree et la tolerance de slippage.",
      "Si tu executes un ordre, ton wallet te demandera toujours de confirmer avant toute transaction.",
    ],
  },
  {
    title: "Bonnes pratiques",
    items: [
      "Verifie toujours le reseau et le montant avant de signer une transaction dans ton wallet.",
      "Utilise les alertes comme aide a la decision, pas comme garantie de performance.",
      "Ne partage jamais ta phrase de recuperation, meme si une page ou un message te la demande.",
    ],
  },
];

const CHECKS = [
  { label: "1", value: "Choisir un actif" },
  { label: "2", value: "Connecter ou renseigner un wallet" },
  { label: "3", value: "Synchroniser ses positions" },
  { label: "4", value: "Creer une alerte simple" },
  { label: "5", value: "Lire les news et le contexte marche" },
  { label: "6", value: "Tester un plan DCA prudemment" },
];

export default function GuidePage() {
  return (
    <div className="guide-page">
      <section className="guide-header">
        <div>
          <p className="eyebrow">Mode d'emploi</p>
          <h2>Prendre en main CryptoLine</h2>
          <p>
            CryptoLine aide a suivre un portefeuille crypto, surveiller le marche,
            recevoir des alertes et preparer des achats progressifs. Cette page te
            guide sans jargon technique.
          </p>
        </div>
        <div className="guide-checks">
          {CHECKS.map((check) => (
            <div key={check.label} className="guide-check">
              <span>{check.label}</span>
              <strong>{check.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="guide-grid">
        {GUIDE_SECTIONS.map((section) => (
          <article key={section.title} className="card guide-card">
            <h3>{section.title}</h3>
            <div className="guide-steps">
              {section.items.map((item, index) => (
                <div key={item} className="guide-step">
                  <span>{index + 1}</span>
                  <p>{item}</p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      <article className="card guide-warning">
        <div>
          <p className="eyebrow">Securite</p>
          <h3>A retenir</h3>
        </div>
        <p>
          CryptoLine ne doit jamais te demander ta seed phrase ou ta cle privee.
          Une transaction reelle passe toujours par une confirmation visible dans
          ton wallet. Si un montant, un reseau ou une adresse ne te semble pas clair,
          ne signe pas.
        </p>
      </article>
    </div>
  );
}
