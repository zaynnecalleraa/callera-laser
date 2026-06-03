(function(){
  const supa = window.SUPA;

  // ---- Helpers ----
  const $  = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const toastBox = $('#toast');
  const isMobile = () => window.matchMedia('(max-width: 640px)').matches;


  function moneyFormat(n){
    // Se o valor já é numérico, apenas formata
    let num;
    if (typeof n === 'number') {
      num = n;
    } else {
      // Remove qualquer caractere que não seja dígito, vírgula, ponto ou sinal
      const cleaned = String(n || '')
        .replace(/[\sR$\u00A0]/g, '') // remove espaços e símbolos de moeda
        .replace(/[^\d,.-]/g, '')
        .replace(/\./g, '')         // remove separadores de milhar
        .replace(',', '.');          // converte vírgula decimal para ponto
      num = parseFloat(cleaned);
      if (!isFinite(num)) num = 0;
    }
    return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  
  function moneyParse(v){
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    const str = String(v).trim();
    if (!str) return null;
    const sanitized = str
      .replace(/[\sR$\u00A0]/g, '')
      .replace(/[^\d,.-]/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const num = parseFloat(sanitized);
    return isNaN(num) ? null : num;
  }

  function showToast(msg, type='ok'){
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    toastBox.appendChild(t);
    requestAnimationFrame(()=> t.classList.add('show'));
    setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(), 250); }, 2600);
  }

  const gate = $('#authGate');

  // ---- Auth probe ----
  // ---- Auth probe (robusto) ----
async function ensureAuthOrShowGate(){
  const gateEl = gate; // #authGate já existe no topo

  try {
    // 1) Tem sessão?
    const { data: sessionData } = await supa.auth.getSession();
    const hasSession = !!sessionData?.session;

    // 2) Se não tiver sessão, mostra o gate e para
    if (!hasSession) { gateEl.style.display = 'grid'; return false; }

    // 3) Sessão existe → checa permissão de leitura (orders)
    const { error } = await supa
      .from('orders')
      .select('id', { head: true, count: 'exact' })
      .limit(1);

    // Se der permission denied, abre o gate
    if (error && /permission|rls|policy/i.test(error.message)) {
      gateEl.style.display = 'grid';
      return false;
    }

    // OK: some com o gate e libera o app
    gateEl.style.display = 'none';
    return true;

  } catch (err) {
    console.error('Auth probe falhou:', err);
    gateEl.style.display = 'grid';
    return false;
  }
}

  // ---- KPI ----
  async function loadKPIs(){
    const prod = await supa.from('products').select('id', { count: 'exact', head: true });
    $('#kpiProducts').textContent = String(prod.count || 0);

    const allOrders = await supa.from('orders').select('id', { count: 'exact', head: true });
    $('#kpiOrders').textContent = String(allOrders.count || 0);

    const d0 = new Date(); d0.setHours(0,0,0,0);
    const today = await supa.from('orders').select('id', { count: 'exact', head: true }).gte('created_at', d0.toISOString());
    $('#kpiToday').textContent = String(today.count || 0);

    const totalAgend = await supa.from('agendamentos').select('id', { count: 'exact', head: true });
    const kpiAgendTotal = $('#kpiAgendTotal');
    if(kpiAgendTotal) kpiAgendTotal.textContent = String(totalAgend.count || 0);

    const pendentes = await supa.from('agendamentos').select('id', { count: 'exact', head: true }).eq('status', 'pendente');
    const kpiAgend = $('#kpiAgend');
    if(kpiAgend) kpiAgend.textContent = String(pendentes.count || 0);
  }

  // ---- Categorias ----
  async function fetchCategories(){
    const { data, error } = await supa.from('categories').select('id,name').order('name',{ascending:true});
    if(error){ console.error(error); showToast('Erro ao carregar categorias','err'); return []; }
    return data||[];
  }

  async function renderCategories(){
    const wrap = $('#tblCats tbody');
    wrap.innerHTML = '';
    const cats = await fetchCategories();
    cats.forEach(c=>{
      const tr=document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Nome">${c.name}</td>
        <td class="actions-col right">
          <button class="btn-sm" data-edit-cat="${c.id}">Editar</button>
          <button class="btn-sm danger" data-del-cat="${c.id}">Excluir</button>
        </td>`;
      wrap.appendChild(tr);
    });
  }

  $('#btnAddCat')?.addEventListener('click', async ()=>{
    const name = ($('#catName').value||'').trim();
    if(!name) return;
    const { error } = await supa.from('categories').insert({name});
    if(error){ showToast('Erro ao adicionar categoria','err'); return; }
    $('#catName').value=''; showToast('Categoria adicionada');
    renderCategories(); renderCatsChecklist();
  });

  $('#tblCats')?.addEventListener('click', async (e)=>{
    const edit = e.target.closest('[data-edit-cat]');
    const del  = e.target.closest('[data-del-cat]');
    if(edit){
      const id = edit.dataset.editCat;
      const novo = prompt('Renomear categoria para:');
      if(!novo) return;
      const { error } = await supa.from('categories').update({name:novo}).eq('id', id);
      if(error){ showToast('Erro ao renomear','err'); return; }
      renderCategories(); renderCatsChecklist(); showToast('Categoria atualizada');
    }
    if(del){
      const id = del.dataset.delCat;
      if(!confirm('Excluir categoria?')) return;
      await supa.from('product_categories').delete().eq('category_id', id);
      const { error } = await supa.from('categories').delete().eq('id', id);
      if(error){ showToast('Erro ao excluir','err'); return; }
      renderCategories(); renderCatsChecklist(); showToast('Categoria excluída');
    }
  });

  // ---- Produtos ----
  let productsCache = [];
  let showLimit = 5;
  let showAll = false;

  async function fetchProducts(){
    const { data, error } = await supa
      .from('products')
      .select('id,name,price,on_sale,promo_price,stock,featured,image_url,installments_enabled,installments_count,installment_value,created_at, product_categories(category_id), categories:product_categories(category_id, categories(name))')
      .order('name',{ascending:true});
    if(error){ console.error(error); showToast('Erro ao carregar produtos','err'); return []; }

    return (data||[]).map(p=>{
      const catNames = (p.categories||[]).map(c=>c?.categories?.name).filter(Boolean);
      return {...p, _catNames: catNames};
    });
  }

  function renderProductsTable(list){
    const body = $('#tblProducts tbody');
    body.innerHTML='';
    const rowset = (showAll? list : list.slice(0, showLimit));
    const mobile = isMobile();

    rowset.forEach(p=>{
      const price   = (p.price==null? null : Number(p.price));
      const promo   = (p.on_sale && p.promo_price!=null) ? Number(p.promo_price||0) : null;
      const instOk  = !!p.installments_enabled;
      const instVal = (p.installment_value ?? null);

      const tr=document.createElement('tr');
      if (mobile) tr.classList.add('collapsed');  // só colapsa no mobile

      const toggleBtn = mobile ? `<button class="btn-sm ghost toggle-row" data-toggle="row" type="button">Ver mais</button>` : '';

      tr.innerHTML = `
        <td data-label="Nome">
          <div style="display:flex;flex-direction:column;gap:4px">
            <strong>${p.name||'—'}</strong>
            ${toggleBtn}
          </div>
        </td>
        <td data-label="Preço">${price!=null? 'R$ '+moneyFormat(price) : '—'}</td>
        <td data-label="Promoção">${promo!=null? 'R$ '+moneyFormat(promo) : '—'}</td>
        <td data-label="Parcelas?">${instOk? 'sim' : '—'}</td>
        <td data-label="Valor parcela">${(instOk && instVal!=null) ? 'R$ '+moneyFormat(instVal) : '—'}</td>
        <td data-label="Estoque">${p.stock!=null? p.stock : '—'}</td>
        <td data-label="Categorias">${p._catNames.length? p._catNames.map(n=>`<span class="chip">${n}</span>`).join(' ') : '—'}</td>
        <td data-label="Destaque">${p.featured? 'sim' : '—'}</td>
        <td class="actions-col right">
          <button class="btn-sm" data-edit="${p.id}">Editar</button>
          <button class="btn-sm danger" data-del="${p.id}">Excluir</button>
        </td>
      `;
      body.appendChild(tr);
    });

    $('#btnToggleMore').textContent = showAll? 'Ocultar' : 'Ver mais';
  }

  async function loadAndRenderProducts(){
    productsCache = await fetchProducts();
    applyProductFilter();
    const kpi = document.getElementById('kpiProducts');
    if (kpi) kpi.textContent = String(productsCache.length);
  }

  function applyProductFilter(){
    const q = ($('#searchProducts').value||'').toLowerCase().trim();
    const list = q? productsCache.filter(p=> (p.name||'').toLowerCase().includes(q)) : productsCache.slice();
    renderProductsTable(list);
  }

  $('#searchProducts')?.addEventListener('input', ()=> applyProductFilter());
  $('#btnToggleMore')?.addEventListener('click', ()=>{ showAll=!showAll; applyProductFilter(); });

  $('#tblProducts')?.addEventListener('click', async (e)=>{
    const del  = e.target.closest('[data-del]');
    const edit = e.target.closest('[data-edit]');
    if(del){
      const id = del.dataset.del;
      if(!confirm('Excluir produto?')) return;
      await supa.from('product_categories').delete().eq('product_id', id);
      const { error } = await supa.from('products').delete().eq('id', id);
      if(error){ showToast('Erro ao excluir','err'); return; }
      showToast('Produto excluído'); loadAndRenderProducts();
    }
    if(edit){ openProductModal(edit.dataset.edit); }
  });

  // ---- Modal Produto ----
  const dlg  = $('#productModal');
  const form = $('#formProduct');
  const pName = $('#pName'), pPrice=$('#pPrice'), pPromo=$('#pPromo'),
        pStock=$('#pStock'), pOnSale=$('#pOnSale'), pTrackStock=$('#pTrackStock'),
        pFeatured=$('#pFeatured'), pImage=$('#pImage'), pDesc=$('#pDesc');

  const pInstEnabled=$('#pInstEnabled'), pInstQty=$('#pInstQty'), pInstValue=$('#pInstValue');
  const preview = $('#pImagePreview');

  function togglePromoUI(){
    const en = pOnSale.checked;
    pPromo.disabled = !en;
    if(!en) pPromo.value='';
  }
  pOnSale.addEventListener('change', togglePromoUI);

  function toggleStockUI(){
    const en = pTrackStock.checked;
    pStock.disabled = !en;
    if(!en) pStock.value='';
  }
  pTrackStock.addEventListener('change', toggleStockUI);

  // >>> NOVO: parcelamento NÃO mexe no campo de preço
  function toggleInstallmentsUI(){
    const en = pInstEnabled.checked;
    pInstQty.disabled = pInstValue.disabled = !en;
    if(!en){ pInstQty.value=''; pInstValue.value=''; }
  }
  pInstEnabled.addEventListener('change', toggleInstallmentsUI);

  pImage.addEventListener('change', ()=>{
    const f = pImage.files?.[0];
    if(!f){ preview.removeAttribute('src'); return; }
    const r = new FileReader(); r.onload = e=> preview.src = e.target.result; r.readAsDataURL(f);
  });

  async function renderCatsChecklist(selected=[]){
    const cats = await fetchCategories();
    const box = $('#catsBox'); box.innerHTML='';
    cats.forEach(c=>{
      const id = `cat_${c.id}`;
      const wrap=document.createElement('label'); wrap.className='cat-item';
      wrap.innerHTML = `<input type="checkbox" value="${c.id}" id="${id}"><span>${c.name}</span>`;
      const ck = wrap.querySelector('input');
      if(selected.includes(c.id)) ck.checked=true;
      box.appendChild(wrap);
    });
  }

  let editingId = null;

  async function openProductModal(id=null){
    editingId = id;
    $('#productModalTitle').textContent = id? 'Editar produto' : 'Novo produto';
    form.reset(); preview.removeAttribute('src');
    togglePromoUI(); toggleStockUI();
    pInstEnabled.checked=false; toggleInstallmentsUI();

    let selectedCats=[];
    if(id){
      const { data, error } = await supa
        .from('products')
        .select('id,name,price,on_sale,promo_price,stock,featured,image_url,description,installments_enabled,installments_count,installment_value, product_categories(category_id)')
        .eq('id', id).maybeSingle();
      if(error || !data){ showToast('Erro ao carregar produto','err'); return; }

      pName.value=data.name||'';
      pPrice.value=(data.price!=null)? moneyFormat(data.price) : '';
      pOnSale.checked= !!data.on_sale; togglePromoUI();
      if(data.on_sale && data.promo_price!=null) pPromo.value = moneyFormat(data.promo_price);

      pTrackStock.checked = (data.stock!=null); toggleStockUI();
      if(data.stock!=null) pStock.value = data.stock;

      pFeatured.checked = !!data.featured;
      pDesc.value = data.description||'';
      if(data.image_url) preview.src = data.image_url;

      if(data.installments_enabled){
        pInstEnabled.checked=true; toggleInstallmentsUI();
        if(data.installments_count) pInstQty.value = data.installments_count;
        if(data.installment_value!=null) pInstValue.value = moneyFormat(data.installment_value);
      }

      selectedCats = (data.product_categories||[]).map(x=>x.category_id);
    }
    await renderCatsChecklist(selectedCats);
    dlg.showModal();
  }

  $('#btnNewProduct')?.addEventListener('click', ()=> openProductModal());

  dlg.addEventListener('click', e=>{
    if(e.target.hasAttribute('data-close')) dlg.close();
  });

  async function uploadImageIfAny(currentUrl){
    const f = pImage.files?.[0];
    if(!f) return currentUrl||null;
    try{
      const ext = (f.name.split('.').pop()||'jpg').toLowerCase();
      const path = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { data, error } = await supa.storage.from('images').upload(path, f, {upsert:false});
      if(error) throw error;
      const { data:pub } = supa.storage.from('images').getPublicUrl(path);
      return pub?.publicUrl || null;
    }catch(err){ console.error(err); showToast('Falha ao subir imagem','warn'); return currentUrl||null; }
  }

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();

    const priceParsed = moneyParse(pPrice.value); // pode ser number ou null
    const payload = {
      name: pName.value.trim(),
      price: priceParsed, // <<< mantém preço mesmo com parcelamento
      on_sale: !!pOnSale.checked,
      promo_price: pOnSale.checked ? moneyParse(pPromo.value) : null,
      featured: !!pFeatured.checked,
      description: pDesc.value||null,
      installments_enabled: !!pInstEnabled.checked,
      installments_count: pInstEnabled.checked? (Number(pInstQty.value)||null) : null,
      installment_value:  pInstEnabled.checked? moneyParse(pInstValue.value) : null,
    };

    if(pTrackStock.checked) payload.stock = Number(pStock.value)||0; else payload.stock = null;

    // imagem
    let currentUrl = null;
    if(editingId){
      const { data } = await supa.from('products').select('image_url').eq('id', editingId).maybeSingle();
      currentUrl = data?.image_url||null;
    }
    payload.image_url = await uploadImageIfAny(currentUrl);

    // grava produto
    let pid = editingId;
    if(editingId){
      const { error } = await supa.from('products').update(payload).eq('id', editingId);
      if(error){ showToast('Erro ao salvar','err'); return; }
    }else{
      const { data, error } = await supa.from('products').insert(payload).select('id').single();
      if(error){ showToast('Erro ao criar produto','err'); return; }
      pid = data.id;
    }

    // categorias
    const checked = $$('#catsBox input[type="checkbox"]:checked').map(i=>i.value);
    await supa.from('product_categories').delete().eq('product_id', pid);
    if(checked.length){
      const rows = checked.map(cid=>({product_id:pid, category_id:cid}));
      await supa.from('product_categories').insert(rows);
    }

    dlg.close();
    showToast('Produto salvo');
    loadAndRenderProducts();
  });

  // ---- Pedidos (inalterado relevante) ----
  let ordersCache = [];
  let showOrdersAll = false;
  const ORDERS_LIMIT = 10;

  // Carrega pedidos com tratamento de erro e normalização do items (jsonb)
async function loadOrders(){
  try{
    const { data, error } = await supa
      .from('orders')
      .select('id, customer, phone, items, created_at, status, to_whatsapp')
      .order('created_at', { ascending:false });

    if (error){
      console.error('[orders] select error:', error);
      showToast('Não foi possível carregar pedidos', 'warn');
      return [];
    }
    return (data || []).map(o => ({
      ...o,
      items: Array.isArray(o.items) ? o.items : []   // garante array
    }));
  }catch(err){
    console.error('[orders] unexpected:', err);
    showToast('Falha inesperada ao carregar pedidos', 'err');
    return [];
  }
}


  function renderOrders(){
    const body = $('#tblOrders tbody'); body.innerHTML='';
    const rows = showOrdersAll? ordersCache : ordersCache.slice(0, ORDERS_LIMIT);
    const mobile = isMobile();

    rows.forEach((o)=>{
      const when  = new Date(o.created_at);
      const itens = (o.items||[]).map(i=>`${i.qty||1}× ${i.name}`).join(', ');

      const tr=document.createElement('tr');
      if (mobile) tr.classList.add('collapsed');

      const toggleBtn = mobile ? `<button class="btn-sm ghost toggle-row" data-toggle="row" type="button">Ver mais</button>` : '';

      tr.innerHTML = `
        <td data-label="#">${o.id.slice(0,6)}</td>
        <td data-label="Cliente">
          <div style="display:flex;flex-direction:column;gap:4px">
            <strong>${o.customer||'—'}</strong>
            ${toggleBtn}
          </div>
        </td>
        <td data-label="Itens">${itens||'—'}</td>
        <td data-label="Quando">${when.toLocaleDateString('pt-BR')} ${when.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</td>
        <td data-label="Status">${o.status||'—'}</td>
        <td class="actions-col right">
          <button class="btn-sm" data-view-order="${o.id}">Ver</button>
          <button class="btn-sm danger" data-del-order="${o.id}">Excluir</button>
        </td>
      `;
      body.appendChild(tr);
    });

    $('#btnToggleMoreOrders').textContent = showOrdersAll? 'Ocultar' : 'Ver mais';
  }


  $('#btnToggleMoreOrders')?.addEventListener('click', ()=>{ showOrdersAll=!showOrdersAll; renderOrders(); });

  $('#orderFilter')?.addEventListener('change', ()=>{
    const f = $('#orderFilter').value;
    let list = ordersCache.slice();
    if(f==='today'){
      const d0=new Date(); d0.setHours(0,0,0,0);
      list = list.filter(o=> new Date(o.created_at)>=d0);
    }else if(f==='whatsapp'){
      list = list.filter(o=> !!o.to_whatsapp);
    }
    const body = $('#tblOrders tbody'); body.innerHTML='';
    (showOrdersAll? list : list.slice(0,ORDERS_LIMIT)).forEach(o=>{
      const when = new Date(o.created_at);
      const itens = (o.items||[]).map(i=>`${i.qty||1}× ${i.name}`).join(', ');
      const tr=document.createElement('tr');
      tr.innerHTML = `
        <td>${o.id.slice(0,6)}</td>
        <td>${o.customer||'—'}</td>
        <td>${itens||'—'}</td>
        <td>${when.toLocaleDateString('pt-BR')} ${when.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</td>
        <td>${o.status||'—'}</td>
        <td class="actions-col right">
          <button class="btn-sm" data-view-order="${o.id}">Ver</button>
          <button class="btn-sm danger" data-del-order="${o.id}">Excluir</button>
        </td>`;
      body.appendChild(tr);
    });
  });

  $('#tblOrders')?.addEventListener('click', async (e)=>{
    const del = e.target.closest('[data-del-order]');
    const view= e.target.closest('[data-view-order]');
    if(del){
      if(!confirm('Excluir pedido?')) return;
      const id = del.dataset.delOrder;
      const { error } = await supa.from('orders').delete().eq('id', id);
      if(error){ showToast('Erro ao excluir','err'); return; }
      ordersCache = await loadOrders(); renderOrders(); showToast('Pedido excluído');
    }
    if(view){
      const id = view.dataset.viewOrder;
      const { data } = await supa.from('orders').select('*').eq('id', id).maybeSingle();
      alert(JSON.stringify(data, null, 2));
    }
  });

  // ---- Agendamentos ----
  let agendCache = [];
  let showAgendAll = false;
  const AGEND_LIMIT = 10;
  let agendEditingId = null;

  async function loadAgendamentos(){
    try{
      const { data, error } = await supa
        .from('agendamentos')
        .select('id,nome,telefone,email,servico,data,horario,observacoes,status,created_at')
        .order('data', { ascending: true })
        .order('horario', { ascending: true });
      if(error){ console.error('[agend] select error:', error); return []; }
      return data || [];
    }catch(err){ console.error('[agend] unexpected:', err); return []; }
  }

  function agendStatusLabel(s){
    const map = { pendente:'Pendente', confirmado:'Confirmado', cancelado:'Cancelado', concluido:'Concluído' };
    return map[s] || s || '—';
  }

  function renderAgendamentos(list){
    const body = $('#tblAgend tbody');
    if(!body) return;
    body.innerHTML = '';
    const rows = showAgendAll ? list : list.slice(0, AGEND_LIMIT);
    const mobile = isMobile();

    rows.forEach(a => {
      const dataFmt = a.data ? new Date(a.data + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
      const tr = document.createElement('tr');
      if(mobile) tr.classList.add('collapsed');

      const toggleBtn = mobile ? `<button class="btn-sm ghost toggle-row" data-toggle="row" type="button">Ver mais</button>` : '';

      tr.innerHTML = `
        <td data-label="Cliente">
          <div style="display:flex;flex-direction:column;gap:4px">
            <strong>${a.nome||'—'}</strong>
            <span style="color:#8a8278;font-size:.82rem">${a.telefone||''}</span>
            ${toggleBtn}
          </div>
        </td>
        <td data-label="Serviço">${a.servico||'—'}</td>
        <td data-label="Data">${dataFmt}</td>
        <td data-label="Horário">${a.horario ? a.horario.slice(0,5) : '—'}</td>
        <td data-label="Status"><span class="status-chip status-${a.status||'pendente'}">${agendStatusLabel(a.status)}</span></td>
        <td class="actions-col right">
          <button class="btn-sm" data-view-agend="${a.id}">Ver</button>
          <button class="btn-sm danger" data-del-agend="${a.id}">Excluir</button>
        </td>
      `;
      body.appendChild(tr);
    });

    const btn = $('#btnToggleMoreAgend');
    if(btn) btn.textContent = showAgendAll ? 'Ocultar' : 'Ver mais';
  }

  function applyAgendFilter(){
    const f = ($('#agendFilter')?.value) || 'all';
    let list = agendCache.slice();
    if(f === 'today'){
      const todayStr = new Date().toISOString().split('T')[0];
      list = list.filter(a => a.data === todayStr);
    } else if(f !== 'all'){
      list = list.filter(a => a.status === f);
    }
    renderAgendamentos(list);
  }

  $('#agendFilter')?.addEventListener('change', applyAgendFilter);
  $('#btnToggleMoreAgend')?.addEventListener('click', ()=>{ showAgendAll = !showAgendAll; applyAgendFilter(); });

  // Modal de detalhes
  const agendDlg = $('#agendModal');

  function openAgendModal(agend){
    agendEditingId = agend.id;
    const dataFmt = agend.data ? new Date(agend.data + 'T12:00:00').toLocaleDateString('pt-BR') : '—';

    const fields = [
      ['Nome', agend.nome],
      ['WhatsApp', agend.telefone],
      ['E-mail', agend.email || '—'],
      ['Serviço', agend.servico],
      ['Data', dataFmt],
      ['Horário', agend.horario ? agend.horario.slice(0,5) : '—'],
      ['Observações', agend.observacoes || '—'],
      ['Solicitado em', agend.created_at ? new Date(agend.created_at).toLocaleString('pt-BR') : '—'],
    ];

    const body = $('#agendModalBody');
    body.innerHTML = fields.map(([lbl, val]) => `
      <div class="detail-row">
        <span class="detail-label">${lbl}</span>
        <span class="detail-value">${val}</span>
      </div>
    `).join('');

    const statusSel = $('#agendModalStatus');
    if(statusSel) statusSel.value = agend.status || 'pendente';

    // Botão WhatsApp com mensagem contextual
    const waBtn = $('#btnWhatsAgend');
    if(waBtn && agend.telefone){
      const tel = agend.telefone.replace(/\D/g,'');
      const statusMsg = {
        pendente: `Olá ${agend.nome}! Recebemos seu agendamento para *${agend.servico}* no dia *${dataFmt}* às *${agend.horario ? agend.horario.slice(0,5) : ''}*. Entraremos em contato em breve para confirmar. 😊`,
        confirmado: `Olá ${agend.nome}! Seu agendamento para *${agend.servico}* está *confirmado* para o dia *${dataFmt}* às *${agend.horario ? agend.horario.slice(0,5) : ''}*. Te esperamos! 💛`,
        cancelado: `Olá ${agend.nome}! Infelizmente precisamos *cancelar* seu agendamento para *${agend.servico}* no dia *${dataFmt}*. Por favor, entre em contato para remarcar.`,
        concluido: `Olá ${agend.nome}! Obrigada por sua visita à Callera Laser. Esperamos te ver em breve! 💛`,
      };
      const msg = statusMsg[agend.status || 'pendente'] || statusMsg.pendente;
      waBtn.href = `https://wa.me/55${tel}?text=${encodeURIComponent(msg)}`;
    }

    agendDlg?.showModal();
  }

  agendDlg?.addEventListener('click', e => {
    if(e.target.hasAttribute('data-close-agend')) agendDlg.close();
  });

  $('#btnSaveAgendStatus')?.addEventListener('click', async () => {
    if(!agendEditingId) return;
    const status = $('#agendModalStatus')?.value;
    const { error } = await supa.from('agendamentos').update({ status }).eq('id', agendEditingId);
    if(error){ showToast('Erro ao atualizar status', 'err'); return; }
    showToast('Status atualizado');
    agendDlg?.close();
    agendCache = await loadAgendamentos();
    applyAgendFilter();
    loadKPIs();
  });

  $('#tblAgend')?.addEventListener('click', async e => {
    const viewBtn = e.target.closest('[data-view-agend]');
    const delBtn  = e.target.closest('[data-del-agend]');

    if(viewBtn){
      const id = viewBtn.dataset.viewAgend;
      const agend = agendCache.find(a => a.id === id);
      if(agend) openAgendModal(agend);
    }

    if(delBtn){
      if(!confirm('Excluir agendamento?')) return;
      const id = delBtn.dataset.delAgend;
      const { error } = await supa.from('agendamentos').delete().eq('id', id);
      if(error){ showToast('Erro ao excluir', 'err'); return; }
      showToast('Agendamento excluído');
      agendCache = await loadAgendamentos();
      applyAgendFilter();
      loadKPIs();
    }
  });

  async function loadAgendAndRender(){
    agendCache = await loadAgendamentos();
    applyAgendFilter();
  }

  // ---- LOGOUT ----
  $('#btnLogout')?.addEventListener('click', async ()=>{
    try{ await supa.auth.signOut(); }catch{}
    showToast('Sessão encerrada'); location.reload();
  });

  // Atualiza pedidos + KPIs em conjunto
async function refreshOrdersAndKPIs(){
  ordersCache = await loadOrders();
  renderOrders();
  try { await loadKPIs(); } catch {}
}

// Realtime: refaz a lista quando houver INSERT/UPDATE/DELETE em "orders"
function startRealtimeOrders(){
  // encerra canal anterior (se existir)
  if (window.__ordersChannel) {
    try { supa.removeChannel(window.__ordersChannel); } catch {}
  }
  const channel = supa
    .channel('orders-admin-live')
    .on('postgres_changes',
        { event:'*', schema:'public', table:'orders' },
        async () => { await refreshOrdersAndKPIs(); })
    .subscribe();
  window.__ordersChannel = channel;
}

// Polling de segurança (caso realtime falhe)
function startOrdersPolling(){
  if (window.__ordersPoll) clearInterval(window.__ordersPoll);
  window.__ordersPoll = setInterval(refreshOrdersAndKPIs, 30000); // 30s
}

  // ---- Bootstrap ----
// ---- Bootstrap ----
// ---- Bootstrap ----
(async function init(){
  const ok = await ensureAuthOrShowGate();
  if (!ok) {
    // liga o form só quando precisar logar
    const form = $('#authForm');
    if (form && !form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', async (e)=>{
        e.preventDefault();
        const email = $('#authEmail').value.trim();
        const pass  = $('#authPass').value;
        const { error } = await supa.auth.signInWithPassword({ email, password: pass });
        if (error) { showToast('Login inválido','err'); return; }
        gate.style.display = 'none';
        startApp();
      });
    }
    return; // evita startApp sem sessão
  }
  startApp();
})();


  async function startApp(){
  await Promise.all([ loadKPIs(), renderCategories(), loadAndRenderProducts() ]);

  // Agendamentos
  if(document.getElementById('tblAgend')){
    await loadAgendAndRender();
  }

  // só roda a parte de pedidos se a tabela existir no DOM
  const hasOrdersUI = !!document.getElementById('tblOrders');
  if (hasOrdersUI) {
    ordersCache = await loadOrders();
    renderOrders();

    // só chama se as funções existem (evita ReferenceError)
    if (typeof startRealtimeOrders === 'function') startRealtimeOrders();
    if (typeof startOrdersPolling === 'function') startOrdersPolling();
  }
}

// Expande/colapsa a linha no mobile
// Expande/colapsa a linha no mobile
document.addEventListener('click', (ev)=>{
  const btn = ev.target.closest('[data-toggle="row"]');
  if(!btn) return;
  const tr = btn.closest('tr');
  const collapsed = tr.classList.toggle('collapsed');
  btn.textContent = collapsed ? 'Ver mais' : 'Ocultar';
});

// Se mudar o tamanho da tela, ajusta DOM para o estado correto
window.addEventListener('resize', ()=>{
  const mobile = isMobile();

  // Produtos
  $('#tblProducts tbody')?.querySelectorAll('tr').forEach(tr=>{
    if (mobile) {
      // se não tiver botão, adiciona (após nome)
      if (!tr.querySelector('.toggle-row')) {
        const nameCell = tr.querySelector('td:first-child > div');
        if (nameCell){
          const b = document.createElement('button');
          b.type='button'; b.className='btn-sm ghost toggle-row'; b.dataset.toggle='row';
          b.textContent='Ver mais';
          nameCell.appendChild(b);
        }
      }
      tr.classList.add('collapsed');
    } else {
      tr.classList.remove('collapsed');
      tr.querySelectorAll('.toggle-row').forEach(b=> b.remove());
    }
  });

  // Pedidos
  $('#tblOrders tbody')?.querySelectorAll('tr').forEach(tr=>{
    if (mobile) {
      if (!tr.querySelector('.toggle-row')) {
        const cliCell = tr.querySelector('td:nth-child(2) > div');
        if (cliCell){
          const b = document.createElement('button');
          b.type='button'; b.className='btn-sm ghost toggle-row'; b.dataset.toggle='row';
          b.textContent='Ver mais';
          cliCell.appendChild(b);
        }
      }
      tr.classList.add('collapsed');
    } else {
      tr.classList.remove('collapsed');
      tr.querySelectorAll('.toggle-row').forEach(b=> b.remove());
    }
  });
});


})();