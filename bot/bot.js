require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const { createPayment, IS_SANDBOX } = require('./payment');

// ---------- ENV ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
const API_URL = process.env.API_URL || 'https://felina-backend-production.up.railway.app';
const WEBHOOK_URL = process.env.WEBHOOK_URL; // ex: https://atlas-bot.up.railway.app/webhook/nowpayments
const IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET;
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN manquant dans .env');
  process.exit(1);
}

// ---------- BOT ----------
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Suivi utilisateurs: { chatId: { crypto, step: 'awaiting_amount' } }
const pendingRecharge = {};

// Menu principal
const mainMenu = {
  keyboard: [
    ['🏪 Ouvrir la boutique', '💰 Balance'],
    ['💳 Recharger', '📞 Support'],
  ],
  resize_keyboard: true,
};

// Menu cryptos
const cryptoMenu = {
  keyboard: [
    ['BTC', 'ETH'],
    ['SOL', '⬅️ Retour'],
  ],
  resize_keyboard: true,
};

async function getUserBalance(userId) {
  const res = await axios.get(`${API_URL}/api/user/${userId}`);
  return res.data.balance || 0;
}

// ---------- /start ----------
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    '👋 Bienvenue sur ATLAS LOG !\n🔒 Connexion sécurisée activée.\n\nSélectionnez une option :',
    { reply_markup: mainMenu }
  );
});

// ---------- Messages ----------
bot.on('message', async (msg) => {
  if (!msg.text) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Étape: l'utilisateur a déjà choisi la crypto et doit maintenant entrer le montant en EUR
  if (pendingRecharge[chatId] && pendingRecharge[chatId].step === 'awaiting_amount') {
    const cryptoChoice = pendingRecharge[chatId].crypto;
    const montantEur = parseFloat(msg.text.replace(',', '.'));

    if (isNaN(montantEur) || montantEur <= 0) {
      bot.sendMessage(chatId, '❌ Montant invalide. Merci de saisir un nombre en EUR (ex: 50).');
      return;
    }

    // Création du paiement via NOWPayments (adresse unique par transaction)
    const orderId = `USER_${userId}_${Date.now()}`;
    await bot.sendMessage(chatId, '⏳ Génération de ton adresse de paiement...');

    const payment = await createPayment({
      priceAmount: montantEur,
      priceCurrency: 'EUR',
      crypto: cryptoChoice,
      orderId,
      orderDescription: `Recharge ATLAS - user ${userId}`,
      ipnCallbackUrl: WEBHOOK_URL,
    });

    delete pendingRecharge[chatId];

    if (!payment.success) {
      bot.sendMessage(
        chatId,
        `❌ Erreur lors de la création du paiement :\n${payment.error}\n\nRéessaie plus tard ou contacte le support.`,
        { reply_markup: mainMenu }
      );
      return;
    }

    const expires = payment.expiration_estimate_date
      ? new Date(payment.expiration_estimate_date).toLocaleString('fr-FR')
      : 'quelques minutes';

    const modeTag = IS_SANDBOX ? '\n🧪 _Mode TEST (sandbox)_' : '';

    await bot.sendMessage(
      chatId,
      `💸 *Paiement ${cryptoChoice}*\n\n` +
        `Envoie exactement :\n*${payment.pay_amount} ${payment.pay_currency.toUpperCase()}*\n\n` +
        `À l'adresse unique ci-dessous :\n\`${payment.pay_address}\`\n\n` +
        `💶 Montant crédité : *${payment.price_amount} ${payment.price_currency.toUpperCase()}*\n` +
        `🆔 Payment ID : \`${payment.payment_id}\`\n` +
        `⏱ Expire le : ${expires}\n\n` +
        `⚠️ Cette adresse est *unique et temporaire*. Ta balance sera créditée automatiquement après confirmation de la transaction.${modeTag}`,
      { parse_mode: 'Markdown', reply_markup: mainMenu }
    );
    return;
  }

  switch (msg.text) {
    case '🏪 Ouvrir la boutique':
      bot.sendMessage(chatId, 'Clique ci-dessous pour accéder à la boutique :', {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🛒 Ouvrir la boutique',
                web_app: { url: 'https://el-felina.vercel.app' },
              },
            ],
          ],
        },
      });
      break;

    case '💰 Balance':
      try {
        const balance = await getUserBalance(userId);
        bot.sendMessage(
          chatId,
          `Ton ID Telegram est : ${userId}\nTa balance est de ${Number(balance).toFixed(2)}€`
        );
      } catch (error) {
        console.error('Erreur chargement balance :', error.message);
        bot.sendMessage(chatId, 'Erreur lors du chargement du balance.');
      }
      break;

    case '💳 Recharger':
      bot.sendMessage(chatId, 'Choisis une crypto pour recharger :', { reply_markup: cryptoMenu });
      break;

    case 'BTC':
    case 'ETH':
    case 'SOL':
      pendingRecharge[chatId] = { crypto: msg.text, step: 'awaiting_amount' };
      bot.sendMessage(
        chatId,
        `Tu as choisi *${msg.text}*.\n\nCombien veux-tu recharger (en EUR) ? Ex: 50`,
        { parse_mode: 'Markdown' }
      );
      break;

    case '⬅️ Retour':
      delete pendingRecharge[chatId];
      bot.sendMessage(chatId, 'Menu principal :', { reply_markup: mainMenu });
      break;

    case '📞 Support':
      bot.sendMessage(chatId, 'Contacte le support : @R0BESS ');
      break;

    default:
      break;
  }
});

