const TOKEN_KEY = 'ptv_token';
const USER_KEY = 'ptv_user';

const apiLogin = async (username, password) => {
  const resp = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.ok || !data.token) {
    throw new Error(data.mensaje || 'Usuario o contraseña incorrectos');
  }
  return { token: data.token, role: data.role, username: data.username };
};

const showError = (msg) => {
  const el = document.getElementById('mensajeError');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
};

const hideError = () => {
  const el = document.getElementById('mensajeError');
  if (!el) return;
  el.textContent = '';
  el.style.display = 'none';
};

const redirectToHome = () => {
  window.location.href = '/register';
};

const saveSession = ({ token, role, username }) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify({ role, username }));
};

const togglePasswordVisibility = () => {
  const input = document.getElementById('password');
  const btn = document.getElementById('togglePassword');
  if (!input || !btn) return;
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.textContent = isHidden ? 'Ocultar' : 'Ver';
};

const showLeadStatus = (message, type = 'ok') => {
  const el = document.getElementById('leadStatus');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('is-ok', 'is-error');
  el.classList.add(type === 'error' ? 'is-error' : 'is-ok');
};

const leadForm = document.getElementById('leadForm');
if (leadForm) {
  leadForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nombre = document.getElementById('leadNombre')?.value.trim();
    const email = document.getElementById('leadEmail')?.value.trim();
    const telefono = document.getElementById('leadTelefono')?.value.trim();
    const mensaje = document.getElementById('leadMensaje')?.value.trim();

    if (!nombre || !email) {
      showLeadStatus('Por favor ingresa al menos tu nombre y email.', 'error');
      return;
    }

    try {
      showLeadStatus('Enviando tus datos, un momento...', 'ok');
      const resp = await fetch('/api/potenciales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, email, telefono, mensaje }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        throw new Error(data.mensaje || 'No se pudo enviar tu solicitud.');
      }
      showLeadStatus(data.mensaje || 'Hemos recibido tu solicitud, te contactaremos pronto.', 'ok');
      leadForm.reset();
    } catch (error) {
      showLeadStatus(error && error.message ? error.message : 'Ocurrió un error al enviar tus datos.', 'error');
    }
  });
}

if (localStorage.getItem(TOKEN_KEY)) {
  redirectToHome();
}

const form = document.getElementById('loginForm');
if (form) {
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    hideError();
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const username = usernameInput ? usernameInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';
    if (!username || !password) {
      showError('Ingresa usuario y contraseña.');
      return;
    }
    try {
      const { token, role, username: confirmed } = await apiLogin(username, password.trim());
      saveSession({ token, role, username: confirmed || username });
      redirectToHome();
    } catch (e) {
      showError(e && e.message ? e.message : 'No se pudo iniciar sesión');
    }
  });
}

const toggleBtn = document.getElementById('togglePassword');
if (toggleBtn) {
  toggleBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    togglePasswordVisibility();
  });
}

const loginPanel = document.getElementById('loginPanel');
const openLoginBtn = document.getElementById('openLogin');
const loginMenuToggle = document.getElementById('loginMenuToggle');
const leadLinkHero = document.getElementById('leadLinkHero');

const syncPanelState = (isOpen) => {
  if (!loginPanel) return;
  loginPanel.setAttribute('data-state', isOpen ? 'open' : 'closed');
  document.body.classList.toggle('login-panel-open', isOpen);
  if (loginMenuToggle) {
    loginMenuToggle.classList.toggle('is-active', isOpen);
    loginMenuToggle.setAttribute('aria-expanded', String(isOpen));
  }
};

const openLoginPanel = () => syncPanelState(true);
const closeLoginPanel = () => syncPanelState(false);
const toggleLoginPanel = () => {
  if (!loginPanel) return;
  const isOpen = loginPanel.getAttribute('data-state') === 'open';
  syncPanelState(!isOpen);
};

if (openLoginBtn) {
  openLoginBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    openLoginPanel();
  });
}

if (loginMenuToggle) {
  loginMenuToggle.addEventListener('click', (ev) => {
    ev.preventDefault();
    toggleLoginPanel();
  });
}

if (leadLinkHero) {
  leadLinkHero.addEventListener('click', () => {
    closeLoginPanel();
  });
}

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    closeLoginPanel();
  }
});
