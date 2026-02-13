<template>
  <div class="p-3">
    
    <div v-if="loading" class="text-center py-4">Carregando...</div>
    <div v-else>
      <div v-if="!sessions.length" class="text-muted">Nenhuma sessão encontrada.</div>

      <div v-else>
        <ListCard title="Frentes de Caixa" icon="bi bi-cash-stack" :subtitle="sessions.length ? `${sessions.length} sessões` : ''">
          <template #default>
            <div class="table-responsive">
              <table class="table table-sm table-hover">
                <thead>
                  <tr>
                    <th>Abertura</th>
                    <th>Fechamento</th>
                    <th>Abertura (R$)</th>
                    <th>Saldo registrado (R$)</th>
                    <th>Retiradas</th>
                    <th>Reforços</th>
                    <th>Diferença</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(s, idx) in sessions" :key="s.id">
                    <td>{{ formatDate(s.openedAt) }}</td>
                    <td>{{ s.closedAt ? formatDate(s.closedAt) : '-' }}</td>
                    <td class="text-end">{{ formatCurrency(Number(s.openingAmount || 0)) }}</td>
                    <td class="text-end">{{ formatCurrency(Number(s.currentBalance || s.balance || 0)) }}</td>
                    <td class="text-end">{{ formatCurrency(Number(s.summary?.totalWithdrawals || totalWithdrawalsFor(s) )) }}</td>
                    <td class="text-end">{{ formatCurrency(Number(s.summary?.totalReinforcements || totalReinforcementsFor(s) )) }}</td>
                    <td class="text-end">
                      <span v-if="s.differences" :class="totalDiffClass(s.differences)">
                        {{ formatCurrency(totalDiff(s.differences)) }}
                      </span>
                      <span v-else class="text-muted">—</span>
                    </td>
                    <td class="text-end">
                      <button class="btn btn-sm btn-outline-secondary" @click="showSessionDetails(s)">
                        Mais detalhes
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </ListCard>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, createApp } from 'vue';
import api from '../api';
import Swal from 'sweetalert2';
import { formatCurrency } from '../utils/formatters.js';
import CurrencyInput from '../components/form/input/CurrencyInput.vue';
import ListCard from '../components/ListCard.vue';

const sessions = ref([]);
const loading = ref(false);
const usersMap = ref({});
// no inline details; we'll show a modal

function formatDate(d) {
  if (!d) return '-';
  try { return new Date(d).toLocaleString(); } catch (e) { return String(d); }
}

function totalWithdrawalsFor(s) {
  try {
    const m = Array.isArray(s.movements) ? s.movements : [];
    return m.filter(x => {
      const t = String(x.type||'').toUpperCase();
      return t === 'WITHDRAWAL' || t.includes('RETIR') || t.includes('WITHDRAW');
    }).reduce((a,b)=>a+Number(b.amount||0),0);
  } catch(e){return 0}
}
function totalReinforcementsFor(s) {
  try {
    const m = Array.isArray(s.movements) ? s.movements : [];
    return m.filter(x => {
      const t = String(x.type||'').toUpperCase();
      return t === 'REINFORCEMENT' || t.includes('REFOR') || t.includes('REINFOR');
    }).reduce((a,b)=>a+Number(b.amount||0),0);
  } catch(e){return 0}
}

function totalDiff(differences) {
  if (!differences) return 0;
  return Object.values(differences).reduce((sum, v) => sum + Number(v || 0), 0);
}

function totalDiffClass(differences) {
  const d = totalDiff(differences);
  if (Math.abs(d) < 0.01) return 'text-success fw-semibold';
  return d > 0 ? 'text-primary fw-semibold' : 'text-danger fw-semibold';
}

function sortedMovements(movements){
  try {
    return (Array.isArray(movements)?movements.slice():[]).sort((a,b)=> new Date(b.createdAt||b.at||0)-new Date(a.createdAt||a.at||0));
  } catch(e){ return movements || [] }
}

function toggleDetails(idx){ /* kept for compatibility if needed */ }

