/**
 * Apps Script backend for the customer-facing app.
 *
 * Deploy as a Web App:
 *   - Deploy → New deployment → type: Web app
 *   - Execute as: Me (your email)
 *   - Who has access: Anyone
 *
 * Copy the Web App URL and paste it into the customer app's
 * CONFIG.API_URL (in customers/index.html).
 *
 * Endpoints (POST with JSON body, "action" field):
 *   - login       { username, password }
 *   - getRequests { token }
 *   - uploadFile  { token, category, reqId, reportNum?, filename, mimeType, dataBase64 }
 *   - submitAnswer{ token, reqId, answer }
 *   - removeFile  { token, category, reqId, fileId }
 */

// ─── CONFIG ─────────────────────────────────────────────────────────
const SHEET_ID = '1ixQ0iImkxI1YiTrX_dFsSxVTISUyfCEYpKt1C2EWtLE';
const DRIVE_ROOT_ID = '1RitBIq8HXTVymhalA34HS4BRyfOzT6lq'; // חדלפ folder

// 1-based column indexes (W=23 etc)
const COL = {
  NAME:      23,  // W — client name
  CR_USER:   96,  // CR — username (national ID)
  CS_PASS:   97,  // CS — password
  CT_ACTIVE: 98,  // CT — TRUE/FALSE
  CU_REPORTS:99,  // CU — JSON list (reports docs)
  CV_DOCS:  100,  // CV — JSON list (supplemental docs)
  CW_INFO:  101,  // CW — JSON list (info questions)
};

// ─── HTTP entrypoints ────────────────────────────────────────────────
function doPost(e){
  try{
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    let result;
    if(action === 'login')         result = handleLogin(body);
    else if(action === 'getRequests')  result = handleGetRequests(body);
    else if(action === 'uploadFile')   result = handleUploadFile(body);
    else if(action === 'submitAnswer') result = handleSubmitAnswer(body);
    else if(action === 'removeFile')   result = handleRemoveFile(body);
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
  for(let i=1; i<data.length; i++){  // skip header
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
  try{
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  }catch(_){ return []; }
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
  const name = found.row[COL.NAME-1] || '';
  return {
    user: {
      rowNum: found.rowNum,
      name: name.toString(),
      username: username.trim(),
      token: _makeToken(found.rowNum, username),
    }
  };
}

// ─── Action: getRequests ─────────────────────────────────────────────
function handleGetRequests(body){
  const t = _verifyToken(body.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
  const sheet = _sheet();
  const row = sheet.getRange(t.rowNum, 1, 1, COL.CW_INFO).getValues()[0];
  return {
    reports: _parseList(row[COL.CU_REPORTS-1]),
    docs:    _parseList(row[COL.CV_DOCS-1]),
    info:    _parseList(row[COL.CW_INFO-1]),
    name:    row[COL.NAME-1] || ''
  };
}

// ─── Action: uploadFile ──────────────────────────────────────────────
function handleUploadFile(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
  const sheet = _sheet();
  const clientName = (sheet.getRange(t.rowNum, COL.NAME).getValue() || '').toString().trim() || 'ללא שם';

  // Walk: חדלפ → [client] → מסמכים שהתקבלו מהלקוח → (category subdir)
  const root = DriveApp.getFolderById(DRIVE_ROOT_ID);
  const clientFolder = _ensureFolder(root, clientName);
  const inboxFolder = _ensureFolder(clientFolder, 'מסמכים שהתקבלו מהלקוח');
  let target;
  if(p.category === 'reports'){
    const reportsRoot = _ensureFolder(inboxFolder, 'מסמכי דוחות');
    target = _ensureFolder(reportsRoot, 'דוח ' + (p.reportNum || '?'));
  } else if(p.category === 'docs'){
    const docsRoot = _ensureFolder(inboxFolder, 'השלמת מסמכים');
    target = _ensureFolder(docsRoot, 'השלמה נוספת');
  } else if(p.category === 'info'){
    target = _ensureFolder(inboxFolder, 'השלמת פרטים');
  } else {
    throw new Error('קטגוריה לא תקינה');
  }

  // Save the file
  const blob = Utilities.newBlob(
    Utilities.base64Decode(p.dataBase64),
    p.mimeType || 'application/octet-stream',
    p.filename || 'file'
  );
  const file = target.createFile(blob);

  // Update the requirement entry in the sheet
  const colMap = {reports: COL.CU_REPORTS, docs: COL.CV_DOCS, info: COL.CW_INFO};
  const colIdx = colMap[p.category];
  const cell = sheet.getRange(t.rowNum, colIdx);
  const list = _parseList(cell.getValue());
  const req = list.find(r => r.id === p.reqId);
  if(req){
    if(!req.files) req.files = [];
    req.files.push({
      id: file.getId(),
      name: file.getName(),
      url: file.getUrl(),
      ts: Date.now(),
    });
    if(req.status === 'pending' || req.status === 'rejected') req.status = 'uploaded';
    cell.setValue(JSON.stringify(list));
  }

  return { fileId: file.getId(), fileUrl: file.getUrl(), fileName: file.getName() };
}

// ─── Action: submitAnswer (info questions) ───────────────────────────
function handleSubmitAnswer(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
  const sheet = _sheet();
  const cell = sheet.getRange(t.rowNum, COL.CW_INFO);
  const list = _parseList(cell.getValue());
  const req = list.find(r => r.id === p.reqId);
  if(!req) throw new Error('פריט לא נמצא');
  req.answer = String(p.answer || '');
  req.status = 'uploaded';
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
  const cell = sheet.getRange(t.rowNum, colMap[p.category]);
  const list = _parseList(cell.getValue());
  const req = list.find(r => r.id === p.reqId);
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
