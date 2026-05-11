/* =========================================
   STREET FOOD — CLIENT (menu1.js)
   Version Supabase — remplace localStorage
   ========================================= */

class StreetFoodClient {
  constructor() {
    this.restaurant = null;       // objet restaurant chargé depuis Supabase
    this.restaurantId = null;
    this.plats = [];
    this.zones = [];              // [{id, nom, prix_livraison}]
    this.panier = JSON.parse(localStorage.getItem('sf_panier')) || [];
    this.orderType = 'onsite';
    this.selectedTable = '';
    this.currentCategory = 'all';
    this._deliveryFee = 0;
    this.init();
  }

  async init() {
    this.showLoader(true);
    try {
      // 1. Identifier le restaurant via l'URL (?resto=slug)
      const slug = StreetFoodDB.getRestaurantSlug();
      this.restaurant = await StreetFoodDB.RestaurantAPI.getBySlug(slug);
      this.restaurantId = this.restaurant.id;

      // Adapter le titre et la couleur du restaurant
      document.title = `${this.restaurant.nom} — Commander`;
      document.querySelector('.brand-name').textContent = this.restaurant.nom;
      if (this.restaurant.couleur) {
        document.documentElement.style.setProperty('--fire', this.restaurant.couleur);
      }

      // 2. Charger plats et zones en parallèle
      const [plats, zones] = await Promise.all([
        StreetFoodDB.PlatAPI.getAll(this.restaurantId),
        StreetFoodDB.ZoneAPI.getAll(this.restaurantId)
      ]);
      this.plats = plats;
      this.zones = zones;

      // 3. Construire l'UI
      this.buildTableOptions();
      this.setTodayDate();
      this.bindEvents();
      this.renderDishes();
      this.renderCart();
      this.updateBadge();
      this.updateInfoBar();

      // 4. Écoute temps réel des plats (rupture de stock → mise à jour immédiate)
      this.subscribeToPlats();

    } catch (err) {
      console.error('Erreur init client:', err);
      this.toast('❌ Impossible de charger le menu. Réessayez.', 'error');
    } finally {
      this.showLoader(false);
    }
  }

  showLoader(show) {
    let loader = document.getElementById('appLoader');
    if (show && !loader) {
      loader = document.createElement('div');
      loader.id = 'appLoader';
      loader.style.cssText = 'position:fixed;inset:0;background:rgba(13,13,13,0.9);display:flex;align-items:center;justify-content:center;z-index:9999;font-size:1.5rem;color:white;flex-direction:column;gap:1rem';
      loader.innerHTML = '<div style="font-size:3rem">🔥</div><div>Chargement du menu…</div>';
      document.body.appendChild(loader);
    } else if (!show && loader) {
      loader.remove();
    }
  }

