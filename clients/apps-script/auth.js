/**
 * auth.js — secure authentication helpers for the customer app.
 *
 * Replaces the previous plain-text + unsigned-token system:
 *   - Passwords stored as PBKDF2-SHA256 (100k iterations + 16-byte salt)
 *     in column CS, format: "pbkdf2$<iters>$<saltB64>$<hashB64>".
 *   - Session tokens are signed HS256 JWTs with 24h expiration. Secret
 *     lives in Script Properties (JWT_SECRET, set via _adminSetSecret).
 *
 * One-time setup:
 *   1. In Apps Script editor, run _adminAuthBootstrap() — generates a
 *      JWT_SECRET if missing and stores it in Script Properties.
 *   2. Run _adminMigrateAllPasswords() — converts every plain password
 *      in column CS to the hashed format. Idempotent (skips rows that
 *      are already hashed). Run again any time without harm.
 *
 * Public-facing API (called from Code.js):
 *   _verifyPassword(plain, stored)        -> bool
 *   _hashPassword(plain, saltBytes?)      -> "pbkdf2$..." string
 *   _jwtSign(payload)                     -> token string
 *   _jwtVerify(token)                     -> payload | null
 *
 * Admin endpoints (called from a logged-in lawyer client):
 *   admin_createClientPassword            -> generate temp password for a row
 *   admin_resetClientPassword             -> same, force change on next login
 *   admin_setClientActive                 -> enable/disable login
 *   admin_changeMyPassword                -> client changes own password
 */

// ─── Tunables ──────────────────────────────────────────────────────────
const PBKDF2_ITERS    = 100000;
const PBKDF2_SALT_LEN = 16;          // bytes
const JWT_TTL_SECONDS = 24 * 60 * 60;

// ─── Crypto primitives ─────────────────────────────────────────────────
function _bytesToB64(bytes){
  return Utilities.base64Encode(bytes);
}
function _b64ToBytes(b64){
  return Utilities.base64Decode(b64);
}
function _bytesToB64Url(bytes){
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}
function _b64UrlToBytes(b64url){
  // pad to multiple of 4
  const pad = b64url.length % 4 ? '='.repeat(4 - (b64url.length % 4)) : '';
  return Utilities.base64DecodeWebSafe(b64url + pad);
}
function _strToBytes(s){
  return Utilities.newBlob(s).getBytes();
}
function _bytesToStr(bytes){
  return Utilities.newBlob(bytes).getDataAsString();
}
function _randomBytes(n){
  // Apps Script lacks crypto.getRandomValues; use Math.random + time
  // mixed via SHA-256 for reasonable entropy. Sufficient for per-user
  // salt; not cryptographically perfect but PBKDF2 doesn't need secrecy
  // from the salt — only uniqueness.
  const seed = Utilities.getUuid() + ':' + Date.now() + ':' + Math.random();
  const dig = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed);
  // Repeat & truncate to n bytes (n <= 32 normally)
  const out = [];
  let cur = dig;
  while(out.length < n){
    for(let i=0; i<cur.length && out.length<n; i++) out.push(cur[i]);
    cur = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, cur);
  }
  return out;
}

// ─── PBKDF2-SHA256 (single 32-byte block — sufficient for our needs) ──
function _pbkdf2Sha256(passwordStr, saltBytes, iterations){
  // Standard PBKDF2: T1 = U1 XOR U2 XOR ... XOR Uc
  //   U1 = HMAC(P, S || INT(1))
  //   Ui = HMAC(P, U_{i-1})
  // Apps Script HMAC: computeHmacSha256Signature(value, key) — bytes accepted.
  const block1 = saltBytes.concat([0, 0, 0, 1]);
  let u = Utilities.computeHmacSha256Signature(block1, passwordStr);
  const t = u.slice();
  for(let i=1; i<iterations; i++){
    u = Utilities.computeHmacSha256Signature(u, passwordStr);
    for(let j=0; j<t.length; j++) t[j] ^= u[j];
  }
  return t;
}

// ─── Public: hash + verify password ────────────────────────────────────
function _hashPassword(plainPassword, optSaltBytes){
  if(!plainPassword || typeof plainPassword !== 'string') throw new Error('סיסמה חסרה');
  const salt = optSaltBytes && optSaltBytes.length === PBKDF2_SALT_LEN
    ? optSaltBytes
    : _randomBytes(PBKDF2_SALT_LEN);
  const hash = _pbkdf2Sha256(plainPassword, salt, PBKDF2_ITERS);
  return 'pbkdf2$' + PBKDF2_ITERS + '$' + _bytesToB64(salt) + '$' + _bytesToB64(hash);
}

