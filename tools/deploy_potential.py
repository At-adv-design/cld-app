"""Deploy potential/apps-script/Code.gs and print the web-app URL."""
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from pathlib import Path

PRIVATE  = Path.home() / '.legal-system-private'
TOKEN    = PRIVATE / 'google-token.json'
CODE_GS  = Path('C:/Users/redcastle/cld-app/potential/apps-script/Code.gs')
CLASP    = CODE_GS.parent / '.clasp.json'
POTENTIAL_HTML = Path('C:/Users/redcastle/cld-app/potential/index.html')

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/script.projects',
    'https://www.googleapis.com/auth/script.deployments',
]

creds = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
if creds.expired and creds.refresh_token:
    creds.refresh(Request())
    TOKEN.write_text(creds.to_json())

drive  = build('drive',  'v3', credentials=creds)
script = build('script', 'v1', credentials=creds)

code = CODE_GS.read_text(encoding='utf-8')
content_body = {'files': [
    {'name': 'Code', 'type': 'SERVER_JS', 'source': code},
    {'name': 'appsscript', 'type': 'JSON', 'source': json.dumps({
        'timeZone': 'Asia/Jerusalem',
        'dependencies': {},
        'exceptionLogging': 'STACKDRIVER',
        'runtimeVersion': 'V8',
        'webapp': {'executeAs': 'USER_DEPLOYING', 'access': 'ANYONE_ANONYMOUS'},
    })},
]}

# Re-use existing project if clasp file exists
pid = None
if CLASP.exists():
    try:
        pid = json.loads(CLASP.read_text())['scriptId']
        print(f'Re-using project: {pid}')
    except Exception:
        pass

if not pid:
    proj = script.projects().create(body={
        'title': 'Potential Clients API',
        'parentId': '1RitBIq8HXTVymhalA34HS4BRyfOzT6lq',
    }).execute()
    pid = proj['scriptId']
    print(f'Created project: {pid}')
    CLASP.write_text(json.dumps({'scriptId': pid}))

script.projects().updateContent(scriptId=pid, body=content_body).execute()
print('Content updated.')

ver  = script.projects().versions().create(scriptId=pid, body={'description':'Deploy'}).execute()
vnum = ver['versionNumber']
print(f'Version {vnum}.')

deps    = script.projects().deployments().list(scriptId=pid).execute().get('deployments', [])
web_dep = next((d for d in deps if any(e.get('entryPointType')=='WEB_APP' for e in d.get('entryPoints',[]))), None)

updated = False
if web_dep:
    try:
        script.projects().deployments().update(
            scriptId=pid, deploymentId=web_dep['deploymentId'],
            body={'deploymentConfig':{'versionNumber':vnum,'manifestFileName':'appsscript','description':'Update'}}
        ).execute()
        dep_id  = web_dep['deploymentId']
        updated = True
    except Exception as ex:
        print(f'Update failed ({ex}), creating new...')

if not updated:
    nd     = script.projects().deployments().create(
        scriptId=pid,
        body={'versionNumber':vnum,'manifestFileName':'appsscript','description':'Potential clients portal'}
    ).execute()
    dep_id = nd['deploymentId']

url = f'https://script.google.com/macros/s/{dep_id}/exec'
print(f'\n✅ DEPLOYED: {url}')

# Patch potential/index.html with the new URL
import re
html = POTENTIAL_HTML.read_text(encoding='utf-8')
new_html = re.sub(
    r"API_URL:\s*'https://script\.google\.com/macros/s/[^']+/exec'",
    f"API_URL: '{url}'",
    html
)
if new_html != html:
    POTENTIAL_HTML.write_text(new_html, encoding='utf-8')
    print(f'Updated API_URL in potential/index.html')
else:
    print('API_URL already up to date or placeholder not found — update manually.')
    print(f'Set API_URL to: {url}')
