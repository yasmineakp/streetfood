/* =========================================
   STREET FOOD — DASHBOARD VENDEUR
   Version Supabase — temps réel + multi-resto
   ========================================= */

class StreetFoodDashboard {
  constructor() {
    this.restaurant = null;
    this.restaurantId = null;
    this.commandes = [];
    this.reservations = [];
    this.plats = [];
    this.zones = [];
    this.periode = 'today';
    this.currentSub = 'all';
    this.charts = {};
    this.prevOrderCount = 0;
    this.realtimeChannels = [];
    // Dans ton constructor ou init()
    this.livreurs = JSON.parse(localStorage.getItem('nacreatsLivreurs')) || [];

    // Méthode pour sauvegarder les livreurs
    this.init();
  }

  async init() {
    this.showLoader(true);
    try {
      const slug = StreetFoodDB.getRestaurantSlug();
      this.restaurant = await StreetFoodDB.RestaurantAPI.getBySlug(slug);
      this.restaurantId = this.restaurant.id;

      document.title = `${this.restaurant.nom} — Dashboard`;
      document.querySelector('.brand-label').textContent = this.restaurant.nom;
      if (this.restaurant.couleur)
        document.documentElement.style.setProperty('--fire', this.restaurant.couleur);

      await this.loadAll();
      this.bindEvents();
      this.startClock();
      this.renderAll();
      this.subscribeRealtime();
    } catch (err) {
      console.error('Erreur init dashboard:', err);
      this.toast('❌ Connexion impossible. Vérifiez votre config Supabase.', 'error');
    } finally {
      this.showLoader(false);
    }
  }

  showLoader(show) {
    let el = document.getElementById('appLoader');
    if (show && !el) {
      el = document.createElement('div');
      el.id = 'appLoader';
      el.style.cssText = 'position:fixed;inset:0;background:rgba(10,10,10,0.95);display:flex;align-items:center;justify-content:center;z-index:9999;flex-direction:column;gap:1rem;color:white;font-family:var(--font-display)';
      el.innerHTML = '<div style="font-size:4rem">🔥</div><div style="font-size:1.2rem;font-weight:700">Connexion au dashboard…</div>';
      document.body.appendChild(el);
    } else if (!show && el) el.remove();
  }

  async loadAll() {
    const [commandes, reservations, plats, zones] = await Promise.all([
      StreetFoodDB.CommandeAPI.getAll(this.restaurantId),
      StreetFoodDB.ReservationAPI.getAll(this.restaurantId),
      StreetFoodDB.PlatAPI.getAll(this.restaurantId),
      StreetFoodDB.ZoneAPI.getAll(this.restaurantId)
    ]);
    this.commandes = commandes;
    this.reservations = reservations;
    this.plats = plats;
    this.zones = zones;
    this.prevOrderCount = this.commandes.filter(c => c.status === 'pending').length;
  }

  // ─── TEMPS RÉEL SUPABASE ───
  subscribeRealtime() {
    // Nouvelle commande → alerte + rechargement
    const ch1 = StreetFoodDB.CommandeAPI.subscribeNew(this.restaurantId, async (newCmd) => {
      await this.loadAll();
      this.renderAll();
      this.updateKPI();
      this.playSound();
      this.toast(`🔔 Nouvelle commande #${newCmd.id.slice(-6)} !`, 'new-order');
      document.querySelector('[data-tab="commandes"]')?.classList.add('has-new');
      setTimeout(() => document.querySelector('[data-tab="commandes"]')?.classList.remove('has-new'), 6000);
    });

    // Mise à jour statut → rechargement silencieux
    const ch2 = StreetFoodDB.CommandeAPI.subscribeUpdates(this.restaurantId, async () => {
      await this.loadAll();
      if (document.getElementById('commandesPanel')?.classList.contains('active')) this.renderOrders();
      this.updateKPI();
    });
// Écouteur pour les changements sur les PLATS
const ch3 = supabase
  .channel('realtime-plats')
  .on('postgres_changes', { 
    event: '*', 
    schema: 'public', 
    table: 'plats',
    filter: `restaurant_id=eq.${this.restaurantId}` 
  }, async (payload) => {
    console.log('Changement détecté sur un plat !', payload);
    await this.loadAll(); // On recharge les données
    this.renderPlats();   // On rafraîchit l'affichage
    this.toast('🥗 La carte a été mise à jour');
  })
  .subscribe();

// On met à jour la liste des canaux actifs
this.realtimeChannels = [ch1, ch2, ch3];
    this.realtimeChannels = [ch1, ch2];
  }

