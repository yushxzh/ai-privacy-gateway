"""离线构造 mitmproxy HTTPFlow，跨进程核对真实正文重写和 App 记录。"""
import asyncio
import hashlib
import importlib.util
import json
import gzip
from pathlib import Path
from mitmproxy import connection, http

spec=importlib.util.spec_from_file_location('apg_addon',Path(__file__).parents[1]/'src/https/workbuddy.py')
addon=importlib.util.module_from_spec(spec)
spec.loader.exec_module(addon)

def flow_for(text):
    flow=http.HTTPFlow(connection.Client(peername=('127.0.0.1',10001),sockname=('127.0.0.1',18788)),
                       connection.Server(address=('www.workbuddy.ai',443)))
    body={'model':'synthetic-native-model','stream':True,'messages':[{'role':'user','content':text}],
          'tools':[{'type':'function','function':{'name':'synthetic_tool','description':'helper',
                                               'parameters':{'type':'object','properties':{}}}}]}
    flow.request=http.Request.make('POST','https://www.workbuddy.ai/v2/chat/completions',json.dumps(body).encode(),
        {'content-type':'application/json','content-encoding':'gzip','authorization':'Bearer synthetic-login-for-local-test'})
    assert flow.request.raw_content[:2] == b'\x1f\x8b'
    return flow

async def main():
    await addon.running()
    flow=flow_for('apg.native@example.com 13800138000')
    addon.requestheaders(flow)
    assert flow.request.stream is False
    await addon.request(flow)
    assert flow.response is None
    assert flow.metadata['apg_confirmed']
    raw=flow.request.raw_content
    parsed=json.loads(raw)
    assert 'apg.native@example.com' not in parsed['messages'][0]['content']
    assert '13800138000' not in parsed['messages'][0]['content']
    assert '⟦EMAIL_' in parsed['messages'][0]['content']
    assert parsed['model']=='synthetic-native-model'
    assert parsed['tools'][0]['function']['name']=='synthetic_tool'
    assert flow.request.headers['authorization']=='Bearer synthetic-login-for-local-test'
    assert 'content-encoding' not in flow.request.headers
    assert int(flow.request.headers['content-length'])==len(raw)
    flow.response=http.Response.make(200,b'data: [DONE]\n\n',{'content-type':'text/event-stream'})
    addon.responseheaders(flow)
    assert flow.response.stream is True
    await addon.response(flow)
    blocked=flow_for('password=synthetic-private-0912')
    await addon.request(blocked)
    assert blocked.response.status_code==422
    assert 'apg_confirmed' not in blocked.metadata
    await addon.response(blocked)
    unsupported=flow_for([{'type':'text','text':'hello'},{'type':'image_url','image_url':{'url':'data:image/png;base64,c3ludGhldGlj'}}])
    await addon.request(unsupported)
    assert unsupported.response.status_code==422
    # 受保护端点在格式变化后仍必须阻断；记录不能存入失败正文或认证。
    cases = [
        lambda f: setattr(f.request, 'method', 'GET'),
        lambda f: f.request.headers.__setitem__('content-type', 'text/plain'),
        lambda f: f.request.headers.__setitem__('upgrade', 'websocket'),
        lambda f: setattr(f.request, 'content', b'{broken synthetic-secret-in-malformed-json'),
        lambda f: setattr(f.request, 'content', b'{"messages":[]}'),
        lambda f: setattr(f.request, 'content', b'{"model":"x","input":"synthetic-secret"}'),
        lambda f: setattr(f.request, 'content', b'{"model":"x","messages":[{"role":"user","content":"hello","unknown":"synthetic-secret"}]}'),
        lambda f: setattr(f.request, 'content', b'{"model":"x","messages":[{"role":"user","content":"hello"}],"unknown":"synthetic-secret"}'),
        lambda f: setattr(f.request, 'content', b'{"model":"x","model":"y","messages":[{"role":"user","content":"hello"}]}'),
        lambda f: setattr(f.request, 'path', '/v2/chat/completions?prompt=synthetic-secret'),
        lambda f: setattr(f.request, 'path', '/v2/chat%2fcompletions'),
        lambda f: setattr(f.request, 'path', '/v2/chat/completions/'),
        lambda f: setattr(f.request, 'path', '/v3/responses'),
        lambda f: setattr(f.request, 'path', '/v2//chat/completions'),
        lambda f: setattr(f.request, 'path', '/v2/test/../chat/completions'),
        lambda f: setattr(f.request, 'path', '/v2/chat/./completions'),
        lambda f: setattr(f.request, 'raw_content', gzip.compress(b'x'*(addon.LIMIT+1)))
    ]
    for mutate in cases:
        rejected = flow_for('hello')
        mutate(rejected)
        await addon.request(rejected)
        assert rejected.response.status_code == 422
        assert 'apg_confirmed' not in rejected.metadata
    outside = flow_for('outside-scope-synthetic-secret')
    outside.request.path = '/telemetry/synthetic-secret?token=synthetic-secret'
    await addon.request(outside)
    assert outside.response is None
    assert 'apg_id' not in outside.metadata
    metadata = flow_for('hello')
    parsed_metadata = json.loads(metadata.request.content)
    parsed_metadata['extra_vars'] = {'growthEvent': '{"contact":"native.growth@example.com"}'}
    parsed_metadata['messages'][0]['agent'] = 'native.meta@example.com'
    parsed_metadata['messages'][0]['traceId'] = 'synthetic-trace'
    parsed_metadata['tools'][0]['function']['parameters']['properties']['contact'] = {'type': 'string', 'enum': ['native.enum@example.com']}
    metadata.request.content = json.dumps(parsed_metadata).encode()
    await addon.request(metadata)
    assert metadata.response is None
    assert 'apg_confirmed' in metadata.metadata
    assert b'native.meta@example.com' not in metadata.request.raw_content
    assert b'native.enum@example.com' not in metadata.request.raw_content
    assert b'native.growth@example.com' not in metadata.request.raw_content
    assert b'synthetic-trace' in metadata.request.raw_content
    metadata.response = http.Response.make(200,b'{}',{'content-type':'application/json'})
    await addon.response(metadata)
    print(json.dumps({'sha256':hashlib.sha256(raw).hexdigest(),'id':flow.metadata['apg_id'],'success':True}))

asyncio.run(main())
