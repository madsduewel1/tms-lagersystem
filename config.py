import os

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dms-secret-key-change-me'
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or 'mysql+pymysql://testsystem:testsystempass@localhost:3306/testsystem?charset=utf8mb4'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    BASE_PATH = os.environ.get('BASE_PATH') or '/lagersystem'
    UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
