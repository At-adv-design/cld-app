/**
 * Apps Script backend for the customer-facing app.
 *
 * Deploy as a Web App:
 *   - Deploy ג†’ New deployment ג†’ type: Web app
 *   - Execute as: Me (your email)
 *   - Who has access: Anyone
 *
 * Endpoints (POST with JSON body, "action" field):
 *   - login              { username, password }
 *   - getRequests        { token }
 *   - uploadFile         { token, category, reqId, reportNum?, filename, mimeType, dataBase64 }
 *   - submitAnswer       { token, reqId, answer }
 *   - removeFile         { token, category, reqId, fileId }
 *   - saveQuestionnaire  { token, data }           ג† NEW
 *   - getQuestionnaire   { token }                 ג† NEW
 */

// ג”€ג”€ג”€ CONFIG ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
const SHEET_ID = '1ixQ0iImkxI1YiTrX_dFsSxVTISUyfCEYpKt1C2EWtLE';
const DRIVE_ROOT_ID = '1RitBIq8HXTVymhalA34HS4BRyfOzT6lq';

// 1-based column indexes
const COL = {
  NAME:           23,   // W (1-based) ג€” client display name (canonical)
  CR_USER:        96,   // CR ג€” username
  CS_PASS:        97,   // CS ג€” password
  CT_ACTIVE:      98,   // CT ג€” TRUE/FALSE
  CU_REPORTS:     99,   // CU ג€” JSON (reports docs)
  CV_DOCS:       100,   // CV ג€” JSON (supplemental docs)
  CW_INFO:       101,   // CW ג€” JSON (info questions)
  CX_STAGE:      133,   // EC (0-based 132) ג€” stage: '' | 'pre_order' | 'commercial'
  CY_QUEST:      134,   // ED (0-based 133) ג€” questionnaire JSON (form 45 data)
  SIGS_DOCS:     117,   // DM (1-based) ג€” signature documents JSON: [{id,text,files:[{id,name,url,ts,signedAt?}]}]
  CZ_INQUIRIES:  136,   // EF ג€” client inquiries JSON array
};

