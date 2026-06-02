# MindBase — Agent Clinique en Santé Mentale

Un outil de recherche intelligent pour les praticiens français en santé mentale — psychiatres, psychologues, psychothérapeutes.

**👉 [mindbase-agent.vercel.app](https://mindbase-agent.vercel.app)**

---

## Pour les praticiens

**1. Créez votre espace**
Choisissez un nom d'utilisateur à la première visite (ex: `dr_martin`, `marie_psy`). Pas de mot de passe — ce nom suffit pour retrouver votre bibliothèque sur n'importe quel appareil.

**2. Posez une question naturellement**
MindBase analyse votre question et décide intelligemment quelles sources consulter :

| Question | Sources consultées |
|---|---|
| *"Protocoles TCC pour l'anxiété"* | Recommandations HAS/NICE + PubMed |
| *"Livres sur le TDAH adulte"* | Amazon.fr + Fnac uniquement |
| *"Comptes Instagram psychiatrie"* | Instagram uniquement |
| *"Forums pour patients anxieux"* | Reddit + Forums professionnels |
| *"Ressources complètes sur la dépression"* | Toutes les sources |

**3. Explorez les résultats**
Chaque réponse est structurée en sections selon le besoin : articles PubMed (cités et récents), recommandations officielles, livres, vidéos YouTube, Instagram, Reddit, forums professionnels, LinkedIn.

**4. Sauvegardez ce qui vous est utile**
Cliquez sur **🔖 Sauvegarder** pour ajouter une ressource à votre bibliothèque avec des tags et une note personnelle. Retrouvez tout dans **📚 Ma bibliothèque**.

**5. Téléchargez en PDF**
Cliquez sur **⬇️ PDF** sous n'importe quelle réponse pour l'enregistrer.

**6. Analysez des documents**
Cliquez sur **📎 Analyser PDFs & liens** pour importer un article ou une recommandation HAS — MindBase en extrait les points clés.

---

## Pour les développeurs

MindBase est un agent RAG (Retrieval-Augmented Generation) conçu pour un cas d'usage clinique réel. Construit et itéré entièrement via prompting avec Claude.

**Stack**
- **Frontend** — React 18, Vite, CSS-in-JS pur
- **Backend** — Vercel Serverless Functions (Node.js)
- **LLM** — Mistral AI (`mistral-small-latest`)
- **Recherche** — Brave Search API (web + vidéo), PubMed E-utilities API (gratuite)
- **Base de données** — Supabase (PostgreSQL) — bibliothèque personnelle + base de requêtes
- **Déploiement** — Vercel (frontend + API dans un seul repo)

**Architecture**
```
React (src/) → Vercel Serverless (api/)
                 ├── chat.js       Intent detection → searches ciblées → Mistral synthèse
                 ├── analyse.js    Analyse PDFs et URLs via Mistral
                 └── library.js    CRUD bibliothèque → Supabase
```

**Logique d'intent intelligente**
Chaque requête passe par une détection d'intent via Mistral avant de lancer les recherches. Seules les sources pertinentes sont interrogées — une question sur les livres ne déclenche que Amazon.fr/Fnac, une question sur les protocoles ne déclenche que HAS/NICE/Cochrane + PubMed. Cela réduit les appels API de ~70% sur les requêtes ciblées.

**Base de requêtes persistante**
Les résultats sont stockés dans Supabase après chaque recherche. Les requêtes identiques sont servies instantanément depuis la base (0 crédits Brave). Le contenu stable (guidelines, livres) est conservé 7 jours, le contenu dynamique (Reddit, Instagram) 24h.

**Points techniques notables**
- Pipeline multi-sources en parallèle (jusqu'à 9 sources simultanées)
- PubMed API directe avec filtre sur le type de publication (exclut obituaires, éditoriaux)
- Intent detection + génération de requêtes en un seul appel Mistral
- Fuzzy mapping des noms de sections pour robustesse
- Système d'identité sans authentification — nom d'utilisateur comme clé Supabase
- Export PDF via iframe caché (évite la perte d'état React)
- Reddit OAuth2 avec fallback Brave si identifiants non configurés

---

## Sources consultées

HAS · Ameli · ANSM · Inserm · OMS · PubMed · NICE · Cochrane · APA · YouTube · Instagram · Facebook · Reddit · Amazon.fr · Fnac · LinkedIn

---

*Outil d'aide à la décision clinique — ne remplace pas le jugement professionnel du praticien.*
