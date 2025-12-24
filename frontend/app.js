document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('registroForm');
    const mensajeDiv = document.getElementById('mensaje');
    const submitBtn = document.getElementById('btn-submit');

    const TOKEN_KEY = 'ptv_token';
    const USER_KEY = 'ptv_user';

    const tokenAtLoad = localStorage.getItem(TOKEN_KEY);
    if (!tokenAtLoad) {
        window.location.href = '/login/';
        return;
    }
    const getAuthHeader = () => {
        const token = localStorage.getItem(TOKEN_KEY);
        return token ? { Authorization: `Bearer ${token}` } : {};
    };

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

    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
        btnLogout.addEventListener('click', (ev) => {
            ev.preventDefault();
            logout();
        });
    }

    const tabs = Array.from(document.querySelectorAll('.tab[data-view]'));
    const sections = Array.from(document.querySelectorAll('[data-section]'));

    const tipsForm = document.getElementById('tipsForm');
    const tipsStatus = document.getElementById('tipsStatus');
    const tipsCliente = document.getElementById('tipsCliente');
    const fechaCita = document.getElementById('fechaCita');
    const perfilCliente = document.getElementById('perfilCliente');
    const tipsMensaje = document.getElementById('tipsMensaje');
    const btnGenerar = document.getElementById('btnGenerar');
    const btnEnviarTips = document.getElementById('btnEnviarTips');

    const resultadoForm = document.getElementById('resultadoForm');
    const resultadoStatus = document.getElementById('resultadoStatus');
    const resultadoCliente = document.getElementById('resultadoCliente');
    const estadoInput = document.getElementById('estado');
    const detalleLabel = document.getElementById('detalleLabel');
    const detalle = document.getElementById('detalle');
    const resultadoMensaje = document.getElementById('resultadoMensaje');
    const btnRedactar = document.getElementById('btnRedactar');
    const btnNotificar = document.getElementById('btnNotificar');

    const segmentedButtons = Array.from(document.querySelectorAll('.segmented-btn[data-estado]'));
    
    const mostrarMensaje = (texto, tipo) => {
        mensajeDiv.textContent = texto;
        mensajeDiv.className = `mensaje mensaje-${tipo}`; 
        mensajeDiv.style.display = 'block'; 
        
        if (tipo === 'exito') {
            setTimeout(() => {
                mensajeDiv.style.display = 'none';
                form.reset(); 
            }, 6000); 
        }
    };

    form.addEventListener('submit', async (event) => {
        event.preventDefault(); 

        submitBtn.disabled = true;
        submitBtn.textContent = 'Procesando...';
        mensajeDiv.style.display = 'none'; 

        const formData = new FormData(form);
        const data = Object.fromEntries(formData); 

        try {
            const response = await fetch('/register', {
                method: 'POST', 
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeader(),
                },
                body: JSON.stringify(data) 
            });

            if (redirectToLoginIfUnauthorized(response)) return;

            const result = await response.json();

            if (response.ok && !result.error) {
                mostrarMensaje(
                    `Registro exitoso. Recibo ID ${result.reciboId}. ${result.mensaje}`,
                    'exito'
                );
                if (result.reciboId) {
                    window.open(`/recibo/${result.reciboId}`, '_blank');
                }
            } else {
                mostrarMensaje(`Error al registrar: ${result.mensaje || 'Respuesta de servidor desconocida.'}`, 'error');
            }

        } catch (error) {
            console.error('Error de red al conectar con el servidor:', error);
            mostrarMensaje('No se pudo conectar con el servidor. ¿Está encendido tu Node.js?', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Guardar y Enviar Recibo';
        }
    });

    const setStatus = (el, texto, tipo) => {
        el.textContent = texto;
        el.className = `mensaje mensaje-${tipo}`;
        el.style.display = 'block';
    };

    const showView = (view) => {
        tabs.forEach((t) => t.classList.toggle('tab--active', t.dataset.view === view));
        sections.forEach((s) => s.classList.toggle('is-hidden', s.dataset.section !== view));
    };

    tabs.forEach((t) => {
        t.addEventListener('click', () => showView(t.dataset.view));
    });

    const fillClients = (selectEl, clients) => {
        const keepFirst = selectEl.querySelector('option[value=""]');
        selectEl.innerHTML = '';
        if (keepFirst) selectEl.appendChild(keepFirst);

        clients.forEach((c) => {
            const opt = document.createElement('option');
            opt.value = String(c.id);
            opt.textContent = c.nombre || c.email || `Cliente ${c.id}`;
            selectEl.appendChild(opt);
        });
    };

    const loadClients = async () => {
        try {
            const resp = await fetch('/clients', {
                headers: {
                    ...getAuthHeader(),
                },
            });
            if (redirectToLoginIfUnauthorized(resp)) return;
            const data = await resp.json();
            if (!resp.ok || !data.ok) return;
            fillClients(tipsCliente, data.clients || []);
            fillClients(resultadoCliente, data.clients || []);
        } catch {
        }
    };

    const setEstado = (estado) => {
        estadoInput.value = estado;
        segmentedButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.estado === estado));
        detalleLabel.textContent = estado === 'Aprobada' ? 'Detalles alegría' : 'Razón negación';
        detalle.value = '';
    };

    segmentedButtons.forEach((b) => {
        b.addEventListener('click', () => setEstado(b.dataset.estado));
    });

    btnGenerar.addEventListener('click', () => {
        const perfil = (perfilCliente.value || '').trim();
        const fecha = (fechaCita.value || '').trim();
        const fallback = () => {
            const lines = [
                'Preguntas para la entrevista:',
                '',
                '- ¿Cuál es el propósito del viaje?',
                '- ¿Cuánto tiempo planea quedarse?',
                '- ¿Quién cubre los gastos del viaje?',
                '- ¿A qué se dedica actualmente?',
                '- ¿Qué lazos tiene en su país de origen?',
            ];
            if (perfil) lines.splice(2, 0, `Perfil: ${perfil}`, '');
            if (fecha) lines.splice(2, 0, `Fecha de cita: ${fecha}`, '');
            tipsMensaje.value = lines.join('\n');
        };

        btnGenerar.disabled = true;
        btnGenerar.textContent = 'Generando...';
        tipsStatus.style.display = 'none';

        fetch('/ai/tips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ perfil, fechaCita: fecha }),
        })
            .then(async (r) => {
                if (redirectToLoginIfUnauthorized(r)) throw new Error('No autorizado');
                const data = await r.json().catch(() => ({}));
                if (!r.ok || !data.ok || !data.text) throw new Error(data.mensaje || 'Error');
                tipsMensaje.value = data.text;
            })
            .catch(() => {
                fallback();
            })
            .finally(() => {
                btnGenerar.disabled = false;
                btnGenerar.textContent = 'Sugerir Preguntas';
            });
    });

    tipsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        btnEnviarTips.disabled = true;
        btnEnviarTips.textContent = 'Enviando...';
        tipsStatus.style.display = 'none';

        const payload = {
            clienteId: tipsCliente.value,
            fechaCita: fechaCita.value,
            perfil: perfilCliente.value,
            mensaje: tipsMensaje.value,
        };

        try {
            const resp = await fetch('/tips', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                body: JSON.stringify(payload),
            });
            if (redirectToLoginIfUnauthorized(resp)) return;
            const data = await resp.json();
            if (resp.ok && !data.error) {
                setStatus(tipsStatus, data.mensaje || 'Tips enviados correctamente', 'exito');
            } else {
                setStatus(tipsStatus, data.mensaje || 'Error al enviar tips', 'error');
            }
        } catch {
            setStatus(tipsStatus, 'No se pudo conectar con el servidor.', 'error');
        } finally {
            btnEnviarTips.disabled = false;
            btnEnviarTips.textContent = 'Enviar Tips';
        }
    });

    btnRedactar.addEventListener('click', () => {
        const estado = estadoInput.value;
        const det = (detalle.value || '').trim();
        const fallback = () => {
            if (estado === 'Aprobada') {
                resultadoMensaje.value = `¡Felicitaciones! Tu visa fue aprobada.${det ? ` ${det}` : ''}`;
            } else {
                resultadoMensaje.value = `Tu visa fue denegada.${det ? ` ${det}` : ''} Si quieres, te ayudamos a prepararte para una próxima cita.`;
            }
        };

        btnRedactar.disabled = true;
        btnRedactar.textContent = 'Redactando...';
        resultadoStatus.style.display = 'none';

        fetch('/ai/resultado', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ estado, detalle: det }),
        })
            .then(async (r) => {
                if (redirectToLoginIfUnauthorized(r)) throw new Error('No autorizado');
                const data = await r.json().catch(() => ({}));
                if (!r.ok || !data.ok || !data.text) throw new Error(data.mensaje || 'Error');
                resultadoMensaje.value = data.text;
            })
            .catch(() => {
                fallback();
            })
            .finally(() => {
                btnRedactar.disabled = false;
                btnRedactar.textContent = 'Redactar Mensaje';
            });
    });

    resultadoForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        btnNotificar.disabled = true;
        btnNotificar.textContent = 'Notificando...';
        resultadoStatus.style.display = 'none';

        const payload = {
            clienteId: resultadoCliente.value,
            estado: estadoInput.value,
            detalle: detalle.value,
            mensaje: resultadoMensaje.value,
        };

        try {
            const resp = await fetch('/resultado', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                body: JSON.stringify(payload),
            });
            if (redirectToLoginIfUnauthorized(resp)) return;
            const data = await resp.json();
            if (resp.ok && !data.error) {
                setStatus(resultadoStatus, data.mensaje || 'Resultado notificado correctamente', 'exito');
            } else {
                setStatus(resultadoStatus, data.mensaje || 'Error al notificar', 'error');
            }
        } catch {
            setStatus(resultadoStatus, 'No se pudo conectar con el servidor.', 'error');
        } finally {
            btnNotificar.disabled = false;
            btnNotificar.textContent = 'Notificar';
        }
    });

    setEstado('Aprobada');
    loadClients();
});
