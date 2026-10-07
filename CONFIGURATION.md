# Configuration et verification

Les secrets restent dans `.env.local` (ignore par Git). Ne jamais mettre la cle
serveur Supabase dans une variable `REACT_APP_*`.

Renseigner les valeurs du projet Supabase actif :

- `SUPABASE_URL` et `REACT_APP_SUPABASE_URL` : la meme URL.
- `SUPABASE_SERVICE_ROLE_KEY` : cle serveur, reservee au backend.
- `REACT_APP_SUPABASE_ANON_KEY` : cle publique anon/publishable.
- `SECRET_ENCRYPTION_KEY` : secret serveur aleatoire pour les cles des exchanges.
- `ZEROX_API_KEY` : cle API 0x pour les devis.

Le schema attendu est dans `supabase/schema.sql`. Le script de controle verifie
l'acces aux tables sans ecrire de donnees. Si le domaine du projet est introuvable,
verifier dans Supabase que le projet existe et que son URL est correcte avant toute
modification de schema. Redemarrer le serveur et le frontend apres une modification
de `.env.local` ; reconstruire le frontend pour une mise en production.

```powershell
npm run check:config
npm run test:api
npm run build
npm start
```

`GET /api/health` verifie que le processus repond. `GET /api/ready` renvoie 503
si Supabase ou la configuration Auth est indisponible. Les autres routes privees
exigent un jeton Bearer valide ; un `user_id` seul ne donne aucun acces.
Les controles manuels d'alertes et de DCA sont limites a l'utilisateur connecte.
Les workers internes traitent les plans de tous les utilisateurs.

La liste des origines autorisees est dans `APP_ORIGINS`. En production, ajouter
l'origine HTTPS de l'interface et configurer un reverse proxy pour `/api` : le proxy
de React Scripts ne s'applique qu'au serveur de developpement.

## DCA

L'integration utilise l'API 0x v2 AllowanceHolder. Supprimer un ancien override
`ZEROX_QUOTE_ENDPOINT`, ou utiliser
`https://api.0x.org/swap/allowance-holder/quote`.
Les devis sont lies a l'utilisateur, verifies et expirent apres deux minutes.
Si une approbation du token prend trop longtemps, actualiser le devis avant de
reprendre. Une approbation attend sa confirmation avant la demande de swap.

Un plan prepare un ordre qui apparait dans « Ordres en attente de signature ».
Connecter le wallet indique puis utiliser « Actualiser et signer » : un nouveau
devis est demande avant la signature. Le worker ne compte l'occurrence qu'apres
enregistrement du statut `submitted`. Ce statut signifie transaction envoyee,
pas confirmation de son succes sur la blockchain. Aucun achat autonome n'est
effectue en arriere-plan. Les transactions ne sont jamais signees par le serveur.

Les tests utilisent des donnees et services simules ; ils ne passent aucun ordre.
La validation reelle de Supabase, de 0x et du wallet reste necessaire une fois les
identifiants configures.

References : [0x v2](https://docs.0x.org/docs/upgrading/upgrading-to-swap-v2),
[contrats AllowanceHolder](https://docs.0x.org/docs/core-concepts/contracts),
[Binance WebSocket](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams),
[Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser).
