/**
 * ══════════════════════════════════════════════════════════════
 *  INVENTARIO TONERS Y CARTUCHOS — Firebase Firestore Integration
 * ══════════════════════════════════════════════════════════════
 */

// ─── Firebase Configuration ──────────────────────────────────
// REEMPLAZA ESTOS VALORES CON LOS DE TU PROYECTO DE FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyCyPzraUs5A2QgqtvM86DVhywbgi30scdk",
  authDomain: "bodega-ti.firebaseapp.com",
  projectId: "bodega-ti",
  storageBucket: "bodega-ti.firebasestorage.app",
  messagingSenderId: "399787251145",
  appId: "1:399787251145:web:c1ce48c39f4c76429d8418",
};

// Initialize Firebase
let firestoreDb = null;
try {
  if (firebaseConfig.apiKey !== "TU_API_KEY") {
    firebase.initializeApp(firebaseConfig);
    firestoreDb = firebase.firestore();

    // Enable offline persistence
    firestoreDb.enablePersistence().catch((err) => {
      console.warn("Firebase persistence error:", err.code);
    });
  } else {
    console.warn(
      "⚠️ Firebase no está configurado. Usando modo simulación en memoria.",
    );
  }
} catch (error) {
  console.error("Error inicializando Firebase:", error);
}

// ─── State ──────────────────────────────────────────────────
const COLLECTIONS = {
  items: "items_inventario",
  usuarios: "usuarios",
  sucursales: "sucursales",
  departamentos: "departamentos",
  retiros: "retiros",
  marcas: "marcas",
  tipos: "tipos",
};

// Memory cache to keep UI rendering synchronous
let localData = {
  items: [],
  usuarios: [],
  sucursales: [],
  departamentos: [],
  retiros: [],
  marcas: [],
  tipos: [],
};

let currentPage = "login";
let currentUser = null;

// Pagination & filter state
const dashboardState = {
  search: "",
  statusFilter: "all",
  sortKey: null,
  sortDir: null,
  page: 1,
  pageSize: 10,
};
const inventoryState = {
  search: "",
  statusFilter: "all",
  sortKey: null,
  sortDir: null,
  page: 1,
  pageSize: 10,
};
const historyState = {
  search: "",
  dateFrom: "",
  dateTo: "",
  sortKey: null,
  sortDir: null,
  page: 1,
  pageSize: 10,
};

