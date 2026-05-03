"""Create the 'לקוחות פוטנציאליים' Google Sheet and print its ID."""
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from pathlib import Path

PRIVATE    = Path.home() / '.legal-system-private'
TOKEN      = PRIVATE / 'google-token.json'
DRIVE_ROOT = '1RitBIq8HXTVymhalA34HS4BRyfOzT6lq'

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
]

creds = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
if creds.expired and creds.refresh_token:
    creds.refresh(Request())
    TOKEN.write_text(creds.to_json())

sheets = build('sheets', 'v4', credentials=creds)
drive  = build('drive',  'v3', credentials=creds)

# Check if sheet already exists in Drive root
existing = drive.files().list(
    q=f"name='לקוחות פוטנציאליים' and '{DRIVE_ROOT}' in parents and mimeType='application/vnd.google-apps.spreadsheet'",
    fields='files(id,name)'
).execute().get('files', [])

if existing:
    sid = existing[0]['id']
    print(f'Sheet already exists: {sid}')
else:
    body = {
        'properties': {'title': 'לקוחות פוטנציאליים'},
        'sheets': [{'properties': {'title': 'לקוחות', 'rightToLeft': True}}]
    }
    ss = sheets.spreadsheets().create(body=body, fields='spreadsheetId').execute()
    sid = ss['spreadsheetId']
    # Move to Drive folder
    drive.files().update(
        fileId=sid, addParents=DRIVE_ROOT, removeParents='root', fields='id'
    ).execute()
    print(f'Created new sheet: {sid}')

    # Write header row
    # Build header row — max col used is EF (1-based 136, 0-based 135)
    header_row = [''] * 136
    header_row[0]   = 'מספר'
    header_row[2]   = 'תז'
    header_row[21]  = 'טלפון'       # V
    header_row[22]  = 'שם'           # W
    header_row[95]  = 'שם משתמש'   # CR
    header_row[96]  = 'סיסמה'       # CS
    header_row[97]  = 'פעיל'        # CT
    header_row[132] = 'שלב'         # EC
    header_row[133] = 'שאלון'       # ED
    header_row[135] = 'פניות'       # EF
    sheets.spreadsheets().values().update(
        spreadsheetId=sid,
        range="'לקוחות'!A1:EF1",
        valueInputOption='RAW',
        body={'values': [header_row]}
    ).execute()
    print('Headers written')

print(f'\n✅ POTENTIAL_SHEET_ID = "{sid}"')

# Save the ID to a local config file for the app to use
config_path = Path(__file__).parent.parent / 'insolvency' / 'potential_sheet_id.txt'
config_path.write_text(sid, encoding='utf-8')
print(f'Saved to {config_path}')
