const TOKEN_KEY = 'ptv_token';
const USER_KEY = 'ptv_user';
const currentPage = document.body?.dataset?.page || 'login';
const isLoginPage = currentPage === 'login';
const isRecoverPage = currentPage === 'recover';
const isResetPage = currentPage === 'reset';

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
  btn.setAttribute('aria-pressed', String(isHidden));
  btn.setAttribute('aria-label', isHidden ? 'Ocultar contraseña' : 'Mostrar contraseña');
};

const showLeadStatus = (message, type = 'ok') => {
  const el = document.getElementById('leadStatus');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('is-ok', 'is-error');
  el.classList.add(type === 'error' ? 'is-error' : 'is-ok');
};

const showRecoverStatus = (message, type = 'ok') => {
  const el = document.getElementById('recoverStatus');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('is-ok', 'is-error');
  if (message) {
    el.classList.add(type === 'error' ? 'is-error' : 'is-ok');
  }
};

const showResetStatus = (message, type = 'ok') => {
  const el = document.getElementById('resetStatus');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('is-ok', 'is-error');
  if (message) {
    el.classList.add(type === 'error' ? 'is-error' : 'is-ok');
  }
};

if (isLoginPage && localStorage.getItem(TOKEN_KEY)) {
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
      showLeadStatus(error?.message || 'Ocurrió un error al enviar tus datos.', 'error');
    }
  });
}

const heroLeadBtn = document.getElementById('heroLeadBtn');
const leadSection = document.getElementById('lead-section');
if (heroLeadBtn && leadSection) {
  heroLeadBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    leadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

const recoverForm = document.getElementById('recoverForm');
if (recoverForm) {
  recoverForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const emailInput = document.getElementById('recoverEmail');
    const email = emailInput ? emailInput.value.trim() : '';
    if (!email) {
      showRecoverStatus('Escribe el correo registrado.', 'error');
      return;
    }

    try {
      showRecoverStatus('Enviando instrucciones...', 'ok');
      const resp = await fetch('/api/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        throw new Error(data.mensaje || 'No se pudo procesar tu solicitud.');
      }
      showRecoverStatus(data.mensaje || 'Si tu correo está registrado, te enviamos un enlace.', 'ok');
      recoverForm.reset();
      if (isRecoverPage) {
        setTimeout(() => {
          window.location.href = '/login/';
        }, 2500);
      }
    } catch (error) {
      showRecoverStatus(error?.message || 'Ocurrió un error al enviar el correo.', 'error');
    }
  });
}

const resetForm = document.getElementById('resetForm');
if (resetForm && isResetPage) {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const tokenInput = document.getElementById('resetToken');

  const disableResetForm = () => {
    resetForm.querySelectorAll('input, button').forEach((el) => {
      el.setAttribute('disabled', 'disabled');
    });
  };

  if (!token) {
    showResetStatus('El enlace no es válido. Solicita uno nuevo desde la página de login.', 'error');
    disableResetForm();
  } else if (tokenInput) {
    tokenInput.value = token;
  }

  resetForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!token) {
      return;
    }

    const password = document.getElementById('resetPassword')?.value || '';
    const confirm = document.getElementById('resetPasswordConfirm')?.value || '';

    if (password.length < 8) {
      showResetStatus('La contraseña debe tener al menos 8 caracteres.', 'error');
      return;
    }

    if (password !== confirm) {
      showResetStatus('Las contraseñas no coinciden.', 'error');
      return;
    }

    try {
      showResetStatus('Guardando tu nueva contraseña...', 'ok');
      const resp = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        throw new Error(data.mensaje || 'No se pudo restablecer la contraseña.');
      }
      showResetStatus(data.mensaje || 'Contraseña actualizada. Redireccionando al login...', 'ok');
      resetForm.reset();
      setTimeout(() => {
        window.location.href = '/login/';
      }, 2000);
    } catch (error) {
      showResetStatus(error?.message || 'Ocurrió un error al restablecer la contraseña.', 'error');
    }
  });
}
