import React, { useEffect, useState } from "react";

const API_URL = "https://felina-backend-production.up.railway.app";

const FIELD_DEFS = [
  { key: "identifiant", label: "Identifiant", emoji: "🆔" },
  { key: "password", label: "Mot de passe", emoji: "🔑" },
  { key: "firstname", label: "Prénom", emoji: "👤" },
  { key: "lastname", label: "Nom", emoji: "📛" },
  { key: "birthday", label: "Date de naissance", emoji: "🎂" },
  { key: "phone", label: "Téléphone", emoji: "☎️" },
];

const emptyProduct = () => ({
  title: "",
  subtitle: "",
  price: "",
  imageFile: null,
  fields: FIELD_DEFS.reduce((acc, f) => ({ ...acc, [f.key]: { enabled: false, value: "" } }), {}),
  rawContent: "",
  useRaw: false,
});

function buildHiddenContent(product) {
  if (product.useRaw) return product.rawContent;
  const activeFields = FIELD_DEFS
    .filter((def) => product.fields[def.key]?.enabled && product.fields[def.key]?.value)
    .map((def) => ({
      key: def.key,
      label: def.label,
      emoji: def.emoji,
      value: product.fields[def.key].value,
    }));
  if (activeFields.length === 0) {
    return product.rawContent || "";
  }
  return JSON.stringify({ mode: "structured", fields: activeFields });
}

