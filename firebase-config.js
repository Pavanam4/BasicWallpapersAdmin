(() => {
  const supabaseUrl = 'https://msgncyczxaldboqqyjhw.supabase.co';
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zZ25jeWN6eGFsZGJvcXF5amh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NDI2ODksImV4cCI6MjA5MzMxODY4OX0.xccy6mitXQJ5eckmcOTxRn6O5iy1Mlbd-wY5lxOzPHI';

  if (typeof supabase !== 'undefined' && !window.supabaseClient) {
    window.supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
  }

  const firebaseConfig = {
    apiKey: "AIzaSyAGWFhd9vm6UepVzaS87s5wVINL9ogym_4",
    authDomain: "glasscord-58675.firebaseapp.com",
    projectId: "glasscord-58675",
    storageBucket: "glasscord-58675.firebasestorage.app",
    messagingSenderId: "744549879312",
    appId: "1:744549879312:web:cf9d6d7323092d4099c495",
    measurementId: "G-Y344B0Z4Y7"
  };

  // Helper to sanitize Firestore sentinel objects (like FieldValue.serverTimestamp)
  function sanitizePayload(data) {
    if (!data || typeof data !== 'object') return data;
    const copy = Array.isArray(data) ? [...data] : { ...data };
    for (const key in copy) {
      const val = copy[key];
      if (val && typeof val === 'object') {
        if (val._delegate && val._delegate._methodName === 'FieldValue.serverTimestamp') {
          copy[key] = new Date().toISOString();
        } else {
          copy[key] = sanitizePayload(val);
        }
      }
    }
    return copy;
  }

  // Polyfill/override serverTimestamp
  window.firebase = window.firebase || {};
  window.firebase.firestore = window.firebase.firestore || {};
  window.firebase.firestore.FieldValue = {
    serverTimestamp: () => new Date().toISOString()
  };

  // Firestore to Supabase query wrapper
  class FirestoreToSupabaseCompat {
    constructor(supabase) {
      this.supabase = supabase;
    }
    collection(tableName) {
      return new SupabaseQueryBuilder(this.supabase, tableName);
    }
  }

  class SupabaseQueryBuilder {
    constructor(supabase, tableName) {
      this.supabase = supabase;
      this.tableName = tableName;
      this.filters = [];
      this.orderField = null;
      this.orderAscending = true;
    }

    where(field, op, value) {
      this.filters.push({ field, op, value });
      return this;
    }

    orderBy(field, direction = 'asc') {
      this.orderField = field;
      this.orderAscending = (direction.toLowerCase() === 'asc');
      return this;
    }

    doc(docId) {
      return new SupabaseDocBuilder(this.supabase, this.tableName, docId);
    }

    async get() {
      let query = this.supabase.from(this.tableName).select('*');
      for (const filter of this.filters) {
        const op = filter.op;
        const field = filter.field;
        const val = filter.value;
        if (op === '==' || op === 'EQUAL') {
          query = query.eq(field, val);
        }
      }
      if (this.orderField) {
        query = query.order(this.orderField, { ascending: this.orderAscending });
      }
      const { data, error } = await query;
      if (error) {
        console.error("Supabase Query error:", error);
        throw error;
      }

      const docs = (data || []).map(item => ({
        id: item.id,
        data: () => item,
        exists: true
      }));

      return {
        forEach: (callback) => docs.forEach(callback),
        docs: docs,
        empty: docs.length === 0,
        size: docs.length
      };
    }

    async add(data) {
      const cleanData = sanitizePayload(data);
      const { data: inserted, error } = await this.supabase.from(this.tableName).insert(cleanData).select().single();
      if (error) {
        console.error("Supabase Add error:", error);
        throw error;
      }
      return { id: inserted.id };
    }
  }

  class SupabaseDocBuilder {
    constructor(supabase, tableName, docId) {
      this.supabase = supabase;
      this.tableName = tableName;
      this.docId = docId;
    }

    async get() {
      const { data, error } = await this.supabase.from(this.tableName).select('*').eq('id', this.docId).maybeSingle();
      if (error) {
        console.error("Supabase GetDoc error:", error);
        throw error;
      }
      return {
        exists: !!data,
        id: this.docId,
        data: () => data
      };
    }

    async set(data, options) {
      const cleanData = sanitizePayload(data);
      const payload = { id: this.docId, ...cleanData };
      const { error } = await this.supabase.from(this.tableName).upsert(payload);
      if (error) {
        console.error("Supabase SetDoc error:", error);
        throw error;
      }
    }

    async update(data) {
      const cleanData = sanitizePayload(data);
      const { error } = await this.supabase.from(this.tableName).update(cleanData).eq('id', this.docId);
      if (error) {
        console.error("Supabase UpdateDoc error:", error);
        throw error;
      }
    }

    async delete() {
      const { error } = await this.supabase.from(this.tableName).delete().eq('id', this.docId);
      if (error) {
        console.error("Supabase DeleteDoc error:", error);
        throw error;
      }
    }
  }

  // Initialize Firebase
  if (typeof firebase !== 'undefined' && typeof firebase.initializeApp === 'function') {
    firebase.initializeApp(firebaseConfig);
    window.firebaseAuth = firebase.auth();
    window.storage = firebase.storage();
    
    if (window.supabaseClient) {
      window.db = new FirestoreToSupabaseCompat(window.supabaseClient);
    } else {
      window.db = firebase.firestore();
    }
  } else {
    console.warn("Firebase SDK script not loaded yet.");
  }
})();
