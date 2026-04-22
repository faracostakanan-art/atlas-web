const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const db = require("./database");

const app = express();
const PORT = process.env.PORT || 3001;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "TIGER2006";
const PAYMENT_WEBHOOK_SECRET =
  process.env.PAYMENT_WEBHOOK_SECRET || "CHANGE_ME_WEBHOOK_SECRET";

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

if (!fs.existsSync(path.join(__dirname, "uploads"))) {
  fs.mkdirSync(path.join(__dirname, "uploads"));
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const name = Date.now() + "-" + Math.round(Math.random() * 1e9) + ext;
    cb(null, name);
  }
});

const upload = multer({ storage });

function createUserIfNotExists(userId, username = "") {
  const id = String(userId);
  const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(id);

  if (!existing) {
    db.prepare("INSERT INTO users (id, username, balance) VALUES (?, ?, ?)")
      .run(id, username, 0);
  }

  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

/* -------------------- USERS -------------------- */

app.get("/api/user/:userId", (req, res) => {
  try {
    const user = createUserIfNotExists(req.params.userId);
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* -------------------- ADMIN BALANCE -------------------- */

app.post("/api/admin/add-balance", (req, res) => {
  try {
    const { password, user_id, amount } = req.body;

    if (password !== ADMIN_PASSWORD) {
      return res.status(403).json({ error: "Accès refusé" });
    }

    if (!user_id || amount === undefined || isNaN(Number(amount))) {
      return res.status(400).json({ error: "Champs manquants ou invalides" });
    }

    createUserIfNotExists(String(user_id));

    db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?")
      .run(Number(amount), String(user_id));

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(String(user_id));
    res.json({ success: true, user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* -------------------- PRODUCTS -------------------- */

app.get("/api/products", (req, res) => {
  try {
    const products = db.prepare(`
      SELECT id, title, subtitle, price, image_url
      FROM products
      WHERE visible = 1
      ORDER BY id DESC
    `).all();

    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/admin/products", (req, res) => {
  try {
    const products = db.prepare("SELECT * FROM products ORDER BY id DESC").all();
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/admin/products", upload.single("image"), (req, res) => {
  try {
    const { password, title, subtitle, price, hidden_content } = req.body;

    if (password !== ADMIN_PASSWORD) {
      return res.status(403).json({ error: "Accès refusé" });
    }

    if (!title || price === undefined || !hidden_content) {
      return res.status(400).json({ error: "Champs manquants" });
    }

    const imageUrl = req.file
      ? `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`
      : "";

    const result = db.prepare(`
      INSERT INTO products (title, subtitle, price, image_url, hidden_content, visible)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(
      title,
      subtitle || "",
      Number(price),
      imageUrl,
      hidden_content
    );

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.delete("/api/admin/products/:id", (req, res) => {
  try {
    const { password } = req.body;

    if (password !== ADMIN_PASSWORD) {
      return res.status(403).json({ error: "Accès refusé" });
    }

    db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* -------------------- CHECKOUT -------------------- */

app.post("/api/checkout", (req, res) => {
  try {
    const { user_id, product_id } = req.body;

    if (!user_id || !product_id) {
      return res.status(400).json({ error: "Champs manquants" });
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(String(user_id));
    const product = db.prepare(`
      SELECT * FROM products
      WHERE id = ? AND visible = 1
    `).get(product_id);

    if (!user) {
      return res.status(404).json({ error: "Utilisateur introuvable" });
    }

    if (!product) {
      return res.status(404).json({ error: "Produit introuvable" });
    }

    if (Number(user.balance) < Number(product.price)) {
      return res.status(400).json({ error: "Solde insuffisant" });
    }

    const insertOrder = db.prepare(`
      INSERT INTO orders (user_id, status)
      VALUES (?, ?)
    `).run(String(user_id), "COMPLETED");

    const orderId = insertOrder.lastInsertRowid;

    db.prepare(`
      INSERT INTO order_items (
        order_id,
        product_id,
        title,
        subtitle,
        price,
        image_url,
        hidden_content
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderId,
      product.id,
      product.title,
      product.subtitle || "",
      Number(product.price),
      product.image_url || "",
      product.hidden_content || ""
    );

    db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?")
      .run(Number(product.price), String(user_id));

    db.prepare("DELETE FROM products WHERE id = ?").run(product.id);

    const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(String(user_id));

    res.json({
      success: true,
      balance: Number(updatedUser.balance),
      order_id: orderId
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* -------------------- ORDERS -------------------- */

app.get("/api/orders/:userId", (req, res) => {
  try {
    const orders = db.prepare(`
      SELECT * FROM orders
      WHERE user_id = ?
      ORDER BY id DESC
    `).all(String(req.params.userId));

    res.json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/orders/:userId/:orderId", (req, res) => {
  try {
    const order = db.prepare(`
      SELECT * FROM orders
      WHERE id = ? AND user_id = ?
    `).get(req.params.orderId, String(req.params.userId));

    if (!order) {
      return res.status(404).json({ error: "Commande introuvable" });
    }

    const items = db.prepare(`
      SELECT * FROM order_items
      WHERE order_id = ?
      ORDER BY id DESC
    `).all(order.id);

    res.json({
      ...order,
      items
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* -------------------- REFUNDS -------------------- */

const MAX_REFUNDS_PER_DAY = 3;
const REFUND_WINDOW_HOURS = 24;

function getParisDate() {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
}

function getUserWithRefundReset(userId) {
  const today = getParisDate();
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(String(userId));
  if (!user) return null;

  if (user.refunds_date !== today) {
    db.prepare("UPDATE users SET refunds_today = 0, refunds_date = ? WHERE id = ?")
      .run(today, String(userId));
    user.refunds_today = 0;
    user.refunds_date = today;
  }
  return user;
}

app.get("/api/user/:userId/refund-status", (req, res) => {
  try {
    const user = getUserWithRefundReset(req.params.userId);
    if (!user) {
      return res.json({
        refunds_today: 0,
        refunds_left: MAX_REFUNDS_PER_DAY,
        max_per_day: MAX_REFUNDS_PER_DAY
      });
    }
    const used = Number(user.refunds_today || 0);
    res.json({
      refunds_today: used,
      refunds_left: Math.max(0, MAX_REFUNDS_PER_DAY - used),
      max_per_day: MAX_REFUNDS_PER_DAY
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/orders/:userId/:orderId/refund", (req, res) => {
  try {
    const userId = String(req.params.userId);
    const orderId = req.params.orderId;

    const order = db.prepare(
      "SELECT * FROM orders WHERE id = ? AND user_id = ?"
    ).get(orderId, userId);

    if (!order) return res.status(404).json({ error: "Commande introuvable" });
    if (order.status === "REFUNDED") return res.status(400).json({ error: "Commande déjà remboursée" });
    if (order.status !== "COMPLETED") return res.status(400).json({ error: "Cette commande ne peut pas être remboursée" });

    const createdAt = new Date(order.created_at.replace(" ", "T") + "Z");
    const hoursDiff = (new Date() - createdAt) / (1000 * 60 * 60);
    if (hoursDiff > REFUND_WINDOW_HOURS) {
      return res.status(400).json({ error: "Délai de remboursement dépassé (plus de 24h)" });
    }

    const user = getUserWithRefundReset(userId);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

    const refundsToday = Number(user.refunds_today || 0);
    if (refundsToday >= MAX_REFUNDS_PER_DAY) {
      return res.status(429).json({
        error: `Limite de ${MAX_REFUNDS_PER_DAY} remboursements par jour atteinte`,
        refunds_left: 0
      });
    }

    const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(order.id);
    if (items.length === 0) return res.status(400).json({ error: "Commande vide" });

    const totalRefund = items.reduce((sum, i) => sum + Number(i.price), 0);

    const tx = db.transaction(() => {
      for (const item of items) {
        db.prepare(`
          INSERT INTO products (title, subtitle, price, image_url, hidden_content, visible)
          VALUES (?, ?, ?, ?, ?, 1)
        `).run(
          item.title,
          item.subtitle || "",
          Number(item.price),
          item.image_url || "",
          item.hidden_content || ""
        );
      }

      db.prepare(`
        UPDATE users
        SET balance = balance + ?,
            refunds_today = refunds_today + 1,
            refunds_date = ?
        WHERE id = ?
      `).run(totalRefund, getParisDate(), userId);

      db.prepare(`
        UPDATE orders
        SET status = 'REFUNDED', refunded_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(order.id);
    });

    tx();

    const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);

    res.json({
      success: true,
      refunded_amount: totalRefund,
      new_balance: Number(updatedUser.balance),
      refunds_left: MAX_REFUNDS_PER_DAY - Number(updatedUser.refunds_today || 0)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* -------------------- DEPOSITS -------------------- */

app.post("/api/deposits/create", (req, res) => {
  try {
    const { user_id, amount, currency, provider } = req.body;

    if (!user_id || !amount || !currency || !provider) {
      return res.status(400).json({ error: "Champs manquants" });
    }

    if (isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: "Montant invalide" });
    }

    createUserIfNotExists(String(user_id));

    const reference = `DEP-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    const result = db.prepare(`
      INSERT INTO deposits (
        user_id,
        reference,
        provider,
        amount_expected,
        currency,
        status
      )
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(
      String(user_id),
      reference,
      String(provider),
      Number(amount),
      String(currency).toUpperCase()
    );

    res.json({
      success: true,
      deposit_id: result.lastInsertRowid,
      reference,
      amount_expected: Number(amount),
      currency: String(currency).toUpperCase(),
      status: "pending"
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/deposits/:userId", (req, res) => {
  try {
    const deposits = db.prepare(`
      SELECT * FROM deposits
      WHERE user_id = ?
      ORDER BY id DESC
    `).all(String(req.params.userId));

    res.json(deposits);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* -------------------- PAYMENT WEBHOOK -------------------- */

app.post("/api/payments/webhook", (req, res) => {
  try {
    const signature = req.headers["x-webhook-secret"];

    if (signature !== PAYMENT_WEBHOOK_SECRET) {
      return res.status(403).json({ error: "Signature invalide" });
    }

    const {
      reference,
      transaction_id,
      amount_received,
      currency,
      status,
      provider,
      metadata
    } = req.body;

    if (!reference || !transaction_id || amount_received === undefined || !currency || !status) {
      return res.status(400).json({ error: "Champs manquants" });
    }

    const deposit = db.prepare(`
      SELECT * FROM deposits
      WHERE reference = ?
    `).get(String(reference));

    if (!deposit) {
      return res.status(404).json({ error: "Dépôt introuvable" });
    }

    if (deposit.status === "completed") {
      return res.json({ success: true, message: "Déjà traité" });
    }

    if (deposit.transaction_id && deposit.transaction_id === String(transaction_id)) {
      return res.json({ success: true, message: "Transaction déjà traitée" });
    }

    if (String(currency).toUpperCase() !== String(deposit.currency).toUpperCase()) {
      return res.status(400).json({ error: "Devise invalide" });
    }

    if (Number(amount_received) < Number(deposit.amount_expected)) {
      db.prepare(`
        UPDATE deposits
        SET amount_received = ?, transaction_id = ?, status = ?, metadata = ?
        WHERE id = ?
      `).run(
        Number(amount_received),
        String(transaction_id),
        "underpaid",
        JSON.stringify(metadata || {}),
        deposit.id
      );

      return res.status(400).json({ error: "Montant insuffisant" });
    }

    if (status !== "confirmed" && status !== "completed") {
      db.prepare(`
        UPDATE deposits
        SET amount_received = ?, transaction_id = ?, status = ?, metadata = ?
        WHERE id = ?
      `).run(
        Number(amount_received),
        String(transaction_id),
        String(status),
        JSON.stringify(metadata || {}),
        deposit.id
      );

      return res.json({ success: true, message: "Webhook reçu, en attente de confirmation finale" });
    }

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE users
        SET balance = balance + ?
        WHERE id = ?
      `).run(Number(amount_received), String(deposit.user_id));

      db.prepare(`
        UPDATE deposits
        SET amount_received = ?,
            transaction_id = ?,
            provider = ?,
            status = 'completed',
            metadata = ?,
            credited_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        Number(amount_received),
        String(transaction_id),
        String(provider || deposit.provider || ""),
        JSON.stringify(metadata || {}),
        deposit.id
      );
    });

    tx();

    res.json({ success: true, message: "Solde crédité" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* -------------------- ROOT -------------------- */

app.get("/", (req, res) => {
  res.send("API Felina backend OK");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("API lancée sur le port " + PORT);
});
