/**
 * Apps Script backend for the customer-facing app.
 *
 * Deploy as a Web App:
 *   - Deploy → New deployment → type: Web app
 *   - Execute as: Me (your email)
 *   - Who has access: Anyone
 *
 * Endpoints (POST with JSON body, "action" field):
 *   - login              { username, password }
 *   - getRequests        { token }
 *   - uploadFile         { token, category, reqId, reportNum?, filename, mimeType, dataBase64 }
 *   - submitAnswer       { token, reqId, answer }
 *   - removeFile         { token, category, reqId, fileId }
 *   - saveQuestionnaire  { token, data }           ← NEW
 *   - getQuestionnaire   { token }                 ← NEW
 */

// ─── CONFIG ─────────────────────────────────────────────────────────
const SHEET_ID = '1ixQ0iImkxI1YiTrX_dFsSxVTISUyfCEYpKt1C2EWtLE';
const DRIVE_ROOT_ID = '1RitBIq8HXTVymhalA34HS4BRyfOzT6lq';

// 1-based column indexes
const COL = {
  NAME:           23,   // W
  CR_USER:        96,   // CR — username
  CS_PASS:        97,   // CS — password
  CT_ACTIVE:      98,   // CT — TRUE/FALSE
  CU_REPORTS:     99,   // CU — JSON (reports docs)
  CV_DOCS:       100,   // CV — JSON (supplemental docs)
  CW_INFO:       101,   // CW — JSON (info questions)
  CX_STAGE:      133,   // EC (0-based 132) — stage: '' | 'pre_order' | 'commercial'
  CY_QUEST:      134,   // ED (0-based 133) — questionnaire JSON (form 45 data)
  CZ_INQUIRIES:  136,   // EF — client inquiries JSON array
};

// ─── HTTP entrypoints ────────────────────────────────────────────────
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

// ─── Helpers ─────────────────────────────────────────────────────────
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

