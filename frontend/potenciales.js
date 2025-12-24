document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('potencialesStatus');
  const bodyEl = document.getElementById('potencialesBody');
  const btnRecargar = document.getElementById('btnRecargar');
  const btnLogout = document.getElementById('btnLogout');

  const TOKEN_KEY = 'ptv_token';
  const USER_KEY = 'ptv_user';
  const getAuthHeader = () => {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const tokenAtLoad = localStorage.getItem(TOKEN_KEY);
  if (!tokenAtLoad) {
    window.location.href = '/login/';
    return;
  }

  const redirectToLoginIfUnauthorized = (resp) => {
    if (resp && resp.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      window.location.href = '/login/';
      return true;
    }
    return false;
  };

  const logout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST', headers: { ...getAuthHeader() } });
    } catch {
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.location.href = '/login/';
  };

  if (btnLogout) {
    btnLogout.addEventListener('click', (ev) => {
      ev.preventDefault();
      logout();
    });
  }

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

  const escapeText = (value) => {
    const s = String(value ?? '');
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const formatMessageHtml = (value) => {
    return escapeText(value).replace(/\r\n|\n|\r/g, '<br>');
  };

  const renderEmpty = () => {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="6" style="padding:16px; color:#6b7280;">No hay clientes potenciales todavía.</td>';
    bodyEl.appendChild(tr);
  };

  const renderRows = (rows) => {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';

    if (!rows || rows.length === 0) {
      renderEmpty();
      return;
    }

    rows.forEach((r) => {
      const tr = document.createElement('tr');
      const msg = String(r.mensaje ?? '').trim();
      tr.innerHTML = `
        <td>${escapeText(r.id)}</td>
        <td>${escapeText(r.nombre)}</td>
        <td>${escapeText(r.email)}</td>
        <td>${escapeText(r.telefono)}</td>
        <td class="notes" title="${escapeText(msg)}">${formatMessageHtml(msg)}</td>
        <td>${escapeText(r.created_at || '')}</td>
      `;
      bodyEl.appendChild(tr);
    });
  };

  const load = async () => {
    setStatus('Cargando potenciales...', 'exito');
    try {
      const resp = await fetch('/api/potenciales?limit=200', {
        headers: {
          ...getAuthHeader(),
        },
      });
      if (redirectToLoginIfUnauthorized(resp)) return;
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) throw new Error(data.mensaje || 'Error');
      clearStatus();
      renderRows(data.potenciales || []);
    } catch (e) {
      console.error(e);
      renderEmpty();
      setStatus('No se pudo cargar el listado de potenciales.', 'error');
    }
  };

  if (btnRecargar) btnRecargar.addEventListener('click', load);
  load();
});