  // ─── Synchronisation temps réel des plats ───
  subscribeToPlats() {
    StreetFoodDB.db
      .channel(`plats-${this.restaurantId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'plats',
        filter: `restaurant_id=eq.${this.restaurantId}`
      }, async () => {
        // Recharger les plats quand un plat change (rupture, ajout, etc.)
        this.plats = await StreetFoodDB.PlatAPI.getAll(this.restaurantId);
        this.renderDishes();
      })
      .subscribe();
  }

  buildTableOptions() {
    [document.getElementById('tableNumber'), document.getElementById('modalTable')].forEach(sel => {
      if (!sel) return;
      sel.innerHTML = '<option value="">— Choisir une table —</option>';
      for (let i = 1; i <= 30; i++) {
        const opt = document.createElement('option');
        const num = String(i).padStart(2, '0');
        opt.value = `table-${num}`;
        opt.textContent = `Table ${num}`;
        sel.appendChild(opt);
      }
    });
  }

  setTodayDate() {
    const el = document.getElementById('resDate');
    if (el) {
      const today = new Date().toISOString().split('T')[0];
      el.value = today; el.min = today;
    }
  }

  bindEvents() {
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.addEventListener('click', e => this.switchTab(e.currentTarget.dataset.tab));
    });
    document.getElementById('cartToggle')?.addEventListener('click', () => this.switchTab('panier'));
    document.querySelectorAll('.cat-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.currentCategory = e.currentTarget.dataset.category;
        this.renderDishes();
      });
    });
    document.getElementById('searchInput')?.addEventListener('input', e => {
      this.renderDishes(this.currentCategory, e.target.value);
    });
    document.addEventListener('click', e => {
      const btn = e.target.closest('.add-btn');
      if (btn && btn.dataset.id) {
        if (btn.classList.contains('rupture')) return;
        this.addToCart(btn.dataset.id);
      }
    });
    document.querySelectorAll('.type-btn[data-type]').forEach(btn => {
      btn.addEventListener('click', e => {
        const type = e.currentTarget.dataset.type;
        this.setOrderType(type);
        document.querySelectorAll('.type-btn[data-type]').forEach(b => b.classList.toggle('active', b.dataset.type === type));
      });
    });
    document.getElementById('delVille')?.addEventListener('input', e => {
      this.checkDeliveryZone(e.target.value);
    });
    document.getElementById('submitOrderBtn')?.addEventListener('click', () => this.submitOrder());
    document.getElementById('reservationForm')?.addEventListener('submit', e => {
      e.preventDefault(); this.submitReservation();
    });
    document.getElementById('changeInfoBtn')?.addEventListener('click', () => this.openModal());
    document.getElementById('closeModalBtn')?.addEventListener('click', () => this.closeModal());
    document.getElementById('saveModalBtn')?.addEventListener('click', () => this.saveModal());
    document.getElementById('changeModal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('changeModal')) this.closeModal();
    });
    document.querySelectorAll('[data-modal-type]').forEach(btn => {
      btn.addEventListener('click', e => {
        const type = e.currentTarget.dataset.modalType;
        document.querySelectorAll('[data-modal-type]').forEach(b => b.classList.toggle('active', b.dataset.modalType === type));
        document.getElementById('modalOnsiteBlock').style.display = type === 'onsite' ? '' : 'none';
        document.getElementById('modalDeliveryBlock').style.display = type === 'delivery' ? '' : 'none';
      });
    });
  }

  switchTab(name) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
    document.getElementById(name + 'Tab')?.classList.add('active');
    document.querySelector(`[data-tab="${name}"]`)?.classList.add('active');
    if (name === 'panier') this.renderCart();
  }

  setOrderType(type) {
    this.orderType = type;
    document.getElementById('onsiteBlock').style.display = type === 'onsite' ? '' : 'none';
    document.getElementById('deliveryBlock').style.display = type === 'delivery' ? '' : 'none';
    const feeRow = document.getElementById('deliveryFeeRow');
    if (feeRow) feeRow.style.display = type === 'delivery' ? '' : 'none';
    this.updateTotals();
  }

  checkDeliveryZone(val) {
    const info = document.getElementById('deliveryZoneInfo');
    if (!info) return;
    if (!val.trim()) { info.style.display = 'none'; return; }
    const zone = this.zones.find(z => z.nom.toLowerCase().includes(val.toLowerCase().trim()));
    if (zone) {
      info.className = 'zone-info';
      info.textContent = `✅ Livraison disponible — Frais : ${this.fmt(zone.prix_livraison)}`;
      info.style.display = '';
      this._deliveryFee = zone.prix_livraison;
    } else if (val.length >= 2) {
      info.className = 'zone-info invalid';
      info.textContent = `❌ Livraison non disponible pour "${val}" — contactez-nous.`;
      info.style.display = '';
      this._deliveryFee = 0;
    }
    this.updateTotals();
  }

  renderDishes(category = this.currentCategory, search = '') {
    const grid = document.getElementById('dishesGrid');
    if (!grid) return;
    const q = document.getElementById('searchInput')?.value || search;
    let list = this.plats.filter(p =>
      (category === 'all' || p.category === category) &&
      p.nom.toLowerCase().includes(q.toLowerCase())
    );
    if (!list.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:3rem">
        <i class="fas fa-search" style="font-size:2rem;display:block;margin-bottom:1rem;opacity:.3"></i>Aucun plat trouvé
      </div>`;
      return;
    }
    grid.innerHTML = list.map(p => `
      <div class="dish-card">
        ${p.image_url ? `<img src="${p.image_url}" alt="${p.nom}" class="dish-img" loading="lazy">`
                     : `<div class="dish-img-placeholder">${this.catEmoji(p.category)}</div>`}
        <div class="dish-body">
          <div class="dish-name">${p.nom}</div>
          <div class="dish-desc">${p.description || ''}</div>
          ${(p.tags||[]).length ? `<div class="dish-tags">${p.tags.map(t=>`<span class="dish-tag">${t}</span>`).join('')}</div>` : ''}
          <div class="dish-footer">
            <span class="dish-price">${this.fmt(p.prix)}</span>
            <button class="add-btn ${!p.disponible?'rupture':''}" data-id="${p.id}"
              title="${p.disponible?'Ajouter':'Rupture de stock'}">
              ${p.disponible ? '<i class="fas fa-plus"></i>' : '<i class="fas fa-ban"></i>'}
            </button>
          </div>
        </div>
      </div>
    `).join('');
  }

