import webview
import sys
import threading

from app import app

def start_server():
    app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)


if __name__ == '__main__':
    webview.create_window('ATL','http://127.0.0.1:5000', width=1024, height=768)
    webview.start(start_server)


