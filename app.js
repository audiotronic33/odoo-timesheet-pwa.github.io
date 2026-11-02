// ===========================
// Odoo Timesheet PWA - app.js
// ===========================

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    loadSettings();
    setupEventListeners();
}

// Charger les paramètres depuis le localStorage
function loadSettings() {
    const url = localStorage.getItem('odoo_url') || '';
    const db = localStorage.getItem('odoo_db') || '';
    const login = localStorage.getItem('odoo_login') || '';
    const password = localStorage.getItem('odoo_password') || '';

    if (document.getElementById('odoo-url')) document.getElementById('odoo-url').value = url;
    if (document.getElementById('odoo-db')) document.getElementById('odoo-db').value = db;
    if (document.getElementById('odoo-login')) document.getElementById('odoo-login').value = login;
    if (document.getElementById('odoo-password')) document.getElementById('odoo-password').value = password;

    if (url && db && login && password) {
        authenticateAndLoad(url, db, login, password);
    }
}

// Configuration des écouteurs d'événements
function setupEventListeners() {
    const settingsForm = document.getElementById('settings-form');
    if (settingsForm) {
        settingsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveAndConnect();
        });
    }
}

// Sauvegarde des paramètres et tentative de connexion
function saveAndConnect() {
    const url = document.getElementById('odoo-url').value.trim().replace(/\/+$/, ''); // Supprime le / final si présent
    const db = document.getElementById('odoo-db').value.trim();
    const login = document.getElementById('odoo-login').value.trim();
    const password = document.getElementById('odoo-password').value.trim();

    localStorage.setItem('odoo_url', url);
    localStorage.setItem('odoo_db', db);
    localStorage.setItem('odoo_login', login);
    localStorage.setItem('odoo_password', password);

    authenticateAndLoad(url, db, login, password);
}

// Requête JSON-RPC centralisée vers Odoo
async function odooJsonRpc(url, method, params) {
    const payload = {
        jsonrpc: "2.0",
        method: "call",
        params: params,
        id: Math.floor(Math.random() * 1000000)
    };

    try {
        const response = await fetch(`${url}/jsonrpc`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            // CRUCIAL POUR PWA / MOBILE : Permet d'envoyer/recevoir les cookies de session du serveur Odoo
            credentials: 'include', 
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }

        const data = await response.json();
        if (data.error) {
            throw new Error(data.error.data?.message || data.error.message || 'Erreur Odoo inconnue');
        }

        return data.result;
    } catch (error) {
        console.error("Erreur de communication Odoo:", error);
        throw error;
    }
}

// Authentification auprès d'Odoo
async function authenticateAndLoad(url, db, login, password) {
    showStatus("Connexion en cours...", "info");

    try {
        const uid = await odooJsonRpc(url, 'call', {
            service: "common",
            method: "authenticate",
            args: [db, login, password, {}]
        });

        if (!uid) {
            throw new Error("Échec d'authentification : Identifiants incorrects ou base de données invalide.");
        }

        localStorage.setItem('odoo_uid', uid);
        showStatus("Connecté avec succès !", "success");
        
        // Vous pouvez enchaîner ici le chargement de vos données (feuilles d'temps, projets, etc.)
        // ex: loadTimesheets(url, db, uid, password);

    } catch (error) {
        showStatus(`Erreur de connexion : ${error.message}`, "error");
    }
}

// Utilitaire d'affichage des statuts dans l'interface
function showStatus(message, type) {
    let statusEl = document.getElementById('status-message');
    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'status-message';
        document.body.prepend(statusEl);
    }
    statusEl.textContent = message;
    statusEl.className = `status-${type}`;
}