// ─── Action: login ───────────────────────────────────────────────────
function handleLogin(body){
  const username = body.username, password = body.password;
  if(!username || !password) throw new Error('הזן שם משתמש וסיסמה');
  const found = _findRowByCreds(username, password);
  if(!found) throw new Error('שם משתמש או סיסמה שגויים, או שחיבור לקוח לא הופעל');
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

// ─── Action: getRequests ─────────────────────────────────────────────
function handleGetRequests(body){
  const t = _verifyToken(body.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
  const sheet = _sheet();
  const row = sheet.getRange(t.rowNum, 1, 1, COL.CY_QUEST).getValues()[0];
  const stage = (row[COL.CX_STAGE-1] || '').toString().trim().toLowerCase();

  const reports = _parseList(row[COL.CU_REPORTS-1]);
  const docs    = _parseList(row[COL.CV_DOCS-1]);
  const info    = _parseList(row[COL.CW_INFO-1]);

  const pending = [], rejections = [];
  const _collect = (list, category) => {
    list.forEach(req => {
      const rn = req.reportNum || null;
      if(req.status === 'uploaded' && Array.isArray(req.files)){
        req.files.forEach(f => pending.push({
          reqId: req.id, reqText: req.text||'', category, reportNum: rn,
          fileId: f.id, name: f.name, url: f.url, ts: f.ts
        }));
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

  return {
    reports, docs, info,
    name:    row[COL.NAME-1] || '',
    stage:   stage,
    questionnaire: _parseObj(row[COL.CY_QUEST-1]),
    pending, rejections,
  };
}

// ─── Action: uploadFile ──────────────────────────────────────────────
function handleUploadFile(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
  const sheet = _sheet();
  const clientName = (sheet.getRange(t.rowNum, COL.NAME).getValue() || '').toString().trim() || 'ללא שם';

  const root = DriveApp.getFolderById(DRIVE_ROOT_ID);
  const clientFolder = _ensureFolder(root, clientName);
  const inboxFolder  = _ensureFolder(clientFolder, 'מסמכים שהתקבלו מהלקוח');
  let target;
  if(p.category === 'reports'){
    const reportsRoot = _ensureFolder(inboxFolder, 'מסמכי דוחות');
    target = _ensureFolder(reportsRoot, 'דוח ' + (p.reportNum || '?'));
  } else if(p.category === 'docs'){
    const docsRoot = _ensureFolder(inboxFolder, 'השלמת מסמכים');
    target = _ensureFolder(docsRoot, 'השלמה נוספת');
  } else if(p.category === 'info'){
    target = _ensureFolder(inboxFolder, 'השלמת פרטים');
  } else if(p.category === 'pre_order_docs'){
    const poRoot = _ensureFolder(inboxFolder, 'מסמכי צו פתיחה');
    target = poRoot;
  } else {
    throw new Error('קטגוריה לא תקינה');
  }

  // Filename with timestamp: ddmmyyHHMMSS_original.ext
  const now = new Date();
  const pad2 = n => String(n).padStart(2,'0');
  const ts = pad2(now.getDate()) + pad2(now.getMonth()+1) + String(now.getFullYear()).slice(-2)
           + pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds());
  const origName = p.filename || 'file';
  const stampedName = ts + '_' + origName;

  const blob = Utilities.newBlob(
    Utilities.base64Decode(p.dataBase64),
    p.mimeType || 'application/octet-stream',
    stampedName
  );
  const file = target.createFile(blob);

  // Update requirement entry in sheet
  const colMap = {reports: COL.CU_REPORTS, docs: COL.CV_DOCS, info: COL.CW_INFO, pre_order_docs: COL.CV_DOCS};
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

// ─── Action: submitAnswer ────────────────────────────────────────────
function handleSubmitAnswer(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
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

// ─── Action: removeFile ──────────────────────────────────────────────
function handleRemoveFile(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
  const sheet = _sheet();
  const colMap = {reports: COL.CU_REPORTS, docs: COL.CV_DOCS, info: COL.CW_INFO};
  const cell   = sheet.getRange(t.rowNum, colMap[p.category] || COL.CV_DOCS);
  const list   = _parseList(cell.getValue());
  const req    = list.find(r => r.id === p.reqId);
  if(!req || !req.files) return {ok:true};
  const idx = req.files.findIndex(f => f.id === p.fileId);
  if(idx >= 0){
    try{ DriveApp.getFileById(p.fileId).setTrashed(true); }catch(_){}
    req.files.splice(idx, 1);
    if(!req.files.length && req.status === 'uploaded') req.status = 'pending';
    cell.setValue(JSON.stringify(list));
  }
  return {ok: true};
}

// ─── Action: saveQuestionnaire ───────────────────────────────────────
function handleSaveQuestionnaire(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
  if(!p.data || typeof p.data !== 'object') throw new Error('נתוני שאלון חסרים');
  p.data._savedAt = new Date().toISOString();
  const sheet = _sheet();
  sheet.getRange(t.rowNum, COL.CY_QUEST).setValue(JSON.stringify(p.data));
  return {ok: true};
}

// ─── Action: getQuestionnaire ────────────────────────────────────────
function handleGetQuestionnaire(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
  const sheet = _sheet();
  const raw = sheet.getRange(t.rowNum, COL.CY_QUEST).getValue();
  return { data: _parseObj(raw) };
}

// ─── Action: approveItem ─────────────────────────────────────────────
function handleApproveItem(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
  const sheet = _sheet();
  const colMap = {reports: COL.CU_REPORTS, docs: COL.CV_DOCS, info: COL.CW_INFO, pre_order_docs: COL.CV_DOCS};
  const cell = sheet.getRange(t.rowNum, colMap[p.category] || COL.CV_DOCS);
  const list = _parseList(cell.getValue());
  const req  = list.find(r => r.id === p.reqId);
  if(req){
    req.status = 'approved';
    req.approvedAt = Date.now();
    if(p.fileId) req.approvedFileId = p.fileId;
    cell.setValue(JSON.stringify(list));
  }
  return {ok: true};
}

// ─── Action: rejectItem ──────────────────────────────────────────────
function handleRejectItem(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
  const sheet = _sheet();
  const colMap = {reports: COL.CU_REPORTS, docs: COL.CV_DOCS, info: COL.CW_INFO, pre_order_docs: COL.CV_DOCS};
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

// ─── Action: unapproveItem ───────────────────────────────────────────
function handleUnapproveItem(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
  const sheet = _sheet();
  const colMap = {reports: COL.CU_REPORTS, docs: COL.CV_DOCS, info: COL.CW_INFO, pre_order_docs: COL.CV_DOCS};
  const cell = sheet.getRange(t.rowNum, colMap[p.category] || COL.CV_DOCS);
  const list = _parseList(cell.getValue());
  const req  = list.find(r => r.id === p.reqId);
  if(req && req.status === 'approved'){
    req.status = req.files && req.files.length ? 'uploaded' : 'pending';
    delete req.approvedAt;
    delete req.approvedFileId;
    cell.setValue(JSON.stringify(list));
  }
  return {ok: true};
}

// ─── Action: sendInquiry ─────────────────────────────────────────────
// Stores a client inquiry in column CZ (1-based 136)
function handleSendInquiry(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
  const sheet = _sheet();
  const CZ_INQUIRIES = 136;
  const cell = sheet.getRange(t.rowNum, CZ_INQUIRIES);
  const list = _parseList(cell.getValue());
  list.push({
    id:      Utilities.getUuid(),
    context: p.context || 'כללי',
    message: p.message || '',
    ts:      Date.now(),
    done:    false,
  });
  cell.setValue(JSON.stringify(list));
  return {ok: true};
}
