/**
 * docs-feature.js — תוסף "מסמכים בתיק" עבור אפליקציית לידים + חדל"פ
 *
 * שימוש:
 *   1. שמור את הקובץ הזה ב-GitHub שלך באותה תיקייה של ה-HTML
 *   2. הוסף לפני </body> של כל אפליקציה:
 *        <script src="docs-feature.js"></script>
 *   3. בכרטיס כל לקוח, הוסף את הכפתור:
 *        <button class="docs-btn" onclick="event.stopPropagation();openDocsModal(rowOrIndex)" title="מסמכים">${window.DocsFeature.icon}</button>
 *
 * השרת שאליו הקובץ פונה — http://127.0.0.1:7531 — צריך לרוץ במחשב.
 * הפעלה: קליק כפול על "הפעלה.bat" בתיקיית _legal-system בדרופבוקס.
 */
(function(){
  'use strict';

  const LEGAL_API = 'http://127.0.0.1:7531';

  // אייקון Lucide-style — תיקייה עם קווים פנימיים
  const FOLDER_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;display:block">' +
    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>' +
    '<path d="M14 13H8"/>' +
    '<path d="M14 17H8"/>' +
    '</svg>';

  // ─── CSS — מותאם לערכי הצבע של שתי האפליקציות ──────────────────────────
  const CSS = `
    .docs-btn{
      width:38px;height:38px;
      background:var(--white);border:1px solid var(--border);
      cursor:pointer;flex-shrink:0;
      display:inline-flex;align-items:center;justify-content:center;
      color:var(--slate);font-family:inherit;padding:0;
      transition:all .12s;
      box-shadow:0 1px 3px rgba(0,0,0,0.06);
      position:relative;box-sizing:border-box;border-radius:0;
    }
    .docs-btn:active{transform:scale(.92);background:var(--bg);}
    .docs-btn svg{width:18px;height:18px;}
    .docs-btn .docs-count{
      position:absolute;top:-5px;left:-5px;
      background:var(--slate);color:#fff;
      font-size:9px;font-weight:700;
      padding:1px 4px;border-radius:8px;
      line-height:1.1;border:1.5px solid var(--white);
      font-family:inherit;
    }
    #docs-modal{display:none;position:fixed;inset:0;background:var(--white);z-index:330;}
    #docs-modal.open{display:flex;flex-direction:column;}
    #docs-modal .docs-head{
      display:flex;align-items:center;gap:10px;
      border-bottom:1px solid var(--border);
      padding:14px 16px 10px;
      padding-top:calc(14px + env(safe-area-inset-top));
    }
    #docs-modal .docs-back{
      background:var(--bg);border:1px solid var(--border);
      padding:6px 10px;font-size:14px;cursor:pointer;
      font-family:inherit;display:inline-flex;align-items:center;gap:5px;
      color:var(--text);border-radius:0;
    }
    #docs-modal .docs-title{font-size:15px;font-weight:700;color:var(--text);}
    #docs-modal .docs-sub{font-size:13px;color:var(--muted);font-weight:500;margin-top:2px;}
    #docs-modal .docs-content{flex:1;overflow-y:auto;padding:14px 16px;min-height:0;}
    .doc-row{
      padding:11px 12px;
      border:1px solid var(--border);background:var(--white);
      margin-bottom:8px;cursor:pointer;
      transition:background .12s;border-radius:0;
    }
    .doc-row:active{background:var(--bg);}
    .doc-row .doc-fname{
      font-size:13px;font-weight:600;color:var(--text);
      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
      overflow:hidden;word-break:break-word;line-height:1.35;
    }
    .doc-row .doc-meta{
      font-size:11px;color:var(--muted);margin-top:5px;
      display:flex;gap:8px;flex-wrap:wrap;align-items:center;
    }
    .doc-row .doc-badge{
      background:var(--bg);border:1px solid var(--border);
      padding:1px 6px;font-size:10px;font-weight:600;border-radius:0;
    }
    .doc-row .doc-reasons{
      font-size:10px;color:var(--green);margin-top:4px;font-weight:500;
    }
    .doc-empty{text-align:center;padding:50px 20px;color:var(--muted);font-size:13px;}
    .doc-empty .doc-empty-icon{margin:0 auto 14px;width:36px;height:36px;color:var(--border);}
    .doc-empty .doc-empty-icon svg{width:36px;height:36px;}
    .doc-spinner{
      width:24px;height:24px;border:2px solid var(--border);
      border-top-color:var(--slate);border-radius:50%;
      animation:doc-spin .7s linear infinite;margin:0 auto;
    }
    @keyframes doc-spin{to{transform:rotate(360deg);}}
  `;

  // ─── מצרף CSS לדף ─────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  // ─── מצרף את ה-modal לדף ─────────────────────────────────────────────
  const modalHtml = `
    <div id="docs-modal">
      <div class="docs-head">
        <button class="docs-back" onclick="DocsFeature.close()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          <span>חזרה</span>
        </button>
        <div style="flex:1;min-width:0">
          <div class="docs-title">מסמכים בתיק</div>
          <div class="docs-sub" id="docs-modal-sub"></div>
        </div>
      </div>
      <div class="docs-content" id="docs-modal-content"></div>
    </div>
  `;
  const modalWrap = document.createElement('div');
  modalWrap.innerHTML = modalHtml;
  document.body.appendChild(modalWrap.firstElementChild);

  // ─── ההיסטוריה — back button → סוגר ──────────────────────────────────
  let isOpen = false;
  let suppressPop = false;
  window.addEventListener('popstate', function(e){
    if(suppressPop){ suppressPop=false; return; }
    if(isOpen){ DocsFeature.close(true); }
  });

  // ─── פונקציות עזר ─────────────────────────────────────────────────────
  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function showToast(msg){
    if(typeof window.showToast === 'function'){ window.showToast(msg); return; }
    console.log('[docs]', msg);
  }
  function findClient(rowNum){
    if(typeof allClients !== 'undefined'){
      const c = allClients.find(x => x.rowNum === rowNum);
      if(c) return { name:c.name||'', phone:c.phone||'', caseNum:c.caseNum||'' };
    }
    if(typeof allLeads !== 'undefined'){
      const l = allLeads.find(x => x.index === rowNum);
      if(l) return { name:l.name||'', phone:l.phone||'', caseNum:'' };
    }
    return null;
  }

  // ─── פתיחה ─────────────────────────────────────────────────────────────
  async function open(rowNum){
    const client = findClient(rowNum);
    if(!client){ showToast('לקוח לא נמצא'); return; }
    const { name, phone, caseNum } = client;
    document.getElementById('docs-modal-sub').textContent =
      name + (caseNum?` • תיק ${caseNum}`:'') + (phone?` • ${phone}`:'');
    const wrap = document.getElementById('docs-modal-content');
    wrap.innerHTML = '<div class="doc-empty"><div class="doc-spinner"></div><div style="margin-top:14px">מחפש מסמכים...</div></div>';
    document.getElementById('docs-modal').classList.add('open');
    isOpen = true;
    history.pushState({ page:'docs-feature' }, '');

    try{
      const params = new URLSearchParams({
        name: name || '',
        phone: phone || '',
        case_num: caseNum || '',
        limit: '50'
      });
      const r = await fetch(`${LEGAL_API}/api/client-docs?${params}`);
      if(!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      if(!data.results || data.results.length === 0){
        wrap.innerHTML = `
          <div class="doc-empty">
            <div class="doc-empty-icon">${FOLDER_ICON}</div>
            <div>לא נמצאו מסמכים תואמים</div>
            <div style="margin-top:6px;font-size:12px">חיפוש: ${esc(name||phone||caseNum||'')}</div>
          </div>`;
        return;
      }
      wrap.innerHTML = data.results.map(d => `
        <div class="doc-row">
          <div class="doc-fname">${esc(d.filename)}</div>
          <div class="doc-meta">
            <span class="doc-badge">${esc(d.doc_type)}</span>
            <span>${esc(d.case)}</span>
            <span>${esc(d.source_ext)}</span>
            <span>${(d.chars||0).toLocaleString('he-IL')} תווים</span>
          </div>
          ${d.reasons && d.reasons.length ? `<div class="doc-reasons">✓ ${esc(d.reasons.join(' · '))}</div>` : ''}
        </div>
      `).join('');
    } catch(e){
      wrap.innerHTML = `
        <div class="doc-empty">
          <div style="color:var(--red);margin-bottom:8px;font-weight:600">לא ניתן להתחבר ל-legal-system</div>
          <div style="font-size:12px">ודא שהפעלת את "הפעלה.bat" במחשב</div>
          <div style="font-size:11px;margin-top:8px;color:var(--muted)">${esc(e.message)}</div>
        </div>`;
    }
  }

  // ─── סגירה ─────────────────────────────────────────────────────────────
  function close(fromPopState){
    document.getElementById('docs-modal').classList.remove('open');
    isOpen = false;
    if(!fromPopState && history.state && history.state.page === 'docs-feature'){
      suppressPop = true;
      history.back();
    }
  }

  // ─── הזרקת כפתור אוטומטית לכל כרטיס ─────────────────────────────────
  // עוקב אחרי הוספת כרטיסים חדשים ל-DOM, ומוסיף את כפתור המסמכים
  // ליד שאר ה-icons (אחרי WhatsApp בדרך כלל). זה מאפשר התקנה
  // עם שורה אחת בלבד ב-HTML, בלי שינוי בקוד הקיים של ה-render.
  function injectButton(card){
    if(!card || card.querySelector('.docs-btn')) return;
    let rowNum = null;
    const dataAttr = card.getAttribute('data-row') ||
                     card.querySelector('[data-row]')?.getAttribute('data-row');
    if(dataAttr) rowNum = parseInt(dataAttr, 10);
    if(!rowNum){
      // fallback — search inline onclick attributes (`callLead(123)` / `toggleExpand(123)`)
      const onclickEls = card.querySelectorAll('[onclick]');
      for(const el of onclickEls){
        const m = (el.getAttribute('onclick') || '')
          .match(/(?:rowNum|index|row)\s*[=:,]?\s*(\d+)/);
        if(m){ rowNum = parseInt(m[1], 10); break; }
      }
    }
    if(!rowNum) return;
    // find the WhatsApp button or any icon-button row to anchor next to
    const wa = card.querySelector('.wa-btn');
    const log = card.querySelector('.log-btn, .note-btn, .call-log-btn');
    const anchor = wa || log;
    const btn = document.createElement('button');
    btn.className = 'docs-btn';
    btn.title = 'מסמכים בתיק';
    btn.innerHTML = FOLDER_ICON;
    btn.addEventListener('click', e => { e.stopPropagation(); open(rowNum); });
    if(anchor && anchor.parentElement){
      anchor.parentElement.insertBefore(btn, anchor);
    } else {
      // last-resort: append to the card's first row
      const head = card.querySelector('.card-header, .lead-row');
      if(head) head.appendChild(btn);
    }
  }

  function scanAll(root){
    root = root || document;
    const cards = root.querySelectorAll('.client-card, .lead-card');
    cards.forEach(injectButton);
  }

  // initial scan + ongoing observer
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', () => scanAll());
  } else {
    scanAll();
  }
  const obs = new MutationObserver(muts => {
    for(const m of muts){
      m.addedNodes.forEach(n => {
        if(n.nodeType !== 1) return;
        if(n.matches && (n.matches('.client-card') || n.matches('.lead-card'))){
          injectButton(n);
        } else {
          scanAll(n);
        }
      });
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // ─── חשיפה גלובלית ─────────────────────────────────────────────────────
  window.DocsFeature = { open, close, icon: FOLDER_ICON, isOpen: () => isOpen, scan: scanAll };
  window.openDocsModal = open;
})();