  bindEvents() {
    document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
      btn.addEventListener('click', e => this.switchTab(e.currentTarget.dataset.tab));
    });
    document.querySelectorAll('.sub-tab[data-sub]').forEach(btn => {
      btn.addEventListener('click', e => {
        document.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.currentSub = e.currentTarget.dataset.sub;
        this.renderOrders();
      });
    });
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.periode = e.currentTarget.dataset.period;
        this.renderStats();
      });
    });
    document.getElementById('refreshBtn')?.addEventListener('click', async () => {
      await this.loadAll(); this.renderAll(); this.toast('🔄 Mis à jour');
    });
    document.getElementById('addPlatForm')?.addEventListener('submit', e => {
      e.preventDefault(); this.addPlat();
    });
    document.getElementById('addZoneBtn')?.addEventListener('click', () => this.addZone());
    document.getElementById('exportOrdersBtn')?.addEventListener('click', () => this.exportOrders());
    document.getElementById('exportStatsBtn')?.addEventListener('click', () => this.exportStats());
    
    // Écouteur pour ajout de livreur
    document.getElementById('addLivreurBtn')?.addEventListener('click', () => this.addLivreur());

    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'status') this.updateStatus(id, btn.dataset.status);
      if (action === 'toggle-dispo') this.toggleDispo(id);
      if (action === 'delete-plat') this.deletePlat(id);
      if (action === 'remove-zone') this.removeZone(id);
      if (action === 'confirm-res') this.confirmReservation(id);
      if (action === 'reject-res') this.rejectReservation(id);
    });

    document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });
  }

  startClock() {
    const upd = () => {
      const el = document.getElementById('realTime');
      if (el) el.textContent = new Date().toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    };
    upd(); setInterval(upd, 1000);
  }

  switchTab(name) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector(`[data-tab="${name}"]`)?.classList.add('active');
    document.getElementById(name + 'Panel')?.classList.add('active');
    if (name === 'stats') this.renderStats();
    if (name === 'gestion') this.renderPlats();
    if (name === 'livraison') this.renderZones();
  }

  updateKPI() {
    const live = this.commandes.filter(c => !['servi','livree','annulee'].includes(c.status)).length;
    const tables = new Set(this.commandes.filter(c => c.type === 'onsite' && !['servi'].includes(c.status)).map(c => c.table)).size;
    const deliveries = this.commandes.filter(c => c.type === 'delivery').length;
    const today = this.commandes.filter(c => new Date(c.timestamp).toDateString() === new Date().toDateString());
    const ca = today.reduce((s, c) => s + (c.totalFinal || c.total || 0), 0);

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('kpiLive', live);
    set('kpiCA', this.fmt(ca));
    set('kpiTables', `${tables}/30`);
    set('kpiDeliveries', deliveries);
    set('liveOrdersBadge', live);
    set('mobileBadge', live);
  }

  // ─── COMMANDES ───
  renderOrders() {
    if (this.currentSub === 'reservation') {
      document.getElementById('ordersList').style.display = 'none';
      document.getElementById('reservationsList').style.display = '';
      this.renderReservations(); return;
    }
    document.getElementById('ordersList').style.display = '';
    document.getElementById('reservationsList').style.display = 'none';

    let list = this.currentSub === 'all' ? [...this.commandes]
             : this.currentSub === 'surplace' ? this.commandes.filter(c => c.type === 'onsite')
             : this.commandes.filter(c => c.type === 'delivery');
    list = list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('subAll', this.commandes.length);
    set('subSurplace', this.commandes.filter(c=>c.type==='onsite').length);
    set('subLivraison', this.commandes.filter(c=>c.type==='delivery').length);
    set('subReservation', this.reservations.length);

    const board = document.getElementById('ordersList');
    if (!list.length) {
      board.innerHTML = `<div class="empty-state"><i class="fas fa-receipt"></i>Aucune commande</div>`; return;
    }

    board.innerHTML = list.map(cmd => {
      const status = cmd.status || 'pending';
      const finalStatus = cmd.type === 'onsite' ? 'servi' : 'livree';
      const selectLivreur = `
        <select class="livreur-select" data-cmd-id="${cmd.id}">
          <option value="">Assigner un livreur</option>
          ${this.livreurs.map(l => `
            <option value="${l.id}" ${cmd.livreurId === l.id ? 'selected' : ''}>
              ${l.nom} (${l.tel})
            </option>
          `).join('')}
        </select>
      `;
      return `
        <div class="order-card ${status}">
          <div class="order-head">
            <span class="order-num">#${cmd.id.slice(-6)}</span>
            <span class="order-time">${this.timeAgo(cmd.timestamp)}</span>
            <span class="order-type-badge ${cmd.type}">${cmd.type==='onsite'?'🪑 Sur place':'🚴 Livraison'}</span>
            ${cmd.table?`<span class="order-table-badge">${cmd.table}</span>`:''}
            ${cmd.orderRef?`<span class="order-table-badge">Réf: ${cmd.orderRef}</span>`:''}
          </div>
          <div class="order-body">
            ${cmd.deliveryInfo?`<div class="delivery-info-row">
              <strong>${cmd.deliveryInfo.nom||''} ${cmd.deliveryInfo.prenom||''}</strong> —
              📍 ${cmd.deliveryInfo.ville||''}, ${cmd.deliveryInfo.adresse||''} 📞 ${cmd.deliveryInfo.tel||''}
            </div>`:''}
            <div class="order-items-row">
              ${(cmd.items||[]).map(it=>`<span class="order-item-chip"><b>${it.quantite}x</b> ${it.nom}</span>`).join('')}
            </div>
            ${cmd.instructions?`<div style="font-size:.82rem;color:var(--muted2);margin-top:.3rem">💬 ${cmd.instructions}</div>`:''}
            ${cmd.type === 'delivery' ? selectLivreur : ''}
          </div>
          <div class="order-foot">
            <span class="order-total">${this.fmt(cmd.totalFinal||cmd.total||0)}</span>
            <div class="status-actions">
              <button class="status-btn ${status==='pending'?'active-status':''}" data-action="status" data-id="${cmd.id}" data-status="pending">Nouveau</button>
              <button class="status-btn ${status==='preparation'?'active-status':''}" data-action="status" data-id="${cmd.id}" data-status="preparation">Prépa</button>
              <button class="status-btn ${status==='pret'?'active-status':''}" data-action="status" data-id="${cmd.id}" data-status="pret">Prêt</button>
              <button class="status-btn ${['servi','livree'].includes(status)?'done':''}" data-action="status" data-id="${cmd.id}" data-status="${finalStatus}">
                ${cmd.type==='onsite'?'✅ Servi':'✅ Livrée'}
              </button>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  async assignLivreur(cmdId, livreurId) {
    try {
      await StreetFoodDB.CommandeAPI.assignLivreur(cmdId, livreurId);
      this.toast('✅ Livreur assigné !');
      await this.loadAll();
      this.renderOrders();
    } catch (err) {
      this.toast('❌ Erreur assignation livreur', 'error');
    }
  }

  async updateStatus(id, status) {
    try {
      await StreetFoodDB.CommandeAPI.updateStatus(id, status);
      // La mise à jour temps réel rechargera automatiquement
      this.toast(`#${id.slice(-6)} → ${this.statusLabel(status)}`, 'info');
      this.playSound();
    } catch (err) {
      this.toast('❌ Erreur mise à jour', 'error');
    }
  }

  renderReservations() {
    const list = document.getElementById('reservationsList');
    if (!this.reservations.length) {
      list.innerHTML = `<div class="empty-state"><i class="fas fa-calendar"></i>Aucune réservation</div>`; return;
    }
    list.innerHTML = this.reservations.map(r => `
      <div class="res-card">
        <div class="res-info">
          <div class="res-name">${r.nom} ${r.prenom}</div>
          <div class="res-details">📅 ${r.date} à ${r.heure} — 👥 ${r.personnes} personnes — 📞 ${r.tel}</div>
          ${r.notes?`<div class="res-details">💬 ${r.notes}</div>`:''}
        </div>
        <div class="res-status-btns">
          <button class="res-btn confirm" data-action="confirm-res" data-id="${r.id}">✅ Confirmer</button>
          <button class="res-btn reject" data-action="reject-res" data-id="${r.id}">❌ Refuser</button>
        </div>
      </div>`).join('');
  }

  async confirmReservation(id) {
    await StreetFoodDB.ReservationAPI.updateStatus(id, 'confirmee');
    this.reservations = this.reservations.filter(r => r.id !== id);
    this.renderReservations();
    this.toast('✅ Réservation confirmée !');
  }

  async rejectReservation(id) {
    await StreetFoodDB.ReservationAPI.updateStatus(id, 'annulee');
    this.reservations = this.reservations.filter(r => r.id !== id);
    this.renderReservations();
    this.toast('❌ Réservation refusée', 'error');
  }

  // ─── GESTION LIVREURS ───
  renderLivreurList() {
    const container = document.getElementById('livreursList');
    if (!container) return;
    
    if (!this.livreurs.length) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-motorcycle"></i>Aucun livreur</div>';
      return;
    }
    
    container.innerHTML = this.livreurs.map(l => `
      <div class="livreur-item">
        <div>
          <strong>${l.nom}</strong><br>
          <small>📞 ${l.tel}</small>
        </div>
        <button class="delete-livreur" data-action="delete-livreur" data-id="${l.id}">❌</button>
      </div>
    `).join('');
  }

  // 1. La fonction pour AJOUTER
  addLivreur() {
    const nom = document.getElementById('livreurNom')?.value.trim();
    const tel = document.getElementById('livreurTel')?.value.trim();

    if (!nom || !tel) {
      this.toast('❌ Nom et téléphone requis', 'error');
      return;
    }

    const nouveauLivreur = {
      id: Date.now().toString(),
      nom: nom,
      tel: tel
    };
    
    this.livreurs.push(nouveauLivreur);
    this.saveLivreurs();
    this.renderLivreurList();
    
    // Reset des champs
    document.getElementById('livreurNom').value = '';
    document.getElementById('livreurTel').value = '';
    
    this.toast('✅ Livreur ajouté !');
  } // <--- Fermeture bien placée ici

  // 2. La fonction pour SUPPRIMER
  deleteLivreur(id) {
    if (!confirm('Supprimer ce livreur ?')) return;
    this.livreurs = this.livreurs.filter(l => l.id !== id);
    this.saveLivreurs();
    this.renderLivreurList();
    this.renderOrders();
    this.toast('🗑️ Livreur supprimé');
  }

  // 3. La fonction pour WHATSAPP
  sendToWhatsApp(orderId) {
    const cmd = this.commandes.find(c => c.id === orderId);
    if (!cmd || !cmd.livreurId) return this.toast('⚠️ Assignez un livreur d\'abord', 'error');
    
    const livreur = this.livreurs.find(l => l.id === cmd.livreurId);
    if (!livreur) return;

    const message = `*NOUVELLE COURSE NACReats*\n\n` +
                    `📍 *Client:* ${cmd.deliveryInfo?.nom || 'Client'}\n` +
                    `🏠 *Adresse:* ${cmd.deliveryInfo?.adresse || 'Non précisée'}\n` +
                    `📞 *Contact:* ${cmd.deliveryInfo?.tel || ''}\n` +
                    `💰 *Total à encaisser:* ${this.fmt(cmd.totalFinal || cmd.total)}\n` +
                    `🔗 *Lien de suivi:* ${window.location.origin}/track/${cmd.id}`;
    
    window.open(`https://wa.me/225${livreur.tel}?text=${encodeURIComponent(message)}`, '_blank');
  }

  saveLivreurs() {
    localStorage.setItem('nacreatsLivreurs', JSON.stringify(this.livreurs));
  }

  // ─── STATISTIQUES ───
  renderStats() {
    const filtered = this.filterByPeriod(this.commandes, this.periode);
    const labels = {today:"Aujourd'hui",yesterday:"Hier",'7days':"7 jours",'30days':"30 jours",year:"Année"};
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('statPeriodLabel', labels[this.periode]);
    set('statTotalOrders', filtered.length);
    this.renderCAChart(filtered);
    this.renderRushChart(filtered);
    this.renderDishChart(filtered);
    this.renderTypeChart(filtered);
    this.updateTopCards(filtered);
  }

  filterByPeriod(list, period) {
    const now = new Date();
    return list.filter(c => {
      const d = new Date(c.timestamp), diff = (now-d)/86400000;
      switch(period) {
        case 'today': return d.toDateString()===now.toDateString();
        case 'yesterday': return diff>=1&&diff<2;
        case '7days': return diff<=7;
        case '30days': return diff<=30;
        case 'year': return diff<=365;
        default: return true;
      }
    });
  }

  gc() {
    return { fire:'rgba(255,107,43,0.8)', fireBg:'rgba(255,107,43,0.15)', amber:'rgba(251,191,36,0.8)',
             green:'rgba(34,197,94,0.8)', blue:'rgba(59,130,246,0.8)', grid:'rgba(255,255,255,0.05)', text:'rgba(255,255,255,0.5)' };
  }

  destroyChart(id) { if (this.charts[id]) { this.charts[id].destroy(); delete this.charts[id]; } }

  chartOpts() {
    const c = this.gc();
    return {
      responsive:true,
      plugins:{ legend:{display:false}, tooltip:{backgroundColor:'rgba(20,20,20,0.9)',titleColor:'#fff',bodyColor:'rgba(255,255,255,0.7)',borderColor:c.grid,borderWidth:1} },
      scales:{ x:{grid:{color:c.grid},ticks:{color:c.text,maxTicksLimit:8}}, y:{grid:{color:c.grid},ticks:{color:c.text}} }
    };
  }

  renderCAChart(filtered) {
    this.destroyChart('ca');
    const ctx = document.getElementById('caChart'); if (!ctx) return;
    const c = this.gc(), grouped = {};
    filtered.forEach(cmd => {
      const d = new Date(cmd.timestamp);
      const key = this.periode==='today'?`${d.getHours()}h`:d.toLocaleDateString('fr-FR',{month:'short',day:'numeric'});
      grouped[key] = (grouped[key]||0) + (cmd.totalFinal||cmd.total||0)/100;
    });
    const labels = Object.keys(grouped).slice(-12), data = labels.map(k=>grouped[k]);
    this.charts.ca = new Chart(ctx, { type:'bar', data:{labels,datasets:[{label:'CA (FCFA)',data,backgroundColor:c.fireBg,borderColor:c.fire,borderWidth:2,borderRadius:6}]}, options:this.chartOpts() });
  }

  renderRushChart(filtered) {
    this.destroyChart('rush');
    const ctx = document.getElementById('rushChart'); if (!ctx) return;
    const c = this.gc(), hours = {};
    for (let i=0;i<24;i++) hours[i+'h']=0;
    filtered.forEach(cmd => { hours[new Date(cmd.timestamp).getHours()+'h']++; });
    this.charts.rush = new Chart(ctx, { type:'line', data:{labels:Object.keys(hours),datasets:[{label:'Commandes',data:Object.values(hours),fill:true,backgroundColor:'rgba(251,191,36,0.1)',borderColor:c.amber,tension:0.4,pointRadius:2}]}, options:this.chartOpts() });
  }

  renderDishChart(filtered) {
    this.destroyChart('dish');
    const ctx = document.getElementById('dishChart'); if (!ctx) return;
    const c = this.gc(), counts = {};
    filtered.forEach(cmd => { (cmd.items||[]).forEach(it => { counts[it.nom]=(counts[it.nom]||0)+it.quantite; }); });
    const sorted = Object.entries(counts).sort(([,a],[,b])=>b-a).slice(0,8);
    this.charts.dish = new Chart(ctx, {
      type:'bar',
      data:{labels:sorted.map(([k])=>k.length>15?k.slice(0,15)+'…':k),datasets:[{label:'Quantité',data:sorted.map(([,v])=>v),backgroundColor:[c.fire,c.amber,c.green,c.blue,c.fire,c.amber,c.green,c.blue],borderRadius:6}]},
      options:{...this.chartOpts(),indexAxis:'y'}
    });
  }

  renderTypeChart(filtered) {
    this.destroyChart('type');
    const ctx = document.getElementById('typeChart'); if (!ctx) return;
    const c = this.gc();
    this.charts.type = new Chart(ctx, {
      type:'doughnut',
      data:{labels:['Sur place','Livraison'],datasets:[{data:[filtered.filter(c=>c.type==='onsite').length,filtered.filter(c=>c.type==='delivery').length],backgroundColor:[c.green,c.blue],borderWidth:0}]},
      options:{plugins:{legend:{labels:{color:c.text}}},cutout:'65%'}
    });
  }

  updateTopCards(filtered) {
    const counts = {};
    filtered.forEach(cmd => { (cmd.items||[]).forEach(it => { counts[it.nom]=(counts[it.nom]||0)+it.quantite; }); });
    const top = Object.entries(counts).sort(([,a],[,b])=>b-a)[0];
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('topDishName', top?top[0]:'—');
    set('topDishCount', top?`${top[1]} commandé(s)`:'');
    const hours = {};
    filtered.forEach(cmd => { const h = new Date(cmd.timestamp).getHours(); hours[h]=(hours[h]||0)+1; });
    const topH = Object.entries(hours).sort(([,a],[,b])=>b-a)[0];
    set('topHour', topH?`${topH[0]}h00`:'—');
    set('topHourCount', topH?`${topH[1]} commandes`:'');
  }

  // ─── GESTION PLATS ───
  renderPlats() {
    const wrap = document.getElementById('platsGestion'); if (!wrap) return;
    if (!this.plats.length) { wrap.innerHTML = `<div class="empty-state"><i class="fas fa-box-open"></i>Aucun plat</div>`; return; }
    wrap.innerHTML = this.plats.map(p => `
      <div class="plat-row">
        ${p.image_url?`<img src="${p.image_url}" alt="${p.nom}" onerror="this.style.display='none'">`:''}
        <div class="plat-row-info">
          <div class="plat-row-name">${p.nom}</div>
          <div class="plat-row-price">${this.fmt(p.prix)}</div>
          <div class="plat-row-cat">${this.catLabel(p.category)}</div>
        </div>
        <div class="plat-row-actions">
          <span class="${p.disponible?'badge-dispo':'badge-rupture'}">${p.disponible?'✅ Dispo':'❌ Rupture'}</span>
          <button class="toggle-dispo-btn" data-action="toggle-dispo" data-id="${p.id}">${p.disponible?'Rupture':'Remettre'}</button>
          <button class="delete-plat-btn" data-action="delete-plat" data-id="${p.id}"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join('');
  }

  async addPlat() {
    const nom = document.getElementById('newNom')?.value.trim();
    const prix = parseFloat(document.getElementById('newPrix')?.value) * 100;
    if (!nom || !prix) return this.toast('❌ Nom et prix requis', 'error');
    try {
      const plat = await StreetFoodDB.PlatAPI.add(this.restaurantId, {
        nom, prix,
        category: document.getElementById('newCat')?.value || 'burgers',
        image_url: document.getElementById('newImg')?.value || '',
        description: document.getElementById('newDesc')?.value || '',
        tags: (document.getElementById('newTags')?.value||'').split(',').map(t=>t.trim()).filter(Boolean),
        disponible: true
      });
      this.plats.push(plat);
      document.getElementById('addPlatForm').reset();
      this.renderPlats();
      this.toast(`✅ ${nom} ajouté !`);
    } catch (err) { this.toast('❌ Erreur ajout plat', 'error'); }
  }

  async toggleDispo(id) {
    const plat = this.plats.find(p => p.id === id);
    if (!plat) return;
    try {
      await StreetFoodDB.PlatAPI.toggleDispo(id, !plat.disponible);
      plat.disponible = !plat.disponible;
      this.renderPlats();
      this.toast(plat.disponible ? '✅ Disponible' : '⚠️ Rupture', plat.disponible?'success':'error');
    } catch (err) { this.toast('❌ Erreur', 'error'); }
  }

  async deletePlat(id) {
    try {
      await StreetFoodDB.PlatAPI.delete(id);
      this.plats = this.plats.filter(p => p.id !== id);
      this.renderPlats();
      this.toast('🗑️ Plat supprimé');
    } catch (err) { this.toast('❌ Erreur suppression', 'error'); }
  }

  // ─── ZONES ───
  renderZones() {
    const table = document.getElementById('zonesTable'); if (!table) return;
    if (!this.zones.length) {
      table.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--muted)">Aucune zone configurée</div>`; return;
    }
    table.innerHTML = this.zones.map(z => `
      <div class="zone-row">
        <span class="zone-name">📍 ${z.nom}</span>
        <span class="zone-price">${this.fmt(z.prix_livraison)}</span>
        <button class="remove-zone-btn" data-action="remove-zone" data-id="${z.id}">Supprimer</button>
      </div>`).join('');
  }

  async addZone() {
    const nom = document.getElementById('newZoneName')?.value.trim();
    const prix = parseInt(document.getElementById('newZonePrice')?.value) * 100;
    if (!nom || !prix) return this.toast('❌ Nom et prix requis', 'error');
    try {
      const zone = await StreetFoodDB.ZoneAPI.add(this.restaurantId, nom, prix);
      this.zones.push(zone);
      document.getElementById('newZoneName').value = '';
      document.getElementById('newZonePrice').value = '';
      this.renderZones();
      this.toast(`✅ Zone "${nom}" ajoutée`);
    } catch (err) {
      if (err.code === '23505') this.toast('⚠️ Zone déjà existante', 'error');
      else this.toast('❌ Erreur ajout zone', 'error');
    }
  }

  async removeZone(id) {
    try {
      await StreetFoodDB.ZoneAPI.remove(id);
      this.zones = this.zones.filter(z => z.id !== id);
      this.renderZones();
      this.toast('🗑️ Zone supprimée');
    } catch (err) { this.toast('❌ Erreur', 'error'); }
  }

  // ─── EXPORTS CSV ───
  exportSurPlace() {
    const list = this.commandes.filter(c => c.type === 'onsite');
    const rows = [['ID', 'Date', 'Heure', 'Table', 'N° Référence', 'Nb Articles', 'Détail Articles', 'Prix unitaires (FCFA)', 'Sous-total (FCFA)', 'Statut', 'Instructions']];
    
    list.forEach(c => {
      const d = new Date(c.timestamp);
      rows.push([
        '#' + c.id.slice(-6),
        d.toLocaleDateString('fr-FR'),
        d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        c.table || '',
        c.orderRef || '',
        (c.items || []).reduce((s, i) => s + i.quantite, 0),
        (c.items || []).map(i => `${i.quantite}x ${i.nom}`).join(' | '),
        (c.items || []).map(i => `${i.nom}: ${Math.round(i.prix)} FCFA`).join(' | '),
        Math.round(c.total || 0),
        this.statusLabel(c.status),
        c.instructions || ''
      ]);
    });
    this.downloadCSV(rows, 'commandes_surplace.csv');
    this.toast('📊 Export Sur place OK');
  }

  exportLivraison() {
    const list = this.commandes.filter(c => c.type === 'delivery');
    const rows = [['ID', 'Date', 'Heure', 'Nom', 'Prénom', 'Téléphone', 'Ville', 'Adresse', 'Nb Articles', 'Détail Articles', 'Prix unitaires (FCFA)', 'Sous-total (FCFA)', 'Frais livraison (FCFA)', 'Total TTC (FCFA)', 'Statut', 'Instructions']];
    
    list.forEach(c => {
      const d = new Date(c.timestamp), info = c.deliveryInfo || {};
      rows.push([
        '#' + c.id.slice(-6),
        d.toLocaleDateString('fr-FR'),
        d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        info.nom || '',
        info.prenom || '',
        info.tel || '',
        info.ville || '',
        info.adresse || '',
        (c.items || []).reduce((s, i) => s + i.quantite, 0),
        (c.items || []).map(i => `${i.quantite}x ${i.nom}`).join(' | '),
        (c.items || []).map(i => `${i.nom}: ${Math.round(i.prix)} FCFA`).join(' | '),
        Math.round(c.total || 0),
        Math.round(c.fraisLivraison || 0),
        Math.round(c.totalFinal || c.total || 0),
        this.statusLabel(c.status),
        c.instructions || ''
      ]);
    });
    this.downloadCSV(rows, 'commandes_livraison.csv');
    this.toast('📊 Export Livraison OK');
  }

  exportReservations() {
    const rows = [['ID', 'Date réservation', 'Heure', 'Nom', 'Prénom', 'Téléphone', 'Nb personnes', 'Notes', 'Date soumission', 'Statut']];
    this.reservations.forEach(r => {
      rows.push([
        '#' + r.id.slice(-6),
        r.date || '',
        r.heure || '',
        r.nom || '',
        r.prenom || '',
        r.tel || '',
        r.personnes || '',
        r.notes || '',
        new Date(r.timestamp || r.id).toLocaleString('fr-FR'),
        r.status || 'En attente'
      ]);
    });
    this.downloadCSV(rows, 'reservations.csv');
    this.toast('📊 Export Réservations OK');
  }

  exportOrders() {
    this.exportSurPlace();
    setTimeout(() => this.exportLivraison(), 500);
    setTimeout(() => this.exportReservations(), 1000);
  }

  downloadCSV(rows, filename) {
    const csv = rows.map(r => 
      r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';')
    ).join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 0);
  }

  playSound() {
    if (!document.getElementById('soundToggle')?.checked) return;
    try { document.getElementById('orderSound')?.play(); } catch(e) {}
  }

  renderAll() { 
    this.updateKPI(); 
    this.renderOrders(); 
    this.renderLivreurList();
  }

  statusLabel(s) {
    return {pending:'Nouveau',preparation:'En préparation',pret:'Prêt',servi:'Servi',livree:'Livrée',annulee:'Annulée'}[s]||s||'Nouveau';
  }

  fmt(cents) { return new Intl.NumberFormat('fr-FR').format(Math.round((cents||0)/100))+' F'; }

  timeAgo(ts) {
    const diff=(Date.now()-new Date(ts))/60000;
    if (diff<1) return 'À l\'instant';
    if (diff<60) return `Il y a ${Math.floor(diff)} min`;
    return new Date(ts).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  }

  catLabel(cat) {
    return {burgers:'🍔 Burgers',pizzas:'🍕 Pizzas',pates:'🍝 Pâtes',salades:'🥗 Salades',desserts:'🍰 Desserts',boissons:'🥤 Boissons'}[cat]||cat;
  }

  toast(msg, type='success') {
    const c=document.getElementById('toastContainer'); if(!c) return;
    const el=document.createElement('div'); el.className=`toast ${type}`; el.textContent=msg; c.appendChild(el);
    setTimeout(()=>{el.style.opacity='0';el.style.transition='opacity 0.3s';},2800);
    setTimeout(()=>el.remove(),3200);
  }
}

const dashboard = new StreetFoodDashboard();
window.dashboard = dashboard;

// Écouteur global pour les selects de livreurs
document.addEventListener('change', (e) => {
  if (e.target.classList.contains('livreur-select')) {
    const cmdId = e.target.dataset.cmdId;
    const livreurId = e.target.value;
    dashboard.assignLivreur(cmdId, livreurId);
  }
});
