# 🧠 MindBase — Agent Clinique en Santé Mentale

Un outil de recherche intelligent pour les praticiens français en santé mentale — psychiatres, psychologues, psychothérapeutes.

**👉 [mindbase-seven.vercel.app](https://mindbase-seven.vercel.app)**

---

## Pour les praticiens

**1. Créez votre espace**
Choisissez un nom d'utilisateur à la première visite (ex: `dr_martin`, `marie_psy`). Pas de mot de passe — ce nom suffit pour retrouver votre bibliothèque sur n'importe quel appareil.

**2. Posez une question**
Tapez n'importe quel sujet clinique :
- *Ressources complètes sur le TDAH adulte*
- *Protocoles TCC pour l'anxiété — recommandations HAS*
- *Recherches récentes sur la dépression résistante*

**3. Explorez les résultats**
Chaque réponse est structurée en sections : articles PubMed, recommandations officielles, livres, vidéos YouTube, Instagram, Reddit, forums professionnels.

**4. Sauvegardez ce qui vous est utile**
Cliquez sur **🔖 Sauvegarder** pour ajouter une ressource à votre bibliothèque avec des tags et une note personnelle. Retrouvez tout dans **📚 Ma bibliothèque**.

**5. Téléchargez en PDF**
Cliquez sur **⬇️ PDF** sous n'importe quelle réponse pour l'enregistrer.

**6. Analysez des documents**
Cliquez sur **📎 Analyser PDFs & liens** pour importer un article ou une recommandation HAS — MindBase en extrait les points clés.

---

## Pour les développeurs

MindBase est un agent RAG (Retrieval-Augmented Generation) conçu pour un cas d'usage clinique réel avec ~500 utilisateurs cibles. Construit et itéré entièrement via prompting avec Claude.

**Stack**
- **Frontend** — React 18, Vite, CSS-in-JS pur (pas de framework UI)
- **Backend** — Vercel Serverless Functions (Node.js)
- **LLM** — Mistral AI (`mistral-small-latest`) pour la génération de requêtes et la synthèse
- **Recherche** — Brave Search API (web + vidéo), PubMed E-utilities API (gratuite, sans clé)
- **Base de données** — Supabase (PostgreSQL) pour la bibliothèque personnelle
- **Déploiement** — Vercel (frontend + API dans un seul repo)

**Architecture**
```
React (src/) → Vercel Serverless (api/)
                 ├── chat.js       Mistral génère des requêtes ciblées → Brave Search
                 ├── analyse.js    Analyse PDFs et URLs via Mistral
                 └── library.js    CRUD bibliothèque → Supabase
```

**Points techniques notables**
- Pipeline de recherche multi-sources en parallèle (10+ sources simultanées)
- PubMed API directe avec filtre sur le type de publication (exclut obituaires, éditoriaux)
- Système d'identité sans authentification — nom d'utilisateur comme clé Supabase
- Export PDF via iframe caché (évite la perte d'état React)
- Reddit OAuth2 avec fallback Brave si identifiants non configurés

---

## Sources consultées

HAS · ANSM · Inserm · OMS · PubMed · NICE · Cochrane · APA · YouTube · Instagram · Facebook · Reddit · Amazon.fr · Fnac · LinkedIn

---

*Outil d'aide à la décision clinique — ne remplace pas le jugement professionnel du praticien.*
