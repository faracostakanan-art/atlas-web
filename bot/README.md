# ATLAS Bot — Telegram + NOWPayments

Bot Telegram ATLAS LOG avec système de recharge crypto **automatique** via [NOWPayments](https://nowpayments.io).

## Fonctionnalités

- 🏪 Accès boutique (WebApp)
- 💰 Consultation balance
- 💳 Recharge crypto avec **adresse unique par transaction** (BTC / ETH / SOL)
- 🔁 Tous les paiements sont forwardés automatiquement vers tes wallets principaux (configurés dans le dashboard NOWPayments)
- 🔒 Webhook IPN sécurisé par signature HMAC-SHA512
- ✅ Crédit automatique de la balance utilisateur après confirmation blockchain
- 📩 Notification Telegram à l'utilisateur après crédit

## Architecture

```
User /recharger → Bot → NOWPayments API → Adresse unique
                                            ↓
                                      User envoie crypto
                                            ↓
                             Blockchain confirme la tx
                                            ↓
                    NOWPayments → IPN webhook (HMAC) → Bot
                                            ↓
                          POST /api/user/:id/credit → Backend Felina
                                            ↓
                             Bot notifie l'utilisateur
```

## Setup

### 1. Récupérer les clés NOWPayments

1. Créer un compte sur https://account.nowpayments.io
2. **Store Settings** → ajouter tes adresses wallet finales pour BTC, ETH, SOL (là où tous les paiements seront forwardés)
3. **Settings → API Keys** → générer une `NOWPAYMENTS_API_KEY`
4. **Settings → Payments Settings** → générer un `NOWPAYMENTS_IPN_SECRET`

### 2. Variables d'environnement

Copier `.env.example` vers `.env` et remplir :

| Variable | Description |
|---|---|
| `BOT_TOKEN` | Token du bot Telegram (@BotFather) |
| `API_URL` | URL du backend Felina |
| `NOWPAYMENTS_API_KEY` | Clé API NOWPayments |
| `NOWPAYMENTS_IPN_SECRET` | Secret IPN pour vérifier les webhooks |
| `NOWPAYMENTS_SANDBOX` | `true` pour tester, `false` en prod |
| `WEBHOOK_URL` | URL HTTPS publique du bot + `/webhook/nowpayments` |
| `PORT` | Port Express (3000 par défaut) |

### 3. Installer & lancer

```bash
npm install
npm start
```

Le bot écoute Telegram en polling **et** expose le webhook Express sur le même processus.

### 4. Déploiement Railway

1. Push sur GitHub
2. Créer un service Railway depuis le repo
3. Définir les variables d'env ci-dessus dans l'onglet **Variables**
4. Récupérer l'URL publique générée par Railway et la mettre dans `WEBHOOK_URL` (sous la forme `https://<app>.up.railway.app/webhook/nowpayments`)
5. Redéployer

### 5. Backend Felina — endpoint à implémenter

Le webhook POST vers ton backend :

```
POST {API_URL}/api/user/:user_id/credit
Content-Type: application/json

{
  "amount": 50,
  "currency": "eur",
  "payment_id": "5745459419",
  "pay_currency": "btc",
  "pay_amount": 0.0005,
  "order_id": "USER_1234567_1700000000000",
  "source": "nowpayments"
}
```

Ton backend doit ajouter `amount` (EUR) à la balance de l'utilisateur `user_id`. Pense à dédoublonner sur `payment_id` côté backend pour la sécurité.

## Test en sandbox

1. `NOWPAYMENTS_SANDBOX=true`
2. Créer une clé API sandbox sur https://account-sandbox.nowpayments.io
3. Utiliser https://ngrok.com pour exposer ton bot local et mettre l'URL ngrok dans `WEBHOOK_URL`
4. Lancer un test de paiement depuis Telegram
5. Forcer le statut `finished` depuis le dashboard sandbox pour déclencher l'IPN

## Sécurité

- ✅ Signature HMAC-SHA512 vérifiée sur chaque IPN (timing-safe)
- ✅ Idempotence par `payment_id`
- ✅ Crédit uniquement sur status `confirmed` / `finished`
- ✅ Aucune clé hardcodée — tout via `.env`
