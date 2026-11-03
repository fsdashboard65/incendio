/* FS | Consulta do sistema de incendio: navegador apenas, sem API ou backend. */
(() => {
  'use strict';

  const CONFIG = { jsonURL: './app.json', pdfFolder: './arquivos/', pageSize: 16, maxBytes: 30 * 1024 * 1024 };
  const DB_NAME = 'fs-consulta-incendio-v3';
  const STORAGE_KEY = 'fs-incendio-json-importado-v3';
  const genericKeys = new Set(['dados','data','base','registros','dispositivos','itens','lista','list','alarmes','alarmas','detectores','tags','entries','items','grupos','nos','nodos','loops','lacos']);
  const codeKeys = ['codigo', 'código', 'tag', 'code', 'endereco', 'endereço', 'identificador', 'id'];
  const descriptionKeys = ['descricao','descrição','detector','description','nome','tipo','label','customlabel','texto','identificacao','identificação'];
  const sectorKeys = ['setor','localizacao','localização','ubicacion','ubicación','sector','area','área','local','location'];
  const docKeys = ['arquivos','documentos','pdfs','projetos','planos','arquivo','documento','pdf','projeto','file','files'];
  const obsKeys = ['observacao','observação','observaciones','nota','notes'];
  const $ = id => document.getElementById(id);
  const state = { records: [], source:'', isOffline:false, limit:CONFIG.pageSize, pdfs:new Map(), wantedPdf:'', epoch:0, activeObjectURLs:new Set() };

  const plain = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
  const compact = v => plain(v).replace(/[^a-z0-9]/g, '');
  const fieldName = v => compact(v);
  const number = v => Number(v).toLocaleString('pt-BR');
  const node = (tag, cls = '', value) => { const el = document.createElement(tag); if (cls) el.className = cls; if (value !== undefined) el.textContent = String(value); return el; };
  function icon(name, className = '') { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', `icon ${className}`.trim()); svg.setAttribute('aria-hidden','true'); const use = document.createElementNS('http://www.w3.org/2000/svg','use'); use.setAttribute('href',`#ico-${name}`); svg.append(use); return svg; }
  function getField(obj, aliases) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
    for (const [key,value] of Object.entries(obj)) if (aliases.some(alias => fieldName(alias) === fieldName(key))) return value;
    return undefined;
  }
  function stringValue(v) { return v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim(); }
  function toFiles(value) {
    let files = [];
    if (Array.isArray(value)) files = value.flatMap(v => typeof v === 'string' ? [v] : (v && typeof v === 'object') ? [v.arquivo, v.nome, v.pdf, v.file].filter(x => typeof x === 'string') : []);
    else if (typeof value === 'string') files = value.split(/[;,\n]/);
    return [...new Set(files.map(f => String(f).trim()).filter(Boolean))];
  }
  function codeLike(key) { return /^N[\s\-_]*\d{1,5}[\s\-_]*L[\s\-_]*\d{1,4}[\s\-_]*M[\s\-_]*\d{1,5}$/i.test(key) || /^[A-Za-z]{1,7}[\-_]\d{2,}(?:[\-_][A-Za-z0-9]+)*$/.test(key); }

  // Aceita listas, objetos por TAG, grupos aninhados e aliases pt-BR / espanhol / ingles.
  function parseRecords(data) {
    const records = new Map();
    let visited = 0;
    function add(code, details, inheritedSector) {
      code = stringValue(code);
      if (!code || code.length > 120) return;
      const source = details && typeof details === 'object' && !Array.isArray(details) ? details : {};
      const desc = typeof details === 'string' ? details.trim() : stringValue(getField(source,descriptionKeys));
      const setor = stringValue(getField(source,sectorKeys)) || inheritedSector || '';
      const arquivos = toFiles(getField(source,docKeys));
      const observacao = stringValue(getField(source,obsKeys));
      const confirmation = getField(source,['associacao_confirmada','associação_confirmada','associacaoConfirmada']);
      const confirmed = confirmation === false ? false : undefined;
      const key = compact(code);
      if (!key) return;
      const current = records.get(key);
      if (current) {
        current.descricao ||= desc;
        current.setor ||= setor;
        current.observacao ||= observacao;
        if (confirmed === false) current.associacao_confirmada = false;
        current.arquivos = [...new Set([...current.arquivos,...arquivos])];
      } else {
        records.set(key, { codigo:code, descricao:desc, setor, arquivos, observacao, associacao_confirmada:confirmed });
      }
      if (records.size > 100000) throw new Error('A base excede o limite de 100.000 TAGs.');
    }
    function visit(value, inheritedSector = '', depth = 0, isSectorMap = false) {
      if (++visited > 750000 || depth > 45) throw new Error('O JSON possui estruturas aninhadas demais.');
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { for (const item of value) visit(item,inheritedSector,depth+1); return; }
      const directCode = getField(value,codeKeys);
      if (directCode !== undefined && stringValue(directCode)) { add(directCode,value,inheritedSector); return; }
      for (const [key,child] of Object.entries(value)) {
        if (codeLike(key)) { add(key,child,inheritedSector); continue; }
        const normalized = fieldName(key);
        if (normalized === 'setores' || normalized === 'sectors') { visit(child,inheritedSector,depth+1,true); continue; }
        const nextSector = isSectorMap && !genericKeys.has(normalized) && key.length < 160 ? key : inheritedSector;
        if (child && typeof child === 'object') visit(child,nextSector,depth+1,false);
      }
    }
    visit(data);
    if (!records.size) throw new Error('Nenhuma TAG encontrada. São aceitos os campos "codigo", "tag" ou um objeto indexado pelo código.');
    return [...records.values()].map(r => ({ ...r, codeIndex:compact(r.codigo), searchIndex:plain([r.codigo,r.descricao,r.setor,r.observacao,...r.arquivos].join(' ')) })).sort((a,b)=>a.codigo.localeCompare(b.codigo,'pt-BR',{numeric:true}));
  }

  function showToast(message) {
    const el = $('toast'); el.textContent = message; el.classList.remove('hidden');
    clearTimeout(showToast.timer); showToast.timer = setTimeout(() => el.classList.add('hidden'),4200);
  }
  function showMessage(message = '', warning = false) {
    const el = $('source-message'); el.textContent = message; el.classList.toggle('hidden',!message); el.classList.toggle('warning',warning);
  }
  function openDialog(id) { const dialog = $(id); if (!dialog.open) dialog.showModal(); }
  function setSourceStatus(message, warning = false) {
    $('source-status').textContent = message;
    $('side-source').textContent = message;
    for (const dot of document.querySelectorAll('.status-dot')) dot.classList.toggle('warning',warning);
  }

  function applyRecords(records, source, opts={}) {
    state.records=records;
    state.source=source;
    state.isOffline=!!opts.offline;
    state.limit=CONFIG.pageSize;
    const sectors = [...new Set(records.map(r=>r.setor).filter(Boolean))];
    const files = new Set(records.flatMap(r=>r.arquivos));
    $('total-tags').textContent=number(records.length);
    $('total-sectors').textContent=number(sectors.length);
    $('total-pdfs').textContent=number(files.size);
    $('nav-count').textContent=number(records.length);
    $('base-name').textContent=source;
    $('base-detail').textContent=`${number(records.length)} TAGs · ${number(sectors.length)} setores · ${number(files.size)} documentos distintos`;
    $('source-footer').textContent=source;
    setSourceStatus(opts.status || 'Base carregada', !!opts.warning);
    const selected=$('sector-filter').value;
    const select=$('sector-filter'); select.replaceChildren(new Option('Todos os setores',''));
    sectors.sort((a,b)=>a.localeCompare(b,'pt-BR')).forEach(s=>select.append(new Option(s,s)));
    select.value=sectors.includes(selected) ? selected : '';
    const preferred=['N002L01M002','N003L01M008','N008L01M064'];
    const common=preferred.filter(code=>records.some(r=>r.codeIndex===compact(code)));
    const examples=[...new Set([...common,...records.slice(0,3).map(x=>x.codigo)])].slice(0,3);
    $('examples').replaceChildren(...examples.map(code=>{
      const button=node('button','chip',code); button.type='button';
      button.addEventListener('click',()=>{ $('search').value=code; $('sector-filter').value=''; resetLimitAndRender(); $('search').focus(); });
      return button;
    }));
    render();
  }

  function resultScore(record, raw) {
    const q=plain(raw); const c=compact(raw);
    if (!q) return 20;
    if (record.codeIndex===c) return 0;
    if (record.codeIndex.startsWith(c)) return 1;
    if (record.codeIndex.includes(c)) return 2;
    if (plain(record.descricao).startsWith(q)) return 3;
    if (plain(record.setor).startsWith(q)) return 4;
    return 5;
  }
  function matchesQuery(record, raw) {
    const q=plain(raw); if (!q) return true;
    const c=compact(q);
    if (c && record.codeIndex.includes(c)) return true;
    return q.split(/\s+/).every(part=>record.searchIndex.includes(part) || (part.length>1 && record.codeIndex.includes(compact(part))));
  }
  function resetLimitAndRender() { state.limit=CONFIG.pageSize; render(); }
  function render() {
    const query=$('search').value.trim(), setor=$('sector-filter').value;
    const found=state.records.filter(record=>(!setor || record.setor===setor) && matchesQuery(record,query));
    if (query) found.sort((a,b)=>resultScore(a,query)-resultScore(b,query)||a.codigo.localeCompare(b.codigo,'pt-BR',{numeric:true}));
    $('results-count').textContent=`${number(found.length)} ${found.length===1?'resultado':'resultados'}`;
    $('clear-search').classList.toggle('hidden',!query);
    $('load-more').classList.toggle('hidden',found.length<=state.limit);
    $('load-more').textContent=`Mostrar mais TAGs (${Math.min(state.limit,found.length)} de ${found.length})`;
    if (!found.length) {
      const empty=node('div','empty-state'); const mark=node('span','empty-icon'); mark.append(icon('search'));
      const title=node('h3','',state.records.length?'Nenhuma TAG encontrada':'Nenhuma base carregada');
      const body=node('p','',state.records.length ? `A TAG pesquisada não consta entre os ${number(state.records.length)} registros carregados. Confira o código ou importe um JSON que contenha esse dispositivo.` : 'Carregue o arquivo app.json para consultar os códigos do sistema de incêndio.');
      const button=node('button','btn btn-outline',state.records.length?'Limpar filtros':'Carregar meu JSON');button.type='button';
      button.addEventListener('click',()=>state.records.length?resetFilters():$('json-input').click());
      empty.append(mark,title,body,button); $('results').replaceChildren(empty); return;
    }
    const frag=document.createDocumentFragment();
    for (const record of found.slice(0,state.limit)) frag.append(makeCard(record,!!query && record.codeIndex===compact(query)));
    $('results').replaceChildren(frag);
  }
  function resetFilters() { $('search').value='';$('sector-filter').value='';resetLimitAndRender();$('search').focus(); }
  async function copyText(value) {
    try { if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
      else { const ta=node('textarea');ta.value=value;ta.style.cssText='position:fixed;left:-9999px';document.body.append(ta);ta.select();if (!document.execCommand('copy')) throw Error('Copy');ta.remove(); }
      showToast(`TAG ${value} copiada.`);
    } catch { showToast('Selecione o código e copie com Ctrl+C.'); }
  }
  function makeCard(record, exact) {
    const card=node('article',`device-card${exact?' exact':''}`);
    const top=node('div','device-card-top');
    const tag=node('span','card-eyebrow','IDENTIFICAÇÃO DO DISPOSITIVO');
    const badge=node('span','card-badge',exact?'TAG exata':'Registro cadastrado');badge.prepend(icon('check'));
    top.append(tag,badge);card.append(top);
    const content=node('div','device-card-body');
    const titleRow=node('div','card-title');const code=node('h3','card-code',record.codigo);
    const copy=node('button','copy-btn');copy.type='button';copy.title='Copiar TAG';copy.setAttribute('aria-label',`Copiar ${record.codigo}`);copy.append(icon('copy'));copy.addEventListener('click',()=>copyText(record.codigo));
    titleRow.append(code,copy);content.append(titleRow,node('p','card-description',record.descricao||'Descrição não informada'));
    const parts=record.codigo.match(/^N\s*(\d+)\s*L\s*(\d+)\s*M\s*(\d+)$/i);
    if(parts){const dl=node('dl','address-parts');[['NÓ',parts[1]],['LAÇO',parts[2]],['MÓDULO',parts[3]]].forEach(([k,v])=>{const item=node('div','address-part');item.append(node('dt','',k),node('dd','',v));dl.append(item);});content.append(dl);}
    const loc=node('div','loc-box');loc.append(icon('pin'));const locText=node('div');locText.append(node('strong','','SETOR / LOCALIZAÇÃO'),node('p','',record.setor||'Setor não informado'));loc.append(locText);content.append(loc);
    const docsHead=node('div','docs-heading');const docLabel=node('h4','','PROJETOS RELACIONADOS');docLabel.prepend(icon('file'));docsHead.append(docLabel,node('span','docs-count',`${number(record.arquivos.length)} ${record.arquivos.length===1?'arquivo':'arquivos'}`));content.append(docsHead);
    const docs=node('div','doc-list');
    if (!record.arquivos.length) docs.append(node('p','empty-docs','Nenhum arquivo PDF informado para esta TAG.'));
    else for (const filename of record.arquivos){const button=node('button','doc-row');button.type='button';button.setAttribute('aria-label',`Abrir referência ${filename}`);const paper=node('span','pdf-icon');paper.append(icon('file'));button.append(paper,node('span','name',filename),icon('external','out'));button.addEventListener('click',()=>viewPdf(filename));docs.append(button);}
    content.append(docs);
    if (record.associacao_confirmada===false && record.arquivos.length){const warn=node('div','card-note');warn.append(icon('warning'),node('span','','Referências associadas ao setor; correspondência exata ainda não confirmada nos projetos.'));content.append(warn);}
    if (record.observacao){const obs=node('div','card-note secondary');obs.append(icon('info'),node('span','',record.observacao));content.append(obs);}
    card.append(content);return card;
  }

  const pdfKey = name => plain(String(name).replace(/\\/g,'/').split('/').pop());
  function safePdfPath(name) {
    const parts=String(name).replace(/\\/g,'/').split('/');
    if (!parts.length || parts.some(x=>!x||x==='.'||x==='..'||x.includes(':')) || !/\.pdf$/i.test(parts.at(-1))) return '';
    return CONFIG.pdfFolder + parts.map(encodeURIComponent).join('/');
  }
  function pdfPlaceholder(name, path) {
    const div=node('div','pdf-empty');div.append(icon('file'),node('h3','','PDF de referência'));
    div.append(node('p','',`O registro menciona ${name}, mas o PDF não está incluído nesta entrega. Se já possui o arquivo, use “Vincular PDF” ou coloque-o na pasta arquivos/.`));
    $('pdf-content').replaceChildren(div);
    if(path){$('pdf-open-link').href=path;$('pdf-open-link').classList.remove('hidden');}
  }
  function showPdfURL(url) {
    const frame=node('iframe');frame.src=url;frame.title=$('pdf-title').textContent;
    $('pdf-content').replaceChildren(frame);
    $('pdf-open-link').href=url;$('pdf-open-link').classList.remove('hidden');
  }
  async function viewPdf(filename) {
    state.wantedPdf=filename;
    const epoch=++state.epoch;
    $('pdf-title').textContent=filename;
    $('pdf-open-link').classList.add('hidden');
    openDialog('pdf-dialog');
    const pdf=state.pdfs.get(pdfKey(filename));
    if(pdf){showPdfURL(pdf);return;}
    const path=safePdfPath(filename);
    pdfPlaceholder(filename,path);
    if(!path || location.protocol==='file:')return;
    try{
      const response=await fetch(path,{cache:'no-store'});
      if(!response.ok || epoch!==state.epoch)return;
      const blob=await response.blob();
      if((await blob.slice(0,5).text())!=='%PDF-')return;
      const url=URL.createObjectURL(new Blob([blob],{type:'application/pdf'}));
      state.activeObjectURLs.add(url);
      state.pdfs.set(pdfKey(filename),url);
      if(epoch===state.epoch && $('pdf-dialog').open) showPdfURL(url);
    }catch{ /* PDF não encontrado: mantém aviso e link para a pasta. */ }
  }
  async function importPDFs(files) {
    let total=0;
    for(const file of files){if(!/\.pdf$/i.test(file.name))continue;try{if((await file.slice(0,5).text())!=='%PDF-')continue;const key=pdfKey(file.name);const previous=state.pdfs.get(key);if(previous && state.activeObjectURLs.has(previous)){URL.revokeObjectURL(previous);state.activeObjectURLs.delete(previous);}const url=URL.createObjectURL(file);state.activeObjectURLs.add(url);state.pdfs.set(key,url);total++;}catch{}}
    $('pdf-summary').textContent=`${number(state.pdfs.size)} PDFs disponíveis nesta sessão.`;
    $('pdf-input').value='';
    showToast(`${number(total)} ${total===1?'PDF vinculado':'PDFs vinculados'}.`);
    if(state.wantedPdf && state.pdfs.has(pdfKey(state.wantedPdf)) && $('pdf-dialog').open) showPdfURL(state.pdfs.get(pdfKey(state.wantedPdf)));
  }

  function idb() {
    return new Promise((resolve,reject)=>{
      if(!window.indexedDB){reject(new Error('IndexedDB indisponível'));return;}
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('base'))req.result.createObjectStore('base');};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }
  async function dbOperation(method,payload) {
    const db=await idb();
    try{ return await new Promise((resolve,reject)=>{const tx=db.transaction('base',method==='get'?'readonly':'readwrite');const store=tx.objectStore('base');const req=method==='get'?store.get('manual'):method==='set'?store.put(payload,'manual'):store.delete('manual');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}); }
    finally{db.close();}
  }
  async function loadSaved() {
    try{const value=await dbOperation('get');if(value?.data)return value;}catch{}
    try{const item=localStorage.getItem(STORAGE_KEY);return item?JSON.parse(item):null;}catch{return null;}
  }
  async function saveImported(data,name) {
    const item={data,name,created:Date.now()};
    try{await dbOperation('set',item);try{localStorage.removeItem(STORAGE_KEY);}catch{}return true;}catch{}
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(item));return true;}catch{return false;}
  }
  async function deleteImported() {
    try{await dbOperation('delete');}catch{}
    try{localStorage.removeItem(STORAGE_KEY);}catch{}
  }
  async function loadUserFile(file) {
    if(!file)return;
    $('import-error').classList.add('hidden');
    try{
      if(file.size>CONFIG.maxBytes)throw Error('Arquivo JSON maior que 30 MB.');
      const raw=(await file.text()).replace(/^\uFEFF/,'');
      const data=JSON.parse(raw);
      const records=parseRecords(data);
      const persist=await saveImported(data,file.name);
      applyRecords(records,file.name,{status:'JSON personalizado carregado'});
      showMessage(persist ? `Base “${file.name}” carregada: ${number(records.length)} TAGs. Ela ficará disponível ao reabrir este navegador.` : `Base “${file.name}” carregada: ${number(records.length)} TAGs. O navegador não permitiu salvá-la para futuras sessões; exporte a cópia offline para manter os dados.`,!persist);
      $('base-dialog').close();
      showToast(`${number(records.length)} TAGs importadas com sucesso.`);
    }catch(error){$('import-error').textContent=error instanceof SyntaxError?'O arquivo selecionado não é um JSON válido.':String(error.message||error);$('import-error').classList.remove('hidden');openDialog('base-dialog');}
    finally{$('json-input').value='';}
  }
  async function loadSite(force=false) {
    if(location.protocol==='file:'){
      showMessage('No modo file:// o navegador bloqueia a leitura automática de app.json. Clique em “Carregar JSON” para selecionar seu arquivo, ou use hospedagem HTTP/HTTPS.',true);
      showToast('Para ler app.json automaticamente, abra por HTTP/HTTPS.');
      return false;
    }
    try{
      const resp=await fetch(`${CONFIG.jsonURL}?v=${Date.now()}`,{cache:'no-store'});
      if(!resp.ok)throw Error(`app.json não encontrado (HTTP ${resp.status}).`);
      const length=Number(resp.headers.get('content-length')||0);
      if(length>CONFIG.maxBytes)throw Error('app.json é maior que 30 MB.');
      const text=await resp.text();
      if(new Blob([text]).size>CONFIG.maxBytes)throw Error('app.json é maior que 30 MB.');
      const data=JSON.parse(text.replace(/^\uFEFF/,''));
      const records=parseRecords(data);
      if(force)await deleteImported();
      applyRecords(records,'app.json (arquivo estático do site)',{status:'app.json carregado'});
      showMessage(`app.json lido diretamente do frontend: ${number(records.length)} TAGs carregadas. Nenhuma API foi utilizada.`);
      return true;
    }catch(error){
      showMessage(`Não foi possível carregar app.json: ${error instanceof SyntaxError?'formato JSON inválido':String(error.message||error)}. A base anterior foi mantida.`,true);
      setSourceStatus('Usando base local',true);
      return false;
    }
  }
  function downloadJS() {
    if(!state.records.length)return showToast('Não há dados para exportar.');
    const clean=state.records.map(({codigo,descricao,setor,arquivos,observacao,associacao_confirmada})=>({codigo,descricao,setor,arquivos,...(observacao?{observacao}:{}),...(associacao_confirmada===false?{associacao_confirmada:false}:{})}));
    const content='/* Cópia local para uso sem servidor. */\nwindow.FS_DADOS_LOCAIS = '+JSON.stringify(clean,null,2)+';\n';
    const blob=new Blob([content],{type:'text/javascript;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const link=node('a');link.href=url;link.download='dados-locais.js';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    showToast('Substitua assets/dados-locais.js pelo arquivo baixado para atualizar a cópia offline.');
  }
  async function initialize() {
    // A base embutida funciona ao abrir o HTML com dois cliques.
    try{if(window.FS_DADOS_LOCAIS){const records=parseRecords(window.FS_DADOS_LOCAIS);applyRecords(records,'assets/dados-locais.js (base offline incluída)',{status:'Base offline disponível',offline:true});}}
    catch(error){showMessage(`Erro na base offline: ${error.message}`,true);setSourceStatus('Base não carregada',true);}
    const saved=await loadSaved();
    if(saved?.data){try{const records=parseRecords(saved.data);applyRecords(records,`${saved.name} (JSON salvo no navegador)`,{status:'JSON personalizado carregado'});showMessage(`${number(records.length)} TAGs da base importada anteriormente. Para utilizar outra base, clique em “Carregar JSON”.`);return;}catch{}}
    if(location.protocol!=='file:')await loadSite();
    else if(state.records.length)showMessage(`Modo offline: ${number(state.records.length)} TAGs carregadas de assets/dados-locais.js. Para pesquisar o seu próprio app.json, clique em “Carregar JSON” e selecione o arquivo.`,false);
    else showMessage('Nenhuma TAG disponível. Selecione seu arquivo JSON para iniciar.',true);
  }

  // Eventos de interface.
  document.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>openDialog(b.dataset.open)));
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  document.querySelectorAll('[data-import]').forEach(b=>b.addEventListener('click',()=>$('json-input').click()));
  document.querySelectorAll('[data-pdfs]').forEach(b=>b.addEventListener('click',()=>$('pdf-input').click()));
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',event=>{if(event.target===d){const box=d.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)d.close();}}));
  $('pdf-dialog').addEventListener('close',()=>{state.epoch++;state.wantedPdf='';$('pdf-content').replaceChildren();});
  $('json-input').addEventListener('change',e=>loadUserFile(e.target.files[0]));
  $('pdf-input').addEventListener('change',e=>importPDFs(Array.from(e.target.files)));
  let inputTimer;
  $('search').addEventListener('input',()=>{clearTimeout(inputTimer);inputTimer=setTimeout(resetLimitAndRender,80);});
  $('search-form').addEventListener('submit',e=>{e.preventDefault();clearTimeout(inputTimer);resetLimitAndRender();});
  $('sector-filter').addEventListener('change',resetLimitAndRender);
  $('clear-search').addEventListener('click',()=>{$('search').value='';resetLimitAndRender();$('search').focus();});
  $('reset-filters').addEventListener('click',resetFilters);
  $('show-all').addEventListener('click',resetFilters);
  $('nav-search').addEventListener('click',()=>{$('search').focus();$('search').scrollIntoView({block:'center',behavior:'smooth'});});
  $('load-more').addEventListener('click',()=>{state.limit+=CONFIG.pageSize;render();});
  $('reload-json').addEventListener('click',async()=>{const ok=await loadSite(true);if(ok){$('base-dialog').close();showToast('app.json atualizado com sucesso.');}});
  $('export-offline').addEventListener('click',downloadJS);
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();$('search').focus();}});
  window.addEventListener('pagehide',()=>{for(const url of state.activeObjectURLs)URL.revokeObjectURL(url);});
  initialize();
})();