// ─── Database Helpers ────────────────────────────────────────
function db(key) {
  return localData[key] || [];
}

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Utility to hash passwords client-side
async function hashPassword(password) {
  if (!window.crypto || !window.crypto.subtle) {
    console.warn("Web Crypto API no disponible. Usando fallback.");
    return "hash_btoa_" + btoa(password); // Simple fallback para evitar crashes en IPs locales (HTTP)
  }
  const msgUint8 = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Global UI lock state
let isAppLoading = false;
function setAppLoading(loading) {
  isAppLoading = loading;
  if (loading) {
    document.body.style.pointerEvents = "none";
    document.body.style.opacity = "0.7";
  } else {
    document.body.style.pointerEvents = "";
    document.body.style.opacity = "1";
  }
}

// Button loading state helpers
function setBtnLoading(btn, loadingText) {
  if (!btn) return;
  btn._originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${loadingText || 'Cargando...'}`;
  btn.classList.add('btn-loading');
}

function resetBtn(btn) {
  if (!btn) return;
  btn.disabled = false;
  if (btn._originalHTML !== undefined) {
    btn.innerHTML = btn._originalHTML;
    delete btn._originalHTML;
  }
  btn.classList.remove('btn-loading');
}

// Fetch all collections from Firestore into memory
async function refreshData() {
  if (!firestoreDb) return; // Skip if no Firebase
  setAppLoading(true);
  try {
    const promises = Object.entries(COLLECTIONS).map(async ([key, colName]) => {
      const snapshot = await firestoreDb.collection(colName).get();
      localData[key] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
    });
    await Promise.all(promises);

    // Auto-crear usuario admin si la base de datos de usuarios está vacía
    if (localData.usuarios.length === 0) {
      const adminUser = {
        nombre: "Administrador",
        usuario: "admin",
        password: await hashPassword("123"),
        rol: "admin",
      };
      const addedAdmin = await fbAdd("usuarios", adminUser);
      localData.usuarios.push(addedAdmin);
      console.log("Usuario admin creado automáticamente (admin / 123).");
    }
  } catch (error) {
    console.error("Error fetching data from Firestore:", error);
    showToast("Error de conexión a la base de datos", "error");
  } finally {
    setAppLoading(false);
  }
}

// CRUD Operations wrapper to handle both Firestore and local memory (fallback)
async function fbAdd(collectionKey, data) {
  if (firestoreDb) {
    const ref = firestoreDb
      .collection(COLLECTIONS[collectionKey])
      .doc(data.id || uuid());
    if (!data.id) data.id = ref.id;
    await ref.set(data);
  } else {
    if (!data.id) data.id = uuid();
    localData[collectionKey].push(data); // memory fallback
  }
  return data;
}

async function fbUpdate(collectionKey, id, data) {
  if (firestoreDb) {
    await firestoreDb
      .collection(COLLECTIONS[collectionKey])
      .doc(id)
      .update(data);
  } else {
    const arr = localData[collectionKey];
    const idx = arr.findIndex((i) => i.id === id);
    if (idx >= 0) arr[idx] = { ...arr[idx], ...data };
  }
}

async function fbDelete(collectionKey, id) {
  if (firestoreDb) {
    await firestoreDb.collection(COLLECTIONS[collectionKey]).doc(id).delete();
  } else {
    localData[collectionKey] = localData[collectionKey].filter(
      (i) => i.id !== id,
    );
  }
}

// ─── Seed Data ──────────────────────────────────────────────
async function seedIfEmpty() {
  // If memory fallback is used, populate localData
  if (!firestoreDb) {
    if (localData.usuarios.length === 0) {
      localData.usuarios = [
        {
          id: "admin-uuid",
          nombre: "Administrador",
          usuario: "admin",
          password: "admin123",
          rol: "ambos",
        },
        {
          id: uuid(),
          nombre: "Juan Pérez",
          usuario: "jperez",
          password: "1234",
          rol: "autorizador",
        },
      ];
      const s1 = uuid(),
        s2 = uuid();
      localData.sucursales = [
        { id: s1, nombre: "Sucursal Central" },
        { id: s2, nombre: "Sucursal Norte" },
      ];
      localData.departamentos = [
        { id: uuid(), nombre: "Soporte TI", idSucursal: s1 },
        { id: uuid(), nombre: "Administración", idSucursal: s1 },
      ];
      localData.marcas = [
        { id: uuid(), nombre: "HP" },
        { id: uuid(), nombre: "Brother" },
      ];
      localData.tipos = [
        { id: uuid(), nombre: "Tóner" },
        { id: uuid(), nombre: "Cartucho" },
      ];
      localData.items = [
        {
          id: uuid(),
          tipo: "Tóner",
          modelo: "CF258A",
          marca: "HP",
          color: "Negro",
          stockActual: 15,
          stockMinimo: 5,
        },
        {
          id: uuid(),
          tipo: "Cartucho",
          modelo: "T664120",
          marca: "Epson",
          color: "Negro",
          stockActual: 2,
          stockMinimo: 5,
        },
      ];
      localData.retiros = [];
    }
    return;
  }

  // If using Firestore, check if we need to seed
  if (localData.usuarios.length === 0) {
    console.log("Seeding Firestore base data...");
    const uId = uuid();
    await fbAdd("usuarios", {
      id: uId,
      nombre: "Administrador",
      usuario: "admin",
      password: "admin123",
      rol: "ambos",
    });

    const s1 = uuid();
    await fbAdd("sucursales", { id: s1, nombre: "Central" });
    await fbAdd("departamentos", { id: uuid(), nombre: "TI", idSucursal: s1 });

    const m1 = uuid();
    await fbAdd("marcas", { id: m1, nombre: "HP" });
    const t1 = uuid();
    await fbAdd("tipos", { id: t1, nombre: "Tóner" });

    await fbAdd("items", {
      id: uuid(),
      tipo: "Tóner",
      modelo: "Demo-123",
      marca: "HP",
      color: "Negro",
      stockActual: 10,
      stockMinimo: 2,
    });

    await refreshData();
  }
}

// ─── Format Helpers ─────────────────────────────────────────
function itemLabel(item) {
  return `${item.tipo} ${item.marca} ${item.modelo}`;
}

function formatFecha(ms) {
  return new Date(ms).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stockState(item) {
  if (item.stockActual <= 0)
    return { label: "Agotado", cls: "badge-destructive", key: "agotado" };
  if (item.stockActual < item.stockMinimo)
    return {
      label: "Bajo mínimo",
      cls: "badge-destructive",
      key: "bajo-minimo",
    };
  if (item.stockActual <= item.stockMinimo * 1.5)
    return { label: "Por reponer", cls: "badge-secondary", key: "por-reponer" };
  return { label: "OK", cls: "badge-outline", key: "ok" };
}

// ─── Toast System ───────────────────────────────────────────
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  const icon =
    type === "success"
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  toast.innerHTML = icon + "<span>" + message + "</span>";
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast-exit");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Select Component ───────────────────────────────────────
function initSelect(triggerId, dropdownId, onChange) {
  const trigger = document.getElementById(triggerId);
  const dropdown = document.getElementById(dropdownId);
  if (!trigger || !dropdown) return;

  // Prevent multiple listeners
  const newTrigger = trigger.cloneNode(true);
  trigger.parentNode.replaceChild(newTrigger, trigger);
  const newDropdown = dropdown.cloneNode(true);
  dropdown.parentNode.replaceChild(newDropdown, dropdown);

  newTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".select-content.open").forEach((el) => {
      if (el !== newDropdown) el.classList.remove("open");
    });
    newDropdown.classList.toggle("open");
  });

  newDropdown.addEventListener("click", (e) => {
    const item = e.target.closest(".select-item");
    if (!item || item.classList.contains("disabled")) return;
    const value = item.dataset.value;
    const text = item.textContent.trim();
    newTrigger.dataset.value = value;
    newTrigger.querySelector("span").textContent = text;
    newTrigger.querySelector("span").classList.remove("select-placeholder");
    newDropdown
      .querySelectorAll(".select-item")
      .forEach((el) => el.classList.remove("selected"));
    item.classList.add("selected");
    newDropdown.classList.remove("open");
    if (onChange) onChange(value, text);
  });
}

function setSelectValue(triggerId, dropdownId, value) {
  const trigger = document.getElementById(triggerId);
  const dropdown = document.getElementById(dropdownId);
  if (!trigger || !dropdown) return;
  trigger.dataset.value = value;
  const item = dropdown.querySelector(`[data-value="${value}"]`);
  if (item) {
    trigger.querySelector("span").textContent = item.textContent.trim();
    trigger.querySelector("span").classList.remove("select-placeholder");
    dropdown
      .querySelectorAll(".select-item")
      .forEach((el) => el.classList.remove("selected"));
    item.classList.add("selected");
  }
}

function resetSelect(triggerId, placeholder) {
  const trigger = document.getElementById(triggerId);
  if (!trigger) return;
  trigger.dataset.value = "";
  const span = trigger.querySelector("span");
  span.textContent = placeholder;
  span.classList.add("select-placeholder");
}

function populateSelect(dropdownId, items, valueFn, labelFn, disabledFn) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;
  dropdown.innerHTML = items
    .map((item) => {
      const disabled = disabledFn && disabledFn(item) ? " disabled" : "";
      return `<div class="select-item${disabled}" data-value="${valueFn(item)}">${labelFn(item)}</div>`;
    })
    .join("");
}

document.addEventListener("click", () => {
  document
    .querySelectorAll(".select-content.open")
    .forEach((el) => el.classList.remove("open"));
});

// ─── Modal System ───────────────────────────────────────────
function openModal(id) {
  const overlay = document.getElementById(id);
  if (overlay) {
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
  }
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  if (overlay) {
    overlay.classList.remove("open");
    document.body.style.overflow = "";
  }
}

document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay.classList.remove("open");
      document.body.style.overflow = "";
    }
  });
});

// ─── Navigation ─────────────────────────────────────────────
async function navigateTo(page) {
  if (isAppLoading) return;

  const pages = [
    "login",
    "dashboard",
    "inventory",
    "configuracion",
    "usuarios",
  ];
  pages.forEach((p) => {
    const el = document.getElementById("page-" + p);
    if (el) el.style.display = "none";
  });

  const target = document.getElementById("page-" + page);
  if (target) target.style.display = page === "login" ? "flex" : "block";
  currentPage = page;

  // Refresh data before rendering if logged in
  if (page !== "login") {
    await refreshData();
  }

  // Render the page
  switch (page) {
    case "dashboard":
      renderDashboard();
      break;
    case "inventory":
      renderInventoryManagement();
      break;
    case "configuracion":
      renderConfiguracion();
      break;
    case "usuarios":
      renderUsuarios();
      break;
  }
}

// ─── Auth ───────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  if (isAppLoading) return;

  const btn = document.getElementById("login-btn");
  setBtnLoading(btn, "Ingresando...");

  try {
    await refreshData(); // Make sure we have latest users

    const usuario = document.getElementById("login-usuario").value.trim();
    const password = document.getElementById("login-password").value;

    // --- ALTERNATIVA: BACKDOOR DE EMERGENCIA (SUPER ADMIN LOCAL) ---
    // Si la base de datos falla al crear el usuario, esto permite entrar y probar.
    if (usuario === "superadmin" && password === "123456") {
      currentUser = {
        id: "superadmin-local",
        nombre: "Super Administrador (Local)",
        rol: "admin",
        usuario: "superadmin",
      };
      localStorage.setItem("inv_session", JSON.stringify(currentUser));
      showToast("¡Bienvenido al modo de rescate!");
      navigateTo("dashboard");
      return;
    }
    // ----------------------------------------------------------------

    const hashedPassword = await hashPassword(password);
    const usuarios = db("usuarios");
    const found = usuarios.find(
      (u) => u.usuario === usuario && u.password === hashedPassword,
    );

    if (!found) {
      showToast("Usuario o contraseña incorrectos", "error");
      return;
    }

    currentUser = {
      id: found.id,
      nombre: found.nombre,
      rol: found.rol,
      usuario: found.usuario,
    };
    localStorage.setItem("inv_session", JSON.stringify(currentUser));
    showToast("¡Bienvenido!");

    await seedIfEmpty(); // Populate if empty
    navigateTo("dashboard");
  } finally {
    resetBtn(btn);
  }
}

function handleLogout() {
  currentUser = null;
  localStorage.removeItem("inv_session");
  navigateTo("login");
}

function checkSession() {
  try {
    const session = JSON.parse(localStorage.getItem("inv_session"));
    if (session && session.id) {
      currentUser = session;
      return true;
    }
  } catch {}
  return false;
}

// ─── Refresh ────────────────────────────────────────────────
async function handleRefresh() {
  const btn = document.getElementById("btn-refresh");
  if (btn) btn.classList.add("spinning");

  await refreshData();
  navigateTo(currentPage);

  if (btn) btn.classList.remove("spinning");
  showToast("Datos actualizados");
}

// ─── Count Up Animation ─────────────────────────────────────
function animateCountUp(element, target, duration = 800) {
  let start = 0;
  const startTime = performance.now();
  function animate(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
    element.textContent = Math.round(eased * target);
    if (progress < 1) requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

// ─── SVG Icons ──────────────────────────────────────────────
const ICONS = {
  package:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
  boxes:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"/><path d="m7 16.5-4.74-2.85"/><path d="m7 16.5 5-3"/><path d="M7 16.5v5.17"/><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"/><path d="m17 16.5-5-3"/><path d="m17 16.5 4.74-2.85"/><path d="M17 16.5v5.17"/><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"/><path d="M12 8 7.26 5.15"/><path d="m12 8 4.74-2.85"/><path d="M12 13.5V8"/></svg>',
  alert:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  arrowDown:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>',
  alertSm:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  arrowDownSm:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>',
  sortNone:
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4;"><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg>',
  sortAsc:
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
  sortDesc:
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  chevronLeft:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>',
  chevronRight:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>',
  search:
    '<svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  edit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
  trash:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
  download:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  calendar:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  plus:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
};

function sortIcon(state, col) {
  if (state.sortKey !== col) return ICONS.sortNone;
  return state.sortDir === "asc" ? ICONS.sortAsc : ICONS.sortDesc;
}

// ─── Dashboard Render ───────────────────────────────────────
function renderDashboard() {
  updateUserInfo();
  renderStatsCards();
  renderRecentActivity();
  renderInventoryTable("dashboard-inventory", "dashboard", dashboardState);
  renderWithdrawalsHistory();

  const btnGestion = document.getElementById("btn-gestion");
  if (btnGestion)
    btnGestion.style.display = currentUser?.rol === "solicitante" ? "none" : "";
}

function updateUserInfo() {
  const info = document.getElementById("user-info");
  if (!info) return;
  if (currentUser) {
    info.style.display = "flex";
    document.getElementById("user-name").textContent = currentUser.nombre;
    document.getElementById("user-role").textContent = currentUser.rol;
  } else {
    info.style.display = "none";
  }
}

function renderStatsCards() {
  const container = document.getElementById("stats-cards");
  if (!container) return;
  const items = db("items");
  const retiros = db("retiros");
  const totalItems = items.length;
  const stockTotal = items.reduce(
    (acc, i) => acc + (parseInt(i.stockActual) || 0),
    0,
  );
  const bajoStock = items.filter(
    (i) => (parseInt(i.stockActual) || 0) < (parseInt(i.stockMinimo) || 0),
  ).length;
  const hoy = new Date().setHours(0, 0, 0, 0);
  const retirosHoy = retiros.filter((r) => r.fechaHora >= hoy).length;

  const stats = [
    {
      label: "Tipos de insumo",
      value: totalItems,
      color: "var(--primary)",
      bg: "rgba(243,97,45,0.1)",
      icon: ICONS.package,
    },
    {
      label: "Unidades en stock",
      value: stockTotal,
      color: "var(--chart-5)",
      bg: "rgba(139,92,246,0.1)",
      icon: ICONS.boxes,
    },
    {
      label: "Bajo stock mínimo",
      value: bajoStock,
      color: bajoStock > 0 ? "var(--destructive)" : "var(--muted-foreground)",
      bg: bajoStock > 0 ? "rgba(220,38,38,0.1)" : "var(--muted)",
      icon: ICONS.alert,
    },
    {
      label: "Retiros hoy",
      value: retirosHoy,
      color: "var(--chart-2)",
      bg: "rgba(37,99,235,0.1)",
      icon: ICONS.arrowDown,
    },
  ];

  container.innerHTML = stats
    .map(
      (s, i) => `
    <div class="card stats-card animate-slide-up stagger-${i + 1}" style="padding:1rem;">
      <div class="flex items-center gap-3">
        <div class="stat-icon-wrapper" style="background:${s.bg}; color:${s.color};">
          ${s.icon}
        </div>
        <div>
          <p class="stat-value" data-count="${s.value}">0</p>
          <p class="stat-label">${s.label}</p>
        </div>
      </div>
    </div>
  `,
    )
    .join("");

  container.querySelectorAll(".stat-value").forEach((el) => {
    animateCountUp(el, parseInt(el.dataset.count));
  });
}

function renderRecentActivity() {
  const container = document.getElementById("recent-activity");
  const list = document.getElementById("recent-list");
  const retiros = db("retiros").sort((a, b) => b.fechaHora - a.fechaHora);
  if (retiros.length === 0) {
    container.style.display = "none";
    return;
  }
  container.style.display = "block";
  list.innerHTML = retiros
    .slice(0, 5)
    .map(
      (r) => `
    <div class="flex items-center" style="justify-content:space-between; padding:0.375rem 0.5rem; border-radius:var(--radius); transition:background 0.15s;" onmouseover="this.style.background='var(--muted)'" onmouseout="this.style.background='transparent'">
      <div class="flex items-center gap-2 min-w-0">
        ${ICONS.arrowDownSm}
        <span class="font-medium truncate text-sm">${r.itemNombre}</span>
        <span class="text-muted text-sm">×${r.cantidad}</span>
      </div>
      <div class="flex items-center gap-3 text-xs text-muted" style="flex-shrink:0; margin-left:1rem;">
        <span class="sm-only-inline">${r.usuarioNombre}</span>
        <span class="tabular-nums">${formatFecha(r.fechaHora)}</span>
      </div>
    </div>
  `,
    )
    .join("");
}

// ─── Inventory Table ────────────────────────────────────────
function renderInventoryTable(containerId, mode, state) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const items = db("items");
  const STATUS_FILTERS = [
    { key: "all", label: "Todos" },
    { key: "ok", label: "OK" },
    { key: "por-reponer", label: "Por reponer" },
    { key: "bajo-minimo", label: "Bajo mínimo" },
    { key: "agotado", label: "Agotado" },
  ];

  let filtered = [...items];
  if (state.search.trim()) {
    const q = state.search.toLowerCase();
    filtered = filtered.filter(
      (i) =>
        (i.marca || "").toLowerCase().includes(q) ||
        (i.modelo || "").toLowerCase().includes(q) ||
        (i.tipo || "").toLowerCase().includes(q) ||
        (i.color || "").toLowerCase().includes(q),
    );
  }
  if (state.statusFilter !== "all") {
    filtered = filtered.filter((i) => stockState(i).key === state.statusFilter);
  }

  if (state.sortKey && state.sortDir) {
    filtered.sort((a, b) => {
      let cmp = 0;
      switch (state.sortKey) {
        case "insumo":
          cmp = itemLabel(a).localeCompare(itemLabel(b));
          break;
        case "tipo":
          cmp = (a.tipo || "").localeCompare(b.tipo || "");
          break;
        case "stock":
          cmp = (a.stockActual || 0) - (b.stockActual || 0);
          break;
        case "minimo":
          cmp = (a.stockMinimo || 0) - (b.stockMinimo || 0);
          break;
        case "estado": {
          const order = {
            agotado: 0,
            "bajo-minimo": 1,
            "por-reponer": 2,
            ok: 3,
          };
          cmp =
            (order[stockState(a).key] || 4) - (order[stockState(b).key] || 4);
          break;
        }
      }
      return state.sortDir === "desc" ? -cmp : cmp;
    });
  } else {
    filtered.sort((a, b) => {
      const aBajo = (a.stockActual || 0) < (a.stockMinimo || 0) ? 0 : 1;
      const bBajo = (b.stockActual || 0) < (b.stockMinimo || 0) ? 0 : 1;
      if (aBajo !== bBajo) return aBajo - bBajo;
      return itemLabel(a).localeCompare(itemLabel(b));
    });
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  if (state.page > totalPages) state.page = totalPages;
  const startIdx = (state.page - 1) * state.pageSize;
  const paginated = filtered.slice(startIdx, startIdx + state.pageSize);

  const sortFuncName = "_invSort_" + containerId.replace(/-/g, '_');
  window[sortFuncName] = function (key) {
    if (state.sortKey !== key) {
      state.sortKey = key;
      state.sortDir = "asc";
    } else if (state.sortDir === "asc") {
      state.sortDir = "desc";
    } else {
      state.sortKey = null;
      state.sortDir = null;
    }
    state.page = 1;
    renderInventoryTable(containerId, mode, state);
  };

  const actionHeader = mode === "inventory" ? "Acciones" : "Acción";
  const actionColumn = (item) => {
    if (mode === "inventory") {
      return `
        <td style="text-align:right; white-space:nowrap;">
          <div class="flex items-center gap-2" style="justify-content:flex-end;">
            <button class="btn btn-primary btn-sm" onclick="openEditItemDialog('${item.id}')">
              ${ICONS.edit} Editar
            </button>
            <button class="btn btn-destructive btn-sm btn-icon" onclick="openDeleteItemDialog('${item.id}')">
              ${ICONS.trash}
            </button>
          </div>
        </td>
      `;
    } else {
      return `
        <td style="text-align:right;">
          <button class="btn btn-ghost btn-sm" onclick="openWithdrawalDialog('${item.id}')" ${(item.stockActual || 0) <= 0 ? "disabled" : ""}>
            ${ICONS.arrowDownSm} Retirar
          </button>
        </td>
      `;
    }
  };

  container.innerHTML = `
    <div class="card animate-fade-in">
      <div class="card-header">
        <h2 class="card-title">Inventario</h2>
        <p class="card-description">Los insumos bajo su stock mínimo se resaltan para reponer a tiempo.</p>
        <div class="flex flex-col gap-3" style="padding-top:0.5rem;">
          <div class="search-wrapper">
            ${ICONS.search}
            <input class="input input-with-icon" placeholder="Buscar por marca, modelo, tipo o color..."
              value="${state.search}" oninput="(function(v){${mode === "dashboard" ? "dashboardState" : "inventoryState"}.search=v;${mode === "dashboard" ? "dashboardState" : "inventoryState"}.page=1;renderInventoryTable('${containerId}','${mode}',${mode === "dashboard" ? "dashboardState" : "inventoryState"});})(this.value)">
          </div>
          <div class="flex flex-wrap gap-2">
            ${STATUS_FILTERS.map((f) => {
              const count =
                f.key === "all"
                  ? ""
                  : ` <span style="margin-left:0.25rem;font-size:10px;opacity:0.7;">${items.filter((i) => stockState(i).key === f.key).length}</span>`;
              const active =
                state.statusFilter === f.key
                  ? "badge-default"
                  : "badge-outline";
              return `<span class="badge ${active} filter-badge" onclick="(function(){${mode === "dashboard" ? "dashboardState" : "inventoryState"}.statusFilter='${f.key}';${mode === "dashboard" ? "dashboardState" : "inventoryState"}.page=1;renderInventoryTable('${containerId}','${mode}',${mode === "dashboard" ? "dashboardState" : "inventoryState"});})()">${f.label}${count}</span>`;
            }).join("")}
          </div>
        </div>
      </div>
      <div class="card-content">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th class="sortable-header" onclick="window['${sortFuncName}']('insumo')"><span class="flex items-center">Insumo ${sortIcon(state, "insumo")}</span></th>
                <th class="sortable-header sm-only-cell" onclick="window['${sortFuncName}']('tipo')"><span class="flex items-center">Tipo ${sortIcon(state, "tipo")}</span></th>
                <th class="sortable-header" style="text-align:right;" onclick="window['${sortFuncName}']('stock')"><span class="flex items-center" style="justify-content:flex-end;">Stock ${sortIcon(state, "stock")}</span></th>
                <th class="sortable-header sm-only-cell" style="text-align:right;" onclick="window['${sortFuncName}']('minimo')"><span class="flex items-center" style="justify-content:flex-end;">Mínimo ${sortIcon(state, "minimo")}</span></th>
                <th class="sortable-header" onclick="window['${sortFuncName}']('estado')"><span class="flex items-center">Estado ${sortIcon(state, "estado")}</span></th>
                <th style="text-align:right;">${actionHeader}</th>
              </tr>
            </thead>
            <tbody>
              ${
                paginated.length === 0
                  ? `
                <tr><td colspan="6" class="empty-state">
                  ${
                    state.search || state.statusFilter !== "all"
                      ? "No se encontraron insumos con estos filtros."
                      : "No hay insumos registrados todavía."
                  }
                </td></tr>
              `
                  : paginated
                      .map((item) => {
                        const s = stockState(item);
                        const bajo =
                          (item.stockActual || 0) < (item.stockMinimo || 0);
                        return `
                  <tr class="row-hover${bajo ? " row-warning" : ""}">
                    <td>
                      <div class="flex items-center gap-2 font-medium">
                        ${bajo ? '<span style="color:var(--destructive);">' + ICONS.alertSm + "</span>" : ""}
                        ${item.marca} - ${item.modelo}
                      </div>
                    </td>
                    <td class="sm-only-cell text-muted capitalize">${item.tipo}</td>
                    <td style="text-align:right;" class="tabular-nums font-medium">${item.stockActual}</td>
                    <td class="sm-only-cell text-muted tabular-nums" style="text-align:right;">${item.stockMinimo}</td>
                    <td><span class="badge ${s.cls}">${s.label}</span></td>
                    ${actionColumn(item)}
                  </tr>
                `;
                      })
                      .join("")
              }
            </tbody>
          </table>
        </div>
        ${
          filtered.length > 0
            ? `
          <div class="flex items-center" style="justify-content:space-between; margin-top:1rem; flex-wrap:wrap; gap:1rem;">
            <div class="flex items-center gap-2">
              <span class="text-sm text-muted">Mostrar</span>
              <select class="input" style="width:5rem; padding:0.25rem 0.5rem;" onchange="(function(v){${mode === "dashboard" ? "dashboardState" : "inventoryState"}.pageSize=parseInt(v);${mode === "dashboard" ? "dashboardState" : "inventoryState"}.page=1;renderInventoryTable('${containerId}','${mode}',${mode === "dashboard" ? "dashboardState" : "inventoryState"});})(this.value)">
                ${[5, 10, 20, 50].map((n) => `<option value="${n}" ${state.pageSize === n ? "selected" : ""}>${n}</option>`).join("")}
              </select>
              <span class="text-sm text-muted">por página</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-sm text-muted" style="margin-right:0.5rem;">Página ${state.page} de ${totalPages} (${filtered.length} total)</span>
              <button class="btn btn-outline btn-icon" ${state.page <= 1 ? "disabled" : ""} onclick="(function(){${mode === "dashboard" ? "dashboardState" : "inventoryState"}.page--;renderInventoryTable('${containerId}','${mode}',${mode === "dashboard" ? "dashboardState" : "inventoryState"});})()">${ICONS.chevronLeft}</button>
              <button class="btn btn-outline btn-icon" ${state.page >= totalPages ? "disabled" : ""} onclick="(function(){${mode === "dashboard" ? "dashboardState" : "inventoryState"}.page++;renderInventoryTable('${containerId}','${mode}',${mode === "dashboard" ? "dashboardState" : "inventoryState"});})()">${ICONS.chevronRight}</button>
            </div>
          </div>
        `
            : ""
        }
      </div>
    </div>
  `;
}

// ─── Withdrawals History ────────────────────────────────────
function renderWithdrawalsHistory() {
  const container = document.getElementById("withdrawals-history");
  if (!container) return;
  const allRetiros = db("retiros");
  let retiros = [...allRetiros];

  if (historyState.dateFrom) {
    const [y, m, d] = historyState.dateFrom.split("-").map(Number);
    const from = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
    retiros = retiros.filter((r) => r.fechaHora >= from);
  }
  if (historyState.dateTo) {
    const [y, m, d] = historyState.dateTo.split("-").map(Number);
    const to = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
    retiros = retiros.filter((r) => r.fechaHora <= to);
  }
  if (historyState.search.trim()) {
    const q = historyState.search.toLowerCase();
    retiros = retiros.filter(
      (r) =>
        (r.itemNombre || "").toLowerCase().includes(q) ||
        (r.usuarioNombre || "").toLowerCase().includes(q) ||
        (r.autorizadorNombre || "").toLowerCase().includes(q) ||
        (r.sucursalNombre || "").toLowerCase().includes(q) ||
        (r.departamentoNombre || "").toLowerCase().includes(q),
    );
  }

  if (historyState.sortKey && historyState.sortDir) {
    retiros.sort((a, b) => {
      let cmp = 0;
      switch (historyState.sortKey) {
        case "fecha":
          cmp = a.fechaHora - b.fechaHora;
          break;
        case "insumo":
          cmp = (a.itemNombre || "").localeCompare(b.itemNombre || "");
          break;
        case "cantidad":
          cmp = (a.cantidad || 0) - (b.cantidad || 0);
          break;
        case "solicitante":
          cmp = (a.usuarioNombre || "").localeCompare(b.usuarioNombre || "");
          break;
      }
      return historyState.sortDir === "desc" ? -cmp : cmp;
    });
  } else {
    retiros.sort((a, b) => b.fechaHora - a.fechaHora);
  }

  const totalPages = Math.max(
    1,
    Math.ceil(retiros.length / historyState.pageSize),
  );
  if (historyState.page > totalPages) historyState.page = totalPages;
  const startIdx = (historyState.page - 1) * historyState.pageSize;
  const paginated = retiros.slice(startIdx, startIdx + historyState.pageSize);

  window._historySort = function (key) {
    if (historyState.sortKey !== key) {
      historyState.sortKey = key;
      historyState.sortDir = "asc";
    } else if (historyState.sortDir === "asc") {
      historyState.sortDir = "desc";
    } else {
      historyState.sortKey = null;
      historyState.sortDir = null;
    }
    historyState.page = 1;
    renderWithdrawalsHistory();
  };

  container.innerHTML = `
    <div class="card animate-fade-in">
      <div class="card-header" style="display:flex; flex-direction:column; gap:1rem;">
        <div style="display:flex; flex-wrap:wrap; justify-content:space-between; gap:1rem; align-items:flex-start;">
          <div>
            <h2 class="card-title">Historial de retiros</h2>
            <p class="card-description">Registro de quién retira y quién autoriza cada salida.</p>
          </div>
          <div class="flex flex-col gap-3 sm-flex-row" style="align-items:flex-end;">
            <div class="flex items-center gap-2">
              <div class="flex flex-col gap-1">
                <label class="text-xs text-muted">Desde</label>
                <input type="date" class="input" style="height:2.25rem;" value="${historyState.dateFrom}" onchange="historyState.dateFrom=this.value;historyState.page=1;renderWithdrawalsHistory();">
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-xs text-muted">Hasta</label>
                <input type="date" class="input" style="height:2.25rem;" value="${historyState.dateTo}" onchange="historyState.dateTo=this.value;historyState.page=1;renderWithdrawalsHistory();">
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button class="btn btn-secondary btn-sm" onclick="setCurrentMonth()">
                ${ICONS.calendar} Mes actual
              </button>
              ${historyState.dateFrom || historyState.dateTo ? "<button class=\"btn btn-ghost btn-sm\" onclick=\"historyState.dateFrom='';historyState.dateTo='';historyState.page=1;renderWithdrawalsHistory();\">Limpiar</button>" : ""}
              <button class="btn btn-outline btn-sm" onclick="exportToCSV()" ${retiros.length === 0 ? "disabled" : ""}>
                ${ICONS.download} Exportar
              </button>
              <button class="btn btn-primary btn-sm" onclick="openHistoricalWithdrawalDialog()">
                ${ICONS.plus} Ingresar Histórico
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="card-content">
        <div class="search-wrapper" style="margin-bottom:1rem;">
          ${ICONS.search}
          <input class="input input-with-icon" placeholder="Buscar por insumo, solicitante, autorizador, sucursal..."
            value="${historyState.search}" oninput="historyState.search=this.value;historyState.page=1;renderWithdrawalsHistory();">
        </div>
        <div class="table-wrapper" style="margin-bottom:1rem;">
          <table>
            <thead>
              <tr>
                <th class="sortable-header" onclick="_historySort('fecha')"><span class="flex items-center">Fecha ${sortIcon(historyState, "fecha")}</span></th>
                <th class="sortable-header" onclick="_historySort('insumo')"><span class="flex items-center">Insumo ${sortIcon(historyState, "insumo")}</span></th>
                <th class="sortable-header" style="text-align:right;" onclick="_historySort('cantidad')"><span class="flex items-center" style="justify-content:flex-end;">Cant. ${sortIcon(historyState, "cantidad")}</span></th>
                <th class="sortable-header" onclick="_historySort('solicitante')"><span class="flex items-center">Solicitante ${sortIcon(historyState, "solicitante")}</span></th>
                <th class="sm-only-cell">Autorizador</th>
                <th class="sm-only-cell">Vacío</th>
                <th class="md-only-cell">Ubicación</th>
              </tr>
            </thead>
            <tbody>
              ${
                paginated.length === 0
                  ? `
                <tr><td colspan="7" class="empty-state">
                  ${
                    historyState.search
                      ? "No se encontraron retiros con esa búsqueda."
                      : "No se encontraron retiros en este rango de fechas."
                  }
                </td></tr>
              `
                  : paginated
                      .map(
                        (r) => `
                <tr class="row-hover">
                  <td class="text-muted" style="white-space:nowrap;">${formatFecha(r.fechaHora)}</td>
                  <td class="font-medium">${r.itemNombre}</td>
                  <td class="tabular-nums" style="text-align:right;">${r.cantidad}</td>
                  <td>${r.usuarioNombre}</td>
                  <td class="sm-only-cell text-muted">${r.autorizadorNombre}</td>
                  <td class="sm-only-cell text-muted">${r.entregaVacio ? "Sí" : "No"}</td>
                  <td class="md-only-cell text-muted">${r.sucursalNombre} · ${r.departamentoNombre}</td>
                </tr>
              `,
                      )
                      .join("")
              }
            </tbody>
          </table>
        </div>
        <div class="flex items-center" style="justify-content:space-between; flex-wrap:wrap; gap:1rem;">
          <div class="flex items-center gap-2">
            <span class="text-sm text-muted">Mostrar</span>
            <select class="input" style="width:5rem; padding:0.25rem 0.5rem;" onchange="historyState.pageSize=parseInt(this.value);historyState.page=1;renderWithdrawalsHistory();">
              ${[5, 10, 20, 50].map((n) => `<option value="${n}" ${historyState.pageSize === n ? "selected" : ""}>${n}</option>`).join("")}
            </select>
            <span class="text-sm text-muted">por página</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm text-muted" style="margin-right:0.5rem;">Página ${historyState.page} de ${totalPages} (${retiros.length} total)</span>
            <button class="btn btn-outline btn-icon" ${historyState.page <= 1 ? "disabled" : ""} onclick="historyState.page--;renderWithdrawalsHistory();">${ICONS.chevronLeft}</button>
            <button class="btn btn-outline btn-icon" ${historyState.page >= totalPages ? "disabled" : ""} onclick="historyState.page++;renderWithdrawalsHistory();">${ICONS.chevronRight}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function setCurrentMonth() {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const fmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  historyState.dateFrom = fmt(firstDay);
  historyState.dateTo = fmt(lastDay);
  historyState.page = 1;
  renderWithdrawalsHistory();
}

function exportToCSV() {
  const retiros = db("retiros").sort((a, b) => b.fechaHora - a.fechaHora);
  let filtered = [...retiros];
  if (historyState.dateFrom) {
    const [y, m, d] = historyState.dateFrom.split("-").map(Number);
    filtered = filtered.filter(
      (r) => r.fechaHora >= new Date(y, m - 1, d).getTime(),
    );
  }
  if (historyState.dateTo) {
    const [y, m, d] = historyState.dateTo.split("-").map(Number);
    filtered = filtered.filter(
      (r) => r.fechaHora <= new Date(y, m - 1, d, 23, 59, 59, 999).getTime(),
    );
  }
  if (historyState.search.trim()) {
    const q = historyState.search.toLowerCase();
    filtered = filtered.filter(
      (r) =>
        (r.itemNombre || "").toLowerCase().includes(q) ||
        (r.usuarioNombre || "").toLowerCase().includes(q) ||
        (r.autorizadorNombre || "").toLowerCase().includes(q),
    );
  }

  const header =
    "Fecha,Insumo,Cantidad,Solicitante,Autorizador,Entregó Vacío,Sucursal,Departamento\n";
  const rows = filtered
    .map(
      (r) =>
        `"${formatFecha(r.fechaHora)}","${r.itemNombre}",${r.cantidad},"${r.usuarioNombre}","${r.autorizadorNombre}","${r.entregaVacio ? "Sí" : "No"}","${r.sucursalNombre}","${r.departamentoNombre}"`,
    )
    .join("\n");

  const blob = new Blob(["\uFEFF" + header + rows], {
    type: "text/csv;charset=utf-8;",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `retiros_${historyState.dateFrom || "inicio"}_a_${historyState.dateTo || "fin"}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Archivo exportado correctamente");
}

// ─── Inventory Management Page ──────────────────────────────
function renderInventoryManagement() {
  if (currentUser?.rol === "solicitante") {
    document.getElementById("page-inventory").innerHTML =
      '<div class="flex items-center justify-center" style="min-height:80vh;"><p class="text-muted">No tienes permisos para acceder a esta página.</p></div>';
    return;
  }
  renderInventoryTable(
    "inventory-table-management",
    "inventory",
    inventoryState,
  );
}

// ─── Withdrawal Dialog ──────────────────────────────────────
function openWithdrawalDialog(preselectItemId) {
  const items = db("items").sort((a, b) =>
    itemLabel(a).localeCompare(itemLabel(b)),
  );
  const usuarios = db("usuarios")
    .filter((u) => u.rol === "autorizador" || u.rol === "ambos")
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  const sucursales = db("sucursales").sort((a, b) =>
    a.nombre.localeCompare(b.nombre),
  );
  const departamentos = db("departamentos").sort((a, b) =>
    a.nombre.localeCompare(b.nombre),
  );

  populateSelect(
    "wd-item-dropdown",
    items,
    (i) => i.id,
    (i) => itemLabel(i),
    (i) => (i.stockActual || 0) <= 0,
  );
  populateSelect(
    "wd-auth-dropdown",
    usuarios,
    (u) => u.id,
    (u) => u.nombre,
  );
  populateSelect(
    "wd-suc-dropdown",
    sucursales,
    (s) => s.id,
    (s) => s.nombre,
  );
  populateSelect(
    "wd-dep-dropdown",
    departamentos,
    (d) => d.id,
    (d) => d.nombre,
  );

  document.getElementById("wd-cantidad").value = "1";
  document.getElementById("wd-nombre").value = "";
  resetSelect("wd-item-trigger", "Selecciona un insumo");
  resetSelect("wd-auth-trigger", "Selecciona autorizador");
  resetSelect("wd-suc-trigger", "Selecciona una sucursal");
  resetSelect("wd-dep-trigger", "Selecciona un departamento");
  setSelectValue("wd-vacio-trigger", "wd-vacio-dropdown", "no");
  document.getElementById("wd-item-stock").style.display = "none";

  initSelect("wd-item-trigger", "wd-item-dropdown", (val) => {
    const item = items.find((i) => i.id === val);
    const stockDiv = document.getElementById("wd-item-stock");
    if (item) {
      let html = `Disponible: ${item.stockActual}`;
      if (item.stockActual < item.stockMinimo) {
        html +=
          ' <span class="badge badge-destructive" style="font-size:10px;">Bajo mínimo</span>';
      }
      stockDiv.innerHTML = html;
      stockDiv.style.display = "block";
    } else {
      stockDiv.style.display = "none";
    }
  });
  initSelect("wd-auth-trigger", "wd-auth-dropdown");
  initSelect("wd-suc-trigger", "wd-suc-dropdown");
  initSelect("wd-dep-trigger", "wd-dep-dropdown");
  initSelect("wd-vacio-trigger", "wd-vacio-dropdown");

  if (preselectItemId) {
    setSelectValue("wd-item-trigger", "wd-item-dropdown", preselectItemId);
    const item = items.find((i) => i.id === preselectItemId);
    if (item) {
      const stockDiv = document.getElementById("wd-item-stock");
      stockDiv.innerHTML = `Disponible: ${item.stockActual}`;
      stockDiv.style.display = "block";
    }
  }

  openModal("modal-withdrawal");
}

async function confirmWithdrawal() {
  const codigoItem = document.getElementById("wd-item-trigger").dataset.value;
  const nombreRetira = document.getElementById("wd-nombre").value.trim();
  const idAutorizador =
    document.getElementById("wd-auth-trigger").dataset.value;
  const idSucursal = document.getElementById("wd-suc-trigger").dataset.value;
  const idDepartamento =
    document.getElementById("wd-dep-trigger").dataset.value;
  const cantidad = parseInt(document.getElementById("wd-cantidad").value) || 0;
  const entregaVacio =
    document.getElementById("wd-vacio-trigger").dataset.value === "si";

  if (
    !codigoItem ||
    !nombreRetira ||
    !idAutorizador ||
    !idSucursal ||
    !idDepartamento
  ) {
    showToast("Completa todos los campos del retiro.", "error");
    return;
  }
  if (cantidad <= 0) {
    showToast("La cantidad debe ser mayor a cero.", "error");
    return;
  }

  const items = db("items");
  const item = items.find((i) => i.id === codigoItem);
  if (!item) {
    showToast("Insumo no encontrado.", "error");
    return;
  }
  if (item.stockActual < cantidad) {
    showToast("Stock insuficiente para la cantidad solicitada.", "error");
    return;
  }

  const btnWd = document.getElementById("btn-confirm-withdrawal");
  setBtnLoading(btnWd, "Procesando...");

  try {
    // 1. Update stock
    const nuevoStock = item.stockActual - cantidad;
    await fbUpdate("items", item.id, { stockActual: nuevoStock });

    // 2. Add withdrawal record
    const usuarios = db("usuarios");
    const sucursales = db("sucursales");
    const departamentos = db("departamentos");
    const auth = usuarios.find((u) => u.id === idAutorizador);
    const suc = sucursales.find((s) => s.id === idSucursal);
    const dep = departamentos.find((d) => d.id === idDepartamento);

    await fbAdd("retiros", {
      fechaHora: Date.now(),
      codigoItem,
      idAutorizador,
      idSucursal,
      idDepartamento,
      cantidad,
      entregaVacio,
      itemNombre: itemLabel(item),
      usuarioNombre: nombreRetira,
      autorizadorNombre: auth?.nombre || "",
      sucursalNombre: suc?.nombre || "",
      departamentoNombre: dep?.nombre || "",
    });

    await refreshData();
    showToast("Retiro registrado y stock actualizado.");
    closeModal("modal-withdrawal");
    navigateTo(currentPage);
  } catch (error) {
    console.error(error);
    showToast("Error al registrar retiro", "error");
  } finally {
    resetBtn(btnWd);
  }
}

// ─── Historical Withdrawal Dialog ───────────────────────────
function openHistoricalWithdrawalDialog() {
  const marcas = db("marcas").sort((a, b) => a.nombre.localeCompare(b.nombre));
  const items = db("items").sort((a, b) => {
    const lA = itemLabel(a).toLowerCase();
    const lB = itemLabel(b).toLowerCase();
    return lA.localeCompare(lB);
  });
  const usuarios = db("usuarios").sort((a, b) =>
    a.nombre.localeCompare(b.nombre),
  );
  const sucursales = db("sucursales").sort((a, b) =>
    a.nombre.localeCompare(b.nombre),
  );
  const departamentos = db("departamentos").sort((a, b) =>
    a.nombre.localeCompare(b.nombre),
  );

  // Default to yesterday or current date minus some time
  const now = new Date();
  now.setDate(now.getDate() - 1);
  const offset = now.getTimezoneOffset() * 60000;
  const localISOTime = (new Date(now - offset)).toISOString().slice(0, 16);
  document.getElementById("hwd-fecha").value = localISOTime;

  document.getElementById("hwd-cantidad").value = "1";
  document.getElementById("hwd-nombre").value = "";

  populateSelect(
    "hwd-item-dropdown",
    items,
    (i) => i.id,
    (i) => itemLabel(i),
  );
  populateSelect(
    "hwd-auth-dropdown",
    usuarios,
    (u) => u.id,
    (u) => u.nombre,
  );
  populateSelect(
    "hwd-suc-dropdown",
    sucursales,
    (s) => s.id,
    (s) => s.nombre,
  );
  populateSelect(
    "hwd-dep-dropdown",
    departamentos,
    (d) => d.id,
    (d) => d.nombre,
  );

  resetSelect("hwd-item-trigger", "Selecciona un insumo");
  resetSelect("hwd-auth-trigger", "Selecciona autorizador");
  resetSelect("hwd-suc-trigger", "Selecciona una sucursal");
  resetSelect("hwd-dep-trigger", "Selecciona un departamento");
  setSelectValue("hwd-vacio-trigger", "hwd-vacio-dropdown", "no");

  initSelect("hwd-item-trigger", "hwd-item-dropdown");
  initSelect("hwd-auth-trigger", "hwd-auth-dropdown");
  initSelect("hwd-suc-trigger", "hwd-suc-dropdown");
  initSelect("hwd-dep-trigger", "hwd-dep-dropdown");
  initSelect("hwd-vacio-trigger", "hwd-vacio-dropdown");

  openModal("modal-historical-withdrawal");
}

async function confirmHistoricalWithdrawal() {
  const fechaInput = document.getElementById("hwd-fecha").value;
  const codigoItem = document.getElementById("hwd-item-trigger").dataset.value;
  const cantidad = parseInt(document.getElementById("hwd-cantidad").value) || 0;
  const entregaVacio =
    document.getElementById("hwd-vacio-trigger").dataset.value === "si";
  const nombreRetira = document.getElementById("hwd-nombre").value.trim();
  const idAutorizador =
    document.getElementById("hwd-auth-trigger").dataset.value;
  const idSucursal = document.getElementById("hwd-suc-trigger").dataset.value;
  const idDepartamento =
    document.getElementById("hwd-dep-trigger").dataset.value;

  if (
    !fechaInput ||
    !codigoItem ||
    !nombreRetira ||
    !idAutorizador ||
    !idSucursal ||
    !idDepartamento
  ) {
    showToast("Completa todos los campos del retiro histórico.", "error");
    return;
  }
  if (cantidad <= 0) {
    showToast("La cantidad debe ser mayor a cero.", "error");
    return;
  }

  const items = db("items");
  const item = items.find((i) => i.id === codigoItem);
  if (!item) {
    showToast("Insumo no encontrado.", "error");
    return;
  }

  // Calculate timestamp from the input
  const timestamp = new Date(fechaInput).getTime();

  const btnWd = document.getElementById("btn-confirm-historical");
  setBtnLoading(btnWd, "Procesando...");

  try {
    // We explicitly DO NOT update stock here.
    
    // Add withdrawal record with the historical timestamp
    const usuarios = db("usuarios");
    const sucursales = db("sucursales");
    const departamentos = db("departamentos");
    const auth = usuarios.find((u) => u.id === idAutorizador);
    const suc = sucursales.find((s) => s.id === idSucursal);
    const dep = departamentos.find((d) => d.id === idDepartamento);

    await fbAdd("retiros", {
      fechaHora: timestamp,
      codigoItem,
      idAutorizador,
      idSucursal,
      idDepartamento,
      cantidad,
      entregaVacio,
      itemNombre: itemLabel(item),
      usuarioNombre: nombreRetira,
      autorizadorNombre: auth?.nombre || "",
      sucursalNombre: suc?.nombre || "",
      departamentoNombre: dep?.nombre || "",
    });

    await refreshData();
    showToast("Retiro histórico registrado exitosamente.");
    closeModal("modal-historical-withdrawal");
    navigateTo(currentPage);
  } catch (error) {
    console.error(error);
    showToast("Error al registrar retiro histórico", "error");
  } finally {
    resetBtn(btnWd);
  }
}

// ─── New Item Dialog ────────────────────────────────────────
function openNewItemDialog() {
  const marcas = db("marcas").sort((a, b) => a.nombre.localeCompare(b.nombre));
  const tipos = db("tipos").sort((a, b) => a.nombre.localeCompare(b.nombre));

  populateSelect(
    "ni-tipo-dropdown",
    tipos,
    (t) => t.nombre,
    (t) => t.nombre,
  );
  populateSelect(
    "ni-marca-dropdown",
    marcas,
    (m) => m.nombre,
    (m) => m.nombre,
  );

  resetSelect("ni-tipo-trigger", "Selecciona un tipo");
  resetSelect("ni-marca-trigger", "Selecciona una marca");
  resetSelect("ni-color-trigger", "Selecciona un color");
  document.getElementById("ni-modelo").value = "";
  document.getElementById("ni-stock").value = "";
  document.getElementById("ni-minimo").value = "";
  document.getElementById("ni-model-error").style.display = "none";

  initSelect("ni-tipo-trigger", "ni-tipo-dropdown");
  initSelect("ni-marca-trigger", "ni-marca-dropdown");
  initSelect("ni-color-trigger", "ni-color-dropdown");

  openModal("modal-new-item");
}

async function confirmNewItem() {
  const tipo = document.getElementById("ni-tipo-trigger").dataset.value;
  const marca = document.getElementById("ni-marca-trigger").dataset.value;
  const modelo = document.getElementById("ni-modelo").value.trim();
  const color = document.getElementById("ni-color-trigger").dataset.value;
  const stockActual = parseInt(document.getElementById("ni-stock").value) || 0;
  const stockMinimo = parseInt(document.getElementById("ni-minimo").value) || 0;

  if (!tipo || !marca || !modelo || !color) {
    showToast("Todos los campos de texto son obligatorios.", "error");
    return;
  }

  const items = db("items");
  if (
    items.some((i) => (i.modelo || "").toLowerCase() === modelo.toLowerCase())
  ) {
    document.getElementById("ni-model-error").style.display = "block";
    showToast("Este modelo ya existe en el inventario.", "error");
    return;
  }

  const btnNi = document.querySelector('#modal-new-item .modal-footer .btn-primary');
  setBtnLoading(btnNi, "Agregando...");

  try {
    await fbAdd("items", {
      tipo,
      marca,
      modelo,
      color,
      stockActual,
      stockMinimo,
    });
    await refreshData();
    showToast("Insumo agregado al inventario.");
    closeModal("modal-new-item");
    navigateTo(currentPage);
  } catch (error) {
    console.error(error);
    showToast("Error al agregar insumo", "error");
  } finally {
    resetBtn(btnNi);
  }
}

// ─── Edit Item Dialog ───────────────────────────────────────
function openEditItemDialog(itemId) {
  const items = db("items");
  const item = items.find((i) => i.id === itemId);
  if (!item) return;

  const marcas = db("marcas").sort((a, b) => a.nombre.localeCompare(b.nombre));
  const tipos = db("tipos").sort((a, b) => a.nombre.localeCompare(b.nombre));

  populateSelect(
    "ei-tipo-dropdown",
    tipos,
    (t) => t.nombre,
    (t) => t.nombre,
  );
  populateSelect(
    "ei-marca-dropdown",
    marcas,
    (m) => m.nombre,
    (m) => m.nombre,
  );

  document.getElementById("ei-id").value = itemId;
  document.getElementById("ei-modelo").value = item.modelo;
  document.getElementById("ei-stock").value = item.stockActual;
  document.getElementById("ei-minimo").value = item.stockMinimo;
  document.getElementById("ei-model-error").style.display = "none";

  initSelect("ei-tipo-trigger", "ei-tipo-dropdown");
  initSelect("ei-marca-trigger", "ei-marca-dropdown");
  initSelect("ei-color-trigger", "ei-color-dropdown");

  setSelectValue("ei-tipo-trigger", "ei-tipo-dropdown", item.tipo);
  setSelectValue("ei-marca-trigger", "ei-marca-dropdown", item.marca);
  setSelectValue("ei-color-trigger", "ei-color-dropdown", item.color);

  openModal("modal-edit-item");
}

async function confirmEditItem() {
  const id = document.getElementById("ei-id").value;
  const tipo = document.getElementById("ei-tipo-trigger").dataset.value;
  const marca = document.getElementById("ei-marca-trigger").dataset.value;
  const modelo = document.getElementById("ei-modelo").value.trim();
  const color = document.getElementById("ei-color-trigger").dataset.value;
  const stockActual = parseInt(document.getElementById("ei-stock").value) || 0;
  const stockMinimo = parseInt(document.getElementById("ei-minimo").value) || 0;

  if (!tipo || !marca || !modelo || !color) {
    showToast("Todos los campos de texto son obligatorios.", "error");
    return;
  }

  const items = db("items");
  if (
    items.some(
      (i) =>
        i.id !== id && (i.modelo || "").toLowerCase() === modelo.toLowerCase(),
    )
  ) {
    document.getElementById("ei-model-error").style.display = "block";
    showToast("Este modelo ya existe en el inventario.", "error");
    return;
  }

  const btnEi = document.querySelector('#modal-edit-item .modal-footer .btn-primary');
  setBtnLoading(btnEi, "Guardando...");

  try {
    await fbUpdate("items", id, {
      tipo,
      marca,
      modelo,
      color,
      stockActual,
      stockMinimo,
    });
    await refreshData();
    showToast("Insumo actualizado correctamente.");
    closeModal("modal-edit-item");
    navigateTo(currentPage);
  } catch (error) {
    console.error(error);
    showToast("Error al actualizar insumo", "error");
  } finally {
    resetBtn(btnEi);
  }
}

// ─── Delete Item Dialog ─────────────────────────────────────
function openDeleteItemDialog(itemId) {
  const items = db("items");
  const item = items.find((i) => i.id === itemId);
  if (!item) return;
  document.getElementById("delete-item-id").value = itemId;
  document.getElementById("delete-item-name").textContent =
    `${item.marca} - ${item.modelo}`;
  openModal("modal-delete-item");
}

async function confirmDeleteItem() {
  const id = document.getElementById("delete-item-id").value;
  const btnDel = document.querySelector('#modal-delete-item .modal-footer .btn-destructive');
  setBtnLoading(btnDel, "Eliminando...");

  try {
    await fbDelete("items", id);
    await refreshData();
    showToast("Insumo eliminado correctamente.");
    closeModal("modal-delete-item");
    navigateTo(currentPage);
  } catch (error) {
    console.error(error);
    showToast("Error al eliminar insumo", "error");
  } finally {
    resetBtn(btnDel);
  }
}

// ─── Configuration Page ─────────────────────────────────────
function renderConfiguracion() {
  if (currentUser?.rol === "solicitante") {
    document.getElementById("page-configuracion").innerHTML =
      '<div class="flex items-center justify-center" style="min-height:80vh;"><p class="text-muted">No tienes permisos para acceder a esta página.</p></div>';
    return;
  }
  renderMarcasList();
  renderTiposList();
}

function renderMarcasList() {
  const container = document.getElementById("marcas-list");
  if (!container) return;
  const marcas = db("marcas").sort((a, b) => a.nombre.localeCompare(b.nombre));
  if (marcas.length === 0) {
    container.innerHTML =
      '<p class="text-sm text-muted" style="text-align:center; padding:1rem;">No hay marcas registradas.</p>';
    return;
  }
  container.innerHTML = marcas
    .map(
      (m) => `
    <div class="flex items-center" style="justify-content:space-between; padding:0.5rem; border-radius:var(--radius); border:1px solid var(--border);">
      <span class="font-medium">${m.nombre}</span>
      <button class="btn btn-ghost btn-icon" style="color:var(--destructive); width:2rem; height:2rem;" onclick="deleteMarca('${m.id}')">
        ${ICONS.trash}
      </button>
    </div>
  `,
    )
    .join("");
}

function renderTiposList() {
  const container = document.getElementById("tipos-list");
  if (!container) return;
  const tipos = db("tipos").sort((a, b) => a.nombre.localeCompare(b.nombre));
  if (tipos.length === 0) {
    container.innerHTML =
      '<p class="text-sm text-muted" style="text-align:center; padding:1rem;">No hay tipos registrados.</p>';
    return;
  }
  container.innerHTML = tipos
    .map(
      (t) => `
    <div class="flex items-center" style="justify-content:space-between; padding:0.5rem; border-radius:var(--radius); border:1px solid var(--border);">
      <span class="font-medium">${t.nombre}</span>
      <button class="btn btn-ghost btn-icon" style="color:var(--destructive); width:2rem; height:2rem;" onclick="deleteTipo('${t.id}')">
        ${ICONS.trash}
      </button>
    </div>
  `,
    )
    .join("");
}

async function deleteMarca(id) {
  try {
    await fbDelete("marcas", id);
    await refreshData();
    showToast("Marca eliminada");
    renderMarcasList();
  } catch (error) {
    showToast("Error al eliminar marca", "error");
  }
}

async function deleteTipo(id) {
  try {
    await fbDelete("tipos", id);
    await refreshData();
    showToast("Tipo eliminado");
    renderTiposList();
  } catch (error) {
    showToast("Error al eliminar tipo", "error");
  }
}

// ─── Users Page ─────────────────────────────────────────────
function renderUsuarios() {
  if (currentUser?.rol === "solicitante") {
    document.getElementById("page-usuarios").innerHTML =
      '<div class="flex items-center justify-center" style="min-height:80vh;"><p class="text-muted">No tienes permisos para acceder a esta página.</p></div>';
    return;
  }
  renderUsuariosList();
}

function renderUsuariosList() {
  const container = document.getElementById("usuarios-list");
  if (!container) return;
  const usuarios = db("usuarios").sort((a, b) =>
    a.nombre.localeCompare(b.nombre),
  );
  if (usuarios.length === 0) {
    container.innerHTML =
      '<p class="text-sm text-muted" style="text-align:center; padding:1rem;">No hay usuarios registrados.</p>';
    return;
  }
  container.innerHTML = usuarios
    .map(
      (u) => `
    <div class="flex items-center" style="justify-content:space-between; padding:0.75rem; border-radius:var(--radius); border:1px solid var(--border); background:rgba(var(--muted-rgb, 243,244,246),0.3);">
      <div>
        <span class="font-medium" style="display:block; line-height:1;">${u.nombre}</span>
        <span class="text-xs text-muted">@${u.usuario} • ${u.rol}</span>
      </div>
      <button class="btn btn-ghost btn-icon" style="color:var(--destructive); width:2rem; height:2rem;" onclick="deleteUsuario('${u.id}')" title="Eliminar usuario">
        ${ICONS.trash}
      </button>
    </div>
  `,
    )
    .join("");
}

async function deleteUsuario(id) {
  if (!confirm("¿Seguro que deseas eliminar este usuario?")) return;
  try {
    await fbDelete("usuarios", id);
    await refreshData();
    showToast("Usuario eliminado");
    renderUsuariosList();
  } catch (error) {
    showToast("Error al eliminar usuario", "error");
  }
}

// ─── Init ───────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // Ensure we show loading state while initially fetching
  setAppLoading(true);

  // Login form
  document.getElementById("login-form").addEventListener("submit", handleLogin);

  // Add marca form
  document
    .getElementById("form-add-marca")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("input-nueva-marca");
      const nombre = input.value.trim();
      if (!nombre) return;
      const btnMarca = e.target.querySelector('button[type="submit"]');
      setBtnLoading(btnMarca, "Agregando...");
      try {
        await fbAdd("marcas", { nombre });
        await refreshData();
        input.value = "";
        showToast("Marca agregada");
        renderMarcasList();
      } catch (e) {
        showToast("Error agregando marca", "error");
      } finally {
        resetBtn(btnMarca);
      }
    });

  // Add tipo form
  document
    .getElementById("form-add-tipo")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("input-nuevo-tipo");
      const nombre = input.value.trim();
      if (!nombre) return;
      const btnTipo = e.target.querySelector('button[type="submit"]');
      setBtnLoading(btnTipo, "Agregando...");
      try {
        await fbAdd("tipos", { nombre });
        await refreshData();
        input.value = "";
        showToast("Tipo agregado");
        renderTiposList();
      } catch (e) {
        showToast("Error agregando tipo", "error");
      } finally {
        resetBtn(btnTipo);
      }
    });

  // Add usuario form
  document
    .getElementById("form-add-usuario")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const nombre = document.getElementById("usr-nombre").value.trim();
      const usuario = document.getElementById("usr-usuario").value.trim();
      const password = document.getElementById("usr-password").value;
      const rol =
        document.getElementById("usr-rol-trigger").dataset.value ||
        "solicitante";

      if (!nombre || !usuario || !password) {
        showToast("Completa todos los campos.", "error");
        return;
      }

      const usuarios = db("usuarios");
      if (usuarios.some((u) => u.usuario === usuario)) {
        showToast("Ese nombre de usuario ya existe.", "error");
        return;
      }

      const btnUsr = e.target.querySelector('button[type="submit"]');
      setBtnLoading(btnUsr, "Creando...");

      try {
        const hashedPassword = await hashPassword(password);
        await fbAdd("usuarios", { nombre, usuario, password: hashedPassword, rol });
        await refreshData();
        document.getElementById("usr-nombre").value = "";
        document.getElementById("usr-usuario").value = "";
        document.getElementById("usr-password").value = "";
        setSelectValue("usr-rol-trigger", "usr-rol-dropdown", "solicitante");
        showToast("Usuario agregado exitosamente");
        renderUsuariosList();
      } catch (e) {
        showToast("Error al crear usuario", "error");
      } finally {
        resetBtn(btnUsr);
      }
    });

  // Init user role select
  initSelect("usr-rol-trigger", "usr-rol-dropdown");

  // Initial load
  await refreshData();

  // If memory fallback is used, ensure seed data exists
  if (!firestoreDb) {
    await seedIfEmpty();
  }

  // Check session
  setAppLoading(false);
  if (checkSession()) {
    navigateTo("dashboard");
  } else {
    navigateTo("login");
  }
});
