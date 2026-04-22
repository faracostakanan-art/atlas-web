import React, { useEffect, useState } from "react";
import Admin from "./Admin";

const API = "https://felina-backend-production.up.railway.app/api";
const MAX_REFUNDS_PER_DAY = 3;
const REFUND_WINDOW_HOURS = 24;

// Champs prédéfinis avec emojis
const FIELD_DEFS = {
  identifiant: { label: "Identifiant", emoji: "🆔" },
  password: { label: "Mot de passe", emoji: "🔑" },
  firstname: { label: "Prénom", emoji: "👤" },
  lastname: { label: "Nom", emoji: "📛" },
  birthday: { label: "Date de naissance", emoji: "🎂" },
  phone: { label: "Téléphone", emoji: "☎️" },
};

// Parse hidden_content : si JSON avec fields -> structuré, sinon texte brut
function parseContent(hiddenContent) {
  if (!hiddenContent) return { mode: "empty", fields: [], raw: "" };
  try {
    const parsed = JSON.parse(hiddenContent);
    if (parsed && parsed.mode === "structured" && Array.isArray(parsed.fields)) {
      return { mode: "structured", fields: parsed.fields, raw: hiddenContent };
    }
  } catch (e) {}
  return { mode: "raw", fields: [], raw: hiddenContent };
}