  addToCart(id) {
    const plat = this.plats.find(p => p.id === id);
    if (!plat || !plat.disponible) return;
    const ex = this.panier.find(i => i.id === id);
    if (ex) ex.quantite++;
    else this.panier.push({ id: plat.id, nom: plat.nom, prix: plat.prix, image: plat.image_url, category: plat.category, quantite: 1 });
    this.saveCart();
    this.toast(`✅ ${plat.nom} ajouté !`);
    this.renderCart();
  }

  renderCart() {
    const container = document.getElementById('cartItems');
    const footer = document.getElementById('cartFooter');
    if (!container) return;
    if (!this.panier.length) {
      container.innerHTML = `<div class="cart-empty"><i class="fas fa-shopping-bag"></i>Votre panier est vide</div>`;
      if (footer) footer.style.display = 'none';
      return;
    }
    container.innerHTML = this.panier.map(item => `
      <div class="cart-item">
        ${item.image ? `<img src="${item.image}" class="cart-item-img">` : ''}
        <div class="cart-item-info">
          <div class="cart-item-name">${item.nom}</div>
          <div class="cart-item-price">${this.fmt(item.prix * item.quantite)}</div>
        </div>
        <div class="qty-controls">
          <button class="qty-btn" onclick="app.updateQty('${item.id}', -1)">−</button>
          <span class="qty-num">${item.quantite}</span>
          <button class="qty-btn" onclick="app.updateQty('${item.id}', 1)">+</button>
        </div>
        <button class="remove-btn" onclick="app.updateQty('${item.id}', -999)">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>
    `).join('');
    if (footer) footer.style.display = '';
    this.updateTotals();
    this.updateBadge();
  }

  updateTotals() {
    const sub = this.panier.reduce((s, i) => s + i.prix * i.quantite, 0);
    const fee = this.orderType === 'delivery' ? (this._deliveryFee || 0) : 0;
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('subtotalAmt', this.fmt(sub));
    setEl('deliveryFeeAmt', this.fmt(fee));
    setEl('grandTotalAmt', this.fmt(sub + fee));
    const feeRow = document.getElementById('deliveryFeeRow');
    if (feeRow) feeRow.style.display = this.orderType === 'delivery' ? '' : 'none';
  }

  updateQty(id, change) {
    if (change === -999) {
      this.panier = this.panier.filter(i => i.id !== id);
    } else {
      const item = this.panier.find(i => i.id === id);
      if (!item) return;
      item.quantite += change;
      if (item.quantite <= 0) this.panier = this.panier.filter(i => i.id !== id);
    }
    this.saveCart();
    this.renderCart();
  }

  saveCart() {
    localStorage.setItem('sf_panier', JSON.stringify(this.panier));
    this.updateBadge();
  }

  updateBadge() {
    const count = this.panier.reduce((s, i) => s + i.quantite, 0);
    const el = document.getElementById('cartBadge');
    if (el) el.textContent = count;
  }