// ג”€ג”€ג”€ HTTP entrypoints ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
function doPost(e){
  try{
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    let result;
    if     (action === 'login')             result = handleLogin(body);
    else if(action === 'getRequests')       result = handleGetRequests(body);
    else if(action === 'uploadFile')        result = handleUploadFile(body);
    else if(action === 'submitAnswer')      result = handleSubmitAnswer(body);
    else if(action === 'removeFile')        result = handleRemoveFile(body);
    else if(action === 'saveQuestionnaire') result = handleSaveQuestionnaire(body);
    else if(action === 'getQuestionnaire')  result = handleGetQuestionnaire(body);
    else if(action === 'approveItem')       result = handleApproveItem(body);
    else if(action === 'rejectItem')        result = handleRejectItem(body);
    else if(action === 'unapproveItem')     result = handleUnapproveItem(body);
    else if(action === 'sendInquiry')       result = handleSendInquiry(body);
    else if(action === 'closeReport')       result = handleCloseReport(body);
    else if(action === 'createCalendarEvent') result = handleCreateCalendarEvent(body);
    else if(action === 'sendWhatsApp')        result = handleSendWhatsApp(body);
    else if(action === 'submitSignature')     result = handleSubmitSignature(body);
    else throw new Error('Unknown action: ' + action);
    return ContentService.createTextOutput(JSON.stringify(Object.assign({ok:true}, result)))
      .setMimeType(ContentService.MimeType.JSON);
  }catch(err){
    return ContentService.createTextOutput(JSON.stringify({ok:false, error:String(err.message||err)}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(){
  return ContentService.createTextOutput(JSON.stringify({ok:true, msg:'Customer API alive'}))
    .setMimeType(ContentService.MimeType.JSON);
}

// ג”€ג”€ג”€ Helpers ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
function _sheet(){ return SpreadsheetApp.openById(SHEET_ID).getSheets()[0]; }

function _findRowByCreds(username, password){
  const sheet = _sheet();
  const data = sheet.getDataRange().getValues();
  for(let i=1; i<data.length; i++){
    const row = data[i];
    const u = (row[COL.CR_USER-1] || '').toString().trim();
    const p = (row[COL.CS_PASS-1] || '').toString().trim();
    const active = (row[COL.CT_ACTIVE-1] || '').toString().toUpperCase().trim();
    if(u && u === username.trim() && p === password.trim() && active === 'TRUE'){
      return {rowNum: i+1, row};
    }
  }
  return null;
}

/* ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ SECURITY HELPERS ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
   Added 2026-05-05 as part of security hardening.
   - Lawyer-side endpoints (sendWhatsApp, ג€¦) require a Google OAuth bearer
     token from the lawyer's UI. We verify the token via Google's
     tokeninfo endpoint and check the email against an allowlist.
   - Login attempts are rate-limited per username via PropertiesService:
     5 failed attempts in 15 minutes ג‡’ further attempts blocked. */
const LAWYER_ALLOWLIST = [
  'avi@t-adv.co.il',
  'avi.t.adv@gmail.com'
];

function _verifyLawyerToken(accessToken){
  if(!accessToken) return {ok:false, reason:'no token'};
  try{
    const r = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(accessToken),
      {muteHttpExceptions: true}
    );
    if(r.getResponseCode() !== 200) return {ok:false, reason:'tokeninfo HTTP ' + r.getResponseCode()};
    const info = JSON.parse(r.getContentText());
    const email = (info.email || '').toLowerCase();
    if(!LAWYER_ALLOWLIST.includes(email)){
      return {ok:false, reason:'email not in allowlist', seenEmail:email, allowed:LAWYER_ALLOWLIST};
    }
    return {ok:true, email, info};
  }catch(e){ return {ok:false, reason:'verify exception: ' + (e.message||e)}; }
}

/* Login rate limit. Stored as `login_fail_<username>` ג†’ JSON {n, t}.
   After RATE_LIMIT_MAX failures within RATE_LIMIT_WINDOW_MS, login is
   refused for that username until the window expires. */
const RATE_LIMIT_MAX        = 5;
const RATE_LIMIT_WINDOW_MS  = 15 * 60 * 1000;

function _loginRateState(username){
  const key = 'login_fail_' + (username||'').trim().toLowerCase().substring(0,40);
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(key);
  if(!raw) return {key, props, n:0, t:0};
  try{
    const obj = JSON.parse(raw);
    if(Date.now() - obj.t > RATE_LIMIT_WINDOW_MS) return {key, props, n:0, t:0};
    return Object.assign({key, props}, obj);
  }catch(_){ return {key, props, n:0, t:0}; }
}
function _loginRateRecord(state, success){
  if(success){
    state.props.deleteProperty(state.key);
    return;
  }
  const next = {n: state.n + 1, t: Date.now()};
  state.props.setProperty(state.key, JSON.stringify(next));
}
function _loginRateBlocked(state){
  return state.n >= RATE_LIMIT_MAX && (Date.now() - state.t) <= RATE_LIMIT_WINDOW_MS;
}

/* Audit log ג€” appends one row to a sheet named "audit_log" in the same
   spreadsheet. Created on first call. Don't throw if logging itself
   fails; security is best-effort. */
function _audit(action, identity, detail){
  try{
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sh = ss.getSheetByName('audit_log');
    if(!sh){
      sh = ss.insertSheet('audit_log');
      sh.appendRow(['timestamp','action','identity','detail']);
    }
    sh.appendRow([new Date(), action, identity || '', JSON.stringify(detail || {}).substring(0, 1000)]);
  }catch(_){}
}

/* One-time helper — run this function from the Apps Script editor
   to trigger Google's "Authorization required" dialog for the new
   script.external_request scope. Hits a harmless public endpoint;
   the actual return value doesn't matter, only that UrlFetchApp.fetch
   is invoked once with the user's authorization. */
function _authBootstrap(){
  try{
    const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=invalid', {muteHttpExceptions: true});
    Logger.log('Auth bootstrap OK — UrlFetchApp authorized. HTTP ' + r.getResponseCode());
    return 'OK — UrlFetchApp permission granted';
  }catch(e){
    Logger.log('Auth bootstrap exception: ' + e);
    throw e;
  }
}

/* Generic admin setter for Script Properties. Takes the name + value as
   parameters from `clasp run` so secrets never sit in source. After
   the values are set this function can stay (it's harmless) — running
   it again just overwrites the property. */
function _adminSetSecret(name, value){
  if(!name) throw new Error('name required');
  PropertiesService.getScriptProperties().setProperty(name, String(value || ''));
  return 'set ' + name + ' (' + (value ? value.length : 0) + ' chars)';
}
function _adminListSecretKeys(){
  return Object.keys(PropertiesService.getScriptProperties().getProperties());
}

/* ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ handleSendWhatsApp ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
   Lawyer-only endpoint. Reads the Green API instance + token from
   PropertiesService (NEVER from source). Validates caller via OAuth.
   Set up: in Apps Script editor ג†’ Project Settings ג†’ Script Properties
     GREEN_API_INSTANCE = <set in Script Properties UI>
     GREEN_API_TOKEN    = <set in Script Properties UI>
*/
/* ───────── handleSubmitSignature ─────────
   Client submits a signed document. Body:
     { token, reqId, fileId, signaturePngBase64, signedAt }
   We:
   1. Verify the client's token (only the right client can sign).
   2. Find the requirement entry in column EE.
   3. Save the signature PNG to the client's "מסמכים לחתימה/חתומים/" folder
      with a name like "<reqText>_signature.png" alongside the original PDF
      reference. (PDF signature overlay can be added later — see PHASE 2 note.)
   4. Update the EE JSON entry with signedAt + signaturePngId + IP/email
      attestation, locking the entry as 'signed'. */
function handleSubmitSignature(body){
  const t = _verifyToken(body.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
  const reqId  = body.reqId  || '';
  const fileId = body.fileId || '';
  if(!reqId) throw new Error('מסמך לא מזוהה');
  // Accept either:
  //   (preferred) signedPdfBase64 — full signed PDF produced client-side
  //   (fallback)  signaturePngBase64 — just the signature image
  if(!body.signedPdfBase64 && !body.signaturePngBase64) throw new Error('חסרה חתימה');

  const sheet = _sheet();
  const cell  = sheet.getRange(t.rowNum, COL.SIGS_DOCS);
  const list  = _parseList(cell.getValue());
  const req   = list.find(r => r.id === reqId);
  if(!req) throw new Error('המסמך לא נמצא');
  const f0    = (req.files && req.files[0]) || null;
  if(!f0) throw new Error('הקובץ לא קיים');
  if(req.signedAt || (f0 && f0.signedAt)) throw new Error('המסמך כבר חתום');

  // Build folder structure: <client>/מסמכים לחתימה/חתומים/
  const clientName = (sheet.getRange(t.rowNum, COL.NAME).getValue() || '').toString().trim() || 'לקוח';
  const root        = DriveApp.getFolderById(DRIVE_ROOT_ID);
  const clientFolder= _ensureFolder(root, clientName);
  const sigsRoot    = _ensureFolder(clientFolder, 'מסמכים לחתימה');
  const signedFolder= _ensureFolder(sigsRoot, 'חתומים');

  const ts = body.signedAt || Date.now();
  let signedPdfFile = null, signaturePngFile = null;

  if(body.signedPdfBase64){
    // The client-side flow used pdf-lib to embed the signature; we get a
    // ready-to-store PDF. Save with "_חתום.pdf" suffix.
    const baseName = (req.text || 'מסמך').replace(/\.pdf$/i, '');
    const pdfBlob = Utilities.newBlob(
      Utilities.base64Decode(body.signedPdfBase64),
      'application/pdf',
      baseName + '_חתום.pdf'
    );
    signedPdfFile = signedFolder.createFile(pdfBlob);
    try { signedPdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(_){}
    f0.signedFileId  = signedPdfFile.getId();
    f0.signedFileUrl = signedPdfFile.getUrl();
  }

  if(body.signaturePngBase64){
    // Always also store the bare signature PNG (audit trail / fallback).
    const sigBlob = Utilities.newBlob(
      Utilities.base64Decode(body.signaturePngBase64), 'image/png',
      (req.text || 'מסמך') + '_signature.png'
    );
    signaturePngFile = signedFolder.createFile(sigBlob);
    try { signaturePngFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(_){}
    f0.signedPngId  = signaturePngFile.getId();
    f0.signedPngUrl = signaturePngFile.getUrl();
  }

  // Attestation metadata
  if(!f0.signedAt) f0.signedAt = ts;
  req.signedAt    = ts;
  req.status      = 'signed';
  req.attestation = {
    timestamp: ts,
    rowNum:    t.rowNum,
    sigPos:    body.sigPos || req.sigPos || null,
    userAgent: (body.userAgent || '').toString().substring(0, 200),
    method:    body.signedPdfBase64 ? 'embedded-pdf' : 'png-only'
  };
  cell.setValue(JSON.stringify(list));
  _audit('submitSignature', '#' + t.rowNum, {reqId, fileId, method: req.attestation.method});
  return {
    signed: true, signedAt: ts,
    signedFileUrl: signedPdfFile ? signedPdfFile.getUrl() : null,
    signaturePngUrl: signaturePngFile ? signaturePngFile.getUrl() : null
  };
}

function handleSendWhatsApp(body){
  const auth = _verifyLawyerToken(body.accessToken);
  if(!auth || !auth.ok){
    _audit('sendWhatsApp_unauthorized', (auth && auth.seenEmail) || '', {phone: body && body.phone, reason: auth && auth.reason});
    throw new Error('unauthorized: ' + (auth && auth.reason ? auth.reason : 'unknown') + (auth && auth.seenEmail ? ' (email seen: ' + auth.seenEmail + ')' : ''));
  }
  const phone = (body.phone||'').toString().replace(/\D/g,'');
  const message = (body.message||'').toString();
  if(!phone || !message) throw new Error('missing phone or message');
  const intl = phone.startsWith('0') ? '972' + phone.substring(1) : phone;
  const props = PropertiesService.getScriptProperties();
  const inst  = props.getProperty('GREEN_API_INSTANCE');
  const tok   = props.getProperty('GREEN_API_TOKEN');
  if(!inst || !tok){ throw new Error('green api not configured (set Script Properties GREEN_API_INSTANCE + GREEN_API_TOKEN)'); }
  const url = 'https://api.green-api.com/waInstance' + inst + '/sendMessage/' + tok;
  const resp = UrlFetchApp.fetch(url, {
    method: 'POST',
    contentType: 'application/json; charset=utf-8',
    payload: JSON.stringify({chatId: intl + '@c.us', message: message}),
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  const txt  = resp.getContentText();
  _audit('sendWhatsApp', auth.email, {phone: intl, code, msgLen: message.length});
  if(code >= 300) throw new Error('green api ' + code + ': ' + txt.substring(0, 300));
  return {sent: true, response: JSON.parse(txt)};
}

function _parseList(raw){
  if(!raw) return [];
  try{ const v = JSON.parse(raw); return Array.isArray(v) ? v : []; }catch(_){ return []; }
}

function _parseObj(raw){
  if(!raw) return null;
  try{ return JSON.parse(raw); }catch(_){ return null; }
}

function _ensureFolder(parent, name){
  const it = parent.getFoldersByName(name);
  if(it.hasNext()) return it.next();
  return parent.createFolder(name);
}

function _makeToken(rowNum, username){
  return Utilities.base64Encode(rowNum + ':' + username + ':' + SHEET_ID.slice(-6));
}
function _verifyToken(token){
  try{
    const decoded = Utilities.newBlob(Utilities.base64Decode(token)).getDataAsString();
    const parts = decoded.split(':');
    return {rowNum: parseInt(parts[0],10), username: parts[1]};
  }catch(_){ return null; }
}

// ג”€ג”€ג”€ Action: login ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
function handleLogin(body){
  const username = body.username, password = body.password;
  if(!username || !password) throw new Error('הזן שם משתמש וסיסמה');
  // Rate-limit per username ג€” block after RATE_LIMIT_MAX failed attempts
  // in RATE_LIMIT_WINDOW_MS. Bots / brute-forcers get nothing useful.
  const rate = _loginRateState(username);
  if(_loginRateBlocked(rate)){
    _audit('login_blocked_rate_limit', username, {attempts: rate.n});
    throw new Error('׳™׳•׳×׳¨ ׳׳“׳™ ׳ ׳™׳¡׳™׳•׳ ׳•׳× ׳›׳ ׳™׳¡׳” ׳›׳•׳©׳׳™׳. ׳ ׳¡׳” ׳©׳•׳‘ ׳‘׳¢׳•׳“ 15 ׳“׳§׳•׳×.');
  }
  const found = _findRowByCreds(username, password);
  if(!found){
    _loginRateRecord(rate, false);
    _audit('login_failed', username, {attempts: rate.n + 1});
    throw new Error('שם משתמש או סיסמה שגויים, או שחיבור לקוח לא הופעל');
  }
  _loginRateRecord(rate, true);
  _audit('login_success', username, {row: found.rowNum});
  const name  = found.row[COL.NAME-1] || '';
  const stage = (found.row[COL.CX_STAGE-1] || '').toString().trim().toLowerCase();
  return {
    user: {
      rowNum:   found.rowNum,
      name:     name.toString(),
      username: username.trim(),
      token:    _makeToken(found.rowNum, username),
      stage:    stage,   // '' | 'pre_order' | 'commercial'
    }
  };
}

// ג”€ג”€ג”€ Action: getRequests ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
function handleGetRequests(body){
  const t = _verifyToken(body.token);
  if(!t) throw new Error('׳₪׳’ ׳×׳•׳§׳£ ׳”׳›׳ ׳™׳¡׳” ג€” ׳”׳×׳—׳‘׳¨ ׳׳—׳“׳©');
  const sheet = _sheet();
  // Read up to the highest column we care about. SIGS_DOCS is at DM (117)
  // — earlier than CY_QUEST (134) and CZ_INQUIRIES (136) — so we use the
  // max so all later columns come back too.
  const MAX_COL = Math.max(COL.SIGS_DOCS, COL.CY_QUEST, COL.CZ_INQUIRIES);
  const row = sheet.getRange(t.rowNum, 1, 1, MAX_COL).getValues()[0];
  const stage = (row[COL.CX_STAGE-1] || '').toString().trim().toLowerCase();

  const reports    = _parseList(row[COL.CU_REPORTS-1]);
  const docs       = _parseList(row[COL.CV_DOCS-1]);
  const info       = _parseList(row[COL.CW_INFO-1]);
  const signatures = _parseList(row[COL.SIGS_DOCS-1]);
  const inquiries  = _parseList(row[COL.CZ_INQUIRIES-1]);

  const pending = [], rejections = [];
  const _collect = (list, category) => {
    list.forEach(req => {
      const rn = req.reportNum || null;
      if(req.status === 'uploaded' && Array.isArray(req.files)){
        req.files.forEach(f => {
          // Skip files already individually approved ג€” they'll appear in
          // docsApproved instead of the pending list.
          if(f.approved) return;
          pending.push({
            reqId: req.id, reqText: req.text||'', category, reportNum: rn,
            fileId: f.id, name: f.name, url: f.url, ts: f.ts
          });
        });
      }
      if(req.status === 'rejected'){
        rejections.push({
          reqId: req.id, reqText: req.text||'', category, reportNum: rn,
          reason: req.rejectionReason||'', ts: req.rejectedAt||0
        });
      }
    });
  };
  _collect(reports, 'reports');
  _collect(docs,    'docs');
  _collect(info,    'info');

  // Derive docsRequired + docsApproved from CV docs (clients app expects these fields)
  const docsRequired = docs.map(req => ({
    id: req.id, text: req.text || '', report: 0
  }));
  const docsApproved = [];
  docs.forEach(req => {
    // Multi-file merged: single approved entry pointing to the merged PDF
    if(req.mergedPdfId && req.status === 'approved'){
      docsApproved.push({
        fileId: req.mergedPdfId,
        name: req.mergedPdfName || (req.text ? req.text + '.pdf' : 'מסמך.pdf'),
        url: req.mergedPdfUrl,
        reqId: req.id, reqText: req.text || '',
        approvedAt: req.mergedAt || req.approvedAt || 0,
        isMerged: true
      });
      return;
    }
    // Single-file (or per-file approved): one entry per approved file
    if(Array.isArray(req.files)){
      req.files.forEach(f => {
        if(f.approved){
          docsApproved.push({
            fileId: f.id, name: f.name, url: f.url,
            reqId: req.id, reqText: req.text || '',
            approvedAt: f.approvedAt || req.approvedAt || 0
          });
        }
      });
    }
  });

  return {
    reports, docs, info, signatures,
    docsRequired, docsApproved,
    name:    row[COL.NAME-1] || '',
    stage:   stage,
    questionnaire: _parseObj(row[COL.CY_QUEST-1]),
    pending, rejections,
    // Inquiries — both sides of the conversation. Lawyer's reply (if any)
    // lives on the same entry as iq.reply / iq.replyTs (written by the
    // insolvency app via Sheets API). Client UI shows the original message
    // and the reply, if present.
    inquiries,
  };
}

// ג”€ג”€ג”€ Action: uploadFile ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
function handleUploadFile(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('׳₪׳’ ׳×׳•׳§׳£ ׳”׳›׳ ׳™׳¡׳” ג€” ׳”׳×׳—׳‘׳¨ ׳׳—׳“׳©');
  const sheet = _sheet();
  const clientName = (sheet.getRange(t.rowNum, COL.NAME).getValue() || '').toString().trim() || 'ללא שם';

  // Two-stage flow:
  //   Pending review ג†’ "מסמכים ששלח הלקוח" (pending bin)
  //   After approval ג†’ "השלמת מסמכים" (final, locked)
  // Reports and info still use the old per-stage subfolders.
  const root = DriveApp.getFolderById(DRIVE_ROOT_ID);
  const clientFolder = _ensureFolder(root, clientName);
  let target;
  if(p.category === 'reports'){
    const inboxFolder = _ensureFolder(clientFolder, 'מסמכים שהתקבלו מהלקוח');
    const reportsRoot = _ensureFolder(inboxFolder, 'מסמכי דוחות');
    target = _ensureFolder(reportsRoot, 'דוח ' + (p.reportNum || '?'));
  } else if(p.category === 'docs'){
    // PENDING bin ג€” stays here until lawyer approves; then file moves to השלמת מסמכים
    target = _ensureFolder(clientFolder, 'מסמכים ששלח הלקוח');
  } else if(p.category === 'info'){
    const inboxFolder = _ensureFolder(clientFolder, 'מסמכים שהתקבלו מהלקוח');
    target = _ensureFolder(inboxFolder, 'השלמת פרטים');
  } else if(p.category === 'pre_order_docs'){
    target = _ensureFolder(clientFolder, 'צו פתיחה');
  } else {
    throw new Error('קטגוריה לא תקינה');
  }

  // Filename: use the requirement text (sanitized) as the canonical name.
  // Falls back to the client's filename if reqText is missing.
  // Drive auto-appends "(1)", "(2)" on name collision so we don't need a
  // timestamp prefix. The result for the user/lawyer is a clean filename
  // like "׳×׳׳•׳© ׳©׳›׳¨ ׳׳—׳¨׳•׳.pdf" instead of "040526113200_׳×׳׳•׳© ׳©׳›׳¨ ׳׳—׳¨׳•׳.pdf".
  const sanitize = s => String(s||'').replace(/[\/\\?%*:|"<>]/g,'').trim().slice(0,120);
  const reqLabel = sanitize(p.reqText || '');
  const fallback = sanitize(p.filename || 'file');
  // Preserve the extension from p.filename if present, otherwise infer
  // from mimeType (image/jpeg ג†’ .jpg, application/pdf ג†’ .pdf, ג€¦).
  const m = (p.filename || '').match(/\.[^.\/\\]+$/);
  let ext = m ? m[0] : '';
  if(!ext){
    const mt = (p.mimeType || '').toLowerCase();
    if(mt === 'application/pdf')   ext = '.pdf';
    else if(mt.startsWith('image/jpeg') || mt.startsWith('image/jpg')) ext = '.jpg';
    else if(mt.startsWith('image/png')) ext = '.png';
    else if(mt.startsWith('image/'))    ext = '.jpg';
    else ext = '';
  }
  // Strip extension from reqLabel/fallback before re-adding
  const stripExt = s => s.replace(/\.[^.\/\\]+$/,'');
  const baseLabel = reqLabel ? stripExt(reqLabel) : stripExt(fallback);
  const finalName = baseLabel + ext;

  const blob = Utilities.newBlob(
    Utilities.base64Decode(p.dataBase64),
    p.mimeType || 'application/octet-stream',
    finalName
  );
  const file = target.createFile(blob);
  // Make the file viewable without a Google sign-in prompt. The lawyer's
  // browser session may differ from the app's OAuth account; without this,
  // the Drive iframe demands a separate Google login. ANYONE_WITH_LINK is
  // safe given the file ID is unguessable and only surfaces inside the
  // lawyer's app.
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(_) {}
  const stampedName = file.getName(); // Drive may have added " (1)" on collision

  // Update requirement entry in sheet
  const colMap = {reports: COL.CU_REPORTS, docs: COL.CV_DOCS, info: COL.CW_INFO, pre_order_docs: COL.CV_DOCS, signatures: COL.SIGS_DOCS};
  const colIdx = colMap[p.category] || COL.CV_DOCS;
  const cell = sheet.getRange(t.rowNum, colIdx);
  const list = _parseList(cell.getValue());
  const req  = list.find(r => r.id === p.reqId);
  if(req){
    if(!req.files) req.files = [];
    req.files.push({ id: file.getId(), name: stampedName, url: file.getUrl(), ts: Date.now() });
    if(req.status === 'pending' || req.status === 'rejected') req.status = 'uploaded';
    cell.setValue(JSON.stringify(list));
  }

  return { fileId: file.getId(), fileUrl: file.getUrl(), fileName: stampedName };
}

// ג”€ג”€ג”€ Action: submitAnswer ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
function handleSubmitAnswer(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('׳₪׳’ ׳×׳•׳§׳£ ׳”׳›׳ ׳™׳¡׳” ג€” ׳”׳×׳—׳‘׳¨ ׳׳—׳“׳©');
  const sheet = _sheet();
  const cell  = sheet.getRange(t.rowNum, COL.CW_INFO);
  const list  = _parseList(cell.getValue());
  const req   = list.find(r => r.id === p.reqId);
  if(!req) throw new Error('פריט לא נמצא');
  req.answer     = String(p.answer || '');
  req.status     = 'uploaded';
  req.answeredAt = Date.now();
  cell.setValue(JSON.stringify(list));
  return {ok: true};
}

// ג”€ג”€ג”€ Action: removeFile ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
function handleRemoveFile(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('׳₪׳’ ׳×׳•׳§׳£ ׳”׳›׳ ׳™׳¡׳” ג€” ׳”׳×׳—׳‘׳¨ ׳׳—׳“׳©');
  const sheet = _sheet();
  const colMap = {reports: COL.CU_REPORTS, docs: COL.CV_DOCS, info: COL.CW_INFO};
  const cell   = sheet.getRange(t.rowNum, colMap[p.category] || COL.CV_DOCS);
  const list   = _parseList(cell.getValue());
  const req    = list.find(r => r.id === p.reqId);
  if(!req || !req.files) return {ok:true};
  const file = req.files.find(f => f.id === p.fileId);
  // LOCK: an approved file cannot be removed by the client.
  if(file && (file.locked || file.approvedAt)){
    throw new Error('׳”׳§׳•׳‘׳¥ ׳›׳‘׳¨ ׳׳•׳©׳¨ ׳•׳׳ ׳ ׳™׳×׳ ׳׳”׳¡׳™׳¨׳•');
  }
  const idx = req.files.findIndex(f => f.id === p.fileId);
  if(idx >= 0){
    try{ DriveApp.getFileById(p.fileId).setTrashed(true); }catch(_){}
    req.files.splice(idx, 1);
    if(!req.files.length && req.status === 'uploaded') req.status = 'pending';
    cell.setValue(JSON.stringify(list));
  }
  return {ok: true};
}

// ג”€ג”€ג”€ Action: closeReport ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
function handleCloseReport(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('׳₪׳’ ׳×׳•׳§׳£ ׳”׳›׳ ׳™׳¡׳” ג€” ׳”׳×׳—׳‘׳¨ ׳׳—׳“׳©');
  if(!p.reportNum) throw new Error('מספר דוח חסר');
  const sheet = _sheet();
  const repCell = sheet.getRange(t.rowNum, COL.CU_REPORTS);
  const repList = _parseList(repCell.getValue());
  repList.forEach(req => {
    if((req.reportNum||null) === p.reportNum){
      req.locked = true;
      req.closedAt = Date.now();
    }
  });
  repCell.setValue(JSON.stringify(repList));
  const sigsCell = sheet.getRange(t.rowNum, 138);  // EH
  const sigs = _parseObj(sigsCell.getValue()) || {};
  sigs['rep_' + p.reportNum] = {ts: Date.now()};
  sigsCell.setValue(JSON.stringify(sigs));
  return {ok: true};
}

// ג”€ג”€ג”€ Action: saveQuestionnaire ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
function handleSaveQuestionnaire(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('׳₪׳’ ׳×׳•׳§׳£ ׳”׳›׳ ׳™׳¡׳” ג€” ׳”׳×׳—׳‘׳¨ ׳׳—׳“׳©');
  if(!p.data || typeof p.data !== 'object') throw new Error('נתוני שאלון חסרים');
  p.data._savedAt = new Date().toISOString();
  const sheet = _sheet();
  const clientName = (sheet.getRange(t.rowNum, COL.NAME).getValue() || '').toString().trim() || 'לקוח';
  sheet.getRange(t.rowNum, COL.CY_QUEST).setValue(JSON.stringify(p.data));
  // Also write to a Google Sheet in the client's Drive folder
  try{ _saveQuestToSheet(clientName, p.data); }catch(e){ Logger.log('Sheet save failed: '+e); }
  return {ok: true};
}

function _saveQuestToSheet(clientName, d){
  const root = DriveApp.getFolderById(DRIVE_ROOT_ID);
  const clientFolder = _ensureFolder(root, clientName);
  const tzavFolder   = _ensureFolder(clientFolder, 'צו פתיחה');
  const sheetName    = '׳©׳׳׳•׳ ג€” ' + clientName;

  // Find existing sheet or create new one
  let ss;
  const it = tzavFolder.getFilesByName(sheetName);
  if(it.hasNext()){
    ss = SpreadsheetApp.open(it.next());
    ss.getActiveSheet().clearContents();
  } else {
    ss = SpreadsheetApp.create(sheetName);
    DriveApp.getFileById(ss.getId()).moveTo(tzavFolder);
  }
  const ws = ss.getActiveSheet();

  const sections = [
    { title: '׳₪׳¨׳˜׳™׳ ׳׳™׳©׳™׳™׳', rows: [
      ['׳©׳ ׳׳©׳₪׳—׳”', d.last_name], ['׳©׳ ׳₪׳¨׳˜׳™', d.first_name],
      ['׳׳¡׳₪׳¨ ׳×.׳–', d.id], ['׳×׳׳¨׳™׳ ׳׳™׳“׳”', d.dob],
      ['׳׳™׳', d.gender], ['׳׳¦׳‘ ׳׳©׳₪׳—׳×׳™', d.marital],
      ['׳׳¨׳¥ ׳׳™׳“׳”', d.birth_country], ['׳×׳׳¨׳™׳ ׳¢׳׳™׳™׳”', d.aliya_date],
      ['׳›׳×׳•׳‘׳×', d.address], ['׳׳™׳§׳•׳“', d.zip],
      ['׳—׳“׳¨׳™׳', d.apt_rooms], ['׳–׳›׳•׳™׳•׳× ׳‘׳“׳™׳¨׳”', d.apt_rights],
      ['׳˜׳׳₪׳•׳', d.phone], ['׳׳™׳׳™׳™׳', d.email],
    ]},
    { title: '׳₪׳¨׳˜׳™ ׳‘׳/׳‘׳× ׳–׳•׳’', rows: [
      ['׳©׳ ׳׳©׳₪׳—׳”', d.spouse_last], ['׳©׳ ׳₪׳¨׳˜׳™', d.spouse_first],
      ['׳×.׳–', d.spouse_id], ['׳×׳׳¨׳™׳ ׳׳™׳“׳”', d.spouse_dob],
      ['׳˜׳׳₪׳•׳', d.spouse_phone],
    ]},
    { title: '׳×׳¢׳¡׳•׳§׳”', rows: [
      ['׳¢׳™׳¡׳•׳§', d.occupation], ['׳׳¢׳¡׳™׳§', d.employer],
      ['׳›׳×׳•׳‘׳× ׳¢׳‘׳•׳“׳”', d.work_address], ['׳×׳׳¨׳™׳ ׳×׳—׳™׳׳× ׳¢׳‘׳•׳“׳”', d.work_start],
      ['׳׳©׳›׳•׳¨׳× ׳‘׳¨׳•׳˜׳•', d.salary_gross], ['׳׳©׳›׳•׳¨׳× ׳ ׳˜׳•', d.salary_net],
      ['׳׳¢׳¡׳™׳§ ׳‘׳/׳‘׳× ׳–׳•׳’', d.spouse_employer],
      ['׳׳©׳›׳•׳¨׳× ׳‘׳/׳‘׳× ׳–׳•׳’ ׳‘׳¨׳•׳˜׳•', d.spouse_salary_gross],
      ['׳׳©׳›׳•׳¨׳× ׳‘׳/׳‘׳× ׳–׳•׳’ ׳ ׳˜׳•', d.spouse_salary_net],
      ['׳§׳¦׳‘׳× ׳™׳׳“׳™׳', d.child_allowance], ['׳ ׳›׳•׳×', d.disability],
    ]},
    { title: '׳”׳•׳¦׳׳•׳×', rows: [
      ['׳©׳›׳¨ ׳“׳™׳¨׳”', d.rent], ['׳׳¨׳ ׳•׳ ׳”', d.arnona],
      ['׳—׳©׳׳', d.electric], ['׳׳™׳', d.water], ['׳’׳–', d.gas],
      ['׳׳–׳•׳', d.food], ['׳¨׳›׳‘', d.car], ['׳”׳׳‘׳©׳”', d.clothing],
      ['׳—׳™׳ ׳•׳', d.education], ['׳׳—׳¨', d.other_exp],
    ]},
    { title: '׳ ׳›׳¡׳™׳', rows: [
      ['׳¨׳›׳‘׳™׳', d.cars], ['׳—׳©׳‘׳•׳ ׳•׳× ׳‘׳ ׳§', d.banks],
      ['׳ ׳“׳׳', d.realestate],
    ]},
  ];

  let row = 1;
  // Title row
  ws.getRange(row, 1, 1, 2).merge().setValue('׳©׳׳׳•׳ לקוח ג€” ' + clientName)
    .setFontSize(14).setFontWeight('bold')
    .setBackground('#1a1a2e').setFontColor('#ffffff');
  ws.getRange(row, 1, 1, 2).setHorizontalAlignment('center');
  row += 2;

  sections.forEach(sec => {
    ws.getRange(row, 1, 1, 2).merge().setValue(sec.title)
      .setFontSize(12).setFontWeight('bold')
      .setBackground('#3a5ba0').setFontColor('#ffffff');
    row++;
    sec.rows.forEach(([label, val]) => {
      if(!val) return;
      ws.getRange(row, 1).setValue(label).setFontWeight('bold').setBackground('#f8f9fa');
      ws.getRange(row, 2).setValue(val);
      row++;
    });
    row++;
  });

  // Children
  if(Array.isArray(d.children) && d.children.length){
    ws.getRange(row, 1, 1, 4).merge().setValue('׳™׳׳“׳™׳')
      .setFontSize(12).setFontWeight('bold')
      .setBackground('#3a5ba0').setFontColor('#ffffff');
    row++;
    ws.getRange(row, 1).setValue('׳©׳ ׳׳©׳₪׳—׳”').setFontWeight('bold').setBackground('#e8edf5');
    ws.getRange(row, 2).setValue('׳©׳ ׳₪׳¨׳˜׳™').setFontWeight('bold').setBackground('#e8edf5');
    ws.getRange(row, 3).setValue('׳×.׳–').setFontWeight('bold').setBackground('#e8edf5');
    ws.getRange(row, 4).setValue('׳×׳׳¨׳™׳ ׳׳™׳“׳”').setFontWeight('bold').setBackground('#e8edf5');
    row++;
    d.children.forEach(kid => {
      ws.getRange(row,1).setValue(kid.last||'');
      ws.getRange(row,2).setValue(kid.first||'');
      ws.getRange(row,3).setValue(kid.id||'');
      ws.getRange(row,4).setValue(kid.dob||'');
      row++;
    });
    row++;
  }

  // Creditors
  if(Array.isArray(d.creditors) && d.creditors.length){
    ws.getRange(row, 1, 1, 4).merge().setValue('׳ ׳•׳©׳™׳')
      .setFontSize(12).setFontWeight('bold')
      .setBackground('#3a5ba0').setFontColor('#ffffff');
    row++;
    ws.getRange(row, 1).setValue('׳©׳ ׳ ׳•׳©׳”').setFontWeight('bold').setBackground('#e8edf5');
    ws.getRange(row, 2).setValue('׳¡׳•׳’').setFontWeight('bold').setBackground('#e8edf5');
    ws.getRange(row, 3).setValue('׳¡׳›׳•׳ ג‚×').setFontWeight('bold').setBackground('#e8edf5');
    ws.getRange(row, 4).setValue('׳׳¦׳‘').setFontWeight('bold').setBackground('#e8edf5');
    row++;
    d.creditors.forEach(cr => {
      ws.getRange(row,1).setValue(cr.name||'');
      ws.getRange(row,2).setValue(cr.type||'');
      ws.getRange(row,3).setValue(cr.amount||'');
      ws.getRange(row,4).setValue(cr.status||'');
      row++;
    });
  }

  ws.setColumnWidth(1, 180);
  ws.setColumnWidth(2, 300);
  ws.setRightToLeft(true);
}

// ג”€ג”€ג”€ Action: getQuestionnaire ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
function handleGetQuestionnaire(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('׳₪׳’ ׳×׳•׳§׳£ ׳”׳›׳ ׳™׳¡׳” ג€” ׳”׳×׳—׳‘׳¨ ׳׳—׳“׳©');
  const sheet = _sheet();
  const raw = sheet.getRange(t.rowNum, COL.CY_QUEST).getValue();
  return { data: _parseObj(raw) };
}

// ג”€ג”€ג”€ Helper: append a single file to req's merge Doc, re-export PDF ג”€ג”€ג”€
// Per user spec 2026-05-04 ג€” incremental merge: each approval adds one
// page to the growing PDF (instead of waiting for all approvals).
//
// Input: req (mutated), single file id to append, clientFolder.
// Output: { success, pdfId, pdfName, pdfUrl, docId } on success.
//
// PDF inputs are skipped (would need Drive.Files.copy + convert).
function _appendFileToMergedPdf(req, fileId, clientFolder){
  const sanitize = s => String(s||'').replace(/[\/\\?%*:|"<>]/g,'').trim().slice(0,120) || 'מסמך';
  const pdfName = sanitize(req.text || 'מסמך') + '.pdf';
  const A4_WIDTH = 520;

  let driveFile;
  let mime;
  try {
    driveFile = DriveApp.getFileById(fileId);
    mime = driveFile.getMimeType() || '';
  } catch(e){
    return { success: false, error: 'file_not_found', detail: String(e) };
  }
  if(mime.indexOf('image/') !== 0){
    // Non-image (PDF/other): skip merge ג€” return signal so caller treats
    // the approve as a regular single-file approval (file stays separate).
    return { success: false, error: 'non_image' };
  }

  // Open the existing merge Doc, or create a fresh one if first approval
  let doc;
  let isNewDoc = false;
  if(req.mergedDocId){
    try { doc = DocumentApp.openById(req.mergedDocId); } catch(_){}
  }
  if(!doc){
    doc = DocumentApp.create('_merge_' + req.id + '_' + Date.now());
    doc.getBody().clear();
    isNewDoc = true;
  }
  const body = doc.getBody();

  // Append this image as a new page (page break before unless it's the first page)
  if(!isNewDoc) body.appendPageBreak();
  try {
    const blob = driveFile.getBlob();
    const para = body.appendParagraph('');
    const img = para.appendInlineImage(blob);
    if(img.getWidth() > A4_WIDTH){
      const ratio = A4_WIDTH / img.getWidth();
      img.setWidth(A4_WIDTH).setHeight(Math.round(img.getHeight() * ratio));
    }
  } catch(e){
    Logger.log('append image failed: ' + e);
    if(isNewDoc) try { DriveApp.getFileById(doc.getId()).setTrashed(true); } catch(_){}
    return { success: false, error: 'append_failed', detail: String(e) };
  }
  doc.saveAndClose();

  // Re-export Doc as PDF (replaces previous PDF)
  const pdfBlob = DriveApp.getFileById(doc.getId()).getAs(MimeType.PDF).setName(pdfName);
  const finalFolder = _ensureFolder(clientFolder, 'השלמת מסמכים');

  // Trash the previous PDF, if any
  if(req.mergedPdfId){
    try { DriveApp.getFileById(req.mergedPdfId).setTrashed(true); } catch(_){}
  }
  const newPdf = finalFolder.createFile(pdfBlob);
  try { newPdf.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(_){}

  return {
    success: true,
    pdfId: newPdf.getId(),
    pdfName: pdfName,
    pdfUrl: newPdf.getUrl(),
    docId: doc.getId()
  };
}

// ג”€ג”€ג”€ Action: approveItem ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
// Per-file approval. Each click approves ONE file in the requirement.
// When EVERY file in req.files becomes approved (and there's more than
// one), the script then auto-merges them into a single PDF, trashes
// the originals from Drive, and replaces req.files with [mergedPdf].
//
// User spec 2026-05-04: '׳¢׳•׳׳™׳ ׳©׳ ׳™ ׳”׳׳¡׳׳›׳™׳ ׳‘׳ ׳₪׳¨׳“ ׳•׳ ׳™׳×׳ ׳׳׳©׳¨ ׳׳•׳×׳ ׳‘׳ ׳₪׳¨׳“.
// ׳׳׳—׳¨ ׳©׳׳׳•׳©׳¨׳™׳ ׳›׳ ׳”׳׳¡׳׳›׳™׳ ׳”׳ ׳׳¦׳•׳¨׳₪׳™׳ ׳׳§׳•׳‘׳¥ pdf ׳׳—׳“ ׳•׳ ׳׳—׳§׳™׳ ׳™׳×׳¨
// ׳”׳׳¡׳׳›׳™׳ ׳’׳ ׳׳”׳×׳™׳§׳™׳™׳” ׳•׳’׳ ׳׳”׳¨׳™׳©׳•׳'.
function handleApproveItem(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('׳₪׳’ ׳×׳•׳§׳£ ׳”׳›׳ ׳™׳¡׳” ג€” ׳”׳×׳—׳‘׳¨ ׳׳—׳“׳©');
  const sheet = _sheet();
  const colMap = {reports: COL.CU_REPORTS, docs: COL.CV_DOCS, info: COL.CW_INFO, pre_order_docs: COL.CV_DOCS, signatures: COL.SIGS_DOCS};
  const cell = sheet.getRange(t.rowNum, colMap[p.category] || COL.CV_DOCS);
  const list = _parseList(cell.getValue());
  const req  = list.find(r => r.id === p.reqId);
  if(!req){ return {ok: true}; }

  const isDocs = (p.category === 'docs' || p.category === 'pre_order_docs');
  const clientName = (sheet.getRange(t.rowNum, COL.NAME).getValue() || '').toString().trim() || 'ללא שם';
  const root = DriveApp.getFolderById(DRIVE_ROOT_ID);
  const clientFolder = _ensureFolder(root, clientName);

  // Incremental merge per user 2026-05-04: each approve appends THIS
  // file (if image) to the growing PDF and trashes the original.
  // PDFs/other inputs are kept as separate approved entries.
  if(isDocs && p.fileId){
    let isImageMerged = false;
    if(req.mergedPdfId !== undefined || true){
      // Try image-merge path first
      const oldPdfId = req.mergedPdfId;
      const result = _appendFileToMergedPdf(req, p.fileId, clientFolder);
      if(result.success){
        // Trash the original (now baked into PDF)
        try { DriveApp.getFileById(p.fileId).setTrashed(true); } catch(_){}
        // Update req.files: remove THIS file entry + the old merged PDF
        // entry (if any) and add the new merged PDF
        req.files = (req.files || []).filter(f =>
          f.id !== p.fileId && f.id !== oldPdfId
        );
        req.files.push({
          id: result.pdfId,
          name: result.pdfName,
          url: result.pdfUrl,
          ts: Date.now(),
          approved: true,
          approvedAt: Date.now()
        });
        req.mergedPdfId = result.pdfId;
        req.mergedPdfName = result.pdfName;
        req.mergedPdfUrl = result.pdfUrl;
        req.mergedDocId = result.docId;
        req.mergedAt = Date.now();
        isImageMerged = true;
      }
    }

    // PDF / other input: just move to השלמת מסמכים, mark as approved (separate)
    if(!isImageMerged){
      try{
        const finalFolder = _ensureFolder(clientFolder, 'השלמת מסמכים');
        const driveFile   = DriveApp.getFileById(p.fileId);
        const sanitize = s => String(s||'').replace(/[\/\\?%*:|"<>]/g,'').trim().slice(0,120);
        const reqText = sanitize(req.text || '');
        if(reqText){
          const orig = driveFile.getName();
          const ext = (orig.match(/\.[^.\/\\]+$/) || [''])[0];
          const desiredName = reqText + ext;
          if(driveFile.getName() !== desiredName){
            try { driveFile.setName(desiredName); } catch(_){}
          }
        }
        const parents = driveFile.getParents();
        while(parents.hasNext()){
          const parent = parents.next();
          try{ parent.removeFile(driveFile); }catch(_){}
        }
        finalFolder.addFile(driveFile);
        try { driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(_) {}
        const fileEntry = (req.files||[]).find(f => f.id === p.fileId);
        if(fileEntry){
          fileEntry.approved   = true;
          fileEntry.approvedAt = Date.now();
          fileEntry.url        = driveFile.getUrl();
          fileEntry.name       = driveFile.getName();
        }
      }catch(e){ Logger.log('approve move failed: ' + e); }
    }
  }

  // Status: 'approved' iff every remaining file in req.files is approved
  const hasUnapproved = (req.files || []).some(f => !f.approved);
  req.status = hasUnapproved ? 'uploaded' : 'approved';
  if(!hasUnapproved){
    req.approvedAt = Date.now();
  }
  if(p.fileId) req.approvedFileId = p.fileId;
  cell.setValue(JSON.stringify(list));
  return {ok: true};
}

// ג”€ג”€ג”€ Action: rejectItem ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
function handleRejectItem(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('׳₪׳’ ׳×׳•׳§׳£ ׳”׳›׳ ׳™׳¡׳” ג€” ׳”׳×׳—׳‘׳¨ ׳׳—׳“׳©');
  const sheet = _sheet();
  const colMap = {reports: COL.CU_REPORTS, docs: COL.CV_DOCS, info: COL.CW_INFO, pre_order_docs: COL.CV_DOCS, signatures: COL.SIGS_DOCS};
  const cell = sheet.getRange(t.rowNum, colMap[p.category] || COL.CV_DOCS);
  const list = _parseList(cell.getValue());
  const req  = list.find(r => r.id === p.reqId);
  if(req){
    // Trash the file from Drive
    if(p.fileId){
      try{ DriveApp.getFileById(p.fileId).setTrashed(true); }catch(_){}
      if(req.files) req.files = req.files.filter(f => f.id !== p.fileId);
    }
    req.status = 'rejected';
    req.rejectionReason = p.reason || '';
    req.rejectedAt = Date.now();
    cell.setValue(JSON.stringify(list));
  }
  return {ok: true};
}

// ג”€ג”€ג”€ Action: unapproveItem ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
// Reverses an approval. For docs: physically move the file back from
// "השלמת מסמכים" to the pending bin "מסמכים ששלח הלקוח" and clear the
// locked/approved flags on the file entry.
function handleUnapproveItem(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('׳₪׳’ ׳×׳•׳§׳£ ׳”׳›׳ ׳™׳¡׳” ג€” ׳”׳×׳—׳‘׳¨ ׳׳—׳“׳©');
  const sheet = _sheet();
  const colMap = {reports: COL.CU_REPORTS, docs: COL.CV_DOCS, info: COL.CW_INFO, pre_order_docs: COL.CV_DOCS, signatures: COL.SIGS_DOCS};
  const cell = sheet.getRange(t.rowNum, colMap[p.category] || COL.CV_DOCS);
  const list = _parseList(cell.getValue());
  const req  = list.find(r => r.id === p.reqId);
  if(!req) return {ok: true};

  const isDocs = (p.category === 'docs' || p.category === 'pre_order_docs');
  // After per-file approval, req.status may not be 'approved' (e.g. only
  // one of two files approved). Allow unapprove of an individual file
  // regardless of overall status.
  const fileId = p.fileId;

  if(isDocs && fileId){
    // Move the file back to pending bin (works for merged PDF too ג€”
    // it now lives in השלמת מסמכים after merge; this moves it back).
    try{
      const clientName = (sheet.getRange(t.rowNum, COL.NAME).getValue() || '').toString().trim() || 'ללא שם';
      const root = DriveApp.getFolderById(DRIVE_ROOT_ID);
      const clientFolder  = _ensureFolder(root, clientName);
      const pendingFolder = _ensureFolder(clientFolder, 'מסמכים ששלח הלקוח');
      const driveFile     = DriveApp.getFileById(fileId);
      const parents = driveFile.getParents();
      while(parents.hasNext()){
        const parent = parents.next();
        try{ parent.removeFile(driveFile); }catch(_){}
      }
      pendingFolder.addFile(driveFile);
      const fileEntry = (req.files||[]).find(f => f.id === fileId);
      if(fileEntry){
        delete fileEntry.approved;
        delete fileEntry.locked;
        delete fileEntry.approvedAt;
        fileEntry.url = driveFile.getUrl();
      }
    }catch(e){ Logger.log('unapprove move failed: ' + e); }
  }

  // Re-derive overall status: 'approved' iff all files still approved
  const files = req.files || [];
  const allApproved = files.length > 0 && files.every(f => f.approved);
  req.status = allApproved ? 'approved' : (files.length ? 'uploaded' : 'pending');
  if(!allApproved){
    delete req.approvedAt;
    delete req.approvedFileId;
  }
  // Note: req.mergedPdfId stays set even after unapprove ג€” the merged
  // PDF still exists in Drive (now back in pending bin). User can
  // re-approve it (single-file flow) or reject it (trashes the PDF).
  cell.setValue(JSON.stringify(list));
  return {ok: true};
}

// ג”€ג”€ג”€ Action: sendInquiry ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
// Stores a client inquiry in column CZ (1-based 136)
function handleSendInquiry(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('׳₪׳’ ׳×׳•׳§׳£ ׳”׳›׳ ׳™׳¡׳” ג€” ׳”׳×׳—׳‘׳¨ ׳׳—׳“׳©');
  const sheet = _sheet();
  const CZ_INQUIRIES = 136;
  const cell = sheet.getRange(t.rowNum, CZ_INQUIRIES);
  const list = _parseList(cell.getValue());
  const entry = {
    id:      Utilities.getUuid(),
    context: p.context || '׳›׳׳׳™',
    message: p.message || '',
    ts:      Date.now(),
    done:    false,
  };
  if(Array.isArray(p.slots) && p.slots.length) entry.slots = p.slots;
  list.push(entry);
  cell.setValue(JSON.stringify(list));
  return {ok: true};
}

// ג”€ג”€ג”€ Action: createCalendarEvent ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€
function handleCreateCalendarEvent(p){
  const title = p.title || '׳₪׳’׳™׳©׳”';
  const start = new Date(p.start);
  const end   = new Date(p.end);
  const description = p.description || '';
  const cal = CalendarApp.getDefaultCalendar();
  const event = cal.createEvent(title, start, end, {description});
  return { eventId: event.getId() };
}