export default function App() {
  if (window.location.pathname === "/admin") {
    return <Admin />;
  }

  const tg = window.Telegram?.WebApp;
  const telegramUser = tg?.initDataUnsafe?.user;
  const USER_ID = telegramUser?.id ? String(telegramUser.id) : null;

  const [page, setPage] = useState("home");
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [balance, setBalance] = useState(0);
  const [cart, setCart] = useState([]);
  const [refundsLeft, setRefundsLeft] = useState(MAX_REFUNDS_PER_DAY);
  const [toast, setToast] = useState(null);
  const [refundingId, setRefundingId] = useState(null);

  const showToast = (text, type = "success") => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3200);
  };

  const loadUser = async () => {
    if (!USER_ID) return;
    try {
      const res = await fetch(`${API}/user/${USER_ID}`);
      const data = await res.json();
      if (res.ok) setBalance(Number(data.balance || 0));
    } catch (e) { console.error(e); }
  };

  const loadRefundStatus = async () => {
    if (!USER_ID) return;
    try {
      const res = await fetch(`${API}/user/${USER_ID}/refund-status`);
      const data = await res.json();
      if (res.ok) setRefundsLeft(Number(data.refunds_left ?? MAX_REFUNDS_PER_DAY));
    } catch (e) { console.error(e); }
  };

  const loadProducts = async () => {
    try {
      const res = await fetch(`${API}/products`);
      const data = await res.json();
      setProducts(res.ok && Array.isArray(data) ? data : []);
    } catch (e) { setProducts([]); }
  };

  const loadOrders = async () => {
    if (!USER_ID) return;
    try {
      const res = await fetch(`${API}/orders/${USER_ID}`);
      const data = await res.json();
      setOrders(res.ok && Array.isArray(data) ? data : []);
    } catch (e) { setOrders([]); }
  };

  useEffect(() => {
    if (!USER_ID) {
      showToast("Ouvre la boutique depuis Telegram", "error");
      return;
    }
    loadUser();
    loadProducts();
    loadOrders();
    loadRefundStatus();
  }, [USER_ID]);

  const addToCart = (product) => {
    if (cart.some((i) => i.id === product.id)) {
      showToast("Déjà dans le panier", "error");
      return;
    }
    setCart((prev) => [...prev, product]);
    showToast("Produit ajouté au panier");
  };

  const removeFromCart = (productId) => {
    setCart((prev) => prev.filter((i) => i.id !== productId));
  };

  const cartTotal = cart.reduce((sum, i) => sum + Number(i.price), 0);

  const checkoutCart = async () => {
    if (cart.length === 0) return showToast("Panier vide", "error");
    if (balance < cartTotal) return showToast("Solde insuffisant", "error");

    try {
      for (const item of cart) {
        const res = await fetch(`${API}/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: USER_ID, product_id: item.id }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          showToast(data.error || `Erreur achat ${item.title}`, "error");
          await loadUser(); await loadProducts(); await loadOrders();
          return;
        }
        setBalance(Number(data.balance));
      }
      setCart([]);
      await loadProducts();
      await loadOrders();
      setPage("orders");
      showToast("Achat effectué avec succès");
    } catch (e) {
      showToast("Erreur lors du paiement", "error");
    }
  };

  const openOrder = async (orderId) => {
    try {
      const res = await fetch(`${API}/orders/${USER_ID}/${orderId}`);
      const data = await res.json();
      if (res.ok) setSelectedOrder(data);
      else showToast(data.error || "Commande introuvable", "error");
    } catch (e) {
      showToast("Erreur chargement commande", "error");
    }
  };

  const isRefundable = (order) => {
    if (!order) return false;
    if (order.status === "REFUNDED") return false;
    if (order.status !== "COMPLETED") return false;
    const createdAt = new Date(String(order.created_at).replace(" ", "T") + "Z");
    const hoursDiff = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
    return hoursDiff <= REFUND_WINDOW_HOURS;
  };

  const refundOrder = async (order) => {
    if (!order) return;
    const confirmed = window.confirm(
      `Rembourser cette commande ?\n\n` +
      `Ton solde sera recrédité et la commande sera SUPPRIMÉE de ton historique.\n\n` +
      `Remboursements restants aujourd'hui : ${refundsLeft}/${MAX_REFUNDS_PER_DAY}`
    );
    if (!confirmed) return;

    setRefundingId(order.id);
    try {
      const res = await fetch(`${API}/orders/${USER_ID}/${order.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || "Erreur remboursement", "error");
        return;
      }
      setBalance(Number(data.new_balance));
      setRefundsLeft(Number(data.refunds_left ?? refundsLeft - 1));
      showToast(`Remboursement de ${Number(data.refunded_amount).toFixed(2)}€ effectué`);
      setSelectedOrder(null);
      await loadOrders();
      await loadProducts();
    } catch (e) {
      showToast("Erreur réseau", "error");
    } finally {
      setRefundingId(null);
    }
  };

  const statusClass = (status) => {
    if (status === "REFUNDED") return "refunded";
    if (status === "COMPLETED") return "done";
    return "waiting";
  };

  const renderFields = (content) => {
    const parsed = parseContent(content);
    if (parsed.mode === "structured" && parsed.fields.length > 0) {
      return (
        <div className="field-list">
          {parsed.fields.map((f, i) => {
            const def = FIELD_DEFS[f.key] || {};
            const emoji = f.emoji || def.emoji || "•";
            const label = f.label || def.label || f.key;
            return (
              <div className="field-row" key={i}>
                <div className="field-emoji">{emoji}</div>
                <div className="field-body">
                  <div className="field-label">{label}</div>
                  <div className="field-value">{f.value || "-"}</div>
                </div>
              </div>
            );
          })}
        </div>
      );
    }
    if (parsed.mode === "raw" && parsed.raw) {
      return (
        <div className="order-detail-raw-box">
          <div className="order-detail-raw-label">Contenu livré</div>
          <pre className="order-detail-raw-text">{parsed.raw}</pre>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="app-shell">
      {toast && (
        <div className={`toast ${toast.type === "error" ? "error" : ""}`} data-testid="toast">
          {toast.text}
        </div>
      )}

      <div className="app-header">
        <div className="app-title">Ma Boutique</div>
        <div className="app-subtitle">
          {telegramUser ? `Bienvenue ${telegramUser.first_name}` : "Interface sécurisée"}
        </div>
      </div>

      {page === "home" && (
        <>
          <div className="balance-card" data-testid="balance-card">
            <div className="balance-label">SOLDE DISPONIBLE</div>
            <div className="balance-amount">€{balance.toFixed(2)}</div>
            <div className="refund-chip" data-testid="refund-chip">
              🔄 {refundsLeft}/{MAX_REFUNDS_PER_DAY} remboursements restants
            </div>
          </div>

          <button className="filter-btn" onClick={() => { loadUser(); loadProducts(); loadRefundStatus(); }} data-testid="refresh-btn">
            Actualiser
          </button>
          <div className="result-count">{products.length} résultat(s)</div>

          <div className="page-container">
            {products.map((product) => (
              <div className="shop-product" key={product.id} data-testid={`product-card-${product.id}`}>
                <div className="shop-product-top">
                  {product.image_url ? (
                    <img className="shop-product-thumb" src={product.image_url} alt={product.title} />
                  ) : (
                    <div className="shop-product-thumb empty">📦</div>
                  )}
                  <div className="shop-product-info">
                    <div className="shop-product-title">{product.title}</div>
                    {product.subtitle ? (
                      <div className="shop-product-subtitle">{product.subtitle}</div>
                    ) : null}
                    <div className="shop-product-status">DISPONIBLE</div>
                  </div>
                </div>

                <button
                  className="shop-product-cta"
                  onClick={() => addToCart(product)}
                  data-testid={`add-to-cart-${product.id}`}
                >
                  Ajouter au panier (€{Number(product.price).toFixed(2)})
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {page === "cart" && (
        <div className="page-container">
          <h1 className="orders-heading">Panier</h1>

          {cart.length === 0 ? (
            <p>Ton panier est vide.</p>
          ) : (
            <>
              {cart.map((item) => (
                <div className="shop-product" key={item.id}>
                  <div className="shop-product-top">
                    {item.image_url ? (
                      <img className="shop-product-thumb" src={item.image_url} alt={item.title} />
                    ) : (
                      <div className="shop-product-thumb empty">📦</div>
                    )}
                    <div className="shop-product-info">
                      <div className="shop-product-title">{item.title}</div>
                      {item.subtitle ? (
                        <div className="shop-product-subtitle">{item.subtitle}</div>
                      ) : null}
                      <div className="shop-product-status">PANIER · €{Number(item.price).toFixed(2)}</div>
                    </div>
                  </div>

                  <button
                    className="ghost-btn"
                    onClick={() => removeFromCart(item.id)}
                    data-testid={`remove-from-cart-${item.id}`}
                  >
                    Retirer
                  </button>
                </div>
              ))}

              <div className="shop-product">
                <div className="shop-product-top">
                  <div className="shop-product-info">
                    <div className="shop-product-title">Total panier</div>
                    <div className="shop-product-subtitle">{cart.length} produit(s)</div>
                    <div className="shop-product-status">€{cartTotal.toFixed(2)}</div>
                  </div>
                </div>
                <button className="shop-product-cta" onClick={checkoutCart} data-testid="checkout-btn">
                  Payer avec le solde
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {page === "orders" && (
        <div className="page-container">
          <h1 className="orders-heading">Commandes</h1>

          {selectedOrder ? (
            <div className="order-detail-card">
              <div className="order-detail-header">
                <div>
                  <div className="order-detail-title">Commande #{selectedOrder.id}</div>
                  <div className="order-detail-subtitle">{selectedOrder.created_at}</div>
                </div>
                <div className={`order-detail-status ${selectedOrder.status === "REFUNDED" ? "refunded" : ""}`}>
                  {selectedOrder.status}
                </div>
              </div>

              {(selectedOrder.items || []).map((item) => (
                <div key={item.id} className="order-detail-product">
                  <div className="order-detail-product-top">
                    {item.image_url ? (
                      <img className="order-detail-product-img" src={item.image_url} alt={item.title} />
                    ) : (
                      <div className="order-detail-product-img" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", color: "#5d4f85" }}>📦</div>
                    )}
                    <div className="order-detail-product-info">
                      <div className="order-detail-product-title">{item.title}</div>
                      {item.subtitle ? (
                        <div className="shop-product-subtitle">{item.subtitle}</div>
                      ) : null}
                      <div className="order-detail-product-price">€{Number(item.price).toFixed(2)}</div>
                    </div>
                  </div>

                  {renderFields(item.hidden_content)}
                </div>
              ))}

              {isRefundable(selectedOrder) ? (
                <button
                  className="refund-btn"
                  onClick={() => refundOrder(selectedOrder)}
                  disabled={refundingId === selectedOrder.id || refundsLeft <= 0}
                  data-testid="refund-btn"
                >
                  {refundingId === selectedOrder.id
                    ? "Remboursement en cours..."
                    : refundsLeft <= 0
                      ? `Limite atteinte (${MAX_REFUNDS_PER_DAY}/${MAX_REFUNDS_PER_DAY} aujourd'hui)`
                      : `Rembourser cette commande (${refundsLeft}/${MAX_REFUNDS_PER_DAY} restants)`}
                </button>
              ) : selectedOrder.status === "REFUNDED" ? (
                <div style={{ marginTop: "10px", textAlign: "center", color: "#fca5a5", fontSize: "12px", fontWeight: 600 }}>
                  Déjà remboursée
                </div>
              ) : (
                <div style={{ marginTop: "10px", textAlign: "center", color: "#9d8fc7", fontSize: "12px" }}>
                  Délai de remboursement dépassé (24h max)
                </div>
              )}

              <button className="ghost-btn" onClick={() => setSelectedOrder(null)} data-testid="back-to-orders">
                Retour
              </button>
            </div>
          ) : (
            (orders || []).map((order) => (
              <div className="order-card" key={order.id} data-testid={`order-card-${order.id}`}>
                <div className="order-top">
                  <div>
                    <div className="order-title">Commande #{order.id}</div>
                    <div className="order-date">{order.created_at}</div>
                  </div>
                  <div className={`status-badge ${statusClass(order.status)}`}>{order.status}</div>
                </div>

                <button className="details-btn" onClick={() => openOrder(order.id)} data-testid={`view-order-${order.id}`}>
                  Voir les détails
                </button>
              </div>
            ))
          )}

          {orders.length === 0 && !selectedOrder && <p>Aucune commande.</p>}
        </div>
      )}

      <div className="bottom-nav">
        <div
          className={page === "home" ? "nav-item active-nav" : "nav-item"}
          onClick={() => { setPage("home"); setSelectedOrder(null); }}
          data-testid="nav-home"
        >
          <div className="nav-icon">⌂</div>
          <div className="nav-text">Accueil</div>
        </div>

        <div
          className={page === "cart" ? "nav-item active-nav" : "nav-item"}
          onClick={() => { setPage("cart"); setSelectedOrder(null); }}
          data-testid="nav-cart"
        >
          <div className="nav-icon">🛒</div>
          <div className="nav-text">Panier ({cart.length})</div>
        </div>

        <div
          className={page === "orders" ? "nav-item active-nav" : "nav-item"}
          onClick={() => setPage("orders")}
          data-testid="nav-orders"
        >
          <div className="nav-icon">⬡</div>
          <div className="nav-text">Commandes</div>
        </div>
      </div>
    </div>
  );
}
