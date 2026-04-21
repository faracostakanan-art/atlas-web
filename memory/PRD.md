# ATLAS Bot — PRD

## Problem statement (original, FR)
> Voici le code de mon bot Telegram. Ce que je veux rajouter, c'est un système de paiement automatique via les adresses crypto. Pour chaque transaction, une adresse crypto différente. Tout est versé sur un seul wallet.

## User choices
- Repo: https://github.com/faracostakanan-art/ATLAS-bot (Node.js `node-telegram-bot-api`)
- Cryptos supportées: BTC, ETH, SOL (remplace l'ancien USDC)
- Approche: **Option A** — passerelle NOWPayments (adresse unique par transaction, forwardée automatiquement vers le wallet final configuré dans le dashboard NOWPayments)

## Architecture
- `bot.js` : bot Telegram (polling) + serveur Express pour le webhook NOWPayments (même process)
- `payment.js` : wrapper NOWPayments API (createPayment, getPaymentStatus)
- IPN vérifié par HMAC-SHA512 (timing-safe) via `NOWPAYMENTS_IPN_SECRET`
- Crédit balance via POST vers `{API_URL}/api/user/:user_id/credit`

## Fichiers livrés (/app/bot)
- `bot.js` — bot + webhook + notification user Telegram après crédit
- `payment.js` — wrapper NOWPayments (prod + sandbox)
- `package.json` — dépendances : express, axios, dotenv, node-telegram-bot-api
- `.env.example` — template des variables
- `.gitignore`
- `README.md` — setup complet, déploiement Railway, test sandbox

## Implémentation ✅ (Jan 2026)
- Remplacement USDC → SOL dans le menu et la logique
- Génération d'une adresse crypto **unique par transaction** via NOWPayments `/v1/payment`
- L'utilisateur saisit maintenant un montant en **EUR** (plus pertinent), NOWPayments calcule la conversion crypto
- Webhook IPN Express `/webhook/nowpayments` avec vérif HMAC-SHA512
- Crédit automatique de la balance sur status `confirmed` / `finished`
- Idempotence par `payment_id` (in-memory) + dédoublonnage recommandé côté backend
- Notification Telegram à l'utilisateur après crédit
- Health check `/health`
- Support mode **sandbox** via `NOWPAYMENTS_SANDBOX=true`

## Action items utilisateur (indispensables avant la prod)
1. Créer compte NOWPayments, ajouter les 3 wallets finaux (BTC/ETH/SOL) dans Store Settings
2. Générer `NOWPAYMENTS_API_KEY` et `NOWPAYMENTS_IPN_SECRET` dans le dashboard
3. Pousser `/app/bot` sur GitHub (repo ATLAS-bot) et déployer sur Railway
4. Définir les variables d'env Railway, puis renseigner `WEBHOOK_URL` = `https://<app>.up.railway.app/webhook/nowpayments`
5. **Backend Felina** : implémenter `POST /api/user/:id/credit` qui ajoute `amount` à la balance (avec dédoublonnage sur `payment_id`)

## Backlog / P1
- Stocker les paiements en DB (MongoDB/SQLite) au lieu de `processedPayments` en mémoire
- Commande `/status <payment_id>` pour vérifier un paiement
- Logs structurés + monitoring Sentry
- Limite anti-spam sur la recharge (rate limit par user)
- Support USDT-TRC20 / USDT-ERC20 si volume

## Test local
```bash
cd /app/bot
cp .env.example .env   # remplir BOT_TOKEN, NOWPAYMENTS_API_KEY, IPN_SECRET, WEBHOOK_URL (ngrok)
npm install
npm start
```
Exposer localement : `ngrok http 3000` → copier l'URL HTTPS dans `WEBHOOK_URL`.
