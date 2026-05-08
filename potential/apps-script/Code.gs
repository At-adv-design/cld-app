/**
 * Apps Script backend for the POTENTIAL CLIENTS portal.
 * Same structure as the insolvency clients portal but:
 *   - Points to the "לקוחות פוטנציאליים" sheet
 *   - handleLogin supports self-registration (ID + chosen password)
 *   - Stage is always 'pre_order'
 */

const SHEET_ID      = '1UNN3eJts5Wv3G_pL_R6gFMQ1ppxeGLZCbMctMTe3tzQ';
const DRIVE_ROOT_ID = '1RitBIq8HXTVymhalA34HS4BRyfOzT6lq';

const COL = {
  NAME:          23,   // W (1-based) — client display name (canonical)
  CR_USER:       96,   // CR — username (ID number)
  CS_PASS:       97,   // CS — password
  CT_ACTIVE:     98,   // CT — TRUE/FALSE
  CU_REPORTS:    99,   // CU — reports JSON (unused for potential)
  CV_DOCS:      100,   // CV — docs JSON
  CW_INFO:      101,   // CW — info questions JSON
  CX_STAGE:     133,   // EC — always 'pre_order'
  CY_QUEST:     134,   // ED — questionnaire JSON
  CZ_INQUIRIES: 136,   // EF — inquiries JSON
};

