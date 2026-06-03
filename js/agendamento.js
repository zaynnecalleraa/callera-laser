(function () {
  const supa = window.SUPA;

  const form = document.getElementById('formAgend');
  const bookingCard = document.getElementById('bookingCard');
  const bookingSuccess = document.getElementById('bookingSuccess');
  const submitBtn = document.getElementById('submitAgend');
  const errorEl = document.getElementById('formError');

  // Bloqueia datas passadas
  const dateInput = document.getElementById('agendData');
  if (dateInput) {
    dateInput.min = new Date().toISOString().split('T')[0];
  }

  function showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.hidden = false;
    errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideError() {
    if (errorEl) errorEl.hidden = true;
  }

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const nome = form.agendNome.value.trim();
    const telefone = form.agendTelefone.value.trim().replace(/\D/g, '');
    const email = form.agendEmail.value.trim() || null;
    const servico = form.agendServico.value;
    const data = form.agendData.value;
    const horario = form.agendHorario.value;
    const observacoes = form.agendObs.value.trim() || null;

    if (!nome) { showError('Por favor, informe seu nome completo.'); return; }
    if (telefone.length < 10) { showError('Por favor, informe um número de WhatsApp válido com DDD.'); return; }
    if (!servico) { showError('Por favor, selecione um serviço.'); return; }
    if (!data) { showError('Por favor, selecione uma data.'); return; }
    if (!horario) { showError('Por favor, selecione um horário.'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';

    const { error } = await supa.from('agendamentos').insert({
      nome,
      telefone,
      email,
      servico,
      data,
      horario,
      observacoes,
    });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirmar Agendamento';

    if (error) {
      console.error('[agendamento] insert error:', error);
      const msg = error.message || '';
      const hint = /relation|does not exist/i.test(msg)
        ? 'A tabela de agendamentos ainda não foi criada no banco. Informe o administrador.'
        : 'Não foi possível enviar o agendamento. Tente novamente ou entre em contato pelo WhatsApp.';
      showError(hint);
      return;
    }

    bookingCard.hidden = true;
    bookingSuccess.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  document.getElementById('btnNewBooking')?.addEventListener('click', () => {
    form.reset();
    hideError();
    bookingCard.hidden = false;
    bookingSuccess.hidden = true;
  });
})();
