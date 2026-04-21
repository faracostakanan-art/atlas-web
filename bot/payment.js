// NOWPayments API wrapper
// Doc: https://documenter.getpostman.com/view/7907941/S1a32n38
const axios = require('axios');

const IS_SANDBOX = String(process.env.NOWPAYMENTS_SANDBOX || 'false').toLowerCase() === 'true';
const NOWPAYMENTS_API_URL = IS_SANDBOX
  ? 'https://api-sandbox.nowpayments.io/v1'
  : 'https://api.nowpayments.io/v1';

// Map our internal currency codes to NOWPayments tickers
const PAY_CURRENCY_MAP = {
  BTC: 'btc',
  ETH: 'eth',
  SOL: 'sol',
};

function apiHeaders() {
  return {
    'x-api-key': process.env.NOWPAYMENTS_API_KEY,
    'Content-Type': 'application/json',
  };
}

async function getStatus() {
  const res = await axios.get(`${NOWPAYMENTS_API_URL}/status`);
  return res.data;
}

async function createPayment({ priceAmount, priceCurrency = 'EUR', crypto, orderId, orderDescription, ipnCallbackUrl }) {
  const payCurrency = PAY_CURRENCY_MAP[crypto];
  if (!payCurrency) {
    return { success: false, error: `Crypto non supportée: ${crypto}` };
  }

  try {
    const res = await axios.post(
      `${NOWPAYMENTS_API_URL}/payment`,
      {
        price_amount: parseFloat(priceAmount),
        price_currency: priceCurrency.toLowerCase(),
        pay_currency: payCurrency,
        order_id: orderId,
        order_description: orderDescription || `Recharge ATLAS (${crypto})`,
        ipn_callback_url: ipnCallbackUrl,
        is_fee_paid_by_user: false,
      },
      { headers: apiHeaders(), timeout: 15000 }
    );

    const d = res.data || {};
    return {
      success: true,
      payment_id: d.payment_id,
      pay_address: d.pay_address,
      pay_amount: d.pay_amount,
      pay_currency: d.pay_currency,
      price_amount: d.price_amount,
      price_currency: d.price_currency,
      order_id: d.order_id,
      expiration_estimate_date: d.expiration_estimate_date,
    };
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data || err.message;
    console.error('NOWPayments createPayment error:', msg);
    return { success: false, error: typeof msg === 'string' ? msg : JSON.stringify(msg) };
  }
}

async function getPaymentStatus(paymentId) {
  try {
    const res = await axios.get(
      `${NOWPAYMENTS_API_URL}/payment/${paymentId}`,
      { headers: apiHeaders(), timeout: 15000 }
    );
    return { success: true, data: res.data };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    return { success: false, error: msg };
  }
}

module.exports = {
  createPayment,
  getPaymentStatus,
  getStatus,
  IS_SANDBOX,
  NOWPAYMENTS_API_URL,
};