function escapeHtml(str) {
  if (!str && str !== 0) return '';
  return String(str).replace(/[&<>"'`]/g, (s) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;', '`':'&#96;'})[s]);
}

function showSessionDetails(s) {
  try {
    // prefer summary if available
    const summary = s.summary || {};
    const paymentsByMethod = summary.paymentsByMethod || {};
    const inRegisterByMethod = summary.inRegisterByMethod || {};
    const totalWithdrawals = summary.totalWithdrawals || totalWithdrawalsFor(s);
    const totalReinforcements = summary.totalReinforcements || totalReinforcementsFor(s);

    // build rows for payment methods
    const methods = Object.keys(inRegisterByMethod).length ? Object.keys(inRegisterByMethod) : (Object.keys(paymentsByMethod).length ? Object.keys(paymentsByMethod) : ['Dinheiro']);
    const rows = methods.map(m => {
      const expectedNum = Number(inRegisterByMethod[m] || paymentsByMethod[m] || 0);
      const inputId = `cf-in-${m.replace(/\s+/g,'_')}`;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee"><div style="flex:1">${escapeHtml(m)}</div><div style="flex:1;text-align:center">${formatCurrency(expectedNum)}</div><div style="flex:1;text-align:center"><input id="${inputId}" inputmode="decimal" class="swal2-input" value="${(function(v){try{return (typeof v==='number'? (v.toFixed? v.toFixed(2):String(v)) : String(v));}catch(e){return String(v) } })(formatCurrency(expectedNum).replace('R$ ','').replace('.','').replace(',','.'))}" style="width:120px;margin:0 auto"></div></div>`;
    }).join('\n');

    const opening = Number(s.openingAmount||0);
    const totalInRegister = Object.values(inRegisterByMethod||{}).reduce((a,b)=>a+Number(b||0),0);

    const closingNote = s.closingNote || (s.closingSummary && (s.closingSummary.note || '')) || '';

    const openerName = usersMap.value && usersMap.value[s.openedBy] ? usersMap.value[s.openedBy] : (s.openedBy || '');
    const closerName = usersMap.value && usersMap.value[s.closedBy] ? usersMap.value[s.closedBy] : (s.closedBy || '');

    const html = `
      <div style="text-align:left">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <strong>Fechamento de Frente de Caixa</strong>
            <div style="font-size:0.85rem;color:#666">Id. ${escapeHtml(s.id || '')}</div>
            <div style="margin-top:6px;color:#666">Abertura: ${escapeHtml(s.openedAt || '')} &nbsp;&nbsp; Fechamento: ${escapeHtml(s.closedAt || '-')}</div>
            ${ closerName ? `<div style="margin-top:4px;color:#666">Fechado por: ${escapeHtml(closerName)}</div>` : '' }
          </div>
          <div style="text-align:right">
            <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px">
              <div style="text-align:right">
                <div style="font-size:1.05rem;color:#333">Saldo em caixa</div>
                <div id="cf-total-in-register-header" style="font-weight:700;font-size:1.25rem;color:${totalInRegister>=0 ? 'green' : 'red'}">${formatCurrency(totalInRegister)}</div>
              </div>
              <div style="display:flex;flex-direction:column;gap:6px">
                <button id="cf-print-a4" class="btn btn-sm btn-light">Imprimir A4</button>
                <button id="cf-print-sm" class="btn btn-sm btn-light">Imprimir Rápida</button>
                <button id="cf-edit-close" class="btn btn-sm btn-outline-primary">Editar fechamento</button>
              </div>
            </div>
          </div>
        </div>

        <div style="margin-top:12px">${rows}</div>
        <hr/>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:220px">
            <div style="font-size:0.9rem">Abertura de caixa(+): <strong style="color:green">${formatCurrency(opening)}</strong></div>
            <div style="font-size:0.9rem">Vendas(+): <strong style="color:green">${formatCurrency(paymentsByMethod['Dinheiro']||0)}</strong></div>
          </div>
          <div style="flex:1;min-width:220px">
            <div style="font-size:0.9rem;color:red">Retiradas(-): <strong id="cf-total-withdrawals" style="color:red">${formatCurrency(totalWithdrawals)}</strong> <a href="#" id="cf-view-withdrawals" style="margin-left:8px">Ver</a> - <a href="#" id="cf-include-withdrawal">Incluir</a></div>
            <div style="font-size:0.9rem;color:green">Reforços(+): <strong id="cf-total-reinforcements" style="color:green">${formatCurrency(totalReinforcements)}</strong> <a href="#" id="cf-view-reinforcements" style="margin-left:8px">Ver</a> - <a href="#" id="cf-include-reinforcement">Incluir</a></div>
          </div>
          <div style="flex:1;min-width:180px;text-align:right">
            <div style="font-size:0.9rem;color:#666">Totais em caixa</div>
            <div id="cf-total-in-register" style="font-weight:700;font-size:1.05rem">${formatCurrency(totalInRegister)}</div>
          </div>
        </div>
        <hr/>
        <label>Obs. Fechamento</label>
        <div><textarea id="cf-close-note" class="swal2-textarea" style="min-height:80px">${escapeHtml(closingNote)}</textarea></div>
      </div>
    `;

    const title = `Fechamento de Frente de Caixa${openerName ? ' - ' + escapeHtml(openerName) : ''}`;
    Swal.fire({ title, html, width:920, showCancelButton: true, confirmButtonText: 'Fechar', didOpen: () => {
      // attach handlers: print, view lists and include/edit actions
      try{
        const rootHtml = document.querySelector('.swal2-html-container');
        const viewW = document.getElementById('cf-view-withdrawals');
        const viewR = document.getElementById('cf-view-reinforcements');
        const incW = document.getElementById('cf-include-withdrawal');
        const incR = document.getElementById('cf-include-reinforcement');
        const printA4 = document.getElementById('cf-print-a4');
        const printSm = document.getElementById('cf-print-sm');
        const editBtn = document.getElementById('cf-edit-close');

        if(viewW) viewW.addEventListener('click', (ev)=>{ ev.preventDefault(); showMovementsInline(s, 'retirada'); });
        if(viewR) viewR.addEventListener('click', (ev)=>{ ev.preventDefault(); showMovementsInline(s, 'reforco'); });

        if(incW) incW.addEventListener('click', (ev)=>{
          ev.preventDefault();
          const mountId = 'cf-inc-app-' + Date.now();
          Swal.fire({
            title: 'Incluir Retirada',
            html: `<div id="${mountId}"></div>`,
            showCancelButton: true,
            confirmButtonText: 'Incluir',
            didOpen: () => {
              try{
                const mountEl = document.getElementById(mountId);
                const IncRoot = {
                  components: { CurrencyInput },
                  template: `<div style="display:flex;flex-direction:column;gap:8px"><currency-input v-model="amount" /><input v-model="note" class="swal2-input" placeholder="Descrição (opcional)"></div>`,
                  data(){ return { amount: null, note: '' } }
                };
                const incApp = createApp(IncRoot);
                incApp.component('currency-input', CurrencyInput);
                const proxy = incApp.mount(mountEl);
                mountEl.__incApp = { app: incApp, proxy };
              }catch(e){ console.error(e) }
            },
            preConfirm: () => {
              const mountEl = document.getElementById(mountId);
              const state = mountEl && mountEl.__incApp && mountEl.__incApp.proxy;
              if (!state || state.amount == null || isNaN(Number(state.amount))) { Swal.showValidationMessage('Informe um valor numérico válido'); return false; }
              return { amount: Number(state.amount), note: state.note || '' };
            },
            willClose: () => {
              const mountEl = document.getElementById(mountId);
              if (mountEl && mountEl.__incApp) { try{ mountEl.__incApp.app.unmount(); }catch(e){} delete mountEl.__incApp; }
            }
          }).then(async (result) => {
            try{
              if (!result.isConfirmed || !result.value) return;
              const payload = { type: 'withdrawal', amount: result.value.amount, note: result.value.note };
              const r = await api.post('/cash/movement', payload);
              if (r && r.data && r.data.session) {
                const updated = r.data.session;
                const movement = r.data.movement;
                const idx = sessions.value.findIndex(x => x.id === updated.id);
                if (idx >= 0) sessions.value.splice(idx, 1, updated);
                else sessions.value.unshift(updated);
                Swal.fire('Sucesso','Retirada incluída','success');
                // try to update current modal inline
                try{
                  const root = document.querySelector('.swal2-html-container');
                  if (root && root.innerHTML.includes(escapeHtml(updated.id || ''))) {
                    const elW = root.querySelector('#cf-total-withdrawals');
                    const elR = root.querySelector('#cf-total-reinforcements');
                    const elT = root.querySelector('#cf-total-in-register');
                    if (elW) elW.textContent = formatCurrency(updated.summary?.totalWithdrawals ?? totalWithdrawalsFor(updated));
                    if (elR) elR.textContent = formatCurrency(updated.summary?.totalReinforcements ?? totalReinforcementsFor(updated));
                    if (elT) elT.textContent = formatCurrency(updated.summary ? Object.values(updated.summary.inRegisterByMethod || {}).reduce((a,b)=>a+Number(b||0),0) : (updated.balance||0));
                    const holder = root.querySelector('#cf-view-list-withdrawals');
                    const actor = (movement && (movement.createdBy||movement.by) && usersMap.value && usersMap.value[movement.createdBy||movement.by]) ? usersMap.value[movement.createdBy||movement.by] : (movement && (movement.createdBy||movement.by)) || '';
                    const liHtml = `<li style="padding:6px 0;border-bottom:1px dashed #eee">${escapeHtml(new Date(movement.createdAt||movement.at).toLocaleString())} - ${formatCurrency(Number(movement.amount||0))}${movement.note? ' - '+escapeHtml(movement.note):''}${actor? ' - '+escapeHtml(actor): ''}</li>`;
                    if (holder) {
                      let ul = holder.querySelector('ul');
                      if (!ul) holder.innerHTML = '<ul style="list-style:none;padding:0;margin:0">' + liHtml + '</ul>';
                      else ul.insertAdjacentHTML('afterbegin', liHtml);
                      holder.style.display='block';
                    }
                  } else {
                    showSessionDetails(updated);
                  }
                }catch(e){ console.error(e); showSessionDetails(updated); }
              } else {
                Swal.fire('Sucesso','Retirada incluída','success');
              }
            }catch(err){
              console.error('Failed to include withdrawal', err);
              const msg = (err && err.response && err.response.data && err.response.data.message) ? err.response.data.message : String(err && err.message ? err.message : err);
              Swal.fire('Erro','Falha ao incluir retirada: ' + msg,'error');
            }
          });
        });

        if(incR) incR.addEventListener('click', (ev)=>{
          ev.preventDefault();
          const mountIdR = 'cf-inc-app-' + Date.now();
          Swal.fire({
            title: 'Incluir Reforço',
            html: `<div id="${mountIdR}"></div>`,
            showCancelButton: true,
            confirmButtonText: 'Incluir',
            didOpen: () => {
              try{
                const mountEl = document.getElementById(mountIdR);
                const IncRoot = {
                  components: { CurrencyInput },
                  template: `<div style="display:flex;flex-direction:column;gap:8px"><currency-input v-model="amount" /><input v-model="note" class="swal2-input" placeholder="Descrição (opcional)"></div>`,
                  data(){ return { amount: null, note: '' } }
                };
                const incApp = createApp(IncRoot);
                incApp.component('currency-input', CurrencyInput);
                const proxy = incApp.mount(mountEl);
                mountEl.__incApp = { app: incApp, proxy };
              }catch(e){ console.error(e) }
            },
            preConfirm: () => {
              const mountEl = document.getElementById(mountIdR);
              const state = mountEl && mountEl.__incApp && mountEl.__incApp.proxy;
              if (!state || state.amount == null || isNaN(Number(state.amount))) { Swal.showValidationMessage('Informe um valor numérico válido'); return false; }
              return { amount: Number(state.amount), note: state.note || '' };
            },
            willClose: () => {
              const mountEl = document.getElementById(mountIdR);
              if (mountEl && mountEl.__incApp) { try{ mountEl.__incApp.app.unmount(); }catch(e){} delete mountEl.__incApp; }
            }
          }).then(async (result) => {
            try{
              if (!result.isConfirmed || !result.value) return;
              const payload = { type: 'reinforcement', amount: result.value.amount, note: result.value.note };
              const r = await api.post('/cash/movement', payload);
              if (r && r.data && r.data.session) {
                const updated = r.data.session;
                const movement = r.data.movement;
                const idx = sessions.value.findIndex(x => x.id === updated.id);
                if (idx >= 0) sessions.value.splice(idx, 1, updated);
                else sessions.value.unshift(updated);
                Swal.fire('Sucesso','Reforço incluído','success');
                // try update inline
                try{
                  const root = document.querySelector('.swal2-html-container');
                  if (root && root.innerHTML.includes(escapeHtml(updated.id || ''))) {
                    const elW = root.querySelector('#cf-total-withdrawals');
                    const elR = root.querySelector('#cf-total-reinforcements');
                    const elT = root.querySelector('#cf-total-in-register');
                    if (elW) elW.textContent = formatCurrency(updated.summary?.totalWithdrawals ?? totalWithdrawalsFor(updated));
                    if (elR) elR.textContent = formatCurrency(updated.summary?.totalReinforcements ?? totalReinforcementsFor(updated));
                    if (elT) elT.textContent = formatCurrency(updated.summary ? Object.values(updated.summary.inRegisterByMethod || {}).reduce((a,b)=>a+Number(b||0),0) : (updated.balance||0));
                    const holder = root.querySelector('#cf-view-list-reinforcements');
                    const actor = (movement && (movement.createdBy||movement.by) && usersMap.value && usersMap.value[movement.createdBy||movement.by]) ? usersMap.value[movement.createdBy||movement.by] : (movement && (movement.createdBy||movement.by)) || '';
                    const liHtml = `<li style="padding:6px 0;border-bottom:1px dashed #eee">${escapeHtml(new Date(movement.createdAt||movement.at).toLocaleString())} - ${formatCurrency(Number(movement.amount||0))}${movement.note? ' - '+escapeHtml(movement.note):''}${actor? ' - '+escapeHtml(actor): ''}</li>`;
                    if (holder) {
                      let ul = holder.querySelector('ul');
                      if (!ul) holder.innerHTML = '<ul style="list-style:none;padding:0;margin:0">' + liHtml + '</ul>';
                      else ul.insertAdjacentHTML('afterbegin', liHtml);
                      holder.style.display='block';
                    }
                  } else {
                    showSessionDetails(updated);
                  }
                }catch(e){ console.error(e); showSessionDetails(updated); }
              } else {
                Swal.fire('Sucesso','Reforço incluído','success');
              }
            }catch(err){
              console.error('Failed to include reinforcement', err);
              const msg = (err && err.response && err.response.data && err.response.data.message) ? err.response.data.message : String(err && err.message ? err.message : err);
              Swal.fire('Erro','Falha ao incluir reforço: ' + msg,'error');
            }
          });
        });

        if(printA4 && rootHtml) printA4.addEventListener('click', ()=>{
          try{
            const w = window.open('','_blank');
            w.document.write('<html><head><title>Impressão - Frente de Caixa</title><style>body{font-family:Arial,Helvetica,sans-serif;padding:12px}</style></head><body>'+rootHtml.innerHTML+'</body></html>');
            w.document.close();
            w.focus();
            w.print();
          }catch(e){console.error(e)}
        });
        if(printSm && rootHtml) printSm.addEventListener('click', ()=>{
          try{
            const w = window.open('','_blank');
            w.document.write('<html><head><title>Impressão Rápida</title><style>body{font-family:Arial,Helvetica,sans-serif;padding:8px;font-size:12px}</style></head><body>'+rootHtml.innerHTML+'</body></html>');
            w.document.close(); w.focus(); w.print();
          }catch(e){console.error(e)}
        });

        if(editBtn) editBtn.addEventListener('click', ()=>{ Swal.fire('Editar','Implementar edição de fechamento','info'); });
      }catch(e){console.error(e)}
    }});
  } catch(e){ console.error('showSessionDetails failed', e); Swal.fire('Erro','Falha ao abrir detalhes','error') }
}

function showMovementsInline(session, kind){
  try{
    const containerId = kind==='retirada' ? 'cf-view-list-withdrawals' : 'cf-view-list-reinforcements';
    // try to find existing container inside modal, else append below the links
    const root = document.querySelector('.swal2-html-container');
    if(!root) return;
    let holder = root.querySelector(`#${containerId}`);
    if(holder && holder.style.display && holder.style.display!== 'none') { holder.style.display = 'none'; return; }
    if(!holder){
      holder = document.createElement('div'); holder.id = containerId; holder.style.marginTop='8px'; holder.style.maxHeight='220px'; holder.style.overflow='auto'; holder.style.border='1px solid #eee'; holder.style.padding='8px'; holder.style.background='#fff';
      root.appendChild(holder);
    }
    const movements = Array.isArray(session.movements)? session.movements : [];
    const filtered = movements.filter(mv => {
      const t = String(mv.type||'').toUpperCase();
      if(kind==='retirada') return t === 'WITHDRAWAL' || t.includes('RETIR') || t.includes('WITHDRAW');
      return t === 'REINFORCEMENT' || t.includes('REFOR') || t.includes('REINFOR');
    }).sort((a,b)=> new Date(b.createdAt||b.at||0)-new Date(a.createdAt||a.at||0));
    if(!filtered.length) { holder.innerHTML = '<div class="text-muted">Nenhuma movimentação encontrada</div>'; holder.style.display='block'; return; }
    holder.innerHTML = '<ul style="list-style:none;padding:0;margin:0">' + filtered.map(mv=>{
      const actor = ((mv.createdBy||mv.by) && usersMap.value && usersMap.value[mv.createdBy||mv.by]) ? usersMap.value[mv.createdBy||mv.by] : (mv.createdBy||mv.by || '');
      return `<li style="padding:6px 0;border-bottom:1px dashed #eee">${escapeHtml(new Date(mv.createdAt||mv.at).toLocaleString())} - ${formatCurrency(Number(mv.amount||0))}${mv.note? ' - '+escapeHtml(mv.note):''}${actor? ' - '+escapeHtml(actor): ''}</li>`
    }).join('') + '</ul>';
    holder.style.display='block';
  }catch(e){console.error(e)}
}

onMounted(async ()=>{
  loading.value = true;
  try{
    const { data } = await api.get('/cash/sessions');
    // show closed sessions (those with closedAt) first, fallback to all
    sessions.value = Array.isArray(data) ? data : [];
    // fetch users to map ids -> names. If backend fails, fall back to extracting ids/names from sessions
    try{
      const { data: users } = await api.get('/users');
      if (Array.isArray(users)) {
        const m = {};
        users.forEach(u => { if (u && u.id) m[u.id] = u.name || (u.email || u.id); });
        usersMap.value = m;
      }
    }catch(e){
      console.warn('Failed to fetch users for name mapping', e);
      // Fallback: build a minimal map from session fields and movements so the UI can display something
      try{
        const fm = {};
        (sessions.value || []).forEach(s => {
          if (s.openedBy && !fm[s.openedBy]) fm[s.openedBy] = (s.openedByName || s.openedBy);
          if (s.closedBy && !fm[s.closedBy]) fm[s.closedBy] = (s.closedByName || s.closedBy);
          if (Array.isArray(s.movements)) {
            s.movements.forEach(mv => { if (mv && mv.by && !fm[mv.by]) fm[mv.by] = (mv.byName || mv.by); });
          }
        });
        usersMap.value = fm;
      }catch(_e){ console.warn('Fallback users map build failed', _e) }
    }
  }catch(e){ console.error('Failed to fetch cash sessions', e); }
  finally{ loading.value = false }
});
</script>

<style scoped>
</style>