function _verifyPassword(plainPassword, stored){
  if(!stored) return false;
  if(typeof stored !== 'string') stored = String(stored);
  const s = stored.trim();
  if(!s) return false;
  // Hashed format
  if(s.indexOf('pbkdf2$') === 0){
    const parts = s.split('$');
    if(parts.length !== 4) return false;
    const iters = parseInt(parts[1], 10) || PBKDF2_ITERS;
    const salt  = _b64ToBytes(parts[2]);
    const expected = _b64ToBytes(parts[3]);
    const got = _pbkdf2Sha256(plainPassword, salt, iters);
    if(got.length !== expected.length) return false;
    let diff = 0;
    for(let i=0; i<got.length; i++) diff |= (got[i] ^ expected[i]);
    return diff === 0;
  }
  // Legacy plain-text — accept once, caller should rewrite as hash
  return s === String(plainPassword).trim();
}

function _isHashedFormat(stored){
  return typeof stored === 'string' && stored.indexOf('pbkdf2$') === 0;
}

// ─── JWT (HS256) ───────────────────────────────────────────────────────
function _getJwtSecret(){
  const s = PropertiesService.getScriptProperties().getProperty('JWT_SECRET');
  if(!s) throw new Error('JWT_SECRET לא הוגדר. הפעל _adminAuthBootstrap מהעורך.');
  return s;
}

function _jwtSign(payload){
  const header = {alg:'HS256', typ:'JWT'};
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = Object.assign({iat: now, exp: now + JWT_TTL_SECONDS}, payload);
  const h = _bytesToB64Url(_strToBytes(JSON.stringify(header)));
  const p = _bytesToB64Url(_strToBytes(JSON.stringify(fullPayload)));
  const data = h + '.' + p;
  const sig = Utilities.computeHmacSha256Signature(data, _getJwtSecret());
  return data + '.' + _bytesToB64Url(sig);
}