export default function Admin() {
  const [password, setPassword] = useState("");
  const [productForms, setProductForms] = useState([emptyProduct()]);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");
  const [products, setProducts] = useState([]);

  const [userIdForBalance, setUserIdForBalance] = useState("");
  const [balanceAmount, setBalanceAmount] = useState("");

  const showMsg = (text, type = "info") => {
    setMessage(text);
    setMessageType(type);
  };

  const loadProducts = async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/products`);
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
    } catch (error) {
      showMsg("Impossible de charger les produits.", "error");
    }
  };

  useEffect(() => { loadProducts(); }, []);

  const updateForm = (idx, updater) => {
    setProductForms((prev) => prev.map((p, i) => (i === idx ? updater(p) : p)));
  };

  const addFormRow = () => {
    setProductForms((prev) => [...prev, emptyProduct()]);
  };

  const removeFormRow = (idx) => {
    setProductForms((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  const toggleField = (formIdx, fieldKey) => {
    updateForm(formIdx, (p) => ({
      ...p,
      fields: {
        ...p.fields,
        [fieldKey]: { ...p.fields[fieldKey], enabled: !p.fields[fieldKey].enabled },
      },
    }));
  };

  const setFieldValue = (formIdx, fieldKey, value) => {
    updateForm(formIdx, (p) => ({
      ...p,
      fields: {
        ...p.fields,
        [fieldKey]: { ...p.fields[fieldKey], value },
      },
    }));
  };

  const submitAllProducts = async () => {
    showMsg("");
    if (!password) {
      showMsg("Mot de passe admin requis.", "error");
      return;
    }
    for (const [i, p] of productForms.entries()) {
      if (!p.title || !p.price) {
        showMsg(`Produit #${i + 1} : titre et prix requis.`, "error");
        return;
      }
      const content = buildHiddenContent(p);
      if (!content) {
        showMsg(`Produit #${i + 1} : remplis au moins un champ ou un contenu libre.`, "error");
        return;
      }
    }

    let ok = 0;
    let fail = 0;
    for (const p of productForms) {
      try {
        const fd = new FormData();
        fd.append("password", password);
        fd.append("title", p.title);
        fd.append("subtitle", p.subtitle);
        fd.append("price", p.price);
        fd.append("hidden_content", buildHiddenContent(p));
        if (p.imageFile) fd.append("image", p.imageFile);
        const res = await fetch(`${API_URL}/api/admin/products`, { method: "POST", body: fd });
        const data = await res.json();
        if (data.success) ok++;
        else fail++;
      } catch (e) {
        fail++;
      }
    }
    showMsg(`${ok} produit(s) ajouté(s). ${fail ? `${fail} échec(s).` : ""}`, fail ? "error" : "success");
    if (ok > 0) {
      setProductForms([emptyProduct()]);
      await loadProducts();
    }
  };

  const deleteProduct = async (id) => {
    try {
      const res = await fetch(`${API_URL}/api/admin/products/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.success) {
        showMsg("Produit supprimé.", "success");
        await loadProducts();
      } else {
        showMsg(data.error || "Erreur suppression.", "error");
      }
    } catch {
      showMsg("Erreur de connexion.", "error");
    }
  };

  const addBalance = async () => {
    showMsg("");
    if (!password || !userIdForBalance || !balanceAmount) {
      showMsg("Remplis le mot de passe, l'ID et le montant.", "error");
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/admin/add-balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          user_id: userIdForBalance,
          amount: parseFloat(balanceAmount),
        }),
      });
      const data = await res.json();
      if (data.success) {
        showMsg(`Solde ajouté. Nouveau solde : ${Number(data.user.balance).toFixed(2)}€`, "success");
        setUserIdForBalance("");
        setBalanceAmount("");
      } else {
        showMsg(data.error || "Erreur ajout solde.", "error");
      }
    } catch {
      showMsg("Erreur de connexion.", "error");
    }
  };

  const styles = {
    page: { minHeight: "100vh", background: "#0a0612", color: "#f5f0ff", padding: "20px", fontFamily: "Inter, Arial, sans-serif" },
    h1: { background: "linear-gradient(90deg, #c4b5fd 0%, #a855f7 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", fontSize: "28px", margin: "0 0 20px" },
    h2: { color: "#c4b5fd", fontSize: "18px", margin: "24px 0 12px" },
    section: { background: "#140826", border: "1px solid rgba(168,85,247,0.2)", borderRadius: "14px", padding: "14px", marginBottom: "16px" },
    input: { width: "100%", padding: "10px 12px", background: "#0b0315", border: "1px solid rgba(168,85,247,0.25)", borderRadius: "10px", color: "#f5f0ff", fontSize: "14px", marginBottom: "10px" },
    btn: { padding: "10px 18px", background: "linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, cursor: "pointer", fontSize: "14px" },
    btnGhost: { padding: "8px 12px", background: "transparent", color: "#c4b5fd", border: "1px solid rgba(168,85,247,0.3)", borderRadius: "10px", fontWeight: 600, cursor: "pointer", fontSize: "13px" },
    btnDanger: { padding: "6px 12px", background: "rgba(239,68,68,0.1)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.4)", borderRadius: "8px", fontWeight: 600, cursor: "pointer", fontSize: "12px" },
    fieldRow: { display: "flex", alignItems: "center", gap: "10px", padding: "6px 0" },
    checkbox: { width: "18px", height: "18px", accentColor: "#a855f7", cursor: "pointer" },
    productFormCard: { background: "#100520", border: "1px solid rgba(168,85,247,0.22)", borderRadius: "12px", padding: "14px", marginBottom: "14px" },
    cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" },
    message: (type) => ({ padding: "10px 14px", borderRadius: "10px", marginTop: "10px", fontSize: "13px", background: type === "error" ? "rgba(239,68,68,0.1)" : type === "success" ? "rgba(34,197,94,0.12)" : "rgba(168,85,247,0.1)", color: type === "error" ? "#fca5a5" : type === "success" ? "#4ade80" : "#c4b5fd", border: `1px solid ${type === "error" ? "rgba(239,68,68,0.3)" : type === "success" ? "rgba(34,197,94,0.3)" : "rgba(168,85,247,0.3)"}` }),
  };

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Admin Panel · ATLAS</h1>

      <div style={styles.section}>
        <input
          type="password"
          placeholder="Mot de passe admin"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
          data-testid="admin-password"
        />
      </div>

      <h2 style={styles.h2}>Ajouter des produits</h2>

      {productForms.map((p, idx) => (
        <div key={idx} style={styles.productFormCard} data-testid={`product-form-${idx}`}>
          <div style={styles.cardHeader}>
            <strong style={{ color: "#c4b5fd" }}>Produit #{idx + 1}</strong>
            {productForms.length > 1 && (
              <button onClick={() => removeFormRow(idx)} style={styles.btnDanger} data-testid={`remove-form-${idx}`}>
                Retirer
              </button>
            )}
          </div>

          <input
            type="text"
            placeholder="Titre (ex: Abonnement premium)"
            value={p.title}
            onChange={(e) => updateForm(idx, (f) => ({ ...f, title: e.target.value }))}
            style={styles.input}
          />
          <input
            type="text"
            placeholder="Sous-titre (ex: Netflix - 1 an)"
            value={p.subtitle}
            onChange={(e) => updateForm(idx, (f) => ({ ...f, subtitle: e.target.value }))}
            style={styles.input}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Prix en €"
            value={p.price}
            onChange={(e) => updateForm(idx, (f) => ({ ...f, price: e.target.value }))}
            style={styles.input}
          />
          <input
            type="file"
            accept="image/*"
            onChange={(e) => updateForm(idx, (f) => ({ ...f, imageFile: e.target.files[0] || null }))}
            style={{ ...styles.input, padding: "8px" }}
          />

          <div style={{ marginTop: "14px", padding: "12px", background: "#0b0315", borderRadius: "10px", border: "1px solid rgba(168,85,247,0.18)" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#c4b5fd", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Champs livrés après achat
            </div>

            {FIELD_DEFS.map((def) => {
              const state = p.fields[def.key];
              return (
                <div key={def.key} style={styles.fieldRow}>
                  <input
                    type="checkbox"
                    checked={state.enabled}
                    onChange={() => toggleField(idx, def.key)}
                    style={styles.checkbox}
                    data-testid={`toggle-${def.key}-${idx}`}
                  />
                  <span style={{ fontSize: "16px" }}>{def.emoji}</span>
                  <span style={{ minWidth: "110px", fontSize: "13px", color: "#e9defe" }}>{def.label}</span>
                  {state.enabled && (
                    <input
                      type="text"
                      placeholder={`${def.label}...`}
                      value={state.value}
                      onChange={(e) => setFieldValue(idx, def.key, e.target.value)}
                      style={{ ...styles.input, marginBottom: 0, flex: 1 }}
                    />
                  )}
                </div>
              );
            })}

            <div style={{ marginTop: "14px", paddingTop: "10px", borderTop: "1px dashed rgba(168,85,247,0.2)" }}>
              <label style={{ fontSize: "12px", color: "#9d8fc7", display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={p.useRaw}
                  onChange={(e) => updateForm(idx, (f) => ({ ...f, useRaw: e.target.checked }))}
                  style={styles.checkbox}
                />
                Utiliser plutôt un contenu libre (texte simple)
              </label>
              {p.useRaw && (
                <textarea
                  placeholder="Contenu libre..."
                  value={p.rawContent}
                  onChange={(e) => updateForm(idx, (f) => ({ ...f, rawContent: e.target.value }))}
                  rows={4}
                  style={{ ...styles.input, marginTop: "8px", fontFamily: "inherit" }}
                />
              )}
            </div>
          </div>
        </div>
      ))}

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "20px" }}>
        <button onClick={addFormRow} style={styles.btnGhost} data-testid="add-form-row">
          + Ajouter un autre produit
        </button>
        <button onClick={submitAllProducts} style={styles.btn} data-testid="submit-all-products">
          Créer {productForms.length} produit{productForms.length > 1 ? "s" : ""}
        </button>
      </div>

      {message && <div style={styles.message(messageType)}>{message}</div>}

      <h2 style={styles.h2}>Ajouter du solde à un utilisateur</h2>
      <div style={styles.section}>
        <input
          type="text"
          placeholder="ID Telegram (ex: 123456789)"
          value={userIdForBalance}
          onChange={(e) => setUserIdForBalance(e.target.value)}
          style={styles.input}
          data-testid="balance-user-id"
        />
        <input
          type="number"
          step="0.01"
          placeholder="Montant en €"
          value={balanceAmount}
          onChange={(e) => setBalanceAmount(e.target.value)}
          style={styles.input}
          data-testid="balance-amount"
        />
        <button onClick={addBalance} style={styles.btn} data-testid="add-balance-btn">
          Ajouter le solde
        </button>
      </div>

      <h2 style={styles.h2}>Produits existants ({products.length})</h2>
      <div style={styles.section}>
        {products.length === 0 ? (
          <p style={{ color: "#9d8fc7" }}>Aucun produit.</p>
        ) : (
          products.map((product) => (
            <div key={product.id} style={{ display: "flex", gap: "12px", alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(168,85,247,0.1)" }}>
              {product.image_url && (
                <img src={product.image_url} alt={product.title} style={{ width: "50px", height: "50px", borderRadius: "8px", objectFit: "cover" }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: "#f5f0ff" }}>{product.title}</div>
                <div style={{ fontSize: "12px", color: "#9d8fc7" }}>{product.subtitle}</div>
                <div style={{ fontSize: "13px", color: "#c4b5fd" }}>€{Number(product.price).toFixed(2)}</div>
              </div>
              <button onClick={() => deleteProduct(product.id)} style={styles.btnDanger} data-testid={`delete-product-${product.id}`}>
                Supprimer
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
