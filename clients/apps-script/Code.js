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
  NAME:           24,   // X — canonical client display name (per user 2026-05-04)
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
    else if(action === 'closeReport')       result = handleCloseReport(body);
    else if(action === 'createCalendarEvent') result = handleCreateCalendarEvent(body);
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
        req.files.forEach(f => {
          // Skip files already individually approved — they'll appear in
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
    reports, docs, info,
    docsRequired, docsApproved,
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

  // Two-stage flow:
  //   Pending review → "מסמכים ששלח הלקוח" (pending bin)
  //   After approval → "השלמת מסמכים" (final, locked)
  // Reports and info still use the old per-stage subfolders.
  const root = DriveApp.getFolderById(DRIVE_ROOT_ID);
  const clientFolder = _ensureFolder(root, clientName);
  let target;
  if(p.category === 'reports'){
    const inboxFolder = _ensureFolder(clientFolder, 'מסמכים שהתקבלו מהלקוח');
    const reportsRoot = _ensureFolder(inboxFolder, 'מסמכי דוחות');
    target = _ensureFolder(reportsRoot, 'דוח ' + (p.reportNum || '?'));
  } else if(p.category === 'docs'){
    // PENDING bin — stays here until lawyer approves; then file moves to השלמת מסמכים
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
  // like "תלוש שכר אחרון.pdf" instead of "040526113200_תלוש שכר אחרון.pdf".
  const sanitize = s => String(s||'').replace(/[\/\\?%*:|"<>]/g,'').trim().slice(0,120);
  const reqLabel = sanitize(p.reqText || '');
  const fallback = sanitize(p.filename || 'file');
  // Preserve the extension from p.filename if present, otherwise infer
  // from mimeType (image/jpeg → .jpg, application/pdf → .pdf, …).
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
  const file = req.files.find(f => f.id === p.fileId);
  // LOCK: an approved file cannot be removed by the client.
  if(file && (file.locked || file.approvedAt)){
    throw new Error('הקובץ כבר אושר ולא ניתן להסירו');
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

// ─── Action: closeReport ─────────────────────────────────────────────
function handleCloseReport(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
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

// ─── Action: saveQuestionnaire ───────────────────────────────────────
function handleSaveQuestionnaire(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
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
  const sheetName    = 'שאלון — ' + clientName;

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
    { title: 'פרטים אישיים', rows: [
      ['שם משפחה', d.last_name], ['שם פרטי', d.first_name],
      ['מספר ת.ז', d.id], ['תאריך לידה', d.dob],
      ['מין', d.gender], ['מצב משפחתי', d.marital],
      ['ארץ לידה', d.birth_country], ['תאריך עלייה', d.aliya_date],
      ['כתובת', d.address], ['מיקוד', d.zip],
      ['חדרים', d.apt_rooms], ['זכויות בדירה', d.apt_rights],
      ['טלפון', d.phone], ['אימייל', d.email],
    ]},
    { title: 'פרטי בן/בת זוג', rows: [
      ['שם משפחה', d.spouse_last], ['שם פרטי', d.spouse_first],
      ['ת.ז', d.spouse_id], ['תאריך לידה', d.spouse_dob],
      ['טלפון', d.spouse_phone],
    ]},
    { title: 'תעסוקה', rows: [
      ['עיסוק', d.occupation], ['מעסיק', d.employer],
      ['כתובת עבודה', d.work_address], ['תאריך תחילת עבודה', d.work_start],
      ['משכורת ברוטו', d.salary_gross], ['משכורת נטו', d.salary_net],
      ['מעסיק בן/בת זוג', d.spouse_employer],
      ['משכורת בן/בת זוג ברוטו', d.spouse_salary_gross],
      ['משכורת בן/בת זוג נטו', d.spouse_salary_net],
      ['קצבת ילדים', d.child_allowance], ['נכות', d.disability],
    ]},
    { title: 'הוצאות', rows: [
      ['שכר דירה', d.rent], ['ארנונה', d.arnona],
      ['חשמל', d.electric], ['מים', d.water], ['גז', d.gas],
      ['מזון', d.food], ['רכב', d.car], ['הלבשה', d.clothing],
      ['חינוך', d.education], ['אחר', d.other_exp],
    ]},
    { title: 'נכסים', rows: [
      ['רכבים', d.cars], ['חשבונות בנק', d.banks],
      ['נדלן', d.realestate],
    ]},
  ];

  let row = 1;
  // Title row
  ws.getRange(row, 1, 1, 2).merge().setValue('שאלון לקוח — ' + clientName)
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
    ws.getRange(row, 1, 1, 4).merge().setValue('ילדים')
      .setFontSize(12).setFontWeight('bold')
      .setBackground('#3a5ba0').setFontColor('#ffffff');
    row++;
    ws.getRange(row, 1).setValue('שם משפחה').setFontWeight('bold').setBackground('#e8edf5');
    ws.getRange(row, 2).setValue('שם פרטי').setFontWeight('bold').setBackground('#e8edf5');
    ws.getRange(row, 3).setValue('ת.ז').setFontWeight('bold').setBackground('#e8edf5');
    ws.getRange(row, 4).setValue('תאריך לידה').setFontWeight('bold').setBackground('#e8edf5');
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
    ws.getRange(row, 1, 1, 4).merge().setValue('נושים')
      .setFontSize(12).setFontWeight('bold')
      .setBackground('#3a5ba0').setFontColor('#ffffff');
    row++;
    ws.getRange(row, 1).setValue('שם נושה').setFontWeight('bold').setBackground('#e8edf5');
    ws.getRange(row, 2).setValue('סוג').setFontWeight('bold').setBackground('#e8edf5');
    ws.getRange(row, 3).setValue('סכום ₪').setFontWeight('bold').setBackground('#e8edf5');
    ws.getRange(row, 4).setValue('מצב').setFontWeight('bold').setBackground('#e8edf5');
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

// ─── Action: getQuestionnaire ────────────────────────────────────────
function handleGetQuestionnaire(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
  const sheet = _sheet();
  const raw = sheet.getRange(t.rowNum, COL.CY_QUEST).getValue();
  return { data: _parseObj(raw) };
}

// ─── Helper: merge multiple files in a requirement into a single PDF ──
// Builds a temporary Google Doc, appends each image as one page, then
// exports the Doc as PDF and saves it to "השלמת מסמכים" with the
// requirement text as filename (sanitized + ".pdf"). Returns metadata
// about the merged PDF or { success: false } on failure.
//
// PDFs in the input are skipped from the merge for now (would need
// Drive.Files.copy + convert which adds complexity). They stay in
// the pending folder as backup, visible separately.
function _mergeReqFilesToPdf(req, clientFolder){
  const sanitize = s => String(s||'').replace(/[\/\\?%*:|"<>]/g,'').trim().slice(0,120) || 'מסמך';
  const pdfName = sanitize(req.text || 'מסמך') + '.pdf';

  const tempDocName = '_merge_temp_' + Date.now();
  const tempDoc = DocumentApp.create(tempDocName);
  const body = tempDoc.getBody();
  body.clear();

  let pageCount = 0;
  const skipped = [];
  // A4 portrait is ~595pt wide; with default margins ~520pt content area
  const A4_WIDTH = 520;

  (req.files || []).forEach((f, idx) => {
    try {
      const driveFile = DriveApp.getFileById(f.id);
      const mime = driveFile.getMimeType() || '';

      if(mime.indexOf('image/') === 0){
        // Image: insert as a page
        if(pageCount > 0) body.appendPageBreak();
        const blob = driveFile.getBlob();
        const para = body.appendParagraph('');
        const img = para.appendInlineImage(blob);
        // Compress: scale down to fit A4 width (preserves aspect ratio)
        if(img.getWidth() > A4_WIDTH){
          const ratio = A4_WIDTH / img.getWidth();
          img.setWidth(A4_WIDTH).setHeight(Math.round(img.getHeight() * ratio));
        }
        pageCount++;
      } else {
        // PDF or other: skip for now
        skipped.push({id: f.id, name: f.name, mime});
      }
    } catch(e){
      Logger.log('merge: skip file ' + f.id + ' — ' + e);
      skipped.push({id: f.id, name: f.name, error: String(e)});
    }
  });

  if(pageCount === 0){
    // Nothing to merge; clean up temp doc
    try { DriveApp.getFileById(tempDoc.getId()).setTrashed(true); } catch(_){}
    return { success: false, error: 'no_mergeable_files', skipped };
  }

  tempDoc.saveAndClose();

  // Convert temp Doc to PDF blob
  const docFile = DriveApp.getFileById(tempDoc.getId());
  const pdfBlob = docFile.getAs(MimeType.PDF).setName(pdfName);

  const finalFolder = _ensureFolder(clientFolder, 'השלמת מסמכים');
  const mergedPdf = finalFolder.createFile(pdfBlob);
  try { mergedPdf.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(_){}

  // Trash the temp Doc
  try { docFile.setTrashed(true); } catch(_){}

  return {
    success: true,
    pdfId: mergedPdf.getId(),
    pdfName: pdfName,
    pdfUrl: mergedPdf.getUrl(),
    pageCount,
    skipped
  };
}

// ─── Action: approveItem ─────────────────────────────────────────────
// Per-file approval. Each click approves ONE file in the requirement.
// When EVERY file in req.files becomes approved (and there's more than
// one), the script then auto-merges them into a single PDF, trashes
// the originals from Drive, and replaces req.files with [mergedPdf].
//
// User spec 2026-05-04: 'עולים שני המסמכים בנפרד וניתן לאשר אותם בנפרד.
// לאחר שמאושרים כל המסמכים הם מצורפים לקובץ pdf אחד ונמחקים יתר
// המסמכים גם מהתיקייה וגם מהרישום'.
function handleApproveItem(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
  const sheet = _sheet();
  const colMap = {reports: COL.CU_REPORTS, docs: COL.CV_DOCS, info: COL.CW_INFO, pre_order_docs: COL.CV_DOCS};
  const cell = sheet.getRange(t.rowNum, colMap[p.category] || COL.CV_DOCS);
  const list = _parseList(cell.getValue());
  const req  = list.find(r => r.id === p.reqId);
  if(!req){ return {ok: true}; }

  const isDocs = (p.category === 'docs' || p.category === 'pre_order_docs');

  // Step 1: approve THIS file — move it from pending → השלמת מסמכים
  if(isDocs && p.fileId){
    try{
      const clientName = (sheet.getRange(t.rowNum, COL.NAME).getValue() || '').toString().trim() || 'ללא שם';
      const root = DriveApp.getFolderById(DRIVE_ROOT_ID);
      const clientFolder = _ensureFolder(root, clientName);
      const finalFolder  = _ensureFolder(clientFolder, 'השלמת מסמכים');
      const driveFile    = DriveApp.getFileById(p.fileId);
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
      }
    }catch(e){ Logger.log('approve move failed: ' + e); }
  }

  // Step 2: are ALL files in req now approved?
  const files = req.files || [];
  const allApproved = files.length > 0 && files.every(f => f.approved);

  // Step 3: if multiple files all approved → merge + delete originals
  if(isDocs && allApproved && files.length > 1){
    try {
      const clientName = (sheet.getRange(t.rowNum, COL.NAME).getValue() || '').toString().trim() || 'ללא שם';
      const root = DriveApp.getFolderById(DRIVE_ROOT_ID);
      const clientFolder = _ensureFolder(root, clientName);
      const result = _mergeReqFilesToPdf(req, clientFolder);
      if(result.success){
        // Trash originals from Drive (they're now baked into the PDF)
        files.forEach(f => {
          try { DriveApp.getFileById(f.id).setTrashed(true); } catch(_){}
        });
        // Replace req.files with a single entry — the merged PDF
        req.files = [{
          id: result.pdfId,
          name: result.pdfName,
          url: result.pdfUrl,
          ts: Date.now(),
          approved: true,
          approvedAt: Date.now()
        }];
        req.mergedPdfId = result.pdfId;
        req.mergedPdfName = result.pdfName;
        req.mergedPdfUrl = result.pdfUrl;
        req.mergedAt = Date.now();
      }
    } catch(e){ Logger.log('all-approved merge failed: ' + e); }
  }
  // Step 4: also produce a 1-page PDF if a single approved file is an
  // image (per user: 'גם מסמך בודד שאני שולח כתמונה עובר ל-PDF')
  else if(isDocs && allApproved && files.length === 1 && !req.mergedPdfId){
    try {
      const onlyFile = files[0];
      const driveFile = DriveApp.getFileById(onlyFile.id);
      const mime = driveFile.getMimeType() || '';
      if(mime.indexOf('image/') === 0){
        const clientName = (sheet.getRange(t.rowNum, COL.NAME).getValue() || '').toString().trim() || 'ללא שם';
        const root = DriveApp.getFolderById(DRIVE_ROOT_ID);
        const clientFolder = _ensureFolder(root, clientName);
        const result = _mergeReqFilesToPdf(req, clientFolder);
        if(result.success){
          // Trash the original image
          try { driveFile.setTrashed(true); } catch(_){}
          req.files = [{
            id: result.pdfId,
            name: result.pdfName,
            url: result.pdfUrl,
            ts: Date.now(),
            approved: true,
            approvedAt: Date.now()
          }];
          req.mergedPdfId = result.pdfId;
          req.mergedPdfName = result.pdfName;
          req.mergedPdfUrl = result.pdfUrl;
          req.mergedAt = Date.now();
        }
      } else {
        // Single PDF/other — just rename to req.text + ext (existing behavior)
        const sanitize = s => String(s||'').replace(/[\/\\?%*:|"<>]/g,'').trim().slice(0,120);
        const reqText = sanitize(req.text || '');
        if(reqText){
          const orig = driveFile.getName();
          const ext = (orig.match(/\.[^.\/\\]+$/) || [''])[0];
          const desiredName = reqText + ext;
          if(driveFile.getName() !== desiredName){
            try { driveFile.setName(desiredName); onlyFile.name = desiredName; } catch(_){}
          }
        }
      }
    } catch(e){ Logger.log('single-image merge failed: ' + e); }
  }

  // Step 5: update req.status — only flip to 'approved' once all files done
  if(allApproved){
    req.status = 'approved';
    req.approvedAt = Date.now();
  }
  // else: leave status='uploaded' so the still-pending file shows in pending list
  if(p.fileId) req.approvedFileId = p.fileId;
  cell.setValue(JSON.stringify(list));
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
// Reverses an approval. For docs: physically move the file back from
// "השלמת מסמכים" to the pending bin "מסמכים ששלח הלקוח" and clear the
// locked/approved flags on the file entry.
function handleUnapproveItem(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
  const sheet = _sheet();
  const colMap = {reports: COL.CU_REPORTS, docs: COL.CV_DOCS, info: COL.CW_INFO, pre_order_docs: COL.CV_DOCS};
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
    // Move the file back to pending bin (works for merged PDF too —
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
  // Note: req.mergedPdfId stays set even after unapprove — the merged
  // PDF still exists in Drive (now back in pending bin). User can
  // re-approve it (single-file flow) or reject it (trashes the PDF).
  cell.setValue(JSON.stringify(list));
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
  const entry = {
    id:      Utilities.getUuid(),
    context: p.context || 'כללי',
    message: p.message || '',
    ts:      Date.now(),
    done:    false,
  };
  if(Array.isArray(p.slots) && p.slots.length) entry.slots = p.slots;
  list.push(entry);
  cell.setValue(JSON.stringify(list));
  return {ok: true};
}

// ─── Action: createCalendarEvent ─────────────────────────────────────
function handleCreateCalendarEvent(p){
  const title = p.title || 'פגישה';
  const start = new Date(p.start);
  const end   = new Date(p.end);
  const description = p.description || '';
  const cal = CalendarApp.getDefaultCalendar();
  const event = cal.createEvent(title, start, end, {description});
  return { eventId: event.getId() };
}