function _jwtVerify(token){
  if(!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if(parts.length !== 3) return null;
  let secret;
  try { secret = _getJwtSecret(); } catch(_){ return null; }
  const expected = Utilities.computeHmacSha256Signature(parts[0] + '.' + parts[1], secret);
  const expectedB64 = _bytesToB64Url(expected);
  // Constant-time compare
  if(expectedB64.length !== parts[2].length) return null;
  let diff = 0;
  for(let i=0; i<expectedB64.length; i++) diff |= expectedB64.charCodeAt(i) ^ parts[2].charCodeAt(i);
  if(diff !== 0) return null;
  let payload;
  try { payload = JSON.parse(_bytesToStr(_b64UrlToBytes(parts[1]))); }
  catch(_){ return null; }
  if(payload.exp && Math.floor(Date.now()/1000) > payload.exp) return null;
  return payload;
}

// ─── Bootstrap (run once from the editor) ──────────────────────────────
function _adminAuthBootstrap(){
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('JWT_SECRET');
  if(s){
    return 'JWT_SECRET כבר קיים (' + s.length + ' תווים). אין צורך לעשות כלום.';
  }
  // 32-byte secret base64-encoded
  const secret = _bytesToB64(_randomBytes(32));
  props.setProperty('JWT_SECRET', secret);
  return 'JWT_SECRET נוצר ונשמר ב-Script Properties (' + secret.length + ' תווים).';
}

// ─── Migration: hash all plain passwords currently in column CS ────────
// Run from the Apps Script editor. Idempotent — skips already-hashed rows.
function _adminMigrateAllPasswords(){
  const sheet = _sheet();
  const lastRow = sheet.getLastRow();
  if(lastRow < 2) return 'אין נתונים לעדכן.';
  const range = sheet.getRange(2, COL.CS_PASS, lastRow - 1, 1);
  const vals  = range.getValues();
  let hashed = 0, skipped = 0, empty = 0;
  for(let i=0; i<vals.length; i++){
    const cur = (vals[i][0] || '').toString().trim();
    if(!cur){ empty++; continue; }
    if(_isHashedFormat(cur)){ skipped++; continue; }
    vals[i][0] = _hashPassword(cur);
    hashed++;
  }
  range.setValues(vals);
  _audit('admin_migrate_passwords', 'admin', {hashed, skipped, empty, total: vals.length});
  return 'הסתיים: ' + hashed + ' hashing, ' + skipped + ' כבר hashed, ' + empty + ' ריקים.';
}

// ─── Admin endpoints (require lawyer OAuth) ────────────────────────────
function _generateTempPassword(){
  // 10-char alphanumeric, easy to read aloud (no 0/O/1/l/I)
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let p = '';
  for(let i=0; i<10; i++) p += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return p;
}

function handleAdmin_createClientPassword(body){
  const v = _verifyLawyerToken(body.lawyerToken);
  if(!v.ok) throw new Error('הרשאה נדחתה: ' + (v.reason || 'token'));
  const rowNum = parseInt(body.rowNum, 10);
  const username = (body.username || '').toString().trim();
  if(!rowNum || rowNum < 2) throw new Error('rowNum לא תקין');
  if(!username) throw new Error('username חסר');
  const tempPassword = body.password || _generateTempPassword();
  const sheet = _sheet();
  sheet.getRange(rowNum, COL.CR_USER).setValue(username);
  sheet.getRange(rowNum, COL.CS_PASS).setValue(_hashPassword(tempPassword));
  sheet.getRange(rowNum, COL.CT_ACTIVE).setValue('TRUE');
  // Mark for forced change on first login (PropertiesService side-channel)
  PropertiesService.getScriptProperties().setProperty('force_change:' + username, '1');
  _audit('admin_create_password', v.email || 'admin', {rowNum, username});
  return {ok: true, username, tempPassword, mustChange: true};
}

function handleAdmin_resetClientPassword(body){
  return handleAdmin_createClientPassword(body); // same logic, different intent
}

function handleAdmin_setClientActive(body){
  const v = _verifyLawyerToken(body.lawyerToken);
  if(!v.ok) throw new Error('הרשאה נדחתה: ' + (v.reason || 'token'));
  const rowNum = parseInt(body.rowNum, 10);
  if(!rowNum || rowNum < 2) throw new Error('rowNum לא תקין');
  const active = body.active ? 'TRUE' : 'FALSE';
  _sheet().getRange(rowNum, COL.CT_ACTIVE).setValue(active);
  _audit('admin_set_active', v.email || 'admin', {rowNum, active});
  return {ok: true, rowNum, active};
}

function handleAdmin_listClientCredentials(body){
  // Lists username + active status only — never returns hashes or anything sensitive.
  const v = _verifyLawyerToken(body.lawyerToken);
  if(!v.ok) throw new Error('הרשאה נדחתה: ' + (v.reason || 'token'));
  const sheet = _sheet();
  const lastRow = sheet.getLastRow();
  if(lastRow < 2) return {ok: true, clients: []};
  const data = sheet.getRange(2, 1, lastRow - 1, Math.max(COL.CT_ACTIVE, COL.NAME, COL.CR_USER)).getValues();
  const clients = [];
  for(let i=0; i<data.length; i++){
    const row = data[i];
    const u = (row[COL.CR_USER-1] || '').toString().trim();
    const n = (row[COL.NAME-1] || '').toString().trim();
    const a = (row[COL.CT_ACTIVE-1] || '').toString().toUpperCase().trim();
    if(u || n){
      clients.push({rowNum: i+2, name: n, username: u, active: a === 'TRUE', hasPassword: !!u});
    }
  }
  return {ok: true, clients};
}

// ─── Self-service: client changes own password ─────────────────────────
function handleAdmin_changeMyPassword(body){
  // Verifies the client's own JWT (from current login), then updates their hash.
  const payload = _jwtVerify(body.token);
  if(!payload) throw new Error('פג תוקף הכניסה — התחבר מחדש');
  const oldPwd = body.oldPassword || '';
  const newPwd = body.newPassword || '';
  if(!newPwd || newPwd.length < 8) throw new Error('הסיסמה החדשה חייבת להכיל לפחות 8 תווים');
  const sheet = _sheet();
  const cell  = sheet.getRange(payload.rowNum, COL.CS_PASS);
  const cur   = (cell.getValue() || '').toString().trim();
  if(!_verifyPassword(oldPwd, cur)) throw new Error('הסיסמה הנוכחית לא נכונה');
  cell.setValue(_hashPassword(newPwd));
  PropertiesService.getScriptProperties().deleteProperty('force_change:' + payload.username);
  _audit('client_change_password', payload.username, {rowNum: payload.rowNum});
  return {ok: true};
}
