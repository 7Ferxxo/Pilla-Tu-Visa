document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('recibosStatus');
  const bodyEl = document.getElementById('recibosBody');
  const btnRecargar = document.getElementById('btnRecargar');
  const btnLogout = document.getElementById('btnLogout');
  const sessionInfoEl = document.getElementById('sessionInfo');

  const TOKEN_KEY = 'ptv_token';
  const USER_KEY = 'ptv_user';

  const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
  const clearToken = () => localStorage.removeItem(TOKEN_KEY);
  const getUserInfo = () => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null') || null;
    } catch {
      return null;
    }
  };
  const clearUserInfo = () => localStorage.removeItem(USER_KEY);

  const redirectToLogin = () => {
    window.location.href = '/login/index.html';
  };

  const setStatus = (texto, tipo) => {
    if (!statusEl) return;
    statusEl.textContent = texto;
    statusEl.className = `mensaje mensaje-${tipo}`;
    statusEl.style.display = 'block';
  };

  const clearStatus = () => {
    if (!statusEl) return;
    statusEl.style.display = 'none';
    statusEl.textContent = '';
  };

  const renderEmpty = () => {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="9" style="padding:16px; color:#6b7280;">No hay recibos todavía.</td>';
    bodyEl.appendChild(tr);
  };

  const formatMoney = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num.toFixed(2) : String(value ?? '');
  };

  const escapeText = (value) => {
    const s = String(value ?? '');
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const formatNotesHtml = (value) => {
    const escaped = escapeText(value);
    return escaped.replace(/\r\n|\n|\r/g, '<br>');
  };

  const updateSessionInfo = () => {
    if (!sessionInfoEl) return;
    const info = getUserInfo();
    if (info && info.username) {
      sessionInfoEl.textContent = `Sesión: ${info.username}${info.role ? ` (${info.role})` : ''}`;
      sessionInfoEl.style.display = 'inline-flex';
    } else if (getToken()) {
      sessionInfoEl.textContent = 'Sesión activa';
      sessionInfoEl.style.display = 'inline-flex';
    } else {
      sessionInfoEl.textContent = '';
      sessionInfoEl.style.display = 'none';
    }
  };

  const renderRows = (rows) => {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';

    if (!rows || rows.length === 0) {
      renderEmpty();
      return;
    }

    rows.forEach((r) => {
      const id = r.id;
      const tr = document.createElement('tr');
      const notas = String(r.notas ?? '').trim();
      tr.innerHTML = `
        <td>${escapeText(id)}</td>
        <td>${escapeText(r.nombre)}</td>
        <td>${escapeText(r.email)}</td>
        <td>${escapeText(r.concepto)}</td>
        <td class="notes" title="${escapeText(notas)}">${formatNotesHtml(notas)}</td>
        <td>${escapeText(r.metodo)}</td>
        <td class="amount">$${escapeText(formatMoney(r.monto))}</td>
        <td><a href="/recibo/${encodeURIComponent(String(id))}" target="_blank" rel="noreferrer">Abrir</a></td>
        <td><button type="button" class="btn-delete" data-id="${escapeText(id)}">Eliminar</button></td>
      `;
      bodyEl.appendChild(tr);
    });
  };

  const fetchWithAuth = async (url, options = {}) => {
    const token = getToken();
    if (!token) {
      redirectToLogin();
      throw new Error('Unauthorized');
    }
    const opts = { ...options, headers: { ...(options.headers || {}) } };
    if (token) {
      opts.headers.Authorization = `Bearer ${token}`;
    }
    const resp = await fetch(url, opts);
    if (resp.status === 401 || resp.status === 403) {
      clearToken();
      clearUserInfo();
      redirectToLogin();
      throw new Error('Unauthorized');
    }
    return resp;
  };

  const deleteRecibo = async (id) => {
    const ok = window.confirm(`¿Eliminar el recibo #${id}? Esta acción no se puede deshacer.`);
    if (!ok) return;

    setStatus(`Eliminando recibo #${id}...`, 'exito');
    try {
      const resp = await fetchWithAuth(`/recibos/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) throw new Error(data.mensaje || 'Error');
      setStatus(`Recibo #${id} eliminado.`, 'exito');
      await load();
    } catch (e) {
      console.error(e);
      setStatus(`No se pudo eliminar el recibo #${id}.`, 'error');
    }
  };

  if (bodyEl) {
    bodyEl.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('.btn-delete') : null;
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      if (!id) return;
      deleteRecibo(id);
    });
  }

  const load = async () => {
    setStatus('Cargando recibos...', 'exito');
    try {
      const resp = await fetchWithAuth('/recibos?limit=200');
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) throw new Error(data.mensaje || 'Error');
      clearStatus();
      renderRows(data.recibos || []);
    } catch (e) {
      console.error(e);
      renderEmpty();
      if (e && e.message === 'Unauthorized') return;
      setStatus('No se pudo cargar el listado de recibos.', 'error');
    }
  };

  if (btnRecargar) btnRecargar.addEventListener('click', load);

  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      clearToken();
      clearUserInfo();
      renderEmpty();
      redirectToLogin();
    });
  }

  if (!getToken()) {
    redirectToLogin();
    return;
  }

  updateSessionInfo();
  load();
});
