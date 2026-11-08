import os

from main import app, init_user_db

BASE_PATH = (os.environ.get('BASE_PATH') or '/lagersystem').rstrip('/')
if not BASE_PATH.startswith('/'):
    BASE_PATH = '/' + BASE_PATH

app.config['BASE_PATH'] = BASE_PATH
app.config['APPLICATION_ROOT'] = BASE_PATH or '/'
app.config['SESSION_COOKIE_PATH'] = BASE_PATH or '/'
app.config['PREFERRED_URL_SCHEME'] = 'https'

init_user_db()

application = app