// =============================================================
//  EXPRESS — Webhook NOWPayments IPN
// =============================================================
const app = express();

// Capture raw body uniquement sur la route du webhook (nécessaire pour la vérif HMAC)
app.use('/webhook/nowpayments', express.raw({ type: '*/*' }));
app.use(express.json());

function verifyIpnSignature(rawBody, signatureHeader) {
  if (!IPN_SECRET) {
    console.error('⚠️ NOWPAYMENTS_IPN_SECRET non configuré');
    return false;
  }
  if (!signatureHeader) return false;

  // NOWPayments signe le JSON avec clés triées alphabétiquement (récursivement)
  let parsed;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return false;
  }

  const sortedPayload = JSON.stringify(sortObjectDeep(parsed));
  const computed = crypto.createHmac('sha512', IPN_SECRET).update(sortedPayload).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(signatureHeader, 'hex'));
  } catch {
    return false;
  }
}

function sortObjectDeep(obj) {
  if (Array.isArray(obj)) return obj.map(sortObjectDeep);
  if (obj && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reduce((acc, k) => {
        acc[k] = sortObjectDeep(obj[k]);
        return acc;
      }, {});
  }
  return obj;
}

// Idempotence : garder en mémoire les payment_id déjà crédités (pour ce process)
const processedPayments = new Set();

app.post('/webhook/nowpayments', async (req, res) => {
  const signature = req.headers['x-nowpayments-sig'];
  const rawBody = req.body; // Buffer (à cause de express.raw)

  if (!verifyIpnSignature(rawBody, signature)) {
    console.warn('❌ IPN signature invalide');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payment;
  try {
    payment = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Toujours répondre 200 rapidement à NOWPayments
  res.status(200).json({ received: true });

  console.log('✅ IPN reçu:', {
    payment_id: payment.payment_id,
    payment_status: payment.payment_status,
    price_amount: payment.price_amount,
    price_currency: payment.price_currency,
    order_id: payment.order_id,
  });

  // On ne crédite que sur 'confirmed' / 'finished'
  if (!['confirmed', 'finished'].includes(payment.payment_status)) return;

  const idempotencyKey = `${payment.payment_id}`;
  if (processedPayments.has(idempotencyKey)) {
    console.log(`↩️ Paiement déjà traité: ${idempotencyKey}`);
    return;
  }
  processedPayments.add(idempotencyKey);

  // Extraire le userId depuis order_id (USER_<id>_<timestamp>)
  const match = (payment.order_id || '').match(/^USER_(\d+)_/);
  if (!match) {
    console.error('⚠️ order_id invalide, impossible de déterminer le user:', payment.order_id);
    return;
  }
  const userId = match[1];
  const amountEur = payment.price_amount; // Montant EUR défini lors de la création

  try {
    await axios.post(
      `${API_URL}/api/user/${userId}/credit`,
      {
        amount: amountEur,
        currency: payment.price_currency,
        payment_id: payment.payment_id,
        pay_currency: payment.pay_currency,
        pay_amount: payment.pay_amount,
        order_id: payment.order_id,
        source: 'nowpayments',
      },
      { timeout: 10000 }
    );
    console.log(`💰 Balance créditée user ${userId}: +${amountEur} ${payment.price_currency}`);

    // Notifier l'utilisateur sur Telegram
    try {
      await bot.sendMessage(
        parseInt(userId, 10),
        `✅ Ta recharge de *${amountEur} ${String(payment.price_currency).toUpperCase()}* a été créditée avec succès !\n\n` +
          `🆔 Payment ID : \`${payment.payment_id}\``,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.warn('Impossible de notifier user sur Telegram:', e.message);
    }
  } catch (err) {
    console.error(`❌ Échec crédit balance user ${userId}:`, err.response?.data || err.message);
    // On retire de processedPayments pour permettre un retry sur le prochain IPN (NOWPayments en envoie plusieurs)
    processedPayments.delete(idempotencyKey);
  }
});

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    sandbox: IS_SANDBOX,
    webhook_url_configured: Boolean(WEBHOOK_URL),
    ipn_secret_configured: Boolean(IPN_SECRET),
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 ATLAS bot démarré (polling). Webhook Express sur le port ${PORT}`);
  console.log(`   Mode NOWPayments: ${IS_SANDBOX ? 'SANDBOX 🧪' : 'PRODUCTION'}`);
  console.log(`   WEBHOOK_URL: ${WEBHOOK_URL || '(non défini — à configurer)'}`);
});
