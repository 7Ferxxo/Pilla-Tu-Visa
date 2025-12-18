document.addEventListener('DOMContentLoaded', () => {
    const TOKEN_KEY = 'ptv_token';
    const getAuthHeaders = () => {
        try {
            const token = window.localStorage.getItem(TOKEN_KEY);
            return token ? { Authorization: `Bearer ${token}` } : {};
        } catch {
            return {};
        }
    };

    const form = document.getElementById('registroForm');
    const mensajeDiv = document.getElementById('mensaje');
    const submitBtn = document.getElementById('btn-submit');

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

    const potencialesBody = document.getElementById('potencialesBody');
    const potencialesStatus = document.getElementById('potencialesStatus');
    const btnRecargarPotenciales = document.getElementById('btnRecargarPotenciales');

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
                    'Content-Type': 'application/json' 
                },
                body: JSON.stringify(data) 
            });

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

        if (view === 'potenciales') {
            loadPotenciales();
        }
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
            const resp = await fetch('/clients');
            const data = await resp.json();
            if (!resp.ok || !data.ok) return;
            fillClients(tipsCliente, data.clients || []);
            fillClients(resultadoCliente, data.clients || []);
        } catch {
        }
    };

    const renderPotenciales = (items) => {
        if (!potencialesBody) return;
        potencialesBody.innerHTML = '';
        if (!items || !items.length) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 6;
            td.className = 'table-empty';
            td.textContent = 'No hay clientes potenciales registrados todavía.';
            tr.appendChild(td);
            potencialesBody.appendChild(tr);
            return;
        }

        items.forEach((p) => {
            const tr = document.createElement('tr');
            const fecha = p.creado_en ? new Date(p.creado_en).toLocaleString() : '';
            const estadoRaw = (p.estado || 'nuevo').toLowerCase();
            const estadoKey = ['contactado', 'descartado'].includes(estadoRaw) ? estadoRaw : 'nuevo';
            const estadoText = estadoKey === 'contactado' ? 'Contactado' : estadoKey === 'descartado' ? 'Descartado' : 'Nuevo';

            const tdNombre = document.createElement('td');
            tdNombre.textContent = p.nombre || '-';
            tr.appendChild(tdNombre);

            const tdEmail = document.createElement('td');
            tdEmail.textContent = p.email || '-';
            tr.appendChild(tdEmail);

            const tdTel = document.createElement('td');
            tdTel.textContent = p.telefono || '-';
            tr.appendChild(tdTel);

            const tdEstado = document.createElement('td');
            const spanEstado = document.createElement('span');
            spanEstado.className = `status-pill status-${estadoKey}`;
            spanEstado.textContent = estadoText;
            tdEstado.appendChild(spanEstado);
            tr.appendChild(tdEstado);

            const tdFecha = document.createElement('td');
            tdFecha.textContent = fecha;
            tr.appendChild(tdFecha);

            const tdAccion = document.createElement('td');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-table';
            btn.textContent = estadoKey === 'contactado' ? 'Contactado' : 'Marcar contactado';
            btn.disabled = estadoKey === 'contactado';
            btn.addEventListener('click', async () => {
                try {
                    setPotencialesStatus('Actualizando estado...', null);
                    const resp = await fetch(`/api/potenciales/${p.id}/estado`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...getAuthHeaders(),
                        },
                        body: JSON.stringify({ estado: 'contactado' }),
                    });
                    const data = await resp.json().catch(() => ({}));
                    if (!resp.ok || !data.ok) {
                        throw new Error(data.mensaje || 'No se pudo actualizar el estado');
                    }
                    await loadPotenciales();
                    setPotencialesStatus('Estado actualizado.', 'ok');
                } catch (err) {
                    setPotencialesStatus(err && err.message ? err.message : 'Error al actualizar el estado.', 'error');
                }
            });
            tdAccion.appendChild(btn);
            tr.appendChild(tdAccion);

            potencialesBody.appendChild(tr);
        });
    };

    const setPotencialesStatus = (text, type) => {
        if (!potencialesStatus) return;
        potencialesStatus.textContent = text || '';
        potencialesStatus.classList.remove('is-ok', 'is-error');
        if (type) {
            potencialesStatus.classList.add(type === 'error' ? 'is-error' : 'is-ok');
        }
    };

    const loadPotenciales = async () => {
        if (!potencialesBody) return;
        setPotencialesStatus('Cargando...', null);
        try {
            const resp = await fetch('/api/potenciales', {
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders(),
                },
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || !data.ok) {
                throw new Error(data.mensaje || 'No se pudieron cargar los clientes potenciales');
            }
            renderPotenciales(data.items || []);
            setPotencialesStatus(`Total: ${(data.items || []).length}`, 'ok');
        } catch (err) {
            renderPotenciales([]);
            setPotencialesStatus(err && err.message ? err.message : 'Error al cargar la lista.', 'error');
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

    if (btnRecargarPotenciales) {
        btnRecargarPotenciales.addEventListener('click', () => {
            loadPotenciales();
        });
    }

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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ perfil, fechaCita: fecha }),
        })
            .then(async (r) => {
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
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado, detalle: det }),
        })
            .then(async (r) => {
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
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
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
