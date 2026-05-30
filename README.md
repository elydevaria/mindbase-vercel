# MindBase — Déploiement Vercel (tout-en-un)
**Coût : €0** · **Temps : 20 minutes** · **Un seul service : Vercel**

---

## Architecture

```
Praticiens  →  Vercel (frontend React + API serverless)
                  ├── /api/chat.js       → Mistral AI
                  ├── /api/analyse.js    → Mistral AI + fetch URLs
                  └── /api/library.js    → Supabase (bibliothèque)
```

Tout est dans un seul projet Vercel. Pas de Railway, pas de serveur séparé.

---

## Étape 1 — Clé Mistral (5 min)

1. → **https://console.mistral.ai**
2. Créez un compte gratuit (pas de carte bancaire)
3. **API Keys** → **Create new key**
4. Copiez la clé (commence par plusieurs caractères alphanumériques)

---

## Étape 2 — Base de données Supabase (5 min)

1. → **https://supabase.com** → **Start for free**
2. Créez un nouveau projet — choisissez région **West EU**
3. Attendez ~2 min que le projet démarre
4. Allez dans **SQL Editor** → collez le contenu de `supabase-schema.sql` → **Run**
5. Allez dans **Settings → API**, copiez :
   - **Project URL** : `https://xxxx.supabase.co`
   - **anon / public key** : `eyJ...`

---

## Étape 3 — Déployer sur Vercel (10 min)

### Option A — Via GitHub (recommandé)

1. Créez un compte sur **https://github.com** si vous n'en avez pas
2. Créez un nouveau repository (bouton **+** → New repository)
3. Uploadez tous les fichiers de ce dossier dans le repository
4. Allez sur **https://vercel.com** → connectez-vous avec GitHub
5. **Add New Project** → importez votre repository
6. Avant de cliquer Deploy, ajoutez les **Environment Variables** :

   | Nom | Valeur |
   |-----|--------|
   | `MISTRAL_API_KEY` | votre clé Mistral |
   | `SUPABASE_URL` | `https://xxxx.supabase.co` |
   | `SUPABASE_ANON_KEY` | `eyJ...` |

7. Cliquez **Deploy** → attendez 2 minutes

### Option B — Via Vercel CLI

```bash
# Installez Vercel CLI
npm install -g vercel

# Dans ce dossier
npm install
vercel

# Suivez les instructions, puis ajoutez les variables :
vercel env add MISTRAL_API_KEY
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY

# Redéployez
vercel --prod
```

---

## Résultat

Vercel vous donne une URL du type :
**`https://mindbase-xxxx.vercel.app`**

Partagez cette URL avec vos praticiens. C'est tout.

---

## Tester que tout fonctionne

- [ ] Posez une question → réponse Mistral en français ✓
- [ ] Cliquez 🔖 Sauvegarder → apparaît dans la bibliothèque ✓
- [ ] Ajoutez un lien URL → contenu analysé ✓
- [ ] Rechargez la page → bibliothèque toujours là ✓

---

## Limites gratuites

| Service | Limite gratuite | Pour 500 users/mois |
|---------|----------------|---------------------|
| Vercel | 100GB bandwidth, fonctions illimitées | ✅ Largement suffisant |
| Mistral | 500K tokens/jour, 1 req/sec | ✅ Suffisant si non-simultané |
| Supabase | 50 000 lignes, 500MB | ✅ Suffisant |

---

## Si vous dépassez les limites

Uniquement Mistral risque d'être limité si beaucoup d'utilisateurs simultanés.
Solution : passez au plan pay-as-you-go Mistral → environ **€5–10/mois** pour 500 users.
Vercel et Supabase restent gratuits à ce volume.

---

## Structure des fichiers

```
mindbase-vercel/
├── api/
│   ├── chat.js          ← appelle Mistral pour le chat
│   ├── analyse.js       ← récupère les URLs + analyse avec Mistral
│   └── library.js       ← sauvegarde/récupère la bibliothèque (Supabase)
├── src/
│   ├── App.jsx          ← toute l'interface React
│   └── main.jsx         ← point d'entrée React
├── index.html
├── vite.config.js
├── vercel.json
├── package.json
├── supabase-schema.sql  ← à coller dans Supabase une seule fois
└── .env.example         ← vos clés (ne jamais committer avec les vraies valeurs)
```