  async submitOrder() {
    if (!this.panier.length) return this.toast('❌ Le panier est vide', 'error');
    if (this.orderType === 'onsite') {
      const table = document.getElementById('tableNumber')?.value;
      if (!table) return this.toast('❌ Veuillez choisir une table', 'error');
      this.selectedTable = table;
    } else {
      const ville = document.getElementById('delVille')?.value?.trim();
      const nom = document.getElementById('delNom')?.value?.trim();
      const tel = document.getElementById('delTel')?.value?.trim();
      const adresse = document.getElementById('delAdresse')?.value?.trim();
      if (!nom || !ville || !tel || !adresse) return this.toast('❌ Remplissez tous les champs livraison', 'error');
      const zone = this.zones.find(z => z.nom.toLowerCase().includes(ville.toLowerCase()));
      if (!zone) return this.toast('❌ Zone de livraison non disponible', 'error');
    }

    const sub = this.panier.reduce((s, i) => s + i.prix * i.quantite, 0);
    const fee = this.orderType === 'delivery' ? (this._deliveryFee || 0) : 0;

    const orderData = {
      type: this.orderType,
      table: this.orderType === 'onsite' ? document.getElementById('tableNumber')?.value : null,
      orderRef: document.getElementById('orderRef')?.value || null,
      deliveryInfo: this.orderType === 'delivery' ? {
        nom: document.getElementById('delNom')?.value,
        prenom: document.getElementById('delPrenom')?.value,
        ville: document.getElementById('delVille')?.value,
        adresse: document.getElementById('delAdresse')?.value,
        tel: document.getElementById('delTel')?.value,
      } : null,
      items: this.panier,
      total: sub,
      fraisLivraison: fee,
      totalFinal: sub + fee,
      instructions: document.getElementById('specialInstructions')?.value || ''
    };

    try {
      const btn = document.getElementById('submitOrderBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Envoi en cours…'; }
      const commande = await StreetFoodDB.CommandeAPI.create(this.restaurantId, orderData);
      this.toast(`🚀 Commande #${commande.id.slice(-6)} envoyée !`, 'success');
      this.panier = [];
      this.saveCart();
      this.renderCart();
      this.updateInfoBar();
      setTimeout(() => this.switchTab('menu'), 1800);
    } catch (err) {
      console.error('Erreur commande:', err);
      this.toast('❌ Erreur lors de l\'envoi. Réessayez.', 'error');
    } finally {
      const btn = document.getElementById('submitOrderBtn');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check-circle"></i> Passer la commande'; }
    }
  }

  async submitReservation() {
    const data = {
      nom: document.getElementById('resNom')?.value,
      prenom: document.getElementById('resPrenom')?.value,
      date: document.getElementById('resDate')?.value,
      heure: document.getElementById('resHeure')?.value,
      personnes: document.getElementById('resPersonnes')?.value,
      tel: document.getElementById('resTel')?.value,
      notes: document.getElementById('resNotes')?.value
    };
    try {
      await StreetFoodDB.ReservationAPI.create(this.restaurantId, data);
      this.toast('📅 Réservation envoyée ! À bientôt 🎉');
      document.getElementById('reservationForm')?.reset();
      this.setTodayDate();
    } catch (err) {
      this.toast('❌ Erreur lors de la réservation.', 'error');
    }
  }

  updateInfoBar() {
    const el = document.getElementById('infoBarText');
    if (!el) return;
    if (this.orderType === 'onsite' && this.selectedTable)
      el.textContent = `🪑 ${this.selectedTable.replace('table-', 'Table ')} — Sur place`;
    else if (this.orderType === 'delivery') el.textContent = `🚴 Mode livraison`;
    else el.textContent = `📍 Choisissez votre table ou mode de commande`;
  }

  openModal() { document.getElementById('changeModal').style.display = 'flex'; }
  closeModal() { document.getElementById('changeModal').style.display = 'none'; }
  saveModal() {
    const type = document.querySelector('[data-modal-type].active')?.dataset?.modalType || 'onsite';
    this.orderType = type;
    this.setOrderType(type);
    document.querySelectorAll('.type-btn[data-type]').forEach(b => b.classList.toggle('active', b.dataset.type === type));
    if (type === 'onsite') {
      const table = document.getElementById('modalTable')?.value;
      if (table) { this.selectedTable = table; const sel = document.getElementById('tableNumber'); if (sel) sel.value = table; }
    } else {
      const ville = document.getElementById('modalVille')?.value;
      if (ville) { const inp = document.getElementById('delVille'); if (inp) { inp.value = ville; this.checkDeliveryZone(ville); } }
    }
    this.updateInfoBar();
    this.closeModal();
    this.toast('✅ Informations mises à jour', 'info');
  }

  catEmoji(cat) {
    return { burgers:'🍔', pizzas:'🍕', pates:'🍝', salades:'🥗', desserts:'🍰', boissons:'🥤' }[cat] || '🍽️';
  }

  fmt(cents) {
    return new Intl.NumberFormat('fr-FR').format(Math.round((cents||0) / 100)) + ' FCFA';
  }

  toast(msg, type = 'success') {
    const c = document.getElementById('toastContainer');
    if (!c) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; }, 2800);
    setTimeout(() => el.remove(), 3200);
  }
}

const app = new StreetFoodClient();
window.app = app;