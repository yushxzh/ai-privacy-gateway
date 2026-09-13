"""测试端点仅连接回环上游；生产适配逻辑直接来自实际入口。"""
import importlib.util
import os
from pathlib import Path

spec = importlib.util.spec_from_file_location('production', Path(__file__).parents[1]/'src/https/workbuddy.py')
production = importlib.util.module_from_spec(spec)
spec.loader.exec_module(production)
for name in ('running', 'requestheaders', 'request', 'responseheaders', 'response', 'error'):
    globals()[name] = getattr(production, name)

def server_connect(data):
    if data.server.address[0] != 'www.workbuddy.ai':
        raise ValueError('test must not connect externally')
    data.server.address = ('127.0.0.1', int(os.environ['APG_TEST_UPSTREAM_PORT']))