function doPost(e){
  try{
    const body   = JSON.parse(e.postData.contents);
    const action = body.action;
    let result;
    if     (action === 'login')             result = handleLogin(body);
    else if(action === 'getRequests')       result = handleGetRequests(body);
    else if(action === 'uploadFile')        result = handleUploadFile(body);
    else if(action === 'submitAnswer')      result = handleSubmitAnswer(body);
    else if(action === 'removeFile')        result = handleRemoveFile(body);
    else if(action === 'saveQuestionnaire') result = handleSaveQuestionnaire(body);
    else if(action === 'getQuestionnaire')  result = handleGetQuestionnaire(body);
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
  return ContentService.createTextOutput(JSON.stringify({ok:true, msg:'Potential clients API alive'}))
    .setMimeType(ContentService.MimeType.JSON);
}

function _sheet(){ return SpreadsheetApp.openById(SHEET_ID).getSheets()[0]; }

function _parseList(raw){
  if(!raw) return [];
  try{ const v=JSON.parse(raw); return Array.isArray(v)?v:[]; }catch(_){return [];}
}
function _parseObj(raw){
  if(!raw) return null;
  try{ return JSON.parse(raw); }catch(_){return null;}
}
function _makeToken(rowNum, username){
  return _jwtSign({rowNum: rowNum, username: String(username || '').trim()});
}
function _verifyToken(token){
  const payload = _jwtVerify(token);
  if(!payload) return null;
  const rowNum = parseInt(payload.rowNum, 10);
  if(!rowNum || rowNum < 2) return null;
  return {rowNum: rowNum, username: payload.username || ''};
}
function _ensureFolder(parent, name){
  const it = parent.getFoldersByName(name);
  if(it.hasNext()) return it.next();
  return parent.createFolder(name);
}

// ── Login / Self-Registration ──────────────────────────────────────
// First call with a new ID creates the account automatically.
function handleLogin(body){
  const username = (body.username||'').toString().trim();
  const password = (body.password||'').toString().trim();
  if(!username || !password) throw new Error('הזן מספר תעודת זהות וסיסמה');

  const sheet = _sheet();
  const data  = sheet.getDataRange().getValues();

  // Search for existing user (skip header row)
  for(let i=1; i<data.length; i++){
    const u = (data[i][COL.CR_USER-1]||'').toString().trim();
    if(u !== username) continue;
    const stored = (data[i][COL.CS_PASS-1]||'').toString();
    if(!_verifyPassword(password, stored)) throw new Error('סיסמה שגויה');
    // Auto-upgrade legacy plain-text passwords to hashed format on login.
    if(!_isHashedFormat(stored)){
      try{ sheet.getRange(i+1, COL.CS_PASS).setValue(_hashPassword(password)); }catch(_){}
    }
    const name = (data[i][COL.NAME-1]||'').toString().trim();
    return {
      user:{
        rowNum:   i+1,
        name:     name||username,
        username: username,
        token:    _makeToken(i+1, username),
        stage:    'pre_order',
        isNew:    false,
      }
    };
  }

  // New user — register by appending a row. Hash the password before storing.
  const newRowNum = data.length + 1;
  sheet.getRange(newRowNum, COL.CR_USER).setValue(username);
  sheet.getRange(newRowNum, COL.CS_PASS).setValue(_hashPassword(password));
  sheet.getRange(newRowNum, COL.CT_ACTIVE).setValue('TRUE');
  sheet.getRange(newRowNum, COL.CX_STAGE).setValue('pre_order');
  return {
    user:{
      rowNum:   newRowNum,
      name:     username,
      username: username,
      token:    _makeToken(newRowNum, username),
      stage:    'pre_order',
      isNew:    true,
    }
  };
}

// ── getRequests ────────────────────────────────────────────────────
function handleGetRequests(body){
  const t = _verifyToken(body.token);
  if(!t) throw new Error('פג תוקף הכניסה — התחבר מחדש');
  const sheet = _sheet();
  const row   = sheet.getRange(t.rowNum, 1, 1, COL.CY_QUEST).getValues()[0];

  const docs = _parseList(row[COL.CV_DOCS-1]);
  const info = _parseList(row[COL.CW_INFO-1]);
  return {
    docs,
    info,
    name:          row[COL.NAME-1]||t.username,
    stage:         'pre_order',
    questionnaire: _parseObj(row[COL.CY_QUEST-1]),
    pending:       [],
    rejections:    [],
  };
}

// ── uploadFile ─────────────────────────────────────────────────────
function handleUploadFile(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה');
  const sheet      = _sheet();
  const clientName = (sheet.getRange(t.rowNum, COL.NAME).getValue()||'').toString().trim()||('ת.ז '+t.username);
  const root       = DriveApp.getFolderById(DRIVE_ROOT_ID);
  const clientFolder = _ensureFolder(root, clientName);
  const tzavFolder   = _ensureFolder(clientFolder, 'צו פתיחה');

  const now   = new Date();
  const pad2  = n => String(n).padStart(2,'0');
  const ts    = pad2(now.getDate())+pad2(now.getMonth()+1)+String(now.getFullYear()).slice(-2)
              + pad2(now.getHours())+pad2(now.getMinutes())+pad2(now.getSeconds());
  const fname = ts+'_'+(p.filename||'file');
  const blob  = Utilities.newBlob(Utilities.base64Decode(p.dataBase64), p.mimeType||'application/octet-stream', fname);
  const file  = tzavFolder.createFile(blob);

  const colIdx = p.category==='docs' ? COL.CV_DOCS : COL.CW_INFO;
  const cell   = sheet.getRange(t.rowNum, colIdx);
  const list   = _parseList(cell.getValue());
  const req    = list.find(r=>r.id===p.reqId);
  if(req){
    if(!req.files) req.files=[];
    req.files.push({id:file.getId(), name:fname, url:file.getUrl(), ts:Date.now()});
    if(req.status==='pending'||req.status==='rejected') req.status='uploaded';
    cell.setValue(JSON.stringify(list));
  }
  return {fileId:file.getId(), fileUrl:file.getUrl(), fileName:fname};
}

// ── submitAnswer ───────────────────────────────────────────────────
function handleSubmitAnswer(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה');
  const sheet = _sheet();
  const cell  = sheet.getRange(t.rowNum, COL.CW_INFO);
  const list  = _parseList(cell.getValue());
  const req   = list.find(r=>r.id===p.reqId);
  if(!req) throw new Error('פריט לא נמצא');
  req.answer     = String(p.answer||'');
  req.status     = 'uploaded';
  req.answeredAt = Date.now();
  cell.setValue(JSON.stringify(list));
  return {ok:true};
}

// ── removeFile ─────────────────────────────────────────────────────
function handleRemoveFile(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה');
  const sheet  = _sheet();
  const colIdx = p.category==='docs' ? COL.CV_DOCS : COL.CW_INFO;
  const cell   = sheet.getRange(t.rowNum, colIdx);
  const list   = _parseList(cell.getValue());
  const req    = list.find(r=>r.id===p.reqId);
  if(!req||!req.files) return {ok:true};
  const idx = req.files.findIndex(f=>f.id===p.fileId);
  if(idx>=0){
    try{DriveApp.getFileById(p.fileId).setTrashed(true);}catch(_){}
    req.files.splice(idx,1);
    if(!req.files.length&&req.status==='uploaded') req.status='pending';
    cell.setValue(JSON.stringify(list));
  }
  return {ok:true};
}

// ── saveQuestionnaire ──────────────────────────────────────────────
function handleSaveQuestionnaire(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה');
  if(!p.data||typeof p.data!=='object') throw new Error('נתוני שאלון חסרים');
  p.data._savedAt = new Date().toISOString();
  const sheet      = _sheet();
  const clientName = (sheet.getRange(t.rowNum, COL.NAME).getValue()||'').toString().trim()||t.username;
  sheet.getRange(t.rowNum, COL.CY_QUEST).setValue(JSON.stringify(p.data));
  // Also update name column if first+last name are filled
  if(p.data.last_name||p.data.first_name){
    const fullName = ((p.data.last_name||'')+' '+(p.data.first_name||'')).trim();
    if(fullName) sheet.getRange(t.rowNum, COL.NAME).setValue(fullName);
  }
  try{ _saveQuestToSheet(clientName, p.data); }catch(e){Logger.log('Sheet save failed:'+e);}
  return {ok:true};
}

function handleGetQuestionnaire(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה');
  const sheet = _sheet();
  return {data: _parseObj(sheet.getRange(t.rowNum, COL.CY_QUEST).getValue())};
}

// ── sendInquiry ────────────────────────────────────────────────────
function handleSendInquiry(p){
  const t = _verifyToken(p.token);
  if(!t) throw new Error('פג תוקף הכניסה');
  const sheet = _sheet();
  const cell  = sheet.getRange(t.rowNum, COL.CZ_INQUIRIES);
  const list  = _parseList(cell.getValue());
  const entry = {id:Utilities.getUuid(), context:p.context||'כללי', message:p.message||'', ts:Date.now(), done:false};
  if(Array.isArray(p.slots)&&p.slots.length) entry.slots=p.slots;
  list.push(entry);
  cell.setValue(JSON.stringify(list));
  return {ok:true};
}

// ── Questionnaire → Google Sheet ───────────────────────────────────
function _saveQuestToSheet(clientName, d){
  const root       = DriveApp.getFolderById(DRIVE_ROOT_ID);
  const cf         = _ensureFolder(root, clientName);
  const tzavFolder = _ensureFolder(cf, 'צו פתיחה');
  const sheetName  = 'שאלון — '+clientName;
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
    {title:'פרטים אישיים',rows:[['שם משפחה',d.last_name],['שם פרטי',d.first_name],['ת.ז',d.id],['תאריך לידה',d.dob],['מין',d.gender],['מצב משפחתי',d.marital],['ארץ לידה',d.birth_country],['עלייה',d.aliya_date],['כתובת',d.address],['מיקוד',d.zip],['חדרים',d.apt_rooms],['זכויות',d.apt_rights],['טלפון',d.phone],['אימייל',d.email]]},
    {title:'בן/בת זוג',rows:[['שם משפחה',d.spouse_last],['שם פרטי',d.spouse_first],['ת.ז',d.spouse_id],['תאריך לידה',d.spouse_dob],['טלפון',d.spouse_phone]]},
    {title:'תעסוקה',rows:[['עיסוק',d.occupation],['מעסיק',d.employer],['כתובת עבודה',d.work_address],['תחילת עבודה',d.work_start],['ברוטו',d.salary_gross],['נטו',d.salary_net],['מעסיק זוג',d.spouse_employer],['ברוטו זוג',d.spouse_salary_gross],['נטו זוג',d.spouse_salary_net],['קצבת ילדים',d.child_allowance],['נכות',d.disability]]},
    {title:'הוצאות',rows:[['שכ"ד',d.rent],['ארנונה',d.arnona],['חשמל',d.electric],['מים',d.water],['גז',d.gas],['מזון',d.food],['רכב',d.car],['ביגוד',d.clothing],['חינוך',d.education],['אחר',d.other_exp]]},
    {title:'נכסים',rows:[['רכבים',d.cars],['בנקים',d.banks],['נדל"ן',d.realestate]]},
  ];
  let row=1;
  ws.getRange(row,1,1,2).merge().setValue('שאלון — '+clientName).setFontSize(13).setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#fff');
  row+=2;
  sections.forEach(sec=>{
    ws.getRange(row,1,1,2).merge().setValue(sec.title).setFontWeight('bold').setBackground('#3a5ba0').setFontColor('#fff');
    row++;
    sec.rows.forEach(([lbl,val])=>{if(!val)return;ws.getRange(row,1).setValue(lbl).setFontWeight('bold').setBackground('#f8f9fa');ws.getRange(row,2).setValue(val);row++;});
    row++;
  });
  if(Array.isArray(d.children)&&d.children.length){
    ws.getRange(row,1,1,4).merge().setValue('ילדים').setFontWeight('bold').setBackground('#3a5ba0').setFontColor('#fff');row++;
    ['שם משפחה','שם פרטי','ת.ז','תאריך לידה'].forEach((h,i)=>ws.getRange(row,i+1).setValue(h).setFontWeight('bold').setBackground('#e8edf5'));row++;
    d.children.forEach(k=>{ws.getRange(row,1).setValue(k.last||'');ws.getRange(row,2).setValue(k.first||'');ws.getRange(row,3).setValue(k.id||'');ws.getRange(row,4).setValue(k.dob||'');row++;});row++;
  }
  if(Array.isArray(d.creditors)&&d.creditors.length){
    ws.getRange(row,1,1,4).merge().setValue('נושים').setFontWeight('bold').setBackground('#3a5ba0').setFontColor('#fff');row++;
    ['שם נושה','סוג','סכום ₪','מצב'].forEach((h,i)=>ws.getRange(row,i+1).setValue(h).setFontWeight('bold').setBackground('#e8edf5'));row++;
    d.creditors.forEach(c=>{ws.getRange(row,1).setValue(c.name||'');ws.getRange(row,2).setValue(c.type||'');ws.getRange(row,3).setValue(c.amount||'');ws.getRange(row,4).setValue(c.status||'');row++;});
  }
  ws.setColumnWidth(1,180);ws.setColumnWidth(2,300);ws.setRightToLeft(true);
}
