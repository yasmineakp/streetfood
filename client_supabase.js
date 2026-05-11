/* ============================================================
   supabase-client.js
   Couche de données partagée — Supabase + Realtime
   À inclure dans menu1.html ET dashboard.html
   ============================================================ */

// ─── CONFIGURATION ───
// Remplacez ces deux valeurs par celles de votre projet Supabase
// Dashboard Supabase → Settings → API
const SUPABASE_URL = 'https://qeaoolctbtvgvgfmcjaq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlYW9vbGN0YnR2Z3ZnZm1jamFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDk4NDAsImV4cCI6MjA5NDA4NTg0MH0.XaPtH1q6m3pKDGyOP-opp8Epx2OuMTZKQ_FYMwhb77U';

// ─── SDK SUPABASE (chargé depuis CDN dans le HTML) ───
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── ID DU RESTAURANT ACTIF ───
// Méthode : lu depuis l'URL (?resto=street-food-abidjan) ou constante
function getRestaurantSlug() {
  const params = new URLSearchParams(window.location.search);
  return params.get('resto') || 'street-food-abidjan'; // valeur par défaut
}

// ============================================================
// API PLATS
// ============================================================
const PlatAPI = {

  // Récupérer tous les plats d'un restaurant
  async getAll(restaurantId) {
    const { data, error } = await db
      .from('plats')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('position', { ascending: true });
    if (error) throw error;
    return data;
  },

  // Ajouter un plat
  async add(restaurantId, plat) {
    const { data, error } = await db
      .from('plats')
      .insert([{ restaurant_id: restaurantId, ...plat }])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // Modifier disponibilité
  async toggleDispo(platId, disponible) {
    const { error } = await db
      .from('plats')
      .update({ disponible, updated_at: new Date().toISOString() })
      .eq('id', platId);
    if (error) throw error;
  },

  // Supprimer
  async delete(platId) {
    const { error } = await db
      .from('plats')
      .delete()
      .eq('id', platId);
    if (error) throw error;
  }
};

// ============================================================
// API ZONES DE LIVRAISON
// ============================================================
const ZoneAPI = {

  async getAll(restaurantId) {
    const { data, error } = await db
      .from('zones_livraison')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('actif', true)
      .order('nom');
    if (error) throw error;
    return data;
  },

  async add(restaurantId, nom, prixLivraison) {
    const { data, error } = await db
      .from('zones_livraison')
      .insert([{ restaurant_id: restaurantId, nom, prix_livraison: prixLivraison }])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async remove(zoneId) {
    const { error } = await db
      .from('zones_livraison')
      .delete()
      .eq('id', zoneId);
    if (error) throw error;
  }
};

// ============================================================
// API COMMANDES
// ============================================================
const CommandeAPI = {

  // Créer une commande complète (commande + items en une transaction)
  async create(restaurantId, orderData) {
    // 1. Créer la commande principale
    const { data: commande, error: errCmd } = await db
      .from('commandes')
      .insert([{
        restaurant_id: restaurantId,
        type: orderData.type,
        status: 'pending',
        table_num: orderData.table || null,
        order_ref: orderData.orderRef || null,
        client_nom: orderData.deliveryInfo?.nom || null,
        client_prenom: orderData.deliveryInfo?.prenom || null,
        client_tel: orderData.deliveryInfo?.tel || null,
        client_ville: orderData.deliveryInfo?.ville || null,
        client_adresse: orderData.deliveryInfo?.adresse || null,
        sous_total: orderData.total,
        frais_livraison: orderData.fraisLivraison || 0,
        total_final: orderData.totalFinal || orderData.total,
        instructions: orderData.instructions || ''
      }])
      .select()
      .single();

    if (errCmd) throw errCmd;

    // 2. Créer les lignes (items)
    const items = orderData.items.map(item => ({
      commande_id: commande.id,
      plat_id: item.id || null,
      nom_plat: item.nom,
      prix_unitaire: item.prix,
      quantite: item.quantite,
      category: item.category || ''
    }));

    const { error: errItems } = await db
      .from('commande_items')
      .insert(items);

    if (errItems) throw errItems;

    return commande;
  },

  // Récupérer toutes les commandes (dashboard)
  async getAll(restaurantId) {
    const { data, error } = await db
      .from('commandes')
      .select(`
        *,
        commande_items (
          id, nom_plat, prix_unitaire, quantite, category, plat_id
        )
      `)
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    // Normalise pour compatibilité avec le code existant
    return data.map(c => ({
      ...c,
      id: c.id,
      timestamp: c.created_at,
      items: (c.commande_items || []).map(i => ({
        id: i.plat_id,
        nom: i.nom_plat,
        prix: i.prix_unitaire,
        quantite: i.quantite,
        category: i.category
      })),
      table: c.table_num,
      total: c.sous_total,
      fraisLivraison: c.frais_livraison,
      totalFinal: c.total_final,
      deliveryInfo: c.client_nom ? {
        nom: c.client_nom,
        prenom: c.client_prenom,
        tel: c.client_tel,
        ville: c.client_ville,
        adresse: c.client_adresse
      } : null
    }));
  },

  // Modifier le statut
  async updateStatus(commandeId, status) {
    const { error } = await db
      .from('commandes')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', commandeId);
    if (error) throw error;
  },

  // Écoute temps réel (nouvelles commandes)
  subscribeNew(restaurantId, callback) {
    return db
      .channel(`commandes-${restaurantId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'commandes',
        filter: `restaurant_id=eq.${restaurantId}`
      }, payload => callback(payload.new))
      .subscribe();
  },

  // Écoute temps réel (mises à jour statut)
  subscribeUpdates(restaurantId, callback) {
    return db
      .channel(`commandes-updates-${restaurantId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'commandes',
        filter: `restaurant_id=eq.${restaurantId}`
      }, payload => callback(payload.new))
      .subscribe();
  }
};

// ============================================================
// API RÉSERVATIONS
// ============================================================
const ReservationAPI = {

  async create(restaurantId, data) {
    const { data: res, error } = await db
      .from('reservations')
      .insert([{
        restaurant_id: restaurantId,
        nom: data.nom,
        prenom: data.prenom,
        tel: data.tel,
        date_resa: data.date,
        heure_resa: data.heure,
        nb_personnes: parseInt(data.personnes),
        notes: data.notes || ''
      }])
      .select()
      .single();
    if (error) throw error;
    return res;
  },

  async getAll(restaurantId) {
    const { data, error } = await db
      .from('reservations')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('date_resa', { ascending: true });
    if (error) throw error;
    return data.map(r => ({
      ...r,
      date: r.date_resa,
      heure: r.heure_resa,
      personnes: r.nb_personnes,
      timestamp: r.created_at
    }));
  },

  async updateStatus(resId, status) {
    const { error } = await db
      .from('reservations')
      .update({ status })
      .eq('id', resId);
    if (error) throw error;
  }
};

// ============================================================
// API RESTAURANT
// ============================================================
const RestaurantAPI = {

  async getBySlug(slug) {
    const { data, error } = await db
      .from('restaurants')
      .select('*')
      .eq('slug', slug)
      .eq('actif', true)
      .single();
    if (error) throw error;
    return data;
  },

  async getAll() {
    const { data, error } = await db
      .from('restaurants')
      .select('id, nom, slug, logo_url, couleur, actif')
      .eq('actif', true);
    if (error) throw error;
    return data;
  }
};

// ============================================================
// EXPORT GLOBAL
// ============================================================
window.StreetFoodDB = {
  db,
  PlatAPI,
  ZoneAPI,
  CommandeAPI,
  ReservationAPI,
  RestaurantAPI,
  getRestaurantSlug
};
